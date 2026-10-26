import { TicketAuditAction } from '@prisma/client';
import type { Guild, GuildMember } from 'discord.js';
import type { Ticket } from '@prisma/client';

import { COOLDOWN_NAMESPACE, LOCK_NAMESPACE, cooldowns, locks } from '../../../core/locks/LockService';
import {
  ConfigurationError,
  RateLimitError,
  TicketLimitError,
  ValidationError,
} from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { getPrisma } from '../../../core/database/prisma';
import { sanitizeTicketSubject } from '../../../utils/sanitize';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { recordTicketAudit } from '../../audit/repositories/AuditRepository';
import {
  activateTicket,
  attachTicketChannel,
  countOpenTicketsByGuild,
  countOpenTicketsByUser,
  createTicket as persistTicket,
  lastTicketCreatedAt,
  reserveTicketNumber,
} from '../repositories/TicketRepository';

import { initialPriorityFor } from './TicketPriorityService';
import {
  createTicketChannel,
  type TicketConversation,
} from './TicketChannelService';
import { getCategoryById, getTeamRoleIds } from './TicketConfigService';
import { getQueueInfo, refreshQueueHead, type QueueInfo } from './TicketQueueService';
import { sendInternalPanel } from './TicketViewService';

/**
 * Abertura de ticket.
 *
 * Ordem executada (espelha o fluxo oficial do sistema):
 *  guild -> categoria -> status -> destino -> equipe -> cooldown -> limite do
 *  usuario -> limite global -> lock -> numero -> ticket(CREATING) -> canal ->
 *  permissoes -> channelId -> OPEN -> fila -> painel -> auditoria -> libera lock.
 */

const logger = createLogger('ticket:create');

export interface CreateTicketRequest {
  guild: Guild;
  member: GuildMember;
  categoryId: string;
  subject: string;
}

export interface CreateTicketResult {
  ticket: Ticket;
  channel: TicketConversation;
  categoryName: string;
  queue: QueueInfo;
}

/** Valida cooldown em memoria E no banco (o banco sobrevive a restart). */
async function assertCooldown(
  guildId: string,
  userId: string,
  cooldownSeconds: number,
): Promise<void> {
  if (cooldownSeconds <= 0) return;

  const key = `${guildId}:${userId}`;
  const memoryRemaining = cooldowns.remainingSeconds(
    COOLDOWN_NAMESPACE.TICKET_CREATE,
    key,
    cooldownSeconds,
  );
  if (memoryRemaining > 0) {
    throw new RateLimitError(memoryRemaining, {
      userMessage: `Aguarde ${memoryRemaining} segundo(s) antes de abrir outro atendimento.`,
    });
  }

  const last = await lastTicketCreatedAt(guildId, userId);
  if (last === null) return;

  const elapsedSeconds = Math.floor((Date.now() - last.getTime()) / 1000);
  const remaining = cooldownSeconds - elapsedSeconds;
  if (remaining > 0) {
    throw new RateLimitError(remaining, {
      userMessage: `Aguarde ${remaining} segundo(s) antes de abrir outro atendimento.`,
    });
  }
}

