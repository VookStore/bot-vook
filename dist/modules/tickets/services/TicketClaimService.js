"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimTicket = claimTicket;
exports.transferTicket = transferTicket;
const client_1 = require("@prisma/client");
const LockService_1 = require("../../../core/locks/LockService");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const PermissionService_1 = require("../../../core/permissions/PermissionService");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TicketQueueService_1 = require("./TicketQueueService");
const TicketViewService_1 = require("./TicketViewService");
/**
 * Assumir e transferir atendimento.
 *
 * A protecao real contra corrida NAO e o lock de RAM: e o `updateMany` com
 * `where: { claimedById: null, status: OPEN }`. Se dois atendentes clicarem no
 * mesmo milissegundo, apenas um update afeta uma linha; o outro recebe count 0
 * e e informado de quem assumiu.
 */
const logger = (0, Logger_1.createLogger)('ticket:claim');
async function claimTicket(guild, member, ticketId) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null || ticket.guildId !== guild.id) {
        throw new errors_1.ValidationError(`Ticket inexistente: ${ticketId}`, {
            userMessage: 'Este atendimento nao foi encontrado.',
        });
    }
    if (ticket.status === client_1.TicketStatus.CLOSED || ticket.status === client_1.TicketStatus.ORPHANED) {
        throw new errors_1.TicketStateError('Ticket encerrado nao pode ser assumido.', {
            userMessage: 'Este atendimento ja foi encerrado.',
        });
    }
    if (ticket.status === client_1.TicketStatus.CLOSING) {
        throw new errors_1.TicketStateError('Ticket em fechamento.', {
            userMessage: 'Este atendimento esta sendo finalizado.',
        });
    }
    if (ticket.claimedById !== null) {
        throw new errors_1.TicketAlreadyClaimedError(ticket.claimedById);
    }
    await (0, PermissionService_1.assertCanClaimTicket)(member, ticket);
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.TICKET_CLAIM, ticket.id, async () => {
        const won = await (0, TicketRepository_1.claimTicketAtomic)(ticket.id, member.id);
        if (!won) {
            // Perdeu a corrida: descobre quem ganhou para dar uma resposta util.
            const current = await (0, TicketRepository_1.findTicketById)(ticket.id);
            if (current?.claimedById != null && current.claimedById !== member.id) {
                throw new errors_1.TicketAlreadyClaimedError(current.claimedById);
            }
            throw new errors_1.TicketStateError('Nao foi possivel assumir o atendimento.', {
                userMessage: 'Nao foi possivel assumir este atendimento. Atualize o painel.',
            });
        }
        const updated = await (0, TicketRepository_1.findTicketById)(ticket.id);
        const claimed = updated ?? ticket;
        await (0, AuditRepository_1.recordTicketAudit)({
            guildId: guild.id,
            ticketId: ticket.id,
            action: client_1.TicketAuditAction.CLAIMED,
            actorId: member.id,
        });
        logger.info('Ticket assumido.', {
            guildId: guild.id,
            userId: member.id,
            entityType: 'ticket',
            entityId: ticket.id,
            ticketNumber: ticket.ticketNumber,
        });
        await (0, TicketViewService_1.refreshInternalPanel)(guild, claimed);
        // Quem estava atras na fila subiu de posicao.
        void (0, TicketQueueService_1.refreshQueueHead)(guild, ticket.categoryId);
        return { ticket: claimed };
    }, { userMessage: 'Este atendimento esta sendo assumido neste momento.' });
}
async function transferTicket(guild, actor, ticketId, targetMember) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null || ticket.guildId !== guild.id) {
        throw new errors_1.ValidationError(`Ticket inexistente: ${ticketId}`, {
            userMessage: 'Este atendimento nao foi encontrado.',
        });
    }
    if (ticket.status !== client_1.TicketStatus.CLAIMED) {
        throw new errors_1.TicketStateError('Somente ticket assumido pode ser transferido.', {
            userMessage: 'Este atendimento precisa estar assumido para ser transferido.',
        });
    }
    await (0, PermissionService_1.assertCanManageTicketMembers)(actor, ticket);
    if (targetMember.user.bot) {
        throw new errors_1.ValidationError('Alvo da transferencia e um bot.', {
            userMessage: 'Nao e possivel transferir um atendimento para um bot.',
        });
    }
    if (targetMember.id === ticket.claimedById) {
        throw new errors_1.ValidationError('Transferencia para o mesmo responsavel.', {
            userMessage: 'Este atendente ja e o responsavel por este atendimento.',
        });
    }
    if (!(await (0, PermissionService_1.isCategoryStaff)(targetMember, ticket.categoryId))) {
        throw new errors_1.ValidationError('Alvo nao pertence a equipe da categoria.', {
            userMessage: 'Este membro nao faz parte da equipe responsavel por esta categoria de atendimento.',
        });
    }
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.TICKET_CLAIM, ticket.id, async () => {
        const moved = await (0, TicketRepository_1.transferTicketAtomic)(ticket.id, ticket.claimedById, targetMember.id);
        if (!moved) {
            throw new errors_1.TicketStateError('Transferencia perdeu a corrida.', {
                userMessage: 'O responsavel por este atendimento mudou. Atualize o painel e tente novamente.',
            });
        }
        await (0, AuditRepository_1.recordTicketTransfer)({
            guildId: guild.id,
            ticketId: ticket.id,
            fromStaffId: ticket.claimedById,
            toStaffId: targetMember.id,
            transferredById: actor.id,
        });
        await (0, AuditRepository_1.recordTicketAudit)({
            guildId: guild.id,
            ticketId: ticket.id,
            action: client_1.TicketAuditAction.TRANSFERRED,
            actorId: actor.id,
            targetId: targetMember.id,
            oldValue: ticket.claimedById,
            newValue: targetMember.id,
        });
        const updated = (await (0, TicketRepository_1.findTicketById)(ticket.id)) ?? ticket;
        await (0, TicketViewService_1.refreshInternalPanel)(guild, updated);
        logger.info('Atendimento transferido.', {
            guildId: guild.id,
            userId: actor.id,
            entityType: 'ticket',
            entityId: ticket.id,
            from: ticket.claimedById,
            to: targetMember.id,
        });
        return { ticket: updated, fromStaffId: ticket.claimedById, toStaffId: targetMember.id };
    }, { userMessage: 'Este atendimento esta sendo alterado neste momento.' });
}
//# sourceMappingURL=TicketClaimService.js.map