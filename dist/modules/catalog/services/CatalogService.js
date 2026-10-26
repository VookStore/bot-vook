"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPacks = getPacks;
exports.invalidatePacks = invalidatePacks;
exports.invalidatePackImages = invalidatePackImages;
exports.getPackImages = getPackImages;
exports.getPackById = getPackById;
exports.getSellablePack = getSellablePack;
exports.getPackView = getPackView;
exports.listVisiblePacks = listVisiblePacks;
exports.listFeaturedPacks = listFeaturedPacks;
exports.countActivePacks = countActivePacks;
exports.createPackFromInput = createPackFromInput;
exports.requirePack = requirePack;
exports.updatePackFromInput = updatePackFromInput;
exports.changePackPrice = changePackPrice;
exports.changePackCategory = changePackCategory;
exports.togglePack = togglePack;
exports.togglePackFeatured = togglePackFeatured;
exports.deletePack = deletePack;
exports.replaceDetails = replaceDetails;
exports.getPackDetails = getPackDetails;
exports.listCategoriesWithPacks = listCategoriesWithPacks;
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const CacheService_1 = require("../../../core/cache/CacheService");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const prisma_1 = require("../../../core/database/prisma");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
const CatalogAuditRepository_1 = require("../repositories/CatalogAuditRepository");
const CatalogPackRepository_1 = require("../repositories/CatalogPackRepository");
const PackImageRepository_1 = require("../repositories/PackImageRepository");
const CatalogCategoryService_1 = require("./CatalogCategoryService");
const packValidators_1 = require("../validators/packValidators");
/**
 * Catalogo de produtos.
 *
 * CACHE: o PostgreSQL e a fonte de verdade; o cache existe so para o caminho
 * quente da vitrine (home, categoria, galeria). Toda escrita invalida DEPOIS do
 * commit — nunca antes.
 *
 * ORDENACAO: destaque primeiro, depois posicao, depois nome. A mesma regra em
 * todos os caminhos, para o cliente nunca ver a lista "pular" entre telas.
 */
const logger = (0, Logger_1.createLogger)('catalog');
// ---------------------------------------------------------------------------
// Leitura (cacheada)
// ---------------------------------------------------------------------------
/** Todos os packs vivos da guild (ativos e desativados), cacheados. */
async function getPacks(guildId) {
    return CacheService_1.cache.getOrLoad(CacheService_1.CACHE_NAMESPACE.CATALOG_PACKS, guildId, () => (0, CatalogPackRepository_1.listPacks)(guildId, { includeDisabled: true }), limits_1.CACHE_TTL.CATALOG_PACKS_MS);
}
function invalidatePacks(guildId) {
    CacheService_1.cache.delete(CacheService_1.CACHE_NAMESPACE.CATALOG_PACKS, guildId);
}
function invalidatePackImages(packId) {
    CacheService_1.cache.delete(CacheService_1.CACHE_NAMESPACE.PACK_IMAGES, packId);
}
/** Imagens do pack em ordem de exibicao, cacheadas por pack. */
async function getPackImages(packId) {
    return CacheService_1.cache.getOrLoad(CacheService_1.CACHE_NAMESPACE.PACK_IMAGES, packId, () => (0, PackImageRepository_1.listPackImages)(packId), limits_1.CACHE_TTL.PACK_IMAGES_MS);
}
/**
 * Pack da guild pelo id.
 *
 * NUNCA confia no customId: confere guild e exclusao. Em caso de miss no cache,
 * confirma no banco (o pack pode ter sido criado por outro processo).
 */
