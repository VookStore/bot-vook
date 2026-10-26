import { CatalogAuditAction, type CatalogCategory } from '@prisma/client';

import { BUSINESS_LIMITS, CACHE_TTL } from '../../../constants/limits';
import { CACHE_NAMESPACE, cache } from '../../../core/cache/CacheService';
import { ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { getPrisma } from '../../../core/database/prisma';
import { sanitizeIdentifier } from '../../../utils/sanitize';
import { recordCatalogAudit } from '../repositories/CatalogAuditRepository';
import {
  countCatalogCategories,
  createCatalogCategory,
  findCatalogCategoryByIdentifier,
  findCatalogCategoryById,
  listCatalogCategories,
  maxCategoryPosition,
  renumberCategories,
  softDeleteCatalogCategory,
  updateCatalogCategory,
} from '../repositories/CatalogCategoryRepository';
import { listPacks } from '../repositories/CatalogPackRepository';
import { invalidatePacks } from './CatalogService';

/**
 * Categorias do catalogo.
 *
 * As categorias sao CONFIGURAVEIS: nada de lista fixa no codigo. Veiculos,
 * roupas, mapas e afins sao apenas o cadastro inicial sugerido a loja.
 *
 * Desativar ou excluir uma categoria nunca pode quebrar pedido historico: os
 * packs continuam existindo com seus snapshots, apenas somem da vitrine.
 */

const logger = createLogger('catalog:categories');

export async function getCatalogCategories(guildId: string): Promise<CatalogCategory[]> {
  return cache.getOrLoad(
    CACHE_NAMESPACE.CATALOG_CATEGORIES,
    guildId,
    () => listCatalogCategories(guildId),
    CACHE_TTL.CATALOG_CATEGORIES_MS,
  );
}

export function invalidateCatalogCategories(guildId: string): void {
  cache.delete(CACHE_NAMESPACE.CATALOG_CATEGORIES, guildId);
}

export async function getEnabledCatalogCategories(
  guildId: string,
): Promise<CatalogCategory[]> {
  return (await getCatalogCategories(guildId)).filter((category) => category.enabled);
}

export async function getCatalogCategoryById(
  guildId: string,
  categoryId: string,
): Promise<CatalogCategory | null> {
  const cached = (await getCatalogCategories(guildId)).find(
    (category) => category.id === categoryId,
  );
  if (cached !== undefined) return cached;

  const category = await findCatalogCategoryById(categoryId);
  if (category === null || category.guildId !== guildId || category.deletedAt !== null) {
    return null;
  }
  invalidateCatalogCategories(guildId);
  return category;
}

export async function requireCatalogCategory(
  guildId: string,
  categoryId: string,
): Promise<CatalogCategory> {
  const category = await getCatalogCategoryById(guildId, categoryId);
  if (category === null) {
    throw new ValidationError(`Categoria de catalogo inexistente: ${categoryId}`, {
      userMessage: 'Esta categoria nao existe mais. Atualize o painel e tente novamente.',
      context: { guildId, entityType: 'catalog-category', entityId: categoryId },
    });
  }
  return category;
}

export interface CategoryTermsInput {
  name: string;
  description: string | null;
  emoji: string | null;
}

export async function createCategoryFromInput(
  guildId: string,
  actorId: string,
  terms: CategoryTermsInput,
): Promise<{ category: CatalogCategory; restored: boolean }> {
  const total = await countCatalogCategories(guildId);
  if (total >= BUSINESS_LIMITS.MAX_CATALOG_CATEGORIES_PER_GUILD) {
    throw new ValidationError(`Limite de categorias atingido: ${total}`, {
      userMessage: `O catalogo aceita no maximo ${BUSINESS_LIMITS.MAX_CATALOG_CATEGORIES_PER_GUILD} categorias.`,
    });
  }

  const identifier = sanitizeIdentifier(terms.name, 'categoria');
  const existing = await findCatalogCategoryByIdentifier(guildId, identifier);

  if (existing !== null && existing.deletedAt === null) {
    throw new ValidationError(`Categoria duplicada: ${identifier}`, {
      userMessage: `Ja existe a categoria **${existing.name}**. Use "Editar" para altera-la.`,
      context: { guildId, entityType: 'catalog-category', entityId: existing.id },
    });
  }

  const position = (await maxCategoryPosition(guildId)) + 1;
  const category = await createCatalogCategory({
    guildId,
    name: terms.name,
    identifier,
    description: terms.description,
    emoji: terms.emoji,
    position,
    createdById: actorId,
  });

  invalidateCatalogCategories(guildId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.CATEGORY_CREATED,
    categoryId: category.id,
    actorId,
    newValue: category.name,
  });

  logger.info(existing !== null ? 'Categoria restaurada.' : 'Categoria criada.', {
    guildId,
    userId: actorId,
    entityType: 'catalog-category',
    entityId: category.id,
  });

  return { category, restored: existing !== null };
}

export async function updateCategoryFromInput(
  guildId: string,
  actorId: string,
  categoryId: string,
  terms: CategoryTermsInput,
): Promise<CatalogCategory> {
  const current = await requireCatalogCategory(guildId, categoryId);

  const updated = await updateCatalogCategory(categoryId, {
    name: terms.name,
    description: terms.description,
    emoji: terms.emoji,
  });

  invalidateCatalogCategories(guildId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.CATEGORY_UPDATED,
    categoryId,
    actorId,
    oldValue: current.name,
    newValue: updated.name,
  });

  return updated;
}

/**
 * Ativa/desativa. Categoria desativada some da vitrine junto com seus packs,
 * mas nenhum pedido historico e afetado.
 */
