import { TicketAuditAction, TicketStatus } from '@prisma/client';
import type { Guild, GuildMember } from 'discord.js';
import type { Ticket } from '@prisma/client';

import { BUSINESS_LIMITS } from '../../../constants/limits';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import { RateLimitError, TicketStateError, ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { assertCanManageTicketMembers } from '../../../core/permissions/PermissionService';
import { sanitizeChannelName } from '../../../utils/sanitize';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { recordTicketAudit } from '../../audit/repositories/AuditRepository';
import {
  addParticipant,
  countActiveParticipants,
  isActiveParticipant,
  listActiveParticipants,
  removeParticipant,
} from '../repositories/TicketParticipantRepository';
import { findTicketById, touchRename } from '../repositories/TicketRepository';
import {
  grantChannelAccess,
  renameTicketChannel,
  resolveTicketChannel,
  revokeChannelAccess,
} from './TicketChannelService';
import { refreshInternalPanel } from './TicketViewService';
import { grantCategoryAccess, revokeCategoryAccessIfLast } from './TicketAccessService';

/** Renomear canal, adicionar e remover participantes do ticket. */

const logger = createLogger('ticket:members');

async function loadEditableTicket(guild: Guild, ticketId: string): Promise<Ticket> {
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
    throw new TicketStateError(`Ticket nao editavel: ${ticket.status}`, {
      userMessage: 'Este atendimento nao esta mais ativo.',
    });
  }
  return ticket;
}

/**
 * Renomeia o canal do ticket.
 *
 * Roda inteiro sob lock: a checagem do cooldown le `lastRenamedAt` e so grava
 * `touchRename` depois de a API do Discord responder. Sem o lock, dois cliques
 * simultaneos passavam os dois pelo cooldown. Isso importa porque o Discord
 * limita `PATCH /channels` (nome/topico) a 2 por 10 minutos: da terceira em
 * diante o REST do discord.js DORME o `retry_after` (ate ~600s) dentro do
 * `setName`, travando o handler e a rota inteira.
 */
export async function renameTicket(
  guild: Guild,
  actor: GuildMember,
  ticketId: string,
  requestedName: string,
): Promise<{ oldName: string; newName: string }> {
  const ticket = await loadEditableTicket(guild, ticketId);
  await assertCanManageTicketMembers(actor, ticket);

  return locks.withLock(
    LOCK_NAMESPACE.TICKET_ADMIN,
    `rename:${ticket.id}`,
    async () => {
      // Releitura DENTRO do lock: o cooldown precisa enxergar a renomeacao que
      // o clique concorrente acabou de gravar.
      const fresh = await loadEditableTicket(guild, ticketId);

      const config = await getGuildConfig(guild.id);
      if (config.renameCooldownSeconds > 0 && fresh.lastRenamedAt !== null) {
        const elapsed = Math.floor((Date.now() - fresh.lastRenamedAt.getTime()) / 1000);
        const remaining = config.renameCooldownSeconds - elapsed;
        if (remaining > 0) {
          throw new RateLimitError(remaining, {
            userMessage: `Aguarde ${remaining} segundo(s) para renomear este canal novamente.`,
          });
        }
      }

      const channel = await resolveTicketChannel(guild, fresh.channelId);
      if (channel === null) {
        throw new TicketStateError('Canal do ticket nao existe mais.', {
          userMessage: 'O canal deste atendimento nao existe mais.',
        });
      }

      const desired = sanitizeChannelName(requestedName, channel.name);
      if (desired === channel.name) {
        throw new ValidationError('Nome identico ao atual.', {
          userMessage: 'O canal ja possui esse nome.',
        });
      }

      const oldName = channel.name;
      const newName = await renameTicketChannel(
        channel,
        desired,
        `Renomeado por ${actor.user.tag} • ticket #${fresh.ticketNumber}`,
      );

      await touchRename(fresh.id, newName);
      await recordTicketAudit({
        guildId: guild.id,
        ticketId: fresh.id,
        action: TicketAuditAction.RENAMED,
        actorId: actor.id,
        oldValue: oldName,
        newValue: newName,
      });

      logger.info('Canal do ticket renomeado.', {
        guildId: guild.id,
        userId: actor.id,
        entityType: 'ticket',
        entityId: fresh.id,
        oldName,
        newName,
      });

      return { oldName, newName };
    },
    { userMessage: 'Este canal ja esta sendo renomeado.' },
  );
}