async function getPackById(guildId, packId) {
    const cached = (await getPacks(guildId)).find((pack) => pack.id === packId);
    if (cached !== undefined)
        return cached.deletedAt === null ? cached : null;
    const pack = await (0, CatalogPackRepository_1.findPackById)(packId);
    if (pack === null || pack.guildId !== guildId || pack.deletedAt !== null)
        return null;
    invalidatePacks(guildId);
    return pack;
}
/** Pack VENDAVEL: existe, esta ativo, tem categoria valida e preco valido. */
async function getSellablePack(guildId, packId) {
    const pack = await getPackById(guildId, packId);
    if (pack === null) {
        throw new errors_1.ValidationError(`Pack inexistente: ${packId}`, {
            userMessage: 'Este pack nao existe mais. Atualize o catalogo e tente novamente.',
            context: { guildId, entityType: 'pack', entityId: packId },
        });
    }
    if (!pack.enabled) {
        throw new errors_1.ValidationError(`Pack desativado: ${packId}`, {
            userMessage: 'Este pack esta indisponivel no momento.',
            context: { guildId, entityType: 'pack', entityId: packId },
        });
    }
    if (!(0, packValidators_1.hasSellablePrice)(pack.price)) {
        throw new errors_1.ValidationError(`Pack sem preco valido: ${packId}`, {
            userMessage: 'Este pack esta sem preco valido e nao pode ser comprado agora.',
            context: { guildId, entityType: 'pack', entityId: packId },
        });
    }
    const category = await (0, CatalogCategoryService_1.getCatalogCategoryById)(guildId, pack.categoryId);
    if (category === null || !category.enabled) {
        throw new errors_1.ValidationError(`Pack em categoria indisponivel: ${packId}`, {
            userMessage: 'Este pack esta em uma categoria indisponivel no momento.',
            context: { guildId, entityType: 'pack', entityId: packId },
        });
    }
    return pack;
}
/** Tudo que a vitrine precisa de um pack em uma unica chamada. */
async function getPackView(guildId, packId) {
    const pack = await getPackById(guildId, packId);
    if (pack === null)
        return null;
    const [category, images, details] = await Promise.all([
        (0, CatalogCategoryService_1.getCatalogCategoryById)(guildId, pack.categoryId),
        getPackImages(packId),
        (0, CatalogPackRepository_1.listPackDetails)(packId),
    ]);
    return { pack, category, images, details };
}
/**
 * Packs que o CLIENTE pode ver: ativos, com categoria ativa e preco vendavel
 * (packs sem preco valido continuam listados, mas marcados como indisponiveis
 * pelo builder — some-los sem aviso esconderia um erro de cadastro).
 */
