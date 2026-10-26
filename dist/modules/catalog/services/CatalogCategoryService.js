"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCatalogCategories = getCatalogCategories;
exports.invalidateCatalogCategories = invalidateCatalogCategories;
exports.getEnabledCatalogCategories = getEnabledCatalogCategories;
exports.getCatalogCategoryById = getCatalogCategoryById;
exports.requireCatalogCategory = requireCatalogCategory;
exports.createCategoryFromInput = createCategoryFromInput;
exports.updateCategoryFromInput = updateCategoryFromInput;
exports.toggleCategory = toggleCategory;
exports.deleteCategory = deleteCategory;
exports.moveCategory = moveCategory;
exports.setBoosterEligibility = setBoosterEligibility;
exports.setCategoryLeadTime = setCategoryLeadTime;
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const CacheService_1 = require("../../../core/cache/CacheService");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const prisma_1 = require("../../../core/database/prisma");
const sanitize_1 = require("../../../utils/sanitize");
const CatalogAuditRepository_1 = require("../repositories/CatalogAuditRepository");
const CatalogCategoryRepository_1 = require("../repositories/CatalogCategoryRepository");
const CatalogPackRepository_1 = require("../repositories/CatalogPackRepository");
const CatalogService_1 = require("./CatalogService");
/**
 * Categorias do catalogo.
 *
 * As categorias sao CONFIGURAVEIS: nada de lista fixa no codigo. Veiculos,
 * roupas, mapas e afins sao apenas o cadastro inicial sugerido a loja.
 *
 * Desativar ou excluir uma categoria nunca pode quebrar pedido historico: os
 * packs continuam existindo com seus snapshots, apenas somem da vitrine.
 */
const logger = (0, Logger_1.createLogger)('catalog:categories');
async function getCatalogCategories(guildId) {
    return CacheService_1.cache.getOrLoad(CacheService_1.CACHE_NAMESPACE.CATALOG_CATEGORIES, guildId, () => (0, CatalogCategoryRepository_1.listCatalogCategories)(guildId), limits_1.CACHE_TTL.CATALOG_CATEGORIES_MS);
}
function invalidateCatalogCategories(guildId) {
    CacheService_1.cache.delete(CacheService_1.CACHE_NAMESPACE.CATALOG_CATEGORIES, guildId);
}
async function getEnabledCatalogCategories(guildId) {
    return (await getCatalogCategories(guildId)).filter((category) => category.enabled);
}
async function getCatalogCategoryById(guildId, categoryId) {
    const cached = (await getCatalogCategories(guildId)).find((category) => category.id === categoryId);
    if (cached !== undefined)
        return cached;
    const category = await (0, CatalogCategoryRepository_1.findCatalogCategoryById)(categoryId);
    if (category === null || category.guildId !== guildId || category.deletedAt !== null) {
        return null;
    }
    invalidateCatalogCategories(guildId);
    return category;
}
async function requireCatalogCategory(guildId, categoryId) {
    const category = await getCatalogCategoryById(guildId, categoryId);
    if (category === null) {
        throw new errors_1.ValidationError(`Categoria de catalogo inexistente: ${categoryId}`, {
            userMessage: 'Esta categoria nao existe mais. Atualize o painel e tente novamente.',
            context: { guildId, entityType: 'catalog-category', entityId: categoryId },
        });
    }
    return category;
}
async function createCategoryFromInput(guildId, actorId, terms) {
    const total = await (0, CatalogCategoryRepository_1.countCatalogCategories)(guildId);
    if (total >= limits_1.BUSINESS_LIMITS.MAX_CATALOG_CATEGORIES_PER_GUILD) {
        throw new errors_1.ValidationError(`Limite de categorias atingido: ${total}`, {
            userMessage: `O catalogo aceita no maximo ${limits_1.BUSINESS_LIMITS.MAX_CATALOG_CATEGORIES_PER_GUILD} categorias.`,
        });
    }
    const identifier = (0, sanitize_1.sanitizeIdentifier)(terms.name, 'categoria');
    const existing = await (0, CatalogCategoryRepository_1.findCatalogCategoryByIdentifier)(guildId, identifier);
    if (existing !== null && existing.deletedAt === null) {
        throw new errors_1.ValidationError(`Categoria duplicada: ${identifier}`, {
            userMessage: `Ja existe a categoria **${existing.name}**. Use "Editar" para altera-la.`,
            context: { guildId, entityType: 'catalog-category', entityId: existing.id },
        });
    }
    const position = (await (0, CatalogCategoryRepository_1.maxCategoryPosition)(guildId)) + 1;
    const category = await (0, CatalogCategoryRepository_1.createCatalogCategory)({
        guildId,
        name: terms.name,
        identifier,
        description: terms.description,
        emoji: terms.emoji,
        position,
        createdById: actorId,
    });
    invalidateCatalogCategories(guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.CATEGORY_CREATED,
        categoryId: category.id,
        actorId,
        newValue: category.name,
    });
    logger.info(existing !== null ? 'Categoria restaurada.' : 'Categoria criada.', {
        guildId,
        userId: actorId,
        entityType: 'catalog-category',
        entityId: category.id,
    });
    return { category, restored: existing !== null };
}
async function updateCategoryFromInput(guildId, actorId, categoryId, terms) {
    const current = await requireCatalogCategory(guildId, categoryId);
    const updated = await (0, CatalogCategoryRepository_1.updateCatalogCategory)(categoryId, {
        name: terms.name,
        description: terms.description,
        emoji: terms.emoji,
    });
    invalidateCatalogCategories(guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.CATEGORY_UPDATED,
        categoryId,
        actorId,
        oldValue: current.name,
        newValue: updated.name,
    });
    return updated;
}
/**
 * Ativa/desativa. Categoria desativada some da vitrine junto com seus packs,
 * mas nenhum pedido historico e afetado.
 */
