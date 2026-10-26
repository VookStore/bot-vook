import {
  CatalogAuditAction,
  type CatalogCategory,
  type CatalogPack,
  type PackImage,
} from '@prisma/client';

import { BUSINESS_LIMITS, CACHE_TTL } from '../../../constants/limits';
import { CACHE_NAMESPACE, cache } from '../../../core/cache/CacheService';
import { ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { getPrisma } from '../../../core/database/prisma';
import { formatCents } from '../../../utils/money';
import { foldForSearch } from '../../../utils/sanitize';
import { recordCatalogAudit } from '../repositories/CatalogAuditRepository';
import {
  countPacks,
  createPack,
  findPackById,
  findPackBySku,
  findPackBySlug,
  listPackDetails,
  listPacks,
  maxPackPosition,
  removePackFromCarts,
  replacePackDetails,
  softDeletePack,
  updatePack,
} from '../repositories/CatalogPackRepository';
import { listPackImages } from '../repositories/PackImageRepository';
import { getCatalogCategories, getCatalogCategoryById } from './CatalogCategoryService';
import {
  assertValidPrice,
  buildPackSlug,
  hasSellablePrice,
  type PackDetailInput,
} from '../validators/packValidators';
import type { PackView } from '../types/catalog';

/**
 * Catalogo de produtos.
 *
 * CACHE: o PostgreSQL e a fonte de verdade; o cache existe so para o caminho
 * quente da vitrine (home, categoria, galeria). Toda escrita invalida DEPOIS do
 * commit — nunca antes.
 *
 * ORDENACAO: destaque primeiro, depois posicao, depois nome. A mesma regra em
 * todos os caminhos, para o cliente nunca ver a lista "pular" entre telas.
 */

const logger = createLogger('catalog');

// ---------------------------------------------------------------------------
// Leitura (cacheada)
// ---------------------------------------------------------------------------

/** Todos os packs vivos da guild (ativos e desativados), cacheados. */
export async function getPacks(guildId: string): Promise<CatalogPack[]> {
  return cache.getOrLoad(
    CACHE_NAMESPACE.CATALOG_PACKS,
    guildId,
    () => listPacks(guildId, { includeDisabled: true }),
    CACHE_TTL.CATALOG_PACKS_MS,
  );
}

export function invalidatePacks(guildId: string): void {
  cache.delete(CACHE_NAMESPACE.CATALOG_PACKS, guildId);
}

export function invalidatePackImages(packId: string): void {
  cache.delete(CACHE_NAMESPACE.PACK_IMAGES, packId);
}

/** Imagens do pack em ordem de exibicao, cacheadas por pack. */
export async function getPackImages(packId: string): Promise<PackImage[]> {
  return cache.getOrLoad(
    CACHE_NAMESPACE.PACK_IMAGES,
    packId,
    () => listPackImages(packId),
    CACHE_TTL.PACK_IMAGES_MS,
  );
}

/**
 * Pack da guild pelo id.
 *
 * NUNCA confia no customId: confere guild e exclusao. Em caso de miss no cache,
 * confirma no banco (o pack pode ter sido criado por outro processo).
 */
export async function getPackById(
  guildId: string,
  packId: string,
): Promise<CatalogPack | null> {
  const cached = (await getPacks(guildId)).find((pack) => pack.id === packId);
  if (cached !== undefined) return cached.deletedAt === null ? cached : null;

  const pack = await findPackById(packId);
  if (pack === null || pack.guildId !== guildId || pack.deletedAt !== null) return null;
  invalidatePacks(guildId);
  return pack;
}

/** Pack VENDAVEL: existe, esta ativo, tem categoria valida e preco valido. */
export async function getSellablePack(
  guildId: string,
  packId: string,
): Promise<CatalogPack> {
  const pack = await getPackById(guildId, packId);
  if (pack === null) {
    throw new ValidationError(`Pack inexistente: ${packId}`, {
      userMessage: 'Este pack nao existe mais. Atualize o catalogo e tente novamente.',
      context: { guildId, entityType: 'pack', entityId: packId },
    });
  }
  if (!pack.enabled) {
    throw new ValidationError(`Pack desativado: ${packId}`, {
      userMessage: 'Este pack esta indisponivel no momento.',
      context: { guildId, entityType: 'pack', entityId: packId },
    });
  }
  if (!hasSellablePrice(pack.price)) {
    throw new ValidationError(`Pack sem preco valido: ${packId}`, {
      userMessage: 'Este pack esta sem preco valido e nao pode ser comprado agora.',
      context: { guildId, entityType: 'pack', entityId: packId },
    });
  }

  const category = await getCatalogCategoryById(guildId, pack.categoryId);
  if (category === null || !category.enabled) {
    throw new ValidationError(`Pack em categoria indisponivel: ${packId}`, {
      userMessage: 'Este pack esta em uma categoria indisponivel no momento.',
      context: { guildId, entityType: 'pack', entityId: packId },
    });
  }

  return pack;
}

/** Tudo que a vitrine precisa de um pack em uma unica chamada. */
export async function getPackView(guildId: string, packId: string): Promise<PackView | null> {
  const pack = await getPackById(guildId, packId);
  if (pack === null) return null;

  const [category, images, details] = await Promise.all([
    getCatalogCategoryById(guildId, pack.categoryId),
    getPackImages(packId),
    listPackDetails(packId),
  ]);

  return { pack, category, images, details };
}

export interface VisiblePacksOptions {
  categoryId?: string | null;
  /** Termo de busca (nome, SKU ou descricao curta). */
  search?: string | null;
}

/**
 * Packs que o CLIENTE pode ver: ativos, com categoria ativa e preco vendavel
 * (packs sem preco valido continuam listados, mas marcados como indisponiveis
 * pelo builder — some-los sem aviso esconderia um erro de cadastro).
 */
export async function listVisiblePacks(
  guildId: string,
  options: VisiblePacksOptions = {},
): Promise<CatalogPack[]> {
  const [packs, categories] = await Promise.all([
    getPacks(guildId),
    getCatalogCategories(guildId),
  ]);

  const enabledCategoryIds = new Set(
    categories.filter((category) => category.enabled).map((category) => category.id),
  );

  const term = normalizeSearchTerm(options.search ?? null);

  return packs.filter((pack) => {
    if (pack.deletedAt !== null || !pack.enabled) return false;
    if (!enabledCategoryIds.has(pack.categoryId)) return false;
    if (
      options.categoryId !== null &&
      options.categoryId !== undefined &&
      pack.categoryId !== options.categoryId
    ) {
      return false;
    }
    if (term === null) return true;
    return matchesSearch(pack, term);
  });
}

/** Packs em destaque (ja visiveis), na ordem oficial da vitrine. */
export async function listFeaturedPacks(guildId: string): Promise<CatalogPack[]> {
  const visible = await listVisiblePacks(guildId);
  return visible.filter((pack) => pack.featured);
}

function normalizeSearchTerm(search: string | null): string | null {
  if (search === null) return null;
  const term = foldForSearch(search);
  return term.length >= BUSINESS_LIMITS.CATALOG_SEARCH_MIN ? term : null;
}

/** Busca por nome, SKU e descricao curta, ignorando acento e caixa. */
function matchesSearch(pack: CatalogPack, term: string): boolean {
  const haystack = [pack.name, pack.sku ?? '', pack.shortDescription ?? '']
    .map((value) => foldForSearch(value))
    .join(' | ');
  return haystack.includes(term);
}

/** Contagem usada no painel de status do sistema. */
export async function countActivePacks(guildId: string): Promise<number> {
  return countPacks(guildId, { includeDisabled: false });
}

// ---------------------------------------------------------------------------
// Administracao
// ---------------------------------------------------------------------------

export interface CreatePackInput {
  guildId: string;
  actorId: string;
  categoryId: string;
  name: string;
  sku: string | null;
  price: number;
  shortDescription: string | null;
  description: string | null;
}

/** Slug unico dentro da guild (o nome pode repetir, o slug nao). */
async function uniqueSlug(guildId: string, name: string, ignoreId?: string): Promise<string> {
  const base = buildPackSlug(name);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await findPackBySlug(guildId, candidate);
    if (existing === null || existing.id === ignoreId) return candidate;
  }
  throw new ValidationError(`Nao foi possivel gerar slug unico para: ${name}`, {
    userMessage: 'Ja existem produtos demais com este nome. Escolha um nome diferente.',
  });
}