async function listVisiblePacks(guildId, options = {}) {
    const [packs, categories] = await Promise.all([
        getPacks(guildId),
        (0, CatalogCategoryService_1.getCatalogCategories)(guildId),
    ]);
    const enabledCategoryIds = new Set(categories.filter((category) => category.enabled).map((category) => category.id));
    const term = normalizeSearchTerm(options.search ?? null);
    return packs.filter((pack) => {
        if (pack.deletedAt !== null || !pack.enabled)
            return false;
        if (!enabledCategoryIds.has(pack.categoryId))
            return false;
        if (options.categoryId !== null &&
            options.categoryId !== undefined &&
            pack.categoryId !== options.categoryId) {
            return false;
        }
        if (term === null)
            return true;
        return matchesSearch(pack, term);
    });
}
/** Packs em destaque (ja visiveis), na ordem oficial da vitrine. */
async function listFeaturedPacks(guildId) {
    const visible = await listVisiblePacks(guildId);
    return visible.filter((pack) => pack.featured);
}
function normalizeSearchTerm(search) {
    if (search === null)
        return null;
    const term = (0, sanitize_1.foldForSearch)(search);
    return term.length >= limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MIN ? term : null;
}
/** Busca por nome, SKU e descricao curta, ignorando acento e caixa. */
function matchesSearch(pack, term) {
    const haystack = [pack.name, pack.sku ?? '', pack.shortDescription ?? '']
        .map((value) => (0, sanitize_1.foldForSearch)(value))
        .join(' | ');
    return haystack.includes(term);
}
/** Contagem usada no painel de status do sistema. */
async function countActivePacks(guildId) {
    return (0, CatalogPackRepository_1.countPacks)(guildId, { includeDisabled: false });
}
/** Slug unico dentro da guild (o nome pode repetir, o slug nao). */
async function uniqueSlug(guildId, name, ignoreId) {
    const base = (0, packValidators_1.buildPackSlug)(name);
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
        const existing = await (0, CatalogPackRepository_1.findPackBySlug)(guildId, candidate);
        if (existing === null || existing.id === ignoreId)
            return candidate;
    }
    throw new errors_1.ValidationError(`Nao foi possivel gerar slug unico para: ${name}`, {
        userMessage: 'Ja existem produtos demais com este nome. Escolha um nome diferente.',
    });
}
async function assertSkuAvailable(guildId, sku, ignoreId) {
    if (sku === null)
        return;
    const existing = await (0, CatalogPackRepository_1.findPackBySku)(guildId, sku);
    if (existing !== null && existing.id !== ignoreId) {
        throw new errors_1.ValidationError(`SKU duplicado: ${sku}`, {
            userMessage: `O SKU **${sku}** ja pertence a outro pack deste servidor.`,
            context: { guildId, entityType: 'pack', entityId: existing.id },
        });
    }
}
async function createPackFromInput(input) {
    (0, packValidators_1.assertValidPrice)(input.price);
    const category = await (0, CatalogCategoryService_1.getCatalogCategoryById)(input.guildId, input.categoryId);
    if (category === null) {
        throw new errors_1.ValidationError(`Categoria inexistente: ${input.categoryId}`, {
            userMessage: 'Esta categoria nao existe mais. Atualize o painel e tente novamente.',
        });
    }
    const total = await (0, CatalogPackRepository_1.countPacks)(input.guildId, { includeDisabled: true });
    if (total >= limits_1.BUSINESS_LIMITS.MAX_PACKS_PER_GUILD) {
        throw new errors_1.ValidationError(`Limite de packs atingido: ${total}`, {
            userMessage: `Este servidor ja possui o limite de ${limits_1.BUSINESS_LIMITS.MAX_PACKS_PER_GUILD} packs.`,
        });
    }
    await assertSkuAvailable(input.guildId, input.sku);
    const slug = await uniqueSlug(input.guildId, input.name);
    const position = (await (0, CatalogPackRepository_1.maxPackPosition)(input.guildId)) + 1;
    const pack = await (0, CatalogPackRepository_1.createPack)({
        guildId: input.guildId,
        categoryId: input.categoryId,
        name: input.name,
        slug,
        sku: input.sku,
        shortDescription: input.shortDescription,
        description: input.description,
        price: input.price,
        position,
        createdById: input.actorId,
    });
    invalidatePacks(input.guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId: input.guildId,
        action: client_1.CatalogAuditAction.PACK_CREATED,
        packId: pack.id,
        categoryId: pack.categoryId,
        actorId: input.actorId,
        newValue: `${pack.name} — ${(0, money_1.formatCents)(pack.price)}`,
    });
    logger.info('Pack criado.', {
        guildId: input.guildId,
        userId: input.actorId,
        entityType: 'pack',
        entityId: pack.id,
        price: pack.price,
    });
    return pack;
}
/** Pack vivo desta guild, ou ValidationError com mensagem util. */
async function requirePack(guildId, packId) {
    const pack = await getPackById(guildId, packId);
    if (pack === null) {
        throw new errors_1.ValidationError(`Pack inexistente: ${packId}`, {
            userMessage: 'Este pack nao existe mais. Atualize o painel e tente novamente.',
            context: { guildId, entityType: 'pack', entityId: packId },
        });
    }
    return pack;
}
async function updatePackFromInput(input) {
    (0, packValidators_1.assertValidPrice)(input.price);
    const current = await requirePack(input.guildId, input.packId);
    await assertSkuAvailable(input.guildId, input.sku, current.id);
    const slug = input.name === current.name
        ? current.slug
        : await uniqueSlug(input.guildId, input.name, current.id);
    const updated = await (0, CatalogPackRepository_1.updatePack)(current.id, {
        name: input.name,
        slug,
        sku: input.sku,
        price: input.price,
        shortDescription: input.shortDescription,
        description: input.description,
    });
    invalidatePacks(input.guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId: input.guildId,
        action: client_1.CatalogAuditAction.PACK_UPDATED,
        packId: updated.id,
        actorId: input.actorId,
        oldValue: `${current.name} — ${(0, money_1.formatCents)(current.price)}`,
        newValue: `${updated.name} — ${(0, money_1.formatCents)(updated.price)}`,
    });
    logger.info('Pack atualizado.', {
        guildId: input.guildId,
        userId: input.actorId,
        entityType: 'pack',
        entityId: updated.id,
    });
    return updated;
}
/** Altera somente o preco (caminho rapido do painel "Precos"). */
async function changePackPrice(guildId, actorId, packId, price) {
    (0, packValidators_1.assertValidPrice)(price);
    const current = await requirePack(guildId, packId);
    const updated = await (0, CatalogPackRepository_1.updatePack)(packId, { price });
    invalidatePacks(guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.PACK_UPDATED,
        packId,
        actorId,
        oldValue: (0, money_1.formatCents)(current.price),
        newValue: (0, money_1.formatCents)(updated.price),
        metadata: { field: 'price' },
    });
    logger.info('Preco de pack alterado.', {
        guildId,
        userId: actorId,
        entityType: 'pack',
        entityId: packId,
        oldPrice: current.price,
        newPrice: updated.price,
    });
    return updated;
}
/** Move o pack para outra categoria do catalogo. */
async function changePackCategory(guildId, actorId, packId, categoryId) {
    const current = await requirePack(guildId, packId);
    const category = await (0, CatalogCategoryService_1.getCatalogCategoryById)(guildId, categoryId);
    if (category === null) {
        throw new errors_1.ValidationError(`Categoria inexistente: ${categoryId}`, {
            userMessage: 'Esta categoria nao existe mais. Atualize o painel e tente novamente.',
        });
    }
    const updated = await (0, CatalogPackRepository_1.updatePack)(packId, { categoryId });
    invalidatePacks(guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.PACK_UPDATED,
        packId,
        categoryId,
        actorId,
        oldValue: current.categoryId,
        newValue: categoryId,
        metadata: { field: 'categoryId' },
    });
    return updated;
}
/**
 * Ativa/desativa o pack.
 *
 * Desativar NAO apaga nada: o pack some da vitrine, sai dos carrinhos abertos
 * (para ninguem finalizar uma compra de item indisponivel) e continua intacto
 * nos pedidos ja emitidos, com todos os snapshots.
 */
