"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTicketFlow = createTicketFlow;
const client_1 = require("@prisma/client");
const LockService_1 = require("../../../core/locks/LockService");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const prisma_1 = require("../../../core/database/prisma");
const sanitize_1 = require("../../../utils/sanitize");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TicketPriorityService_1 = require("./TicketPriorityService");
const TicketChannelService_1 = require("./TicketChannelService");
const TicketConfigService_1 = require("./TicketConfigService");
const TicketQueueService_1 = require("./TicketQueueService");
const TicketViewService_1 = require("./TicketViewService");
/**
 * Abertura de ticket.
 *
 * Ordem executada (espelha o fluxo oficial do sistema):
 *  guild -> categoria -> status -> destino -> equipe -> cooldown -> limite do
 *  usuario -> limite global -> lock -> numero -> ticket(CREATING) -> canal ->
 *  permissoes -> channelId -> OPEN -> fila -> painel -> auditoria -> libera lock.
 */
const logger = (0, Logger_1.createLogger)('ticket:create');
/** Valida cooldown em memoria E no banco (o banco sobrevive a restart). */
async function assertCooldown(guildId, userId, cooldownSeconds) {
    if (cooldownSeconds <= 0)
        return;
    const key = `${guildId}:${userId}`;
    const memoryRemaining = LockService_1.cooldowns.remainingSeconds(LockService_1.COOLDOWN_NAMESPACE.TICKET_CREATE, key, cooldownSeconds);
    if (memoryRemaining > 0) {
        throw new errors_1.RateLimitError(memoryRemaining, {
            userMessage: `Aguarde ${memoryRemaining} segundo(s) antes de abrir outro atendimento.`,
        });
    }
    const last = await (0, TicketRepository_1.lastTicketCreatedAt)(guildId, userId);
    if (last === null)
        return;
    const elapsedSeconds = Math.floor((Date.now() - last.getTime()) / 1000);
    const remaining = cooldownSeconds - elapsedSeconds;
    if (remaining > 0) {
        throw new errors_1.RateLimitError(remaining, {
            userMessage: `Aguarde ${remaining} segundo(s) antes de abrir outro atendimento.`,
        });
    }
}
async function createTicketFlow(request) {
    const guildId = request.guild.id;
    const userId = request.member.id;
    const subject = (0, sanitize_1.sanitizeTicketSubject)(request.subject);
    const config = await (0, GuildConfigService_1.getGuildConfig)(guildId);
    const category = await (0, TicketConfigService_1.getCategoryById)(guildId, request.categoryId);
    if (category === null || category.deletedAt !== null) {
        throw new errors_1.ValidationError(`Categoria inexistente: ${request.categoryId}`, {
            userMessage: 'Esta categoria nao existe mais. Atualize o painel e tente novamente.',
        });
    }
    if (!category.enabled) {
        throw new errors_1.ValidationError(`Categoria desabilitada: ${category.id}`, {
            userMessage: 'Esta categoria esta temporariamente indisponivel.',
        });
    }
    const teamRoleIds = await (0, TicketConfigService_1.getTeamRoleIds)(category.id);
    if (teamRoleIds.length === 0) {
        throw new errors_1.ConfigurationError(`Categoria sem equipe: ${category.id}`, {
            userMessage: 'Esta categoria ainda nao possui equipe responsavel configurada. Avise um administrador.',
            context: { guildId, entityType: 'category', entityId: category.id },
        });
    }
    await assertCooldown(guildId, userId, config.ticketCreateCooldownSeconds);
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.TICKET_CREATE, `${guildId}:${userId}`, async () => {
        const openByUser = await (0, TicketRepository_1.countOpenTicketsByUser)(guildId, userId);
        if (openByUser >= config.maxOpenTicketsPerUser) {
            throw new errors_1.TicketLimitError(`Limite por usuario atingido: ${openByUser}`, {
                userMessage: config.maxOpenTicketsPerUser === 1
                    ? 'Voce ja possui um atendimento em aberto. Finalize-o antes de abrir outro.'
                    : `Voce ja possui ${config.maxOpenTicketsPerUser} atendimentos em aberto.`,
            });
        }
        const openByGuild = await (0, TicketRepository_1.countOpenTicketsByGuild)(guildId);
        if (openByGuild >= config.maxOpenTicketsGuild) {
            throw new errors_1.TicketLimitError(`Limite global atingido: ${openByGuild}`, {
                userMessage: 'A central de atendimento atingiu o limite de tickets simultaneos. Tente novamente em instantes.',
            });
        }
        const ticketNumber = await (0, TicketRepository_1.reserveTicketNumber)(guildId);
        /*
         * Cliente com pedido em aberto entra na frente.
         *
         * E quem ja pagou ou esta pagando: deixar essa pessoa atras de uma duvida
         * generica e o tipo de espera que vira pedido de reembolso. A consulta e
         * melhor-esforco — falhando, o ticket abre NORMAL e nada quebra.
         */
        const priority = await (0, TicketPriorityService_1.initialPriorityFor)(guildId, userId);
        const created = await (0, TicketRepository_1.createTicket)({
            guildId,
            ticketNumber,
            categoryId: category.id,
            ownerId: userId,
            subject,
            priority,
        });
        let channel;
        try {
            channel = await (0, TicketChannelService_1.createTicketChannel)({
                guild: request.guild,
                ticketNumber,
                ownerId: userId,
                subject,
                categoryName: category.name,
                destinationChannelId: category.destinationChannelId,
                teamRoleIds,
            });
        }
        catch (error) {
            // O canal nao existe: remove o rascunho para nao deixar ticket fantasma.
            await (0, prisma_1.getPrisma)()
                .ticket.delete({ where: { id: created.id } })
                .catch(() => undefined);
            throw error;
        }
        // Grava o canal IMEDIATAMENTE, antes de qualquer envio de mensagem. Uma
        // queda daqui em diante deixa `CREATING + channelId`, que o recovery
        // promove para OPEN; sem isso a linha seria apagada e o canal ficaria
        // orfao no Discord, invisivel para o sistema inteiro.
        await (0, TicketRepository_1.attachTicketChannel)(created.id, {
            channelId: channel.id,
            channelName: channel.name,
        });
        const ticket = await (0, TicketRepository_1.activateTicket)(created.id, {
            channelId: channel.id,
            channelName: channel.name,
        });
        LockService_1.cooldowns.mark(LockService_1.COOLDOWN_NAMESPACE.TICKET_CREATE, `${guildId}:${userId}`);
        await (0, TicketViewService_1.sendInternalPanel)(channel, ticket);
        const queue = await (0, TicketQueueService_1.getQueueInfo)(ticket);
        await (0, AuditRepository_1.recordTicketAudit)({
            guildId,
            ticketId: ticket.id,
            action: client_1.TicketAuditAction.CREATED,
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
        void (0, TicketQueueService_1.refreshQueueHead)(request.guild, category.id, { skipTicketId: ticket.id });
        return { ticket, channel, categoryName: category.name, queue };
    }, { userMessage: 'Voce ja esta abrindo um atendimento. Aguarde alguns segundos.' });
}
//# sourceMappingURL=TicketCreationService.js.map