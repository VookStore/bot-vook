"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PACK_ORDER = void 0;
exports.listPacks = listPacks;
exports.findPackById = findPackById;
exports.findPackBySlug = findPackBySlug;
exports.findPackBySku = findPackBySku;
exports.findPacksByIds = findPacksByIds;
exports.countPacks = countPacks;
exports.maxPackPosition = maxPackPosition;
exports.createPack = createPack;
exports.updatePack = updatePack;
exports.softDeletePack = softDeletePack;
exports.removePackFromCarts = removePackFromCarts;
exports.listPackDetails = listPackDetails;
exports.listDetailsForPacks = listDetailsForPacks;
exports.replacePackDetails = replacePackDetails;
const prisma_1 = require("../../../core/database/prisma");
/**
 * Persistencia dos packs.
 *
 * REGRAS DESTE ARQUIVO
 *  - Exclusao e SEMPRE soft delete: `OrderItem` referencia o pack e o historico
 *    de compras nao pode quebrar por causa de uma limpeza de catalogo.
 *  - Preco e inteiro em centavos. Nenhuma conversao acontece aqui.
 *  - A ordenacao padrao da vitrine e (destaque, posicao, nome) — a mesma em
 *    todos os caminhos, para o cliente ver sempre a mesma sequencia.
 */
exports.PACK_ORDER = [
    { featured: 'desc' },
    { position: 'asc' },
    { name: 'asc' },
];
async function listPacks(guildId, options = {}, db = (0, prisma_1.getPrisma)()) {
    return db.catalogPack.findMany({
        where: {
            guildId,
            deletedAt: null,
            ...(options.includeDisabled === true ? {} : { enabled: true }),
            ...(options.categoryId !== undefined ? { categoryId: options.categoryId } : {}),
        },
        orderBy: exports.PACK_ORDER,
    });
}
async function findPackById(id, db = (0, prisma_1.getPrisma)()) {
    return db.catalogPack.findUnique({ where: { id } });
}
async function findPackBySlug(guildId, slug, db = (0, prisma_1.getPrisma)()) {
    return db.catalogPack.findUnique({ where: { guildId_slug: { guildId, slug } } });
}
async function findPackBySku(guildId, sku, db = (0, prisma_1.getPrisma)()) {
    return db.catalogPack.findUnique({ where: { guildId_sku: { guildId, sku } } });
}
async function findPacksByIds(ids, db = (0, prisma_1.getPrisma)()) {
    if (ids.length === 0)
        return [];
    return db.catalogPack.findMany({ where: { id: { in: [...ids] } } });
}
async function countPacks(guildId, options = {}, db = (0, prisma_1.getPrisma)()) {
    return db.catalogPack.count({
        where: {
            guildId,
            deletedAt: null,
            ...(options.includeDisabled === true ? {} : { enabled: true }),
        },
    });
}
async function maxPackPosition(guildId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.catalogPack.aggregate({
        where: { guildId, deletedAt: null },
        _max: { position: true },
    });
    return result._max.position ?? 0;
}
async function createPack(input, db = (0, prisma_1.getPrisma)()) {
    return db.catalogPack.create({ data: { ...input, enabled: true, featured: false } });
}
async function updatePack(id, data, db = (0, prisma_1.getPrisma)()) {
    return db.catalogPack.update({ where: { id }, data });
}
/**
 * Soft delete.
 * Tambem desativa e libera slug/SKU (sufixo com o id), para que a equipe possa
 * recadastrar o mesmo codigo depois sem esbarrar no UNIQUE da guild.
 */
async function softDeletePack(id, db = (0, prisma_1.getPrisma)()) {
    const suffix = id.slice(-6);
    const pack = await db.catalogPack.findUnique({ where: { id } });
    return db.catalogPack.update({
        where: { id },
        data: {
            deletedAt: new Date(),
            enabled: false,
            featured: false,
            slug: `${pack?.slug ?? id}-del-${suffix}`.slice(0, 120),
            sku: pack?.sku === null || pack?.sku === undefined ? null : `${pack.sku}-DEL-${suffix}`,
        },
    });
}
/** Remove os itens de carrinho que apontam para o pack excluido/desativado. */
async function removePackFromCarts(packId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.cartItem.deleteMany({ where: { packId } });
    return result.count;
}
// ---------------------------------------------------------------------------
// Ficha tecnica (detalhes)
// ---------------------------------------------------------------------------
async function listPackDetails(packId, db = (0, prisma_1.getPrisma)()) {
    return db.catalogPackDetail.findMany({
        where: { packId },
        orderBy: [{ position: 'asc' }],
    });
}
async function listDetailsForPacks(packIds, db = (0, prisma_1.getPrisma)()) {
    if (packIds.length === 0)
        return [];
    return db.catalogPackDetail.findMany({
        where: { packId: { in: [...packIds] } },
        orderBy: [{ position: 'asc' }],
    });
}
/**
 * Substitui a ficha tecnica inteira em UMA transacao.
 * O formulario e um bloco de texto: editar linha a linha exigiria um estado
 * intermediario que nao existe, e a substituicao mantem o resultado previsivel.
 */
async function replacePackDetails(packId, details, db = (0, prisma_1.getPrisma)()) {
    await db.catalogPackDetail.deleteMany({ where: { packId } });
    if (details.length === 0)
        return;
    await db.catalogPackDetail.createMany({
        data: details.map((detail, index) => ({
            packId,
            label: detail.label,
            value: detail.value,
            position: index,
        })),
    });
}
//# sourceMappingURL=CatalogPackRepository.js.map