export async function addTicketMember(
  guild: Guild,
  actor: GuildMember,
  ticketId: string,
  target: GuildMember,
): Promise<void> {
  const ticket = await loadEditableTicket(guild, ticketId);
  await assertCanManageTicketMembers(actor, ticket);

  if (target.user.bot) {
    throw new ValidationError('Alvo e um bot.', {
      userMessage: 'Nao e possivel adicionar bots ao atendimento.',
    });
  }
  if (target.id === ticket.ownerId) {
    throw new ValidationError('Alvo ja e o dono do ticket.', {
      userMessage: 'Este usuario ja e o cliente deste atendimento.',
    });
  }
  if (await isActiveParticipant(ticket.id, target.id)) {
    throw new ValidationError('Usuario ja participa do ticket.', {
      userMessage: 'Este usuario ja foi adicionado a este atendimento.',
    });
  }

  const current = await countActiveParticipants(ticket.id);
  if (current >= BUSINESS_LIMITS.MAX_PARTICIPANTS_PER_TICKET) {
    throw new ValidationError(`Limite de participantes atingido: ${current}`, {
      userMessage: `Este atendimento ja possui o maximo de ${BUSINESS_LIMITS.MAX_PARTICIPANTS_PER_TICKET} participantes adicionais.`,
    });
  }

  const channel = await resolveTicketChannel(guild, ticket.channelId);
  if (channel === null) {
    throw new TicketStateError('Canal do ticket nao existe mais.', {
      userMessage: 'O canal deste atendimento nao existe mais.',
    });
  }

  /*
   * CANAL-PAI PRIMEIRO, TOPICO DEPOIS.
   *
   * Ser membro do topico nao basta: sem `ViewChannel` no canal-pai o Discord
   * nao mostra a conversa nem para quem foi adicionado a ela. E a ordem
   * importa — o gateway so entrega eventos de topico a quem ja enxerga o pai,
   * entao adicionar primeiro faria o topico aparecer para o convidado apenas
   * depois de ele reiniciar o Discord.
   */
  await grantCategoryAccess(
    guild,
    ticket.categoryId,
    target.id,
    `Adicionado ao ticket #${ticket.ticketNumber}`,
  );
  await grantChannelAccess(
    channel,
    target,
    `Adicionado por ${actor.user.tag} • ticket #${ticket.ticketNumber}`,
  );
  await addParticipant({
    guildId: guild.id,
    ticketId: ticket.id,
    userId: target.id,
    addedById: actor.id,
  });

  await recordTicketAudit({
    guildId: guild.id,
    ticketId: ticket.id,
    action: TicketAuditAction.MEMBER_ADDED,
    actorId: actor.id,
    targetId: target.id,
  });

  await refreshInternalPanel(guild, ticket);

  logger.info('Participante adicionado ao ticket.', {
    guildId: guild.id,
    userId: actor.id,
    entityType: 'ticket',
    entityId: ticket.id,
    targetId: target.id,
  });
}

export async function removeTicketMember(
  guild: Guild,
  actor: GuildMember,
  ticketId: string,
  targetUserId: string,
): Promise<void> {
  const ticket = await loadEditableTicket(guild, ticketId);
  await assertCanManageTicketMembers(actor, ticket);

  if (targetUserId === ticket.ownerId) {
    throw new ValidationError('Tentativa de remover o dono do ticket.', {
      userMessage: 'O cliente do atendimento nao pode ser removido.',
    });
  }
  if (targetUserId === guild.client.user.id) {
    throw new ValidationError('Tentativa de remover o bot.', {
      userMessage: 'O bot nao pode ser removido do atendimento.',
    });
  }
  if (!(await isActiveParticipant(ticket.id, targetUserId))) {
    throw new ValidationError('Usuario nao e participante ativo.', {
      userMessage: 'Este usuario nao esta na lista de participantes adicionais.',
    });
  }

  const channel = await resolveTicketChannel(guild, ticket.channelId);
  if (channel !== null) {
    await revokeChannelAccess(
      channel,
      targetUserId,
      `Removido por ${actor.user.tag} • ticket #${ticket.ticketNumber}`,
    );
  }
  // Só cega quem nao tem mais nenhum atendimento aberto nesta categoria.
  await revokeCategoryAccessIfLast(
    guild,
    ticket.categoryId,
    targetUserId,
    null,
    `Removido do ticket #${ticket.ticketNumber}`,
  );

  await removeParticipant({
    ticketId: ticket.id,
    userId: targetUserId,
    removedById: actor.id,
  });

  await recordTicketAudit({
    guildId: guild.id,
    ticketId: ticket.id,
    action: TicketAuditAction.MEMBER_REMOVED,
    actorId: actor.id,
    targetId: targetUserId,
  });

  await refreshInternalPanel(guild, ticket);

  logger.info('Participante removido do ticket.', {
    guildId: guild.id,
    userId: actor.id,
    entityType: 'ticket',
    entityId: ticket.id,
    targetId: targetUserId,
  });
}

/** Ids dos participantes ativos (usado pelo painel de remocao). */
export async function listTicketParticipantIds(ticketId: string): Promise<string[]> {
  const participants = await listActiveParticipants(ticketId);
  return participants.map((participant) => participant.userId);
}