async function togglePack(guildId, actorId, packId) {
    const current = await requirePack(guildId, packId);
    if (!current.enabled && !(0, packValidators_1.hasSellablePrice)(current.price)) {
        throw new errors_1.ValidationError(`Pack sem preco valido nao pode ser ativado: ${packId}`, {
            userMessage: 'Cadastre um preco valido antes de ativar este pack.',
        });
    }
    const updated = await (0, CatalogPackRepository_1.updatePack)(packId, { enabled: !current.enabled });
    invalidatePacks(guildId);
    if (!updated.enabled) {
        const removed = await (0, CatalogPackRepository_1.removePackFromCarts)(packId);
        if (removed > 0) {
            logger.info('Pack desativado foi removido de carrinhos abertos.', {
                guildId,
                entityType: 'pack',
                entityId: packId,
                removed,
            });
        }
    }
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: updated.enabled
            ? client_1.CatalogAuditAction.PACK_ENABLED
            : client_1.CatalogAuditAction.PACK_DISABLED,
        packId,
        actorId,
        oldValue: current.enabled ? 'enabled' : 'disabled',
        newValue: updated.enabled ? 'enabled' : 'disabled',
    });
    return updated;
}
async function togglePackFeatured(guildId, actorId, packId) {
    const current = await requirePack(guildId, packId);
    const updated = await (0, CatalogPackRepository_1.updatePack)(packId, { featured: !current.featured });
    invalidatePacks(guildId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: updated.featured
            ? client_1.CatalogAuditAction.PACK_FEATURED
            : client_1.CatalogAuditAction.PACK_UNFEATURED,
        packId,
        actorId,
        oldValue: current.featured ? 'featured' : 'normal',
        newValue: updated.featured ? 'featured' : 'normal',
    });
    return updated;
}
/**
 * Exclusao LOGICA. Pedidos historicos continuam apontando para o pack e
 * mantendo seus snapshots; a vitrine e os carrinhos perdem o produto.
 */
async function deletePack(guildId, actorId, packId) {
    const current = await requirePack(guildId, packId);
    const deleted = await (0, CatalogPackRepository_1.softDeletePack)(packId);
    await (0, CatalogPackRepository_1.removePackFromCarts)(packId);
    invalidatePacks(guildId);
    invalidatePackImages(packId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.PACK_DELETED,
        packId,
        actorId,
        oldValue: `${current.name} — ${(0, money_1.formatCents)(current.price)}`,
    });
    logger.info('Pack excluido (soft delete).', {
        guildId,
        userId: actorId,
        entityType: 'pack',
        entityId: packId,
    });
    return deleted;
}
/** Substitui a ficha tecnica do pack em uma transacao. */
async function replaceDetails(guildId, actorId, packId, details) {
    await requirePack(guildId, packId);
    await (0, prisma_1.getPrisma)().$transaction(async (tx) => {
        await (0, CatalogPackRepository_1.replacePackDetails)(packId, details, tx);
    });
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.PACK_DETAILS_UPDATED,
        packId,
        actorId,
        newValue: `${details.length} item(ns)`,
    });
}
async function getPackDetails(packId) {
    return (0, CatalogPackRepository_1.listPackDetails)(packId);
}
/** Categorias com pelo menos um pack visivel (usado no seletor da vitrine). */
async function listCategoriesWithPacks(guildId) {
    const [categories, visible] = await Promise.all([
        (0, CatalogCategoryService_1.getCatalogCategories)(guildId),
        listVisiblePacks(guildId),
    ]);
    const counts = new Map();
    for (const pack of visible) {
        counts.set(pack.categoryId, (counts.get(pack.categoryId) ?? 0) + 1);
    }
    return categories
        .filter((category) => category.enabled)
        .map((category) => ({ category, count: counts.get(category.id) ?? 0 }));
}
//# sourceMappingURL=CatalogService.js.map