async function assertSkuAvailable(
  guildId: string,
  sku: string | null,
  ignoreId?: string,
): Promise<void> {
  if (sku === null) return;
  const existing = await findPackBySku(guildId, sku);
  if (existing !== null && existing.id !== ignoreId) {
    throw new ValidationError(`SKU duplicado: ${sku}`, {
      userMessage: `O SKU **${sku}** ja pertence a outro pack deste servidor.`,
      context: { guildId, entityType: 'pack', entityId: existing.id },
    });
  }
}

export async function createPackFromInput(input: CreatePackInput): Promise<CatalogPack> {
  assertValidPrice(input.price);

  const category = await getCatalogCategoryById(input.guildId, input.categoryId);
  if (category === null) {
    throw new ValidationError(`Categoria inexistente: ${input.categoryId}`, {
      userMessage: 'Esta categoria nao existe mais. Atualize o painel e tente novamente.',
    });
  }

  const total = await countPacks(input.guildId, { includeDisabled: true });
  if (total >= BUSINESS_LIMITS.MAX_PACKS_PER_GUILD) {
    throw new ValidationError(`Limite de packs atingido: ${total}`, {
      userMessage: `Este servidor ja possui o limite de ${BUSINESS_LIMITS.MAX_PACKS_PER_GUILD} packs.`,
    });
  }

  await assertSkuAvailable(input.guildId, input.sku);
  const slug = await uniqueSlug(input.guildId, input.name);
  const position = (await maxPackPosition(input.guildId)) + 1;

  const pack = await createPack({
    guildId: input.guildId,
    categoryId: input.categoryId,
    name: input.name,
    slug,
    sku: input.sku,
    shortDescription: input.shortDescription,
    description: input.description,
    price: input.price,
    position,
    createdById: input.actorId,
  });

  invalidatePacks(input.guildId);

  await recordCatalogAudit({
    guildId: input.guildId,
    action: CatalogAuditAction.PACK_CREATED,
    packId: pack.id,
    categoryId: pack.categoryId,
    actorId: input.actorId,
    newValue: `${pack.name} — ${formatCents(pack.price)}`,
  });

  logger.info('Pack criado.', {
    guildId: input.guildId,
    userId: input.actorId,
    entityType: 'pack',
    entityId: pack.id,
    price: pack.price,
  });

  return pack;
}

