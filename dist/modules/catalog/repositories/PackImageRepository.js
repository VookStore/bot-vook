"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPackImages = listPackImages;
exports.listImagesForPacks = listImagesForPacks;
exports.findPackImageById = findPackImageById;
exports.countPackImages = countPackImages;
exports.countImagesByPack = countImagesByPack;
exports.createPackImage = createPackImage;
exports.deletePackImage = deletePackImage;
exports.renumberPackImages = renumberPackImages;
exports.setPackCover = setPackCover;
const prisma_1 = require("../../../core/database/prisma");
/**
 * Persistencia das imagens do pack.
 *
 * Ordem e capa sao dados do BANCO, nunca de memoria: a galeria precisa ser
 * reconstruivel identica depois de qualquer restart do processo.
 */
async function listPackImages(packId, db = (0, prisma_1.getPrisma)()) {
    return db.packImage.findMany({
        where: { packId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
}
async function listImagesForPacks(packIds, db = (0, prisma_1.getPrisma)()) {
    if (packIds.length === 0)
        return [];
    return db.packImage.findMany({
        where: { packId: { in: [...packIds] } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
}
async function findPackImageById(id, db = (0, prisma_1.getPrisma)()) {
    return db.packImage.findUnique({ where: { id } });
}
async function countPackImages(packId, db = (0, prisma_1.getPrisma)()) {
    return db.packImage.count({ where: { packId } });
}
/**
 * Quantas imagens cada pack possui, em UMA consulta agregada.
 *
 * O painel administrativo precisa disso para avisar "pack sem imagem de capa".
 * Contar pack a pack seria uma consulta por produto — numa loja com centenas de
 * packs, o painel viraria uma varredura de tabela a cada abertura.
 */
async function countImagesByPack(packIds, db = (0, prisma_1.getPrisma)()) {
    if (packIds.length === 0)
        return new Map();
    const rows = await db.packImage.groupBy({
        by: ['packId'],
        where: { packId: { in: [...packIds] } },
        _count: { _all: true },
    });
    const totals = new Map();
    for (const row of rows)
        totals.set(row.packId, row._count._all);
    return totals;
}
async function createPackImage(input, db = (0, prisma_1.getPrisma)()) {
    return db.packImage.create({ data: input });
}
async function deletePackImage(id, db = (0, prisma_1.getPrisma)()) {
    return db.packImage.delete({ where: { id } });
}
/** Renumera as posicoes (0..n-1) na ordem recebida. */
async function renumberPackImages(orderedIds, db = (0, prisma_1.getPrisma)()) {
    await Promise.all(orderedIds.map((id, index) => db.packImage.update({ where: { id }, data: { position: index } })));
}
/**
 * Define a capa garantindo que exista NO MAXIMO uma por pack.
 * Roda em transacao: zerar todas e marcar uma nao pode ficar pela metade.
 */
async function setPackCover(packId, imageId, db = (0, prisma_1.getPrisma)()) {
    await db.packImage.updateMany({ where: { packId }, data: { isCover: false } });
    await db.packImage.update({ where: { id: imageId }, data: { isCover: true } });
}
//# sourceMappingURL=PackImageRepository.js.map