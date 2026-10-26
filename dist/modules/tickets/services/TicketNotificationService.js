"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyClient = notifyClient;
exports.sendClosureDm = sendClosureDm;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const branding_1 = require("../../../constants/branding");
const errors_1 = require("../../../core/errors");
const LockService_1 = require("../../../core/locks/LockService");
const Logger_1 = require("../../../core/logger/Logger");
const PermissionService_1 = require("../../../core/permissions/PermissionService");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const TicketClosureBuilder_1 = require("../builders/TicketClosureBuilder");
const TicketNotifyBuilder_1 = require("../builders/TicketNotifyBuilder");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TicketConfigService_1 = require("./TicketConfigService");
const TicketChannelService_1 = require("./TicketChannelService");
/**
 * Notificacoes ao cliente.
 *
 * Falha de DM (usuario com DM fechada) NUNCA quebra a operacao: retorna false,
 * registra warning e o chamador informa a equipe.
 */
const logger = (0, Logger_1.createLogger)('ticket:notify');
/** Envia uma DM Components V2. Retorna false quando o usuario nao aceita DMs. */
async function trySendDm(user, root, context) {
    try {
        await user.send({
            components: [root],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            allowedMentions: discord_1.NO_MENTIONS,
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isDmBlockedError)(error) || (0, discord_1.isUnknownResourceError)(error)) {
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
async function findLastStaffMessage(channel, ownerId) {
    try {
        const recent = await channel.messages.fetch({ limit: 50 });
        const botId = channel.client.user.id;
        for (const message of recent.values()) {
            if (message.author.id === ownerId || message.author.id === botId)
                continue;
            const content = message.content.trim().length > 0
                ? message.content
                : message.attachments.size > 0
                    ? '(enviou um arquivo)'
                    : '';
            if (content.length === 0)
                continue;
            return {
                authorId: message.author.id,
                authorName: message.member?.displayName ?? message.author.username,
                content,
                createdAt: message.createdAt,
            };
        }
        return null;
    }
    catch (error) {
        // Historico indisponivel nao pode impedir a notificacao: ela ainda avisa.
        logger.warn('Nao foi possivel ler a ultima mensagem da equipe.', {
            channelId: channel.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
/** Notifica o cliente no canal e por DM que a equipe aguarda resposta. */
async function notifyClient(guild, actor, ticketId) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null || ticket.guildId !== guild.id) {
        throw new errors_1.ValidationError(`Ticket inexistente: ${ticketId}`, {
            userMessage: 'Este atendimento nao foi encontrado.',
        });
    }
    if (ticket.status === client_1.TicketStatus.CLOSED ||
        ticket.status === client_1.TicketStatus.CLOSING ||
        ticket.status === client_1.TicketStatus.ORPHANED) {
        throw new errors_1.TicketStateError('Ticket inativo.', {
            userMessage: 'Este atendimento nao esta mais ativo.',
        });
    }
    await (0, PermissionService_1.assertCanManageTicketMembers)(actor, ticket);
    /*
     * Sob lock: o cooldown le `lastClientNotifyAt` e so grava `touchClientNotify`
     * DEPOIS de enviar o ping no canal. Sem o lock, dois cliques simultaneos
     * passavam os dois pela janela e o cliente levava ping duplo no canal mais
     * duas DMs — furando um cooldown que existe justamente para nao incomoda-lo.
     */
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.TICKET_ADMIN, `notify:${ticket.id}`, async () => {
        // Releitura dentro do lock: precisa enxergar o `touchClientNotify` que o
        // clique concorrente acabou de gravar.
        const fresh = await (0, TicketRepository_1.findTicketById)(ticketId);
        if (fresh === null || fresh.guildId !== guild.id) {
            throw new errors_1.ValidationError(`Ticket inexistente: ${ticketId}`, {
                userMessage: 'Este atendimento nao foi encontrado.',
            });
        }
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        if (config.clientNotifyCooldownSeconds > 0 && fresh.lastClientNotifyAt !== null) {
            const elapsed = Math.floor((Date.now() - fresh.lastClientNotifyAt.getTime()) / 1000);
            const remaining = config.clientNotifyCooldownSeconds - elapsed;
            if (remaining > 0) {
                throw new errors_1.RateLimitError(remaining, {
                    userMessage: `O cliente ja foi notificado recentemente. Aguarde ${remaining} segundo(s).`,
                });
            }
        }
        const channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, fresh.channelId);
        if (channel === null) {
            throw new errors_1.TicketStateError('Canal do ticket nao existe mais.', {
                userMessage: 'O canal deste atendimento nao existe mais.',
            });
        }
        // Ticket entregue fica ARQUIVADO esperando o cliente confirmar — e e
        // justamente nele que a equipe mais vai querer cutucar o cliente.
        await (0, TicketChannelService_1.reopenIfArchived)(channel, 'Cliente notificado pela equipe');
        await channel.send({
            content: `${branding_1.EMOJIS.NOTIFY} ${(0, discord_1.userMention)(fresh.ownerId)}, nossa equipe esta aguardando sua resposta.`,
            allowedMentions: (0, discord_1.mentionOnly)(fresh.ownerId),
        });
        await (0, TicketRepository_1.touchClientNotify)(fresh.id);
        const category = await (0, TicketConfigService_1.getCategoryById)(guild.id, fresh.categoryId);
        const config2 = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        const root = (0, TicketNotifyBuilder_1.buildClientNotifyDm)({
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
        }
        catch (error) {
            if (!(0, discord_1.isUnknownResourceError)(error))
                throw error;
        }
        await (0, AuditRepository_1.recordTicketAudit)({
            guildId: guild.id,
            ticketId: fresh.id,
            action: client_1.TicketAuditAction.CLIENT_NOTIFIED,
            actorId: actor.id,
            targetId: fresh.ownerId,
            metadata: { dmSent },
        });
        return { channelNotified: true, dmSent };
    }, { userMessage: 'O cliente ja esta sendo notificado.' });
}
/**
 * DM de encerramento do atendimento.
 *
 * Leva TAMBEM o convite de avaliacao, no mesmo cartao. O layout vive em
 * `buildClosureDm`; aqui fica so a entrega, que continua best-effort: cliente
 * com DM fechada devolve `false` e o encerramento segue.
 */
async function sendClosureDm(params) {
    const root = (0, TicketClosureBuilder_1.buildClosureDm)({
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
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return false;
        throw error;
    }
}
//# sourceMappingURL=TicketNotificationService.js.map