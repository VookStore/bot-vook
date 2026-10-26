import type { Prisma, TicketCategory } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Categorias de atendimento.
 *
 * Exclusao e SEMPRE soft-delete (`deletedAt`), porque tickets historicos
 * referenciam a categoria. O par (guildId, identifier) e UNIQUE incluindo
 * registros excluidos — recriar um identifier existente "revive" o registro,
 * preservando o historico ligado a ele.
 */

export interface CreateCategoryInput {
  guildId: string;
  name: string;
  identifier: string;
  description?: string | null;
  emoji?: string | null;
  destinationChannelId?: string | null;
  position?: number;
}

export async function listCategories(
  guildId: string,
  options: { includeDisabled?: boolean } = {},
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory[]> {
  return db.ticketCategory.findMany({
    where: {
      guildId,
      deletedAt: null,
      ...(options.includeDisabled === true ? {} : { enabled: true }),
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function findCategoryById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory | null> {
  return db.ticketCategory.findUnique({ where: { id } });
}

/** Busca por identifier incluindo registros soft-deleted (para revive). */
export async function findCategoryByIdentifier(
  guildId: string,
  identifier: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory | null> {
  return db.ticketCategory.findUnique({
    where: { guildId_identifier: { guildId, identifier } },
  });
}

export async function countCategories(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.ticketCategory.count({ where: { guildId, deletedAt: null } });
}

async function nextPosition(guildId: string, db: DatabaseClient): Promise<number> {
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
export async function createCategory(
  input: CreateCategoryInput,
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory> {
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

export async function updateCategory(
  id: string,
  data: Prisma.TicketCategoryUncheckedUpdateInput,
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory> {
  return db.ticketCategory.update({ where: { id }, data });
}

export async function softDeleteCategory(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory> {
  return db.ticketCategory.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false },
  });
}

export async function setCategoryEnabled(
  id: string,
  enabled: boolean,
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory> {
  return db.ticketCategory.update({ where: { id }, data: { enabled } });
}

export async function setCategoryDestination(
  id: string,
  destinationChannelId: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory> {
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
export async function setCategoryLocatorMessage(
  id: string,
  locatorMessageId: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<TicketCategory> {
  return db.ticketCategory.update({ where: { id }, data: { locatorMessageId } });
}

/**
 * Troca a posicao de duas categorias em uma transacao, para nunca deixar duas
 * categorias com a mesma posicao visivel.
 */
export async function swapCategoryPositions(
  first: { id: string; position: number },
  second: { id: string; position: number },
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.ticketCategory.update({ where: { id: first.id }, data: { position: second.position } });
  await db.ticketCategory.update({ where: { id: second.id }, data: { position: first.position } });
}

/** Renumera as posicoes de 0..n-1 (corrige lacunas apos exclusoes). */
export async function normalizeCategoryPositions(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
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
