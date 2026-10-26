"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishCatalogPanel = publishCatalogPanel;
exports.refreshCatalogPanel = refreshCatalogPanel;
exports.removeCatalogPanel = removeCatalogPanel;
exports.ensureCatalogPanelHealthy = ensureCatalogPanelHealthy;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../../components/reply");
const LockService_1 = require("../../../core/locks/LockService");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const CatalogBuilders_1 = require("../builders/CatalogBuilders");
const CatalogCategoryService_1 = require("./CatalogCategoryService");
const CatalogService_1 = require("./CatalogService");
/**
 * Painel publico do catalogo.
 *
 * O par (catalogChannelId, catalogMessageId) fica na configuracao da guild para
 * que "atualizar" EDITE a mensagem existente — publicar de novo a cada mudanca
 * encheria o canal de paineis duplicados.
 *
 * O painel nao expoe nada de cliente: carrinho e pedidos abrem em resposta
 * efemera, so para quem clicou.
 */
const logger = (0, Logger_1.createLogger)('catalog:panel');
/** Chave do lock: um painel por guild. */
function panelKey(guildId) {
    return `catalog:${guildId}`;
}
async function buildPanel(guild) {
    const [config, packs, categories] = await Promise.all([
        (0, GuildConfigService_1.getGuildConfig)(guild.id),
        (0, CatalogService_1.listVisiblePacks)(guild.id),
        (0, CatalogCategoryService_1.getEnabledCatalogCategories)(guild.id),
    ]);
    return (0, CatalogBuilders_1.buildCatalogPanel)(config, { packs: packs.length, categories: categories.length });
}
async function publishCatalogPanel(guild, channel) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PANEL_UPDATE, panelKey(guild.id), async () => {
        // Remove o painel anterior para nao deixar dois paineis vivos no servidor.
        await removePanelMessage(guild).catch(() => undefined);
        const message = await (0, reply_1.sendV2)(channel, await buildPanel(guild));
        await (0, GuildConfigService_1.updateGuildConfig)(guild.id, {
            catalogChannelId: channel.id,
            catalogMessageId: message.id,
        });
        logger.info('Painel do catalogo publicado.', {
            guildId: guild.id,
            channelId: channel.id,
            entityType: 'catalog-panel',
            entityId: message.id,
        });
        return message;
    });
}
/**
 * Reconstroi o painel editando a mensagem existente.
 * Se a mensagem foi apagada, republica e corrige a referencia — o operador nao
 * pode ficar sem painel so porque alguem limpou o canal.
 */
async function refreshCatalogPanel(guild) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PANEL_UPDATE, panelKey(guild.id), async () => {
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        if (config.catalogChannelId === null || config.catalogMessageId === null) {
            return { updated: false, reason: 'Nenhum painel de catalogo publicado ainda.' };
        }
        const channel = await (0, discord_1.fetchChannelSafe)(guild, config.catalogChannelId);
        if (!(0, discord_1.isSendableTextChannel)(channel)) {
            return {
                updated: false,
                reason: 'O canal do painel do catalogo nao existe mais ou o bot perdeu acesso.',
            };
        }
        const panel = await buildPanel(guild);
        try {
            const message = await channel.messages.fetch(config.catalogMessageId);
            await message.edit({
                components: [panel],
                flags: discord_js_1.MessageFlags.IsComponentsV2,
                allowedMentions: discord_1.NO_MENTIONS,
            });
            return { updated: true };
        }
        catch (error) {
            if (!(0, discord_1.isUnknownResourceError)(error))
                throw error;
            const message = await (0, reply_1.sendV2)(channel, panel);
            await (0, GuildConfigService_1.updateGuildConfig)(guild.id, { catalogMessageId: message.id });
            logger.warn('Painel do catalogo havia sido apagado; foi republicado.', {
                guildId: guild.id,
                channelId: channel.id,
            });
            return { updated: true, reason: 'A mensagem anterior nao existia mais e foi republicada.' };
        }
    });
}
async function removePanelMessage(guild) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    if (config.catalogChannelId === null || config.catalogMessageId === null)
        return false;
    const channel = await (0, discord_1.fetchChannelSafe)(guild, config.catalogChannelId);
    if (!(0, discord_1.isSendableTextChannel)(channel))
        return false;
    try {
        const message = await channel.messages.fetch(config.catalogMessageId);
        await message.delete();
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return false;
        throw error;
    }
}
async function removeCatalogPanel(guild) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PANEL_UPDATE, panelKey(guild.id), async () => {
        const removed = await removePanelMessage(guild);
        await (0, GuildConfigService_1.updateGuildConfig)(guild.id, { catalogChannelId: null, catalogMessageId: null });
        logger.info('Painel do catalogo removido.', { guildId: guild.id, removed });
        return removed;
    });
}
/**
 * Reconfere o painel no startup.
 * Nunca lanca: painel quebrado nao pode impedir o bot de subir.
 */
async function ensureCatalogPanelHealthy(guild) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    if (config.catalogChannelId === null || config.catalogMessageId === null) {
        return { updated: false, reason: 'Painel do catalogo nunca foi publicado nesta guild.' };
    }
    return refreshCatalogPanel(guild);
}
//# sourceMappingURL=CatalogPanelService.js.map