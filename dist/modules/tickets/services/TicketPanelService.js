"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishPanel = publishPanel;
exports.refreshPublicPanel = refreshPublicPanel;
exports.removePanel = removePanel;
exports.ensurePanelHealthy = ensurePanelHealthy;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../../components/reply");
const LockService_1 = require("../../../core/locks/LockService");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const TicketPanelBuilder_1 = require("../builders/TicketPanelBuilder");
const TicketConfigService_1 = require("./TicketConfigService");
/**
 * Painel publico da central de atendimento.
 *
 * O par (ticketPanelChannelId, ticketPanelMessageId) e guardado na configuracao
 * para que "atualizar" EDITE a mensagem existente em vez de duplicar o painel.
 */
const logger = (0, Logger_1.createLogger)('ticket:panel');
/** Publica o painel em um canal e memoriza a mensagem. */
async function publishPanel(guild, channel) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PANEL_UPDATE, guild.id, async () => {
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        const categories = await (0, TicketConfigService_1.getCategories)(guild.id);
        // Remove o painel anterior para nao deixar dois paineis ativos.
        await removePanelMessage(guild).catch(() => undefined);
        const message = await (0, reply_1.sendV2)(channel, (0, TicketPanelBuilder_1.buildTicketPanel)(config, categories));
        await (0, GuildConfigService_1.updateGuildConfig)(guild.id, {
            ticketPanelChannelId: channel.id,
            ticketPanelMessageId: message.id,
        });
        logger.info('Painel publico publicado.', {
            guildId: guild.id,
            channelId: channel.id,
            entityType: 'panel',
            entityId: message.id,
        });
        return message;
    });
}
/** Reconstroi o painel publico editando a mensagem ja existente. */
async function refreshPublicPanel(guild) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PANEL_UPDATE, guild.id, async () => {
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        if (config.ticketPanelChannelId === null || config.ticketPanelMessageId === null) {
            return { updated: false, reason: 'Nenhum painel publicado ainda.' };
        }
        const channel = await (0, discord_1.fetchChannelSafe)(guild, config.ticketPanelChannelId);
        if (!(0, discord_1.isSendableTextChannel)(channel)) {
            return {
                updated: false,
                reason: 'O canal do painel nao existe mais ou o bot perdeu acesso a ele.',
            };
        }
        const categories = await (0, TicketConfigService_1.getCategories)(guild.id);
        try {
            const message = await channel.messages.fetch(config.ticketPanelMessageId);
            await message.edit({
                components: [(0, TicketPanelBuilder_1.buildTicketPanel)(config, categories)],
                flags: discord_js_1.MessageFlags.IsComponentsV2,
                allowedMentions: discord_1.NO_MENTIONS,
            });
            return { updated: true };
        }
        catch (error) {
            if (!(0, discord_1.isUnknownResourceError)(error))
                throw error;
            // A mensagem foi apagada: republica e atualiza a referencia.
            const message = await (0, reply_1.sendV2)(channel, (0, TicketPanelBuilder_1.buildTicketPanel)(config, categories));
            await (0, GuildConfigService_1.updateGuildConfig)(guild.id, { ticketPanelMessageId: message.id });
            logger.warn('Painel publico havia sido apagado; foi republicado.', {
                guildId: guild.id,
                channelId: channel.id,
            });
            return { updated: true, reason: 'A mensagem anterior nao existia mais e foi republicada.' };
        }
    });
}
/** Apaga a mensagem do painel (sem limpar a configuracao). */
async function removePanelMessage(guild) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    if (config.ticketPanelChannelId === null || config.ticketPanelMessageId === null)
        return false;
    const channel = await (0, discord_1.fetchChannelSafe)(guild, config.ticketPanelChannelId);
    if (!(0, discord_1.isSendableTextChannel)(channel))
        return false;
    try {
        const message = await channel.messages.fetch(config.ticketPanelMessageId);
        await message.delete();
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return false;
        throw error;
    }
}
/** Remove o painel publico e limpa a referencia salva. */
async function removePanel(guild) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PANEL_UPDATE, guild.id, async () => {
        const removed = await removePanelMessage(guild);
        await (0, GuildConfigService_1.updateGuildConfig)(guild.id, {
            ticketPanelChannelId: null,
            ticketPanelMessageId: null,
        });
        logger.info('Painel publico removido.', { guildId: guild.id, removed });
        return removed;
    });
}
/** Garante que existe painel publicado (usado no recovery de startup). */
async function ensurePanelHealthy(guild) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    if (config.ticketPanelChannelId === null || config.ticketPanelMessageId === null) {
        return { updated: false, reason: 'Painel nunca foi publicado nesta guild.' };
    }
    try {
        return await refreshPublicPanel(guild);
    }
    catch (error) {
        if (error instanceof errors_1.ConfigurationError) {
            return { updated: false, reason: error.userMessage };
        }
        throw error;
    }
}
//# sourceMappingURL=TicketPanelService.js.map