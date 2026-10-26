"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerEvents = registerEvents;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const interactionErrorHandler_1 = require("../core/errors/interactionErrorHandler");
const Logger_1 = require("../core/logger/Logger");
const InteractionRouter_1 = require("../interactions/InteractionRouter");
const AuditRepository_1 = require("../modules/audit/repositories/AuditRepository");
const guildMemberAdd_1 = require("./guild/guildMemberAdd");
const BoosterTierService_1 = require("../modules/booster/services/BoosterTierService");
const TicketRepository_1 = require("../modules/tickets/repositories/TicketRepository");
const GuildConfigRepository_1 = require("../modules/configuration/repositories/GuildConfigRepository");
const GuildConfigService_1 = require("../modules/configuration/services/GuildConfigService");
const CacheService_1 = require("../core/cache/CacheService");
/** Registro de todos os listeners de evento do cliente. */
const logger = (0, Logger_1.createLogger)('events');
function registerInteractionCreate(client) {
    client.on(discord_js_1.Events.InteractionCreate, (interaction) => {
        void (0, InteractionRouter_1.routeInteraction)(interaction).catch((error) => {
            void (0, interactionErrorHandler_1.handleBackgroundError)('interactionCreate', error, {
                guildId: interaction.guildId,
                userId: interaction.user.id,
            });
        });
    });
}
/**
 * Canal de ticket apagado manualmente: o ticket vira ORPHANED e sai da fila.
 * Sem isso, a fila continuaria contando um atendimento que nao existe mais.
 */
function registerChannelDelete(client) {
    client.on(discord_js_1.Events.ChannelDelete, (channel) => {
        void (async () => {
            if (channel.isDMBased())
                return;
            const ticket = await (0, TicketRepository_1.findTicketByChannelId)(channel.id);
            if (ticket === null)
                return;
            const orphaned = await (0, TicketRepository_1.markOrphaned)(ticket.id);
            if (!orphaned)
                return;
            await (0, AuditRepository_1.recordTicketAudit)({
                guildId: ticket.guildId,
                ticketId: ticket.id,
                action: client_1.TicketAuditAction.ORPHANED,
                oldValue: ticket.status,
                newValue: 'ORPHANED',
                metadata: { channelId: channel.id },
            });
            logger.warn('Canal de ticket removido; ticket marcado como orfao.', {
                guildId: ticket.guildId,
                channelId: channel.id,
                entityType: 'ticket',
                entityId: ticket.id,
                ticketNumber: ticket.ticketNumber,
            });
        })().catch((error) => {
            void (0, interactionErrorHandler_1.handleBackgroundError)('channelDelete', error, { channelId: channel.id });
        });
    });
}
/** Guild nova: garante a linha de configuracao para o admin ja poder configurar. */
function registerGuildCreate(client) {
    client.on(discord_js_1.Events.GuildCreate, (guild) => {
        void (async () => {
            await (0, GuildConfigRepository_1.ensureGuildConfig)(guild.id);
            (0, GuildConfigService_1.invalidateGuildConfig)(guild.id);
            logger.info('Bot adicionado a uma nova guild.', {
                guildId: guild.id,
                guildName: guild.name,
            });
        })().catch((error) => {
            void (0, interactionErrorHandler_1.handleBackgroundError)('guildCreate', error, { guildId: guild.id });
        });
    });
}
/** Guild removida: limpa o cache para nao guardar dados de um servidor perdido. */
function registerGuildDelete(client) {
    client.on(discord_js_1.Events.GuildDelete, (guild) => {
        CacheService_1.cache.invalidateGuild(guild.id);
        logger.info('Bot removido de uma guild.', { guildId: guild.id });
    });
}
/** Erros do proprio cliente nunca podem derrubar o processo. */
function registerClientErrors(client) {
    client.on(discord_js_1.Events.Error, (error) => {
        void (0, interactionErrorHandler_1.handleBackgroundError)('discordClient', error);
    });
    client.on(discord_js_1.Events.Warn, (message) => {
        logger.warn('Aviso do cliente Discord.', { detail: message });
    });
    client.on(discord_js_1.Events.ShardDisconnect, (event, shardId) => {
        logger.warn('Shard desconectado.', { shardId, code: event.code });
    });
    client.on(discord_js_1.Events.ShardReconnecting, (shardId) => {
        logger.info('Shard reconectando.', { shardId });
    });
    client.on(discord_js_1.Events.ShardResume, (shardId, replayed) => {
        logger.info('Shard reconectado.', { shardId, replayed });
    });
}
/**
 * Boost do servidor: cargo do degrau 2.
 *
 * Escuta a MENSAGEM DE SISTEMA do boost porque e a unica fonte que informa
 * QUANTOS boosts a pessoa tem — a API nao expoe essa contagem em lugar nenhum.
 * O `guildMemberUpdate` complementa retirando o cargo de quem parou de
 * impulsionar de vez.
 */
function registerBoostRoles(client) {
    client.on(discord_js_1.Events.MessageCreate, (message) => {
        if (!(0, BoosterTierService_1.isBoostMessage)(message))
            return;
        void (0, BoosterTierService_1.handleBoostMessage)(message).catch((error) => {
            void (0, interactionErrorHandler_1.handleBackgroundError)('boostMessage', error, {
                guildId: message.guildId,
                userId: message.author.id,
            });
        });
    });
    client.on(discord_js_1.Events.GuildMemberUpdate, (before, after) => {
        void (async () => {
            // `before` pode ser parcial quando o membro nao estava em cache; sem o
            // estado anterior nao da para saber que ele DEIXOU de impulsionar.
            if (before.partial)
                return;
            await (0, BoosterTierService_1.handleBoostLost)(before, after);
        })().catch((error) => {
            void (0, interactionErrorHandler_1.handleBackgroundError)('guildMemberUpdate', error, {
                guildId: after.guild.id,
                userId: after.id,
            });
        });
    });
}
function registerEvents(client) {
    registerInteractionCreate(client);
    registerChannelDelete(client);
    registerGuildCreate(client);
    registerGuildDelete(client);
    (0, guildMemberAdd_1.registerGuildMemberAdd)(client);
    registerBoostRoles(client);
    registerClientErrors(client);
    logger.info('Listeners de evento registrados.');
}
//# sourceMappingURL=index.js.map