export async function toggleCategory(
  guildId: string,
  actorId: string,
  categoryId: string,
): Promise<CatalogCategory> {
  const current = await requireCatalogCategory(guildId, categoryId);
  const updated = await updateCatalogCategory(categoryId, { enabled: !current.enabled });

  invalidateCatalogCategories(guildId);
  invalidatePacks(guildId);

  await recordCatalogAudit({
    guildId,
    action: updated.enabled
      ? CatalogAuditAction.CATEGORY_ENABLED
      : CatalogAuditAction.CATEGORY_DISABLED,
    categoryId,
    actorId,
    oldValue: current.enabled ? 'enabled' : 'disabled',
    newValue: updated.enabled ? 'enabled' : 'disabled',
  });

  return updated;
}

/**
 * Exclusao logica.
 *
 * Recusada enquanto houver pack vivo na categoria: apagar a categoria de um
 * produto ativo deixaria a vitrine com um item orfao e sem rota de volta.
 */
export async function deleteCategory(
  guildId: string,
  actorId: string,
  categoryId: string,
): Promise<CatalogCategory> {
  const current = await requireCatalogCategory(guildId, categoryId);

  const packs = await listPacks(guildId, { categoryId, includeDisabled: true });
  if (packs.length > 0) {
    throw new ValidationError(`Categoria com ${packs.length} pack(s): ${categoryId}`, {
      userMessage:
        `Esta categoria ainda possui ${packs.length} pack(s). ` +
        'Mova ou exclua os produtos antes de excluir a categoria.',
    });
  }

  const deleted = await softDeleteCatalogCategory(categoryId);
  invalidateCatalogCategories(guildId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.CATEGORY_DELETED,
    categoryId,
    actorId,
    oldValue: current.name,
  });

  return deleted;
}

/**
 * Move a categoria uma posicao para cima/baixo e RENORMALIZA a lista inteira.
 * Renormalizar evita empates e buracos que, com o tempo, tornariam a ordem
 * imprevisivel.
 */
export async function moveCategory(
  guildId: string,
  actorId: string,
  categoryId: string,
  direction: 'up' | 'down',
): Promise<CatalogCategory[]> {
  await requireCatalogCategory(guildId, categoryId);

  const categories = await listCatalogCategories(guildId);
  const index = categories.findIndex((category) => category.id === categoryId);
  if (index < 0) {
    throw new ValidationError(`Categoria fora da lista: ${categoryId}`, {
      userMessage: 'Esta categoria nao esta mais na lista. Atualize o painel.',
    });
  }

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= categories.length) return categories;

  const reordered = [...categories];
  const moved = reordered[index];
  const swapped = reordered[target];
  if (moved === undefined || swapped === undefined) return categories;
  reordered[index] = swapped;
  reordered[target] = moved;

  await getPrisma().$transaction(async (tx) => {
    await renumberCategories(
      reordered.map((category) => category.id),
      tx,
    );
  });

  invalidateCatalogCategories(guildId);

  await recordCatalogAudit({
    guildId,
    action: CatalogAuditAction.CATEGORY_REORDERED,
    categoryId,
    actorId,
    oldValue: String(index),
    newValue: String(target),
  });

  return listCatalogCategories(guildId);
}

/**
 * Define em quais categorias o desconto automatico de booster vale.
 *
 * RECEBE O ESTADO FINAL de cada categoria informada, nao um delta: a tela e um
 * multi-select, e "desmarcar" precisa ser tao possivel quanto "marcar" —
 * desmarcar e justamente a operacao que protege PEDs, roupas e props.
 *
 * Escreve em UMA transacao e invalida o cache no fim. Sem a invalidacao, a
 * proxima venda leria a lista antiga por ate dez minutos e daria (ou negaria) o
 * desconto pela regra que acabou de ser trocada.
 */
export async function setBoosterEligibility(
  guildId: string,
  updates: ReadonlyArray<{ id: string; eligible: boolean }>,
): Promise<number> {
  if (updates.length === 0) return 0;

  const db = getPrisma();

  const written = await db.$transaction(
    updates.map((update) =>
      db.catalogCategory.updateMany({
        // `guildId` no where: um id de outra guild nunca altera nada, mesmo que
        // o valor chegue adulterado pelo componente.
        where: { id: update.id, guildId },
        data: { boosterEligible: update.eligible },
      }),
    ),
  );

  invalidateCatalogCategories(guildId);

  const total = written.reduce((sum, result) => sum + result.count, 0);
  logger.info('Elegibilidade de desconto de booster atualizada.', {
    guildId,
    entityType: 'catalog-category',
    count: total,
  });

  return total;
}

/**
 * Define o prazo de producao de uma categoria, em dias uteis.
 *
 * `null` remove o prazo: a categoria volta a nao gerar previsao nos pedidos, em
 * vez de assumir zero — "sem prazo definido" e "entrega hoje" sao coisas
 * bem diferentes de se prometer.
 *
 * NAO MEXE EM PEDIDO NENHUM. A previsao de cada pedido e congelada no momento
 * do pagamento, de proposito: mudar o prazo aqui vale para as proximas vendas e
 * nunca reescreve a promessa feita a quem ja comprou.
 */
export async function setCategoryLeadTime(
  guildId: string,
  categoryId: string,
  leadTimeDays: number | null,
): Promise<boolean> {
  const { count } = await getPrisma().catalogCategory.updateMany({
    // `guildId` no where: id de outra guild nunca altera nada.
    where: { id: categoryId, guildId },
    data: { leadTimeDays },
  });

  if (count === 0) return false;

  invalidateCatalogCategories(guildId);
  logger.info('Prazo de producao da categoria atualizado.', {
    guildId,
    entityType: 'catalog-category',
    entityId: categoryId,
    leadTimeDays,
  });

  return true;
}
