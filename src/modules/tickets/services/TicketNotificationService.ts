import { ContainerBuilder, MessageFlags } from 'discord.js';
import type { Guild, GuildMember, User } from 'discord.js';
import { TicketAuditAction, TicketStatus } from '@prisma/client';

import { EMOJIS } from '../../../constants/branding';
import { RateLimitError, TicketStateError, ValidationError } from '../../../core/errors';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import { createLogger } from '../../../core/logger/Logger';
import { assertCanManageTicketMembers } from '../../../core/permissions/PermissionService';
import {
  NO_MENTIONS,
  isDmBlockedError,
  isUnknownResourceError,
  mentionOnly,
  userMention,
} from '../../../utils/discord';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { recordTicketAudit } from '../../audit/repositories/AuditRepository';
import { buildClosureDm } from '../builders/TicketClosureBuilder';
import {
  buildClientNotifyDm,
  type LastStaffMessage,
} from '../builders/TicketNotifyBuilder';
import { findTicketById, touchClientNotify } from '../repositories/TicketRepository';
import { getCategoryById } from './TicketConfigService';
import {
  reopenIfArchived,
  resolveTicketChannel,
  type TicketConversation,
} from './TicketChannelService';

/**
 * Notificacoes ao cliente.
 *
 * Falha de DM (usuario com DM fechada) NUNCA quebra a operacao: retorna false,
 * registra warning e o chamador informa a equipe.
 */

const logger = createLogger('ticket:notify');

export interface NotifyResult {
  channelNotified: boolean;
  dmSent: boolean;
}

/** Envia uma DM Components V2. Retorna false quando o usuario nao aceita DMs. */
async function trySendDm(
  user: User,
  root: ContainerBuilder,
  context: Record<string, unknown>,
): Promise<boolean> {
  try {
    await user.send({
      components: [root],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS,
    });
    return true;
  } catch (error) {
    if (isDmBlockedError(error) || isUnknownResourceError(error)) {
      logger.warn('Nao foi possivel enviar DM ao cliente.', { ...context, userId: user.id });
      return false;
    }
    throw error;
  }
}

/**
 * Ultima mensagem da EQUIPE no atendimento.
 *
 * "Da equipe" e definido por exclusao — nao e do cliente e nao e do bot. E mais
 * robusto que checar cargo: quem responde pode ser um administrador sem o cargo
 * de equipe da categoria, e o cliente continua sendo o unico id que nunca conta.
 *
 * Le uma pagina de 50 mensagens. Se a equipe nao falou nas ultimas 50, a
 * citacao simplesmente nao entra — buscar mais fundo custaria varias chamadas
 * REST dentro de um lock, e a DM ainda funciona sem ela.
 *
 * Mensagem so com anexo (print, sem texto) vira um aviso curto em vez de
 * citacao vazia: o cliente precisa saber que ha algo para ver.
 */