/** Pack vivo desta guild, ou ValidationError com mensagem util. */
export async function requirePack(guildId: string, packId: string): Promise<CatalogPack> {
  const pack = await getPackById(guildId, packId);
  if (pack === null) {
    throw new ValidationError(`Pack inexistente: ${packId}`, {
      userMessage: 'Este pack nao existe mais. Atualize o painel e tente novamente.',
      context: { guildId, entityType: 'pack', entityId: packId },
    });
  }
  return pack;
}

export interface UpdatePackInput {
  guildId: string;
  actorId: string;
  packId: string;
  name: string;
  sku: string | null;
  price: number;
  shortDescription: string | null;
  description: string | null;
}

export async function updatePackFromInput(input: UpdatePackInput): Promise<CatalogPack> {
  assertValidPrice(input.price);

  const current = await requirePack(input.guildId, input.packId);
  await assertSkuAvailable(input.guildId, input.sku, current.id);

  const slug =
    input.name === current.name
      ? current.slug
      : await uniqueSlug(input.guildId, input.name, current.id);

  const updated = await updatePack(current.id, {
    name: input.name,
    slug,
    sku: input.sku,
    price: input.price,
    shortDescription: input.shortDescription,
    description: input.description,
  });

  invalidatePacks(input.guildId);

  await recordCatalogAudit({
    guildId: input.guildId,
    action: CatalogAuditAction.PACK_UPDATED,
    packId: updated.id,
    actorId: input.actorId,
    oldValue: `${current.name} — ${formatCents(current.price)}`,
    newValue: `${updated.name} — ${formatCents(updated.price)}`,
  });

  logger.info('Pack atualizado.', {
    guildId: input.guildId,
    userId: input.actorId,
    entityType: 'pack',
    entityId: updated.id,
  });

  return updated;
}

/** Altera somente o preco (caminho rapido do painel "Precos"). */
export async function changePackPrice(
  guildId: string,
  actorId: string,
  packId: string,
  price: number,
): Promise<CatalogPack> {
  assertValidPrice(price);
  const current = await requirePack(guildId, packId);
  const updated = await updatePack(packId, { price });

  invalidatePacks(guildId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.PACK_UPDATED,
    packId,
    actorId,
    oldValue: formatCents(current.price),
    newValue: formatCents(updated.price),
    metadata: { field: 'price' },
  });

  logger.info('Preco de pack alterado.', {
    guildId,
    userId: actorId,
    entityType: 'pack',
    entityId: packId,
    oldPrice: current.price,
    newPrice: updated.price,
  });

  return updated;
}

/** Move o pack para outra categoria do catalogo. */
export async function changePackCategory(
  guildId: string,
  actorId: string,
  packId: string,
  categoryId: string,
): Promise<CatalogPack> {
  const current = await requirePack(guildId, packId);
  const category = await getCatalogCategoryById(guildId, categoryId);
  if (category === null) {
    throw new ValidationError(`Categoria inexistente: ${categoryId}`, {
      userMessage: 'Esta categoria nao existe mais. Atualize o painel e tente novamente.',
    });
  }

  const updated = await updatePack(packId, { categoryId });
  invalidatePacks(guildId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.PACK_UPDATED,
    packId,
    categoryId,
    actorId,
    oldValue: current.categoryId,
    newValue: categoryId,
    metadata: { field: 'categoryId' },
  });

  return updated;
}

