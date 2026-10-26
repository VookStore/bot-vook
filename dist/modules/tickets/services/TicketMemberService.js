"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renameTicket = renameTicket;
exports.addTicketMember = addTicketMember;
exports.removeTicketMember = removeTicketMember;
exports.listTicketParticipantIds = listTicketParticipantIds;
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const LockService_1 = require("../../../core/locks/LockService");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const PermissionService_1 = require("../../../core/permissions/PermissionService");
const sanitize_1 = require("../../../utils/sanitize");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const TicketParticipantRepository_1 = require("../repositories/TicketParticipantRepository");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TicketChannelService_1 = require("./TicketChannelService");
const TicketViewService_1 = require("./TicketViewService");
const TicketAccessService_1 = require("./TicketAccessService");
/** Renomear canal, adicionar e remover participantes do ticket. */
const logger = (0, Logger_1.createLogger)('ticket:members');
async function loadEditableTicket(guild, ticketId) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null || ticket.guildId !== guild.id) {
        throw new errors_1.ValidationError(`Ticket inexistente: ${ticketId}`, {
            userMessage: 'Este atendimento nao foi encontrado.',
        });
    }
    if (ticket.status === client_1.TicketStatus.CLOSED ||
        ticket.status === client_1.TicketStatus.CLOSING ||
        ticket.status === client_1.TicketStatus.ORPHANED) {
        throw new errors_1.TicketStateError(`Ticket nao editavel: ${ticket.status}`, {
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
async function renameTicket(guild, actor, ticketId, requestedName) {
    const ticket = await loadEditableTicket(guild, ticketId);
    await (0, PermissionService_1.assertCanManageTicketMembers)(actor, ticket);
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.TICKET_ADMIN, `rename:${ticket.id}`, async () => {
        // Releitura DENTRO do lock: o cooldown precisa enxergar a renomeacao que
        // o clique concorrente acabou de gravar.
        const fresh = await loadEditableTicket(guild, ticketId);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        if (config.renameCooldownSeconds > 0 && fresh.lastRenamedAt !== null) {
            const elapsed = Math.floor((Date.now() - fresh.lastRenamedAt.getTime()) / 1000);
            const remaining = config.renameCooldownSeconds - elapsed;
            if (remaining > 0) {
                throw new errors_1.RateLimitError(remaining, {
                    userMessage: `Aguarde ${remaining} segundo(s) para renomear este canal novamente.`,
                });
            }
        }
        const channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, fresh.channelId);
        if (channel === null) {
            throw new errors_1.TicketStateError('Canal do ticket nao existe mais.', {
                userMessage: 'O canal deste atendimento nao existe mais.',
            });
        }
        const desired = (0, sanitize_1.sanitizeChannelName)(requestedName, channel.name);
        if (desired === channel.name) {
            throw new errors_1.ValidationError('Nome identico ao atual.', {
                userMessage: 'O canal ja possui esse nome.',
            });
        }
        const oldName = channel.name;
        const newName = await (0, TicketChannelService_1.renameTicketChannel)(channel, desired, `Renomeado por ${actor.user.tag} • ticket #${fresh.ticketNumber}`);
        await (0, TicketRepository_1.touchRename)(fresh.id, newName);
        await (0, AuditRepository_1.recordTicketAudit)({
            guildId: guild.id,
            ticketId: fresh.id,
            action: client_1.TicketAuditAction.RENAMED,
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
    }, { userMessage: 'Este canal ja esta sendo renomeado.' });
}
async function addTicketMember(guild, actor, ticketId, target) {
    const ticket = await loadEditableTicket(guild, ticketId);
    await (0, PermissionService_1.assertCanManageTicketMembers)(actor, ticket);
    if (target.user.bot) {
        throw new errors_1.ValidationError('Alvo e um bot.', {
            userMessage: 'Nao e possivel adicionar bots ao atendimento.',
        });
    }
    if (target.id === ticket.ownerId) {
        throw new errors_1.ValidationError('Alvo ja e o dono do ticket.', {
            userMessage: 'Este usuario ja e o cliente deste atendimento.',
        });
    }
    if (await (0, TicketParticipantRepository_1.isActiveParticipant)(ticket.id, target.id)) {
        throw new errors_1.ValidationError('Usuario ja participa do ticket.', {
            userMessage: 'Este usuario ja foi adicionado a este atendimento.',
        });
    }
    const current = await (0, TicketParticipantRepository_1.countActiveParticipants)(ticket.id);
    if (current >= limits_1.BUSINESS_LIMITS.MAX_PARTICIPANTS_PER_TICKET) {
        throw new errors_1.ValidationError(`Limite de participantes atingido: ${current}`, {
            userMessage: `Este atendimento ja possui o maximo de ${limits_1.BUSINESS_LIMITS.MAX_PARTICIPANTS_PER_TICKET} participantes adicionais.`,
        });
    }
    const channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, ticket.channelId);
    if (channel === null) {
        throw new errors_1.TicketStateError('Canal do ticket nao existe mais.', {
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
    await (0, TicketAccessService_1.grantCategoryAccess)(guild, ticket.categoryId, target.id, `Adicionado ao ticket #${ticket.ticketNumber}`);
    await (0, TicketChannelService_1.grantChannelAccess)(channel, target, `Adicionado por ${actor.user.tag} • ticket #${ticket.ticketNumber}`);
    await (0, TicketParticipantRepository_1.addParticipant)({
        guildId: guild.id,
        ticketId: ticket.id,
        userId: target.id,
        addedById: actor.id,
    });
    await (0, AuditRepository_1.recordTicketAudit)({
        guildId: guild.id,
        ticketId: ticket.id,
        action: client_1.TicketAuditAction.MEMBER_ADDED,
        actorId: actor.id,
        targetId: target.id,
    });
    await (0, TicketViewService_1.refreshInternalPanel)(guild, ticket);
    logger.info('Participante adicionado ao ticket.', {
        guildId: guild.id,
        userId: actor.id,
        entityType: 'ticket',
        entityId: ticket.id,
        targetId: target.id,
    });
}
async function removeTicketMember(guild, actor, ticketId, targetUserId) {
    const ticket = await loadEditableTicket(guild, ticketId);
    await (0, PermissionService_1.assertCanManageTicketMembers)(actor, ticket);
    if (targetUserId === ticket.ownerId) {
        throw new errors_1.ValidationError('Tentativa de remover o dono do ticket.', {
            userMessage: 'O cliente do atendimento nao pode ser removido.',
        });
    }
    if (targetUserId === guild.client.user.id) {
        throw new errors_1.ValidationError('Tentativa de remover o bot.', {
            userMessage: 'O bot nao pode ser removido do atendimento.',
        });
    }
    if (!(await (0, TicketParticipantRepository_1.isActiveParticipant)(ticket.id, targetUserId))) {
        throw new errors_1.ValidationError('Usuario nao e participante ativo.', {
            userMessage: 'Este usuario nao esta na lista de participantes adicionais.',
        });
    }
    const channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, ticket.channelId);
    if (channel !== null) {
        await (0, TicketChannelService_1.revokeChannelAccess)(channel, targetUserId, `Removido por ${actor.user.tag} • ticket #${ticket.ticketNumber}`);
    }
    // Só cega quem nao tem mais nenhum atendimento aberto nesta categoria.
    await (0, TicketAccessService_1.revokeCategoryAccessIfLast)(guild, ticket.categoryId, targetUserId, null, `Removido do ticket #${ticket.ticketNumber}`);
    await (0, TicketParticipantRepository_1.removeParticipant)({
        ticketId: ticket.id,
        userId: targetUserId,
        removedById: actor.id,
    });
    await (0, AuditRepository_1.recordTicketAudit)({
        guildId: guild.id,
        ticketId: ticket.id,
        action: client_1.TicketAuditAction.MEMBER_REMOVED,
        actorId: actor.id,
        targetId: targetUserId,
    });
    await (0, TicketViewService_1.refreshInternalPanel)(guild, ticket);
    logger.info('Participante removido do ticket.', {
        guildId: guild.id,
        userId: actor.id,
        entityType: 'ticket',
        entityId: ticket.id,
        targetId: targetUserId,
    });
}
/** Ids dos participantes ativos (usado pelo painel de remocao). */
async function listTicketParticipantIds(ticketId) {
    const participants = await (0, TicketParticipantRepository_1.listActiveParticipants)(ticketId);
    return participants.map((participant) => participant.userId);
}
//# sourceMappingURL=TicketMemberService.js.map