export async function createTicketFlow(
  request: CreateTicketRequest,
): Promise<CreateTicketResult> {
  const guildId = request.guild.id;
  const userId = request.member.id;

  const subject = sanitizeTicketSubject(request.subject);
  const config = await getGuildConfig(guildId);

  const category = await getCategoryById(guildId, request.categoryId);
  if (category === null || category.deletedAt !== null) {
    throw new ValidationError(`Categoria inexistente: ${request.categoryId}`, {
      userMessage: 'Esta categoria nao existe mais. Atualize o painel e tente novamente.',
    });
  }
  if (!category.enabled) {
    throw new ValidationError(`Categoria desabilitada: ${category.id}`, {
      userMessage: 'Esta categoria esta temporariamente indisponivel.',
    });
  }

  const teamRoleIds = await getTeamRoleIds(category.id);
  if (teamRoleIds.length === 0) {
    throw new ConfigurationError(`Categoria sem equipe: ${category.id}`, {
      userMessage:
        'Esta categoria ainda nao possui equipe responsavel configurada. Avise um administrador.',
      context: { guildId, entityType: 'category', entityId: category.id },
    });
  }

  await assertCooldown(guildId, userId, config.ticketCreateCooldownSeconds);

  return locks.withLock(
    LOCK_NAMESPACE.TICKET_CREATE,
    `${guildId}:${userId}`,
    async () => {
      const openByUser = await countOpenTicketsByUser(guildId, userId);
      if (openByUser >= config.maxOpenTicketsPerUser) {
        throw new TicketLimitError(`Limite por usuario atingido: ${openByUser}`, {
          userMessage:
            config.maxOpenTicketsPerUser === 1
              ? 'Voce ja possui um atendimento em aberto. Finalize-o antes de abrir outro.'
              : `Voce ja possui ${config.maxOpenTicketsPerUser} atendimentos em aberto.`,
        });
      }

      const openByGuild = await countOpenTicketsByGuild(guildId);
      if (openByGuild >= config.maxOpenTicketsGuild) {
        throw new TicketLimitError(`Limite global atingido: ${openByGuild}`, {
          userMessage:
            'A central de atendimento atingiu o limite de tickets simultaneos. Tente novamente em instantes.',
        });
      }

      const ticketNumber = await reserveTicketNumber(guildId);

      /*
       * Cliente com pedido em aberto entra na frente.
       *
       * E quem ja pagou ou esta pagando: deixar essa pessoa atras de uma duvida
       * generica e o tipo de espera que vira pedido de reembolso. A consulta e
       * melhor-esforco — falhando, o ticket abre NORMAL e nada quebra.
       */
      const priority = await initialPriorityFor(guildId, userId);

      const created = await persistTicket({
        guildId,
        ticketNumber,
        categoryId: category.id,
        ownerId: userId,
        subject,
        priority,
      });

      let channel: TicketConversation;
      try {
        channel = await createTicketChannel({
          guild: request.guild,
          ticketNumber,
          ownerId: userId,
          subject,
          categoryName: category.name,
          destinationChannelId: category.destinationChannelId,
          teamRoleIds,
        });
      } catch (error) {
        // O canal nao existe: remove o rascunho para nao deixar ticket fantasma.
        await getPrisma()
          .ticket.delete({ where: { id: created.id } })
          .catch(() => undefined);
        throw error;
      }

      // Grava o canal IMEDIATAMENTE, antes de qualquer envio de mensagem. Uma
      // queda daqui em diante deixa `CREATING + channelId`, que o recovery
      // promove para OPEN; sem isso a linha seria apagada e o canal ficaria
      // orfao no Discord, invisivel para o sistema inteiro.
      await attachTicketChannel(created.id, {
        channelId: channel.id,
        channelName: channel.name,
      });

      const ticket = await activateTicket(created.id, {
        channelId: channel.id,
        channelName: channel.name,
      });

      cooldowns.mark(COOLDOWN_NAMESPACE.TICKET_CREATE, `${guildId}:${userId}`);

      await sendInternalPanel(channel, ticket);

      const queue = await getQueueInfo(ticket);

      await recordTicketAudit({
        guildId,
        ticketId: ticket.id,
        action: TicketAuditAction.CREATED,
        actorId: userId,
        newValue: `#${ticketNumber} • ${category.name}`,
        metadata: { categoryId: category.id, channelId: channel.id, subject },
      });

      logger.info('Ticket criado.', {
        guildId,
        userId,
        channelId: channel.id,
        entityType: 'ticket',
        entityId: ticket.id,
        ticketNumber,
        queuePosition: queue.position,
      });

      // Atualiza o topo da fila (posicoes de quem ja aguardava nao mudam,
      // mas o total exibido sim). Falha aqui nao afeta a criacao.
      void refreshQueueHead(request.guild, category.id, { skipTicketId: ticket.id });

      return { ticket, channel, categoryName: category.name, queue };
    },
    { userMessage: 'Voce ja esta abrindo um atendimento. Aguarde alguns segundos.' },
  );
}
