import { TicketAuditAction, TicketStatus } from '@prisma/client';
import type { Guild, GuildMember } from 'discord.js';
import type { Ticket } from '@prisma/client';

import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import {
  TicketAlreadyClaimedError,
  TicketStateError,
  ValidationError,
} from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import {
  assertCanClaimTicket,
  assertCanManageTicketMembers,
  isCategoryStaff,
} from '../../../core/permissions/PermissionService';
import { recordTicketAudit, recordTicketTransfer } from '../../audit/repositories/AuditRepository';
import {
  claimTicketAtomic,
  findTicketById,
  transferTicketAtomic,
} from '../repositories/TicketRepository';
import { refreshQueueHead } from './TicketQueueService';
import { refreshInternalPanel } from './TicketViewService';

/**
 * Assumir e transferir atendimento.
 *
 * A protecao real contra corrida NAO e o lock de RAM: e o `updateMany` com
 * `where: { claimedById: null, status: OPEN }`. Se dois atendentes clicarem no
 * mesmo milissegundo, apenas um update afeta uma linha; o outro recebe count 0
 * e e informado de quem assumiu.
 */

const logger = createLogger('ticket:claim');

export interface ClaimResult {
  ticket: Ticket;
  alreadyClaimedBy?: string;
}

export async function claimTicket(
  guild: Guild,
  member: GuildMember,
  ticketId: string,
): Promise<ClaimResult> {
  const ticket = await findTicketById(ticketId);
  if (ticket === null || ticket.guildId !== guild.id) {
    throw new ValidationError(`Ticket inexistente: ${ticketId}`, {
      userMessage: 'Este atendimento nao foi encontrado.',
    });
  }

  if (ticket.status === TicketStatus.CLOSED || ticket.status === TicketStatus.ORPHANED) {
    throw new TicketStateError('Ticket encerrado nao pode ser assumido.', {
      userMessage: 'Este atendimento ja foi encerrado.',
    });
  }
  if (ticket.status === TicketStatus.CLOSING) {
    throw new TicketStateError('Ticket em fechamento.', {
      userMessage: 'Este atendimento esta sendo finalizado.',
    });
  }
  if (ticket.claimedById !== null) {
    throw new TicketAlreadyClaimedError(ticket.claimedById);
  }

  await assertCanClaimTicket(member, ticket);

  return locks.withLock(
    LOCK_NAMESPACE.TICKET_CLAIM,
    ticket.id,
    async () => {
      const won = await claimTicketAtomic(ticket.id, member.id);

      if (!won) {
        // Perdeu a corrida: descobre quem ganhou para dar uma resposta util.
        const current = await findTicketById(ticket.id);
        if (current?.claimedById != null && current.claimedById !== member.id) {
          throw new TicketAlreadyClaimedError(current.claimedById);
        }
        throw new TicketStateError('Nao foi possivel assumir o atendimento.', {
          userMessage: 'Nao foi possivel assumir este atendimento. Atualize o painel.',
        });
      }

      const updated = await findTicketById(ticket.id);
      const claimed = updated ?? ticket;

      await recordTicketAudit({
        guildId: guild.id,
        ticketId: ticket.id,
        action: TicketAuditAction.CLAIMED,
        actorId: member.id,
      });

      logger.info('Ticket assumido.', {
        guildId: guild.id,
        userId: member.id,
        entityType: 'ticket',
        entityId: ticket.id,
        ticketNumber: ticket.ticketNumber,
      });

      await refreshInternalPanel(guild, claimed);
      // Quem estava atras na fila subiu de posicao.
      void refreshQueueHead(guild, ticket.categoryId);

      return { ticket: claimed };
    },
    { userMessage: 'Este atendimento esta sendo assumido neste momento.' },
  );
}

export interface TransferResult {
  ticket: Ticket;
  fromStaffId: string | null;
  toStaffId: string;
}

export async function transferTicket(
  guild: Guild,
  actor: GuildMember,
  ticketId: string,
  targetMember: GuildMember,
): Promise<TransferResult> {
  const ticket = await findTicketById(ticketId);
  if (ticket === null || ticket.guildId !== guild.id) {
    throw new ValidationError(`Ticket inexistente: ${ticketId}`, {
      userMessage: 'Este atendimento nao foi encontrado.',
    });
  }
  if (ticket.status !== TicketStatus.CLAIMED) {
    throw new TicketStateError('Somente ticket assumido pode ser transferido.', {
      userMessage: 'Este atendimento precisa estar assumido para ser transferido.',
    });
  }

  await assertCanManageTicketMembers(actor, ticket);

  if (targetMember.user.bot) {
    throw new ValidationError('Alvo da transferencia e um bot.', {
      userMessage: 'Nao e possivel transferir um atendimento para um bot.',
    });
  }
  if (targetMember.id === ticket.claimedById) {
    throw new ValidationError('Transferencia para o mesmo responsavel.', {
      userMessage: 'Este atendente ja e o responsavel por este atendimento.',
    });
  }
  if (!(await isCategoryStaff(targetMember, ticket.categoryId))) {
    throw new ValidationError('Alvo nao pertence a equipe da categoria.', {
      userMessage:
        'Este membro nao faz parte da equipe responsavel por esta categoria de atendimento.',
    });
  }

  return locks.withLock(
    LOCK_NAMESPACE.TICKET_CLAIM,
    ticket.id,
    async () => {
      const moved = await transferTicketAtomic(ticket.id, ticket.claimedById, targetMember.id);
      if (!moved) {
        throw new TicketStateError('Transferencia perdeu a corrida.', {
          userMessage:
            'O responsavel por este atendimento mudou. Atualize o painel e tente novamente.',
        });
      }

      await recordTicketTransfer({
        guildId: guild.id,
        ticketId: ticket.id,
        fromStaffId: ticket.claimedById,
        toStaffId: targetMember.id,
        transferredById: actor.id,
      });

      await recordTicketAudit({
        guildId: guild.id,
        ticketId: ticket.id,
        action: TicketAuditAction.TRANSFERRED,
        actorId: actor.id,
        targetId: targetMember.id,
        oldValue: ticket.claimedById,
        newValue: targetMember.id,
      });

      const updated = (await findTicketById(ticket.id)) ?? ticket;
      await refreshInternalPanel(guild, updated);

      logger.info('Atendimento transferido.', {
        guildId: guild.id,
        userId: actor.id,
        entityType: 'ticket',
        entityId: ticket.id,
        from: ticket.claimedById,
        to: targetMember.id,
      });

      return { ticket: updated, fromStaffId: ticket.claimedById, toStaffId: targetMember.id };
    },
    { userMessage: 'Este atendimento esta sendo alterado neste momento.' },
  );
}
