"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCategories = listCategories;
exports.findCategoryById = findCategoryById;
exports.findCategoryByIdentifier = findCategoryByIdentifier;
exports.countCategories = countCategories;
exports.createCategory = createCategory;
exports.updateCategory = updateCategory;
exports.softDeleteCategory = softDeleteCategory;
exports.setCategoryEnabled = setCategoryEnabled;
exports.setCategoryDestination = setCategoryDestination;
exports.setCategoryLocatorMessage = setCategoryLocatorMessage;
exports.swapCategoryPositions = swapCategoryPositions;
exports.normalizeCategoryPositions = normalizeCategoryPositions;
const prisma_1 = require("../../../core/database/prisma");
async function listCategories(guildId, options = {}, db = (0, prisma_1.getPrisma)()) {
    return db.ticketCategory.findMany({
        where: {
            guildId,
            deletedAt: null,
            ...(options.includeDisabled === true ? {} : { enabled: true }),
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
}
async function findCategoryById(id, db = (0, prisma_1.getPrisma)()) {
    return db.ticketCategory.findUnique({ where: { id } });
}
/** Busca por identifier incluindo registros soft-deleted (para revive). */
async function findCategoryByIdentifier(guildId, identifier, db = (0, prisma_1.getPrisma)()) {
    return db.ticketCategory.findUnique({
        where: { guildId_identifier: { guildId, identifier } },
    });
}
async function countCategories(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketCategory.count({ where: { guildId, deletedAt: null } });
}
async function nextPosition(guildId, db) {
    const last = await db.ticketCategory.findFirst({
        where: { guildId, deletedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
    });
    return (last?.position ?? -1) + 1;
}
/**
 * Cria a categoria. Se o identifier ja existir mas estiver excluido, o registro
 * e revivido com os novos dados (mantendo o mesmo id e o historico).
 */
async function createCategory(input, db = (0, prisma_1.getPrisma)()) {
    const position = input.position ?? (await nextPosition(input.guildId, db));
    const data = {
        name: input.name,
        description: input.description ?? null,
        emoji: input.emoji ?? null,
        destinationChannelId: input.destinationChannelId ?? null,
        position,
        enabled: true,
        deletedAt: null,
    };
    return db.ticketCategory.upsert({
        where: { guildId_identifier: { guildId: input.guildId, identifier: input.identifier } },
        create: { guildId: input.guildId, identifier: input.identifier, ...data },
        update: data,
    });
}
async function updateCategory(id, data, db = (0, prisma_1.getPrisma)()) {
    return db.ticketCategory.update({ where: { id }, data });
}
async function softDeleteCategory(id, db = (0, prisma_1.getPrisma)()) {
    return db.ticketCategory.update({
        where: { id },
        data: { deletedAt: new Date(), enabled: false },
    });
}
async function setCategoryEnabled(id, enabled, db = (0, prisma_1.getPrisma)()) {
    return db.ticketCategory.update({ where: { id }, data: { enabled } });
}
async function setCategoryDestination(id, destinationChannelId, db = (0, prisma_1.getPrisma)()) {
    /*
     * Trocar de canal invalida a mensagem do painel de localizar: ela vive no
     * canal ANTIGO e apontaria para o lugar errado. Zerar a referencia faz a
     * republicacao criar uma nova, em vez de tentar editar a que ficou para tras.
     */
    return db.ticketCategory.update({
        where: { id },
        data: { destinationChannelId, locatorMessageId: null },
    });
}
/** Memoriza a mensagem do painel "Localizar meu ticket" do canal de destino. */
async function setCategoryLocatorMessage(id, locatorMessageId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketCategory.update({ where: { id }, data: { locatorMessageId } });
}
/**
 * Troca a posicao de duas categorias em uma transacao, para nunca deixar duas
 * categorias com a mesma posicao visivel.
 */
async function swapCategoryPositions(first, second, db = (0, prisma_1.getPrisma)()) {
    await db.ticketCategory.update({ where: { id: first.id }, data: { position: second.position } });
    await db.ticketCategory.update({ where: { id: second.id }, data: { position: first.position } });
}
/** Renumera as posicoes de 0..n-1 (corrige lacunas apos exclusoes). */
async function normalizeCategoryPositions(guildId, db = (0, prisma_1.getPrisma)()) {
    const categories = await db.ticketCategory.findMany({
        where: { guildId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, position: true },
    });
    let changed = 0;
    for (const [index, category] of categories.entries()) {
        if (category.position !== index) {
            await db.ticketCategory.update({ where: { id: category.id }, data: { position: index } });
            changed += 1;
        }
    }
    return changed;
}
//# sourceMappingURL=TicketCategoryRepository.js.map