async function findLastStaffMessage(
  channel: TicketConversation,
  ownerId: string,
): Promise<LastStaffMessage | null> {
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    const botId = channel.client.user.id;

    for (const message of recent.values()) {
      if (message.author.id === ownerId || message.author.id === botId) continue;

      const content =
        message.content.trim().length > 0
          ? message.content
          : message.attachments.size > 0
            ? '(enviou um arquivo)'
            : '';
      if (content.length === 0) continue;

      return {
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username,
        content,
        createdAt: message.createdAt,
      };
    }
    return null;
  } catch (error) {
    // Historico indisponivel nao pode impedir a notificacao: ela ainda avisa.
    logger.warn('Nao foi possivel ler a ultima mensagem da equipe.', {
      channelId: channel.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Notifica o cliente no canal e por DM que a equipe aguarda resposta. */
export async function notifyClient(
  guild: Guild,
  actor: GuildMember,
  ticketId: string,
): Promise<NotifyResult> {
  const ticket = await findTicketById(ticketId);
  if (ticket === null || ticket.guildId !== guild.id) {
    throw new ValidationError(`Ticket inexistente: ${ticketId}`, {
      userMessage: 'Este atendimento nao foi encontrado.',
    });
  }
  if (
    ticket.status === TicketStatus.CLOSED ||
    ticket.status === TicketStatus.CLOSING ||
    ticket.status === TicketStatus.ORPHANED
  ) {
    throw new TicketStateError('Ticket inativo.', {
      userMessage: 'Este atendimento nao esta mais ativo.',
    });
  }

  await assertCanManageTicketMembers(actor, ticket);

  /*
   * Sob lock: o cooldown le `lastClientNotifyAt` e so grava `touchClientNotify`
   * DEPOIS de enviar o ping no canal. Sem o lock, dois cliques simultaneos
   * passavam os dois pela janela e o cliente levava ping duplo no canal mais
   * duas DMs — furando um cooldown que existe justamente para nao incomoda-lo.
   */
  return locks.withLock(
    LOCK_NAMESPACE.TICKET_ADMIN,
    `notify:${ticket.id}`,
    async () => {
      // Releitura dentro do lock: precisa enxergar o `touchClientNotify` que o
      // clique concorrente acabou de gravar.
      const fresh = await findTicketById(ticketId);
      if (fresh === null || fresh.guildId !== guild.id) {
        throw new ValidationError(`Ticket inexistente: ${ticketId}`, {
          userMessage: 'Este atendimento nao foi encontrado.',
        });
      }

      const config = await getGuildConfig(guild.id);
      if (config.clientNotifyCooldownSeconds > 0 && fresh.lastClientNotifyAt !== null) {
        const elapsed = Math.floor((Date.now() - fresh.lastClientNotifyAt.getTime()) / 1000);
        const remaining = config.clientNotifyCooldownSeconds - elapsed;
        if (remaining > 0) {
          throw new RateLimitError(remaining, {
            userMessage: `O cliente ja foi notificado recentemente. Aguarde ${remaining} segundo(s).`,
          });
        }
      }

      const channel = await resolveTicketChannel(guild, fresh.channelId);
      if (channel === null) {
        throw new TicketStateError('Canal do ticket nao existe mais.', {
          userMessage: 'O canal deste atendimento nao existe mais.',
        });
      }

      // Ticket entregue fica ARQUIVADO esperando o cliente confirmar — e e
      // justamente nele que a equipe mais vai querer cutucar o cliente.
      await reopenIfArchived(channel, 'Cliente notificado pela equipe');

      await channel.send({
        content: `${EMOJIS.NOTIFY} ${userMention(fresh.ownerId)}, nossa equipe esta aguardando sua resposta.`,
        allowedMentions: mentionOnly(fresh.ownerId),
      });

      await touchClientNotify(fresh.id);

      const category = await getCategoryById(guild.id, fresh.categoryId);
      const config2 = await getGuildConfig(guild.id);
      const root = buildClientNotifyDm({
        storeName: config2.storeName,
        guildId: guild.id,
        channelId: channel.id,
        ownerId: fresh.ownerId,
        ticketNumber: fresh.ticketNumber,
        categoryName: category?.name ?? 'Categoria removida',
        staffId: actor.id,
        bannerUrl: config2.ticketBannerUrl,
        lastMessage: await findLastStaffMessage(channel, fresh.ownerId),
      });

      let dmSent = false;
      try {
        const user = await guild.client.users.fetch(fresh.ownerId);
        dmSent = await trySendDm(user, root, {
          guildId: guild.id,
          entityType: 'ticket',
          entityId: fresh.id,
        });
      } catch (error) {
        if (!isUnknownResourceError(error)) throw error;
      }

      await recordTicketAudit({
        guildId: guild.id,
        ticketId: fresh.id,
        action: TicketAuditAction.CLIENT_NOTIFIED,
        actorId: actor.id,
        targetId: fresh.ownerId,
        metadata: { dmSent },
      });

      return { channelNotified: true, dmSent };
    },
    { userMessage: 'O cliente ja esta sendo notificado.' },
  );
}

/**
 * DM de encerramento do atendimento.
 *
 * Leva TAMBEM o convite de avaliacao, no mesmo cartao. O layout vive em
 * `buildClosureDm`; aqui fica so a entrega, que continua best-effort: cliente
 * com DM fechada devolve `false` e o encerramento segue.
 */
export async function sendClosureDm(params: {
  guild: Guild;
  ownerId: string;
  ticketNumber: number;
  categoryName: string;
  storeName: string;
  closedById: string | null;
  closedByLabel: string | null;
  closeReason: string | null;
  bannerUrl: string | null;
  reviewTicketId: string | null;
  /** Transcript hospedado; ausente apenas omite o botao. */
  transcriptUrl: string | null;
}): Promise<boolean> {
  const root = buildClosureDm({
    storeName: params.storeName,
    ownerId: params.ownerId,
    ticketNumber: params.ticketNumber,
    categoryName: params.categoryName,
    closedById: params.closedById,
    closedByLabel: params.closedByLabel,
    closeReason: params.closeReason,
    bannerUrl: params.bannerUrl,
    reviewTicketId: params.reviewTicketId,
    transcriptUrl: params.transcriptUrl,
  });

  try {
    const user = await params.guild.client.users.fetch(params.ownerId);
    return await trySendDm(user, root, {
      guildId: params.guild.id,
      entityType: 'ticket',
      ticketNumber: params.ticketNumber,
    });
  } catch (error) {
    if (isUnknownResourceError(error)) return false;
    throw error;
  }
}
