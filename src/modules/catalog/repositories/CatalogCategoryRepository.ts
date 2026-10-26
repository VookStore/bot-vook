import type { CatalogCategory, Prisma } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Persistencia das categorias do catalogo.
 *
 * Exclusao e SEMPRE soft delete: pedidos historicos apontam para packs que
 * apontam para categorias. Apagar de verdade quebraria o historico de compras.
 */

export interface CreateCatalogCategoryInput {
  guildId: string;
  name: string;
  identifier: string;
  description: string | null;
  emoji: string | null;
  position: number;
  createdById: string | null;
}

export async function listCatalogCategories(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogCategory[]> {
  return db.catalogCategory.findMany({
    where: { guildId, deletedAt: null },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
}

export async function findCatalogCategoryById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogCategory | null> {
  return db.catalogCategory.findUnique({ where: { id } });
}

/** Busca pelo identificador INCLUINDO excluidas (permite reviver o registro). */
export async function findCatalogCategoryByIdentifier(
  guildId: string,
  identifier: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogCategory | null> {
  return db.catalogCategory.findUnique({
    where: { guildId_identifier: { guildId, identifier } },
  });
}

export async function countCatalogCategories(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.catalogCategory.count({ where: { guildId, deletedAt: null } });
}

/** Maior `position` em uso (para inserir a nova categoria no fim da lista). */
export async function maxCategoryPosition(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
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
export async function createCatalogCategory(
  input: CreateCatalogCategoryInput,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogCategory> {
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

export async function updateCatalogCategory(
  id: string,
  data: Prisma.CatalogCategoryUncheckedUpdateInput,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogCategory> {
  return db.catalogCategory.update({ where: { id }, data });
}

export async function softDeleteCatalogCategory(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogCategory> {
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
export async function renumberCategories(
  orderedIds: readonly string[],
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      db.catalogCategory.update({ where: { id }, data: { position: index } }),
    ),
  );
}
