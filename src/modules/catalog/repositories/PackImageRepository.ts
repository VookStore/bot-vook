import type { PackImage } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Persistencia das imagens do pack.
 *
 * Ordem e capa sao dados do BANCO, nunca de memoria: a galeria precisa ser
 * reconstruivel identica depois de qualquer restart do processo.
 */

export async function listPackImages(
  packId: string,
  db: DatabaseClient = getPrisma(),
): Promise<PackImage[]> {
  return db.packImage.findMany({
    where: { packId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function listImagesForPacks(
  packIds: readonly string[],
  db: DatabaseClient = getPrisma(),
): Promise<PackImage[]> {
  if (packIds.length === 0) return [];
  return db.packImage.findMany({
    where: { packId: { in: [...packIds] } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function findPackImageById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<PackImage | null> {
  return db.packImage.findUnique({ where: { id } });
}

export async function countPackImages(
  packId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.packImage.count({ where: { packId } });
}

/**
 * Quantas imagens cada pack possui, em UMA consulta agregada.
 *
 * O painel administrativo precisa disso para avisar "pack sem imagem de capa".
 * Contar pack a pack seria uma consulta por produto — numa loja com centenas de
 * packs, o painel viraria uma varredura de tabela a cada abertura.
 */
export async function countImagesByPack(
  packIds: readonly string[],
  db: DatabaseClient = getPrisma(),
): Promise<Map<string, number>> {
  if (packIds.length === 0) return new Map();

  const rows = await db.packImage.groupBy({
    by: ['packId'],
    where: { packId: { in: [...packIds] } },
    _count: { _all: true },
  });

  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.packId, row._count._all);
  return totals;
}

export async function createPackImage(
  input: { packId: string; url: string; altText: string | null; position: number; isCover: boolean },
  db: DatabaseClient = getPrisma(),
): Promise<PackImage> {
  return db.packImage.create({ data: input });
}

export async function deletePackImage(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<PackImage> {
  return db.packImage.delete({ where: { id } });
}

/** Renumera as posicoes (0..n-1) na ordem recebida. */
export async function renumberPackImages(
  orderedIds: readonly string[],
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      db.packImage.update({ where: { id }, data: { position: index } }),
    ),
  );
}

/**
 * Define a capa garantindo que exista NO MAXIMO uma por pack.
 * Roda em transacao: zerar todas e marcar uma nao pode ficar pela metade.
 */
export async function setPackCover(
  packId: string,
  imageId: string,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.packImage.updateMany({ where: { packId }, data: { isCover: false } });
  await db.packImage.update({ where: { id: imageId }, data: { isCover: true } });
}
