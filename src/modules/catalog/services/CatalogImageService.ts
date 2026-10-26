import { CatalogAuditAction, type PackImage } from '@prisma/client';

import { BUSINESS_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { getPrisma } from '../../../core/database/prisma';
import { recordCatalogAudit } from '../repositories/CatalogAuditRepository';
import {
  countPackImages,
  createPackImage,
  deletePackImage,
  findPackImageById,
  listPackImages,
  renumberPackImages,
  setPackCover,
} from '../repositories/PackImageRepository';
import { getPackImages, invalidatePackImages, requirePack } from './CatalogService';

/**
 * Galeria de imagens do pack.
 *
 * ORDEM e CAPA vivem no banco. A navegacao (◀️ ▶️) e reconstruida a partir
 * dessa lista, entao ela funciona igual depois de qualquer restart — o indice
 * atual viaja no customId, e so.
 *
 * URL passa por `parseImageUrl` (somente https) antes de chegar aqui.
 */

const logger = createLogger('catalog:images');

export async function listImages(packId: string): Promise<PackImage[]> {
  return listPackImages(packId);
}

/**
 * Imagem de capa: a marcada com `isCover` ou, na falta dela, a primeira da
 * ordem. Assim todo pack com imagem sempre tem uma capa logica.
 */
export function resolveCover(images: readonly PackImage[]): PackImage | null {
  return images.find((image) => image.isCover) ?? images[0] ?? null;
}

export async function addImage(
  guildId: string,
  actorId: string,
  packId: string,
  url: string,
  altText: string | null,
): Promise<PackImage> {
  await requirePack(guildId, packId);

  const total = await countPackImages(packId);
  if (total >= BUSINESS_LIMITS.MAX_IMAGES_PER_PACK) {
    throw new ValidationError(`Limite de imagens atingido: ${total}`, {
      userMessage: `Cada pack aceita no maximo ${BUSINESS_LIMITS.MAX_IMAGES_PER_PACK} imagens.`,
    });
  }

  const image = await createPackImage({
    packId,
    url,
    altText,
    position: total,
    // A primeira imagem cadastrada vira capa automaticamente.
    isCover: total === 0,
  });

  invalidatePackImages(packId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.PACK_IMAGE_ADDED,
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
async function requireImage(packId: string, imageId: string): Promise<PackImage> {
  const image = await findPackImageById(imageId);
  if (image === null || image.packId !== packId) {
    throw new ValidationError(`Imagem inexistente no pack: ${imageId}`, {
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
export async function removeImage(
  guildId: string,
  actorId: string,
  packId: string,
  imageId: string,
): Promise<void> {
  await requirePack(guildId, packId);
  const image = await requireImage(packId, imageId);

  await getPrisma().$transaction(async (tx) => {
    await deletePackImage(imageId, tx);
    const remaining = await listPackImages(packId, tx);
    await renumberPackImages(
      remaining.map((item) => item.id),
      tx,
    );

    const first = remaining[0];
    if (image.isCover && first !== undefined) {
      await setPackCover(packId, first.id, tx);
    }
  });

  invalidatePackImages(packId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.PACK_IMAGE_REMOVED,
    packId,
    imageId,
    actorId,
    oldValue: image.url,
  });
}

/** Sobe/desce uma imagem e renormaliza toda a ordem em uma transacao. */
export async function moveImage(
  guildId: string,
  actorId: string,
  packId: string,
  imageId: string,
  direction: 'up' | 'down',
): Promise<PackImage[]> {
  await requirePack(guildId, packId);
  await requireImage(packId, imageId);

  const images = await listPackImages(packId);
  const index = images.findIndex((image) => image.id === imageId);
  if (index < 0) return images;

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= images.length) return images;

  const reordered = [...images];
  const moved = reordered[index];
  const swapped = reordered[target];
  if (moved === undefined || swapped === undefined) return images;
  reordered[index] = swapped;
  reordered[target] = moved;

  await getPrisma().$transaction(async (tx) => {
    await renumberPackImages(
      reordered.map((image) => image.id),
      tx,
    );
  });

  invalidatePackImages(packId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.PACK_IMAGE_REORDERED,
    packId,
    imageId,
    actorId,
    oldValue: String(index),
    newValue: String(target),
  });

  return getPackImages(packId);
}

/** Define a capa (exatamente uma por pack, garantido em transacao). */
export async function changeCover(
  guildId: string,
  actorId: string,
  packId: string,
  imageId: string,
): Promise<void> {
  await requirePack(guildId, packId);
  await requireImage(packId, imageId);

  await getPrisma().$transaction(async (tx) => {
    await setPackCover(packId, imageId, tx);
  });

  invalidatePackImages(packId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.PACK_COVER_CHANGED,
    packId,
    imageId,
    actorId,
    newValue: imageId,
  });
}
