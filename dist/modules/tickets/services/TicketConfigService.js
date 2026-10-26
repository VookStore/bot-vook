"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCategories = getCategories;
exports.getEnabledCategories = getEnabledCategories;
exports.getCategoryById = getCategoryById;
exports.getTeamRoleIds = getTeamRoleIds;
exports.getGuildTeamRoleIds = getGuildTeamRoleIds;
exports.invalidateCategories = invalidateCategories;
exports.invalidateTeamRoles = invalidateTeamRoles;
exports.preloadTicketConfig = preloadTicketConfig;
const CacheService_1 = require("../../../core/cache/CacheService");
const limits_1 = require("../../../constants/limits");
const TicketCategoryRepository_1 = require("../repositories/TicketCategoryRepository");
const TicketTeamRoleRepository_1 = require("../repositories/TicketTeamRoleRepository");
/**
 * Leitura cacheada da configuracao de tickets (categorias e equipes).
 * Escritas ficam nos repositories; quem escreve chama a invalidacao daqui.
 */
/** Categorias ativas da guild (ordenadas por posicao). */
async function getCategories(guildId) {
    return CacheService_1.cache.getOrLoad(CacheService_1.CACHE_NAMESPACE.CATEGORIES, guildId, () => (0, TicketCategoryRepository_1.listCategories)(guildId, { includeDisabled: true }), limits_1.CACHE_TTL.CATEGORIES_MS);
}
/** Somente as categorias habilitadas (as que aparecem no painel publico). */
async function getEnabledCategories(guildId) {
    const categories = await getCategories(guildId);
    return categories.filter((category) => category.enabled && category.deletedAt === null);
}
async function getCategoryById(guildId, categoryId) {
    const cached = (await getCategories(guildId)).find((category) => category.id === categoryId);
    if (cached !== undefined)
        return cached;
    // Categoria pode ter sido criada em outro processo: confirma no banco.
    const category = await (0, TicketCategoryRepository_1.findCategoryById)(categoryId);
    if (category === null || category.guildId !== guildId)
        return null;
    /*
     * So invalida quando a categoria DEVERIA estar na lista e nao estava — ou
     * seja, quando o cache esta mesmo desatualizado.
     *
     * `listCategories` filtra `deletedAt: null` sempre, entao categoria
     * soft-deletada NUNCA entra no cache e cairia aqui em toda leitura. Como
     * `getCategoryById` esta nos caminhos quentes (todo refresh de painel de
     * ticket, fechamento, notificacao, painel admin), invalidar aqui derrubava o
     * cache de categorias da guild inteira — inclusive o do painel publico — a
     * cada leitura de um ticket de categoria removida.
     */
    if (category.deletedAt === null) {
        invalidateCategories(guildId);
    }
    return category;
}
/** Cargos responsaveis pela categoria. */
async function getTeamRoleIds(categoryId) {
    return CacheService_1.cache.getOrLoad(CacheService_1.CACHE_NAMESPACE.TEAM_ROLES, categoryId, () => (0, TicketTeamRoleRepository_1.listTeamRoleIds)(categoryId), limits_1.CACHE_TTL.TEAM_ROLES_MS);
}
/** Todos os cargos de equipe da guild (qualquer categoria). */
async function getGuildTeamRoleIds(guildId) {
    const roles = await (0, TicketTeamRoleRepository_1.listTeamRolesForGuild)(guildId);
    return [...new Set(roles.map((role) => role.roleId))];
}
function invalidateCategories(guildId) {
    CacheService_1.cache.delete(CacheService_1.CACHE_NAMESPACE.CATEGORIES, guildId);
}
function invalidateTeamRoles(categoryId) {
    CacheService_1.cache.delete(CacheService_1.CACHE_NAMESPACE.TEAM_ROLES, categoryId);
}
/** Pre-carrega categorias e equipes de uma guild no startup. */
async function preloadTicketConfig(guildId) {
    const categories = await getCategories(guildId);
    let teamRoles = 0;
    for (const category of categories) {
        teamRoles += (await getTeamRoleIds(category.id)).length;
    }
    return { categories: categories.length, teamRoles };
}
//# sourceMappingURL=TicketConfigService.js.map