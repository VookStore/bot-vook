import type { CatalogPack, CatalogPackDetail, Prisma } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

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

export const PACK_ORDER: Prisma.CatalogPackOrderByWithRelationInput[] = [
  { featured: 'desc' },
  { position: 'asc' },
  { name: 'asc' },
];

export interface CreateCatalogPackInput {
  guildId: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string | null;
  shortDescription: string | null;
  description: string | null;
  price: number;
  position: number;
  createdById: string | null;
}

export interface ListPacksOptions {
  categoryId?: string;
  /** Quando false (padrao), traz somente packs ativos. */
  includeDisabled?: boolean;
}

export async function listPacks(
  guildId: string,
  options: ListPacksOptions = {},
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPack[]> {
  return db.catalogPack.findMany({
    where: {
      guildId,
      deletedAt: null,
      ...(options.includeDisabled === true ? {} : { enabled: true }),
      ...(options.categoryId !== undefined ? { categoryId: options.categoryId } : {}),
    },
    orderBy: PACK_ORDER,
  });
}

export async function findPackById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPack | null> {
  return db.catalogPack.findUnique({ where: { id } });
}

export async function findPackBySlug(
  guildId: string,
  slug: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPack | null> {
  return db.catalogPack.findUnique({ where: { guildId_slug: { guildId, slug } } });
}

export async function findPackBySku(
  guildId: string,
  sku: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPack | null> {
  return db.catalogPack.findUnique({ where: { guildId_sku: { guildId, sku } } });
}

export async function findPacksByIds(
  ids: readonly string[],
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPack[]> {
  if (ids.length === 0) return [];
  return db.catalogPack.findMany({ where: { id: { in: [...ids] } } });
}

export async function countPacks(
  guildId: string,
  options: { includeDisabled?: boolean } = {},
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.catalogPack.count({
    where: {
      guildId,
      deletedAt: null,
      ...(options.includeDisabled === true ? {} : { enabled: true }),
    },
  });
}

export async function maxPackPosition(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  const result = await db.catalogPack.aggregate({
    where: { guildId, deletedAt: null },
    _max: { position: true },
  });
  return result._max.position ?? 0;
}

export async function createPack(
  input: CreateCatalogPackInput,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPack> {
  return db.catalogPack.create({ data: { ...input, enabled: true, featured: false } });
}

export async function updatePack(
  id: string,
  data: Prisma.CatalogPackUncheckedUpdateInput,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPack> {
  return db.catalogPack.update({ where: { id }, data });
}

/**
 * Soft delete.
 * Tambem desativa e libera slug/SKU (sufixo com o id), para que a equipe possa
 * recadastrar o mesmo codigo depois sem esbarrar no UNIQUE da guild.
 */
export async function softDeletePack(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPack> {
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
export async function removePackFromCarts(
  packId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  const result = await db.cartItem.deleteMany({ where: { packId } });
  return result.count;
}

// ---------------------------------------------------------------------------
// Ficha tecnica (detalhes)
// ---------------------------------------------------------------------------

export async function listPackDetails(
  packId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPackDetail[]> {
  return db.catalogPackDetail.findMany({
    where: { packId },
    orderBy: [{ position: 'asc' }],
  });
}

export async function listDetailsForPacks(
  packIds: readonly string[],
  db: DatabaseClient = getPrisma(),
): Promise<CatalogPackDetail[]> {
  if (packIds.length === 0) return [];
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
export async function replacePackDetails(
  packId: string,
  details: ReadonlyArray<{ label: string; value: string }>,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.catalogPackDetail.deleteMany({ where: { packId } });
  if (details.length === 0) return;
  await db.catalogPackDetail.createMany({
    data: details.map((detail, index) => ({
      packId,
      label: detail.label,
      value: detail.value,
      position: index,
    })),
  });
}