async function toggleCategory(guildId, actorId, categoryId) {
    const current = await requireCatalogCategory(guildId, categoryId);
    const updated = await (0, CatalogCategoryRepository_1.updateCatalogCategory)(categoryId, { enabled: !current.enabled });
    invalidateCatalogCategories(guildId);
    (0, CatalogService_1.invalidatePacks)(guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: updated.enabled
            ? client_1.CatalogAuditAction.CATEGORY_ENABLED
            : client_1.CatalogAuditAction.CATEGORY_DISABLED,
        categoryId,
        actorId,
        oldValue: current.enabled ? 'enabled' : 'disabled',
        newValue: updated.enabled ? 'enabled' : 'disabled',
    });
    return updated;
}
/**
 * Exclusao logica.
 *
 * Recusada enquanto houver pack vivo na categoria: apagar a categoria de um
 * produto ativo deixaria a vitrine com um item orfao e sem rota de volta.
 */
async function deleteCategory(guildId, actorId, categoryId) {
    const current = await requireCatalogCategory(guildId, categoryId);
    const packs = await (0, CatalogPackRepository_1.listPacks)(guildId, { categoryId, includeDisabled: true });
    if (packs.length > 0) {
        throw new errors_1.ValidationError(`Categoria com ${packs.length} pack(s): ${categoryId}`, {
            userMessage: `Esta categoria ainda possui ${packs.length} pack(s). ` +
                'Mova ou exclua os produtos antes de excluir a categoria.',
        });
    }
    const deleted = await (0, CatalogCategoryRepository_1.softDeleteCatalogCategory)(categoryId);
    invalidateCatalogCategories(guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.CATEGORY_DELETED,
        categoryId,
        actorId,
        oldValue: current.name,
    });
    return deleted;
}
/**
 * Move a categoria uma posicao para cima/baixo e RENORMALIZA a lista inteira.
 * Renormalizar evita empates e buracos que, com o tempo, tornariam a ordem
 * imprevisivel.
 */
async function moveCategory(guildId, actorId, categoryId, direction) {
    await requireCatalogCategory(guildId, categoryId);
    const categories = await (0, CatalogCategoryRepository_1.listCatalogCategories)(guildId);
    const index = categories.findIndex((category) => category.id === categoryId);
    if (index < 0) {
        throw new errors_1.ValidationError(`Categoria fora da lista: ${categoryId}`, {
            userMessage: 'Esta categoria nao esta mais na lista. Atualize o painel.',
        });
    }
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= categories.length)
        return categories;
    const reordered = [...categories];
    const moved = reordered[index];
    const swapped = reordered[target];
    if (moved === undefined || swapped === undefined)
        return categories;
    reordered[index] = swapped;
    reordered[target] = moved;
    await (0, prisma_1.getPrisma)().$transaction(async (tx) => {
        await (0, CatalogCategoryRepository_1.renumberCategories)(reordered.map((category) => category.id), tx);
    });
    invalidateCatalogCategories(guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.CATEGORY_REORDERED,
        categoryId,
        actorId,
        oldValue: String(index),
        newValue: String(target),
    });
    return (0, CatalogCategoryRepository_1.listCatalogCategories)(guildId);
}
/**
 * Define em quais categorias o desconto automatico de booster vale.
 *
 * RECEBE O ESTADO FINAL de cada categoria informada, nao um delta: a tela e um
 * multi-select, e "desmarcar" precisa ser tao possivel quanto "marcar" —
 * desmarcar e justamente a operacao que protege PEDs, roupas e props.
 *
 * Escreve em UMA transacao e invalida o cache no fim. Sem a invalidacao, a
 * proxima venda leria a lista antiga por ate dez minutos e daria (ou negaria) o
 * desconto pela regra que acabou de ser trocada.
 */
async function setBoosterEligibility(guildId, updates) {
    if (updates.length === 0)
        return 0;
    const db = (0, prisma_1.getPrisma)();
    const written = await db.$transaction(updates.map((update) => db.catalogCategory.updateMany({
        // `guildId` no where: um id de outra guild nunca altera nada, mesmo que
        // o valor chegue adulterado pelo componente.
        where: { id: update.id, guildId },
        data: { boosterEligible: update.eligible },
    })));
    invalidateCatalogCategories(guildId);
    const total = written.reduce((sum, result) => sum + result.count, 0);
    logger.info('Elegibilidade de desconto de booster atualizada.', {
        guildId,
        entityType: 'catalog-category',
        count: total,
    });
    return total;
}
/**
 * Define o prazo de producao de uma categoria, em dias uteis.
 *
 * `null` remove o prazo: a categoria volta a nao gerar previsao nos pedidos, em
 * vez de assumir zero — "sem prazo definido" e "entrega hoje" sao coisas
 * bem diferentes de se prometer.
 *
 * NAO MEXE EM PEDIDO NENHUM. A previsao de cada pedido e congelada no momento
 * do pagamento, de proposito: mudar o prazo aqui vale para as proximas vendas e
 * nunca reescreve a promessa feita a quem ja comprou.
 */
async function setCategoryLeadTime(guildId, categoryId, leadTimeDays) {
    const { count } = await (0, prisma_1.getPrisma)().catalogCategory.updateMany({
        // `guildId` no where: id de outra guild nunca altera nada.
        where: { id: categoryId, guildId },
        data: { leadTimeDays },
    });
    if (count === 0)
        return false;
    invalidateCatalogCategories(guildId);
    logger.info('Prazo de producao da categoria atualizado.', {
        guildId,
        entityType: 'catalog-category',
        entityId: categoryId,
        leadTimeDays,
    });
    return true;
}
//# sourceMappingURL=CatalogCategoryService.js.map