/**
 * Ativa/desativa o pack.
 *
 * Desativar NAO apaga nada: o pack some da vitrine, sai dos carrinhos abertos
 * (para ninguem finalizar uma compra de item indisponivel) e continua intacto
 * nos pedidos ja emitidos, com todos os snapshots.
 */
export async function togglePack(
  guildId: string,
  actorId: string,
  packId: string,
): Promise<CatalogPack> {
  const current = await requirePack(guildId, packId);

  if (!current.enabled && !hasSellablePrice(current.price)) {
    throw new ValidationError(`Pack sem preco valido nao pode ser ativado: ${packId}`, {
      userMessage: 'Cadastre um preco valido antes de ativar este pack.',
    });
  }

  const updated = await updatePack(packId, { enabled: !current.enabled });
  invalidatePacks(guildId);

  if (!updated.enabled) {
    const removed = await removePackFromCarts(packId);
    if (removed > 0) {
      logger.info('Pack desativado foi removido de carrinhos abertos.', {
        guildId,
        entityType: 'pack',
        entityId: packId,
        removed,
      });
    }
  }

  await recordCatalogAudit({
    guildId,
    action: updated.enabled
      ? CatalogAuditAction.PACK_ENABLED
      : CatalogAuditAction.PACK_DISABLED,
    packId,
    actorId,
    oldValue: current.enabled ? 'enabled' : 'disabled',
    newValue: updated.enabled ? 'enabled' : 'disabled',
  });

  return updated;
}

export async function togglePackFeatured(
  guildId: string,
  actorId: string,
  packId: string,
): Promise<CatalogPack> {
  const current = await requirePack(guildId, packId);
  const updated = await updatePack(packId, { featured: !current.featured });
  invalidatePacks(guildId);

  await recordCatalogAudit({
    guildId,
    action: updated.featured
      ? CatalogAuditAction.PACK_FEATURED
      : CatalogAuditAction.PACK_UNFEATURED,
    packId,
    actorId,
    oldValue: current.featured ? 'featured' : 'normal',
    newValue: updated.featured ? 'featured' : 'normal',
  });

  return updated;
}

/**
 * Exclusao LOGICA. Pedidos historicos continuam apontando para o pack e
 * mantendo seus snapshots; a vitrine e os carrinhos perdem o produto.
 */
export async function deletePack(
  guildId: string,
  actorId: string,
  packId: string,
): Promise<CatalogPack> {
  const current = await requirePack(guildId, packId);
  const deleted = await softDeletePack(packId);

  await removePackFromCarts(packId);
  invalidatePacks(guildId);
  invalidatePackImages(packId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.PACK_DELETED,
    packId,
    actorId,
    oldValue: `${current.name} — ${formatCents(current.price)}`,
  });

  logger.info('Pack excluido (soft delete).', {
    guildId,
    userId: actorId,
    entityType: 'pack',
    entityId: packId,
  });

  return deleted;
}

/** Substitui a ficha tecnica do pack em uma transacao. */
export async function replaceDetails(
  guildId: string,
  actorId: string,
  packId: string,
  details: readonly PackDetailInput[],
): Promise<void> {
  await requirePack(guildId, packId);

  await getPrisma().$transaction(async (tx) => {
    await replacePackDetails(packId, details, tx);
  });

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.PACK_DETAILS_UPDATED,
    packId,
    actorId,
    newValue: `${details.length} item(ns)`,
  });
}

export async function getPackDetails(packId: string): Promise<Awaited<ReturnType<typeof listPackDetails>>> {
  return listPackDetails(packId);
}

/** Categorias com pelo menos um pack visivel (usado no seletor da vitrine). */
export async function listCategoriesWithPacks(
  guildId: string,
): Promise<Array<{ category: CatalogCategory; count: number }>> {
  const [categories, visible] = await Promise.all([
    getCatalogCategories(guildId),
    listVisiblePacks(guildId),
  ]);

  const counts = new Map<string, number>();
  for (const pack of visible) {
    counts.set(pack.categoryId, (counts.get(pack.categoryId) ?? 0) + 1);
  }

  return categories
    .filter((category) => category.enabled)
    .map((category) => ({ category, count: counts.get(category.id) ?? 0 }));
}
