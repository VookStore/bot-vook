import type { TicketCategory } from '@prisma/client';

import { CACHE_NAMESPACE, cache } from '../../../core/cache/CacheService';
import { CACHE_TTL } from '../../../constants/limits';
import {
  listCategories,
  findCategoryById,
} from '../repositories/TicketCategoryRepository';
import {
  listTeamRoleIds,
  listTeamRolesForGuild,
} from '../repositories/TicketTeamRoleRepository';

/**
 * Leitura cacheada da configuracao de tickets (categorias e equipes).
 * Escritas ficam nos repositories; quem escreve chama a invalidacao daqui.
 */

/** Categorias ativas da guild (ordenadas por posicao). */
export async function getCategories(guildId: string): Promise<TicketCategory[]> {
  return cache.getOrLoad(
    CACHE_NAMESPACE.CATEGORIES,
    guildId,
    () => listCategories(guildId, { includeDisabled: true }),
    CACHE_TTL.CATEGORIES_MS,
  );
}

/** Somente as categorias habilitadas (as que aparecem no painel publico). */
export async function getEnabledCategories(guildId: string): Promise<TicketCategory[]> {
  const categories = await getCategories(guildId);
  return categories.filter((category) => category.enabled && category.deletedAt === null);
}

export async function getCategoryById(
  guildId: string,
  categoryId: string,
): Promise<TicketCategory | null> {
  const cached = (await getCategories(guildId)).find((category) => category.id === categoryId);
  if (cached !== undefined) return cached;

  // Categoria pode ter sido criada em outro processo: confirma no banco.
  const category = await findCategoryById(categoryId);
  if (category === null || category.guildId !== guildId) return null;

  /*
   * So invalida quando a categoria DEVERIA estar na lista e nao estava — ou
   * seja, quando o cache esta mesmo desatualizado.
   *
   * `listCategories` filtra `deletedAt: null` sempre, entao categoria
   * soft-deletada NUNCA entra no cache e cairia aqui em toda leitura. Como
   * `getCategoryById` esta nos caminhos quentes (todo refresh de painel de
   * ticket, fechamento, notificacao, painel admin), invalidar aqui derrubava o
   * cache de categorias da guild inteira — inclusive o do painel publico — a
   * cada leitura de um ticket de categoria removida.
   */
  if (category.deletedAt === null) {
    invalidateCategories(guildId);
  }
  return category;
}

/** Cargos responsaveis pela categoria. */
export async function getTeamRoleIds(categoryId: string): Promise<string[]> {
  return cache.getOrLoad(
    CACHE_NAMESPACE.TEAM_ROLES,
    categoryId,
    () => listTeamRoleIds(categoryId),
    CACHE_TTL.TEAM_ROLES_MS,
  );
}

/** Todos os cargos de equipe da guild (qualquer categoria). */
export async function getGuildTeamRoleIds(guildId: string): Promise<string[]> {
  const roles = await listTeamRolesForGuild(guildId);
  return [...new Set(roles.map((role) => role.roleId))];
}

export function invalidateCategories(guildId: string): void {
  cache.delete(CACHE_NAMESPACE.CATEGORIES, guildId);
}

export function invalidateTeamRoles(categoryId: string): void {
  cache.delete(CACHE_NAMESPACE.TEAM_ROLES, categoryId);
}

/** Pre-carrega categorias e equipes de uma guild no startup. */
export async function preloadTicketConfig(guildId: string): Promise<{
  categories: number;
  teamRoles: number;
}> {
  const categories = await getCategories(guildId);
  let teamRoles = 0;
  for (const category of categories) {
    teamRoles += (await getTeamRoleIds(category.id)).length;
  }
  return { categories: categories.length, teamRoles };
}
