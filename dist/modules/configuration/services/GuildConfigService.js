"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGuildConfig = getGuildConfig;
exports.updateGuildConfig = updateGuildConfig;
exports.invalidateGuildConfig = invalidateGuildConfig;
exports.preloadGuildConfigs = preloadGuildConfigs;
exports.getStoreName = getStoreName;
const CacheService_1 = require("../../../core/cache/CacheService");
const limits_1 = require("../../../constants/limits");
const Logger_1 = require("../../../core/logger/Logger");
const GuildConfigRepository_1 = require("../repositories/GuildConfigRepository");
const logger = (0, Logger_1.createLogger)('config');
/**
 * Configuracao da guild com cache.
 *
 * Fluxo obrigatorio de escrita:
 *   banco -> commit bem sucedido -> invalidacao/atualizacao do cache.
 * Nunca atualizar apenas a RAM.
 */
async function getGuildConfig(guildId) {
    return CacheService_1.cache.getOrLoad(CacheService_1.CACHE_NAMESPACE.GUILD_CONFIG, guildId, () => (0, GuildConfigRepository_1.ensureGuildConfig)(guildId), limits_1.CACHE_TTL.GUILD_CONFIG_MS);
}
/** Persiste e so entao atualiza o cache com o registro retornado pelo banco. */
async function updateGuildConfig(guildId, data) {
    const updated = await (0, GuildConfigRepository_1.updateGuildConfig)(guildId, data);
    CacheService_1.cache.set(CacheService_1.CACHE_NAMESPACE.GUILD_CONFIG, guildId, updated, limits_1.CACHE_TTL.GUILD_CONFIG_MS);
    logger.debug('Configuracao da guild atualizada.', {
        guildId,
        fields: Object.keys(data).join(','),
    });
    return updated;
}
function invalidateGuildConfig(guildId) {
    CacheService_1.cache.delete(CacheService_1.CACHE_NAMESPACE.GUILD_CONFIG, guildId);
}
/** Pre-carrega todas as configuracoes conhecidas no startup. */
async function preloadGuildConfigs() {
    const configs = await (0, GuildConfigRepository_1.listGuildConfigs)();
    for (const config of configs) {
        CacheService_1.cache.set(CacheService_1.CACHE_NAMESPACE.GUILD_CONFIG, config.guildId, config, limits_1.CACHE_TTL.GUILD_CONFIG_MS);
    }
    return configs.length;
}
/** Nome visual da loja configurado para a guild. */
async function getStoreName(guildId) {
    const config = await getGuildConfig(guildId);
    return config.storeName;
}
//# sourceMappingURL=GuildConfigService.js.map