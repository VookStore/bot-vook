"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCatalogCategories = listCatalogCategories;
exports.findCatalogCategoryById = findCatalogCategoryById;
exports.findCatalogCategoryByIdentifier = findCatalogCategoryByIdentifier;
exports.countCatalogCategories = countCatalogCategories;
exports.maxCategoryPosition = maxCategoryPosition;
exports.createCatalogCategory = createCatalogCategory;
exports.updateCatalogCategory = updateCatalogCategory;
exports.softDeleteCatalogCategory = softDeleteCatalogCategory;
exports.renumberCategories = renumberCategories;
const prisma_1 = require("../../../core/database/prisma");
async function listCatalogCategories(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.catalogCategory.findMany({
        where: { guildId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
}
async function findCatalogCategoryById(id, db = (0, prisma_1.getPrisma)()) {
    return db.catalogCategory.findUnique({ where: { id } });
}
/** Busca pelo identificador INCLUINDO excluidas (permite reviver o registro). */
async function findCatalogCategoryByIdentifier(guildId, identifier, db = (0, prisma_1.getPrisma)()) {
    return db.catalogCategory.findUnique({
        where: { guildId_identifier: { guildId, identifier } },
    });
}
async function countCatalogCategories(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.catalogCategory.count({ where: { guildId, deletedAt: null } });
}
/** Maior `position` em uso (para inserir a nova categoria no fim da lista). */
async function maxCategoryPosition(guildId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.catalogCategory.aggregate({
        where: { guildId, deletedAt: null },
        _max: { position: true },
    });
    return result._max.position ?? 0;
}
/**
 * Cria a categoria. Se o identificador ja existir (inclusive excluido), o
 * registro e revivido com os novos termos — mesmo id, mesmos produtos ligados.
 */
async function createCatalogCategory(input, db = (0, prisma_1.getPrisma)()) {
    const terms = {
        name: input.name,
        description: input.description,
        emoji: input.emoji,
        position: input.position,
        enabled: true,
        deletedAt: null,
    };
    return db.catalogCategory.upsert({
        where: { guildId_identifier: { guildId: input.guildId, identifier: input.identifier } },
        create: {
            guildId: input.guildId,
            identifier: input.identifier,
            createdById: input.createdById,
            ...terms,
        },
        update: terms,
    });
}
async function updateCatalogCategory(id, data, db = (0, prisma_1.getPrisma)()) {
    return db.catalogCategory.update({ where: { id }, data });
}
async function softDeleteCatalogCategory(id, db = (0, prisma_1.getPrisma)()) {
    return db.catalogCategory.update({
        where: { id },
        data: { deletedAt: new Date(), enabled: false },
    });
}
/**
 * Renormaliza as posicoes (0..n-1) em UMA transacao.
 *
 * Reordenar por swap deixa buracos e empates com o tempo; renormalizar mantem
 * a lista previsivel e faz "subir/descer" continuar funcionando para sempre.
 */
async function renumberCategories(orderedIds, db = (0, prisma_1.getPrisma)()) {
    await Promise.all(orderedIds.map((id, index) => db.catalogCategory.update({ where: { id }, data: { position: index } })));
}
//# sourceMappingURL=CatalogCategoryRepository.js.map