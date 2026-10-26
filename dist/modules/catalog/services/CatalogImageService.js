"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listImages = listImages;
exports.resolveCover = resolveCover;
exports.addImage = addImage;
exports.removeImage = removeImage;
exports.moveImage = moveImage;
exports.changeCover = changeCover;
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const prisma_1 = require("../../../core/database/prisma");
const CatalogAuditRepository_1 = require("../repositories/CatalogAuditRepository");
const PackImageRepository_1 = require("../repositories/PackImageRepository");
const CatalogService_1 = require("./CatalogService");
/**
 * Galeria de imagens do pack.
 *
 * ORDEM e CAPA vivem no banco. A navegacao (◀️ ▶️) e reconstruida a partir
 * dessa lista, entao ela funciona igual depois de qualquer restart — o indice
 * atual viaja no customId, e so.
 *
 * URL passa por `parseImageUrl` (somente https) antes de chegar aqui.
 */
const logger = (0, Logger_1.createLogger)('catalog:images');
async function listImages(packId) {
    return (0, PackImageRepository_1.listPackImages)(packId);
}
/**
 * Imagem de capa: a marcada com `isCover` ou, na falta dela, a primeira da
 * ordem. Assim todo pack com imagem sempre tem uma capa logica.
 */
function resolveCover(images) {
    return images.find((image) => image.isCover) ?? images[0] ?? null;
}
async function addImage(guildId, actorId, packId, url, altText) {
    await (0, CatalogService_1.requirePack)(guildId, packId);
    const total = await (0, PackImageRepository_1.countPackImages)(packId);
    if (total >= limits_1.BUSINESS_LIMITS.MAX_IMAGES_PER_PACK) {
        throw new errors_1.ValidationError(`Limite de imagens atingido: ${total}`, {
            userMessage: `Cada pack aceita no maximo ${limits_1.BUSINESS_LIMITS.MAX_IMAGES_PER_PACK} imagens.`,
        });
    }
    const image = await (0, PackImageRepository_1.createPackImage)({
        packId,
        url,
        altText,
        position: total,
        // A primeira imagem cadastrada vira capa automaticamente.
        isCover: total === 0,
    });
    (0, CatalogService_1.invalidatePackImages)(packId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.PACK_IMAGE_ADDED,
        packId,
        imageId: image.id,
        actorId,
        newValue: url,
    });
    logger.info('Imagem adicionada ao pack.', {
        guildId,
        userId: actorId,
        entityType: 'pack',
        entityId: packId,
        imageId: image.id,
    });
    return image;
}
/** Imagem existente que pertence ao pack informado. */
async function requireImage(packId, imageId) {
    const image = await (0, PackImageRepository_1.findPackImageById)(imageId);
    if (image === null || image.packId !== packId) {
        throw new errors_1.ValidationError(`Imagem inexistente no pack: ${imageId}`, {
            userMessage: 'Esta imagem nao existe mais. Atualize o painel e tente novamente.',
            context: { entityType: 'pack', entityId: packId },
        });
    }
    return image;
}
/**
 * Remove a imagem e renormaliza a ordem.
 * Se a capa foi removida, a primeira imagem restante assume — um pack nunca
 * fica com imagens e nenhuma capa.
 */
async function removeImage(guildId, actorId, packId, imageId) {
    await (0, CatalogService_1.requirePack)(guildId, packId);
    const image = await requireImage(packId, imageId);
    await (0, prisma_1.getPrisma)().$transaction(async (tx) => {
        await (0, PackImageRepository_1.deletePackImage)(imageId, tx);
        const remaining = await (0, PackImageRepository_1.listPackImages)(packId, tx);
        await (0, PackImageRepository_1.renumberPackImages)(remaining.map((item) => item.id), tx);
        const first = remaining[0];
        if (image.isCover && first !== undefined) {
            await (0, PackImageRepository_1.setPackCover)(packId, first.id, tx);
        }
    });
    (0, CatalogService_1.invalidatePackImages)(packId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.PACK_IMAGE_REMOVED,
        packId,
        imageId,
        actorId,
        oldValue: image.url,
    });
}
/** Sobe/desce uma imagem e renormaliza toda a ordem em uma transacao. */
async function moveImage(guildId, actorId, packId, imageId, direction) {
    await (0, CatalogService_1.requirePack)(guildId, packId);
    await requireImage(packId, imageId);
    const images = await (0, PackImageRepository_1.listPackImages)(packId);
    const index = images.findIndex((image) => image.id === imageId);
    if (index < 0)
        return images;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= images.length)
        return images;
    const reordered = [...images];
    const moved = reordered[index];
    const swapped = reordered[target];
    if (moved === undefined || swapped === undefined)
        return images;
    reordered[index] = swapped;
    reordered[target] = moved;
    await (0, prisma_1.getPrisma)().$transaction(async (tx) => {
        await (0, PackImageRepository_1.renumberPackImages)(reordered.map((image) => image.id), tx);
    });
    (0, CatalogService_1.invalidatePackImages)(packId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.PACK_IMAGE_REORDERED,
        packId,
        imageId,
        actorId,
        oldValue: String(index),
        newValue: String(target),
    });
    return (0, CatalogService_1.getPackImages)(packId);
}
/** Define a capa (exatamente uma por pack, garantido em transacao). */
async function changeCover(guildId, actorId, packId, imageId) {
    await (0, CatalogService_1.requirePack)(guildId, packId);
    await requireImage(packId, imageId);
    await (0, prisma_1.getPrisma)().$transaction(async (tx) => {
        await (0, PackImageRepository_1.setPackCover)(packId, imageId, tx);
    });
    (0, CatalogService_1.invalidatePackImages)(packId);
    await (0, CatalogAuditRepository_1.recordCatalogAudit)({
        guildId,
        action: client_1.CatalogAuditAction.PACK_COVER_CHANGED,
        packId,
        imageId,
        actorId,
        newValue: imageId,
    });
}
//# sourceMappingURL=CatalogImageService.js.map