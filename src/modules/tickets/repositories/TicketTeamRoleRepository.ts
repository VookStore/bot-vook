import type { TicketTeamRole } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Cargos responsaveis por cada categoria.
 * Uma categoria pode ter varios cargos (ex.: Compras -> @Vendas + @Administracao).
 */

export async function listTeamRoles(
  categoryId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketTeamRole[]> {
  return db.ticketTeamRole.findMany({
    where: { categoryId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listTeamRoleIds(
  categoryId: string,
  db: DatabaseClient = getPrisma(),
): Promise<string[]> {
  const roles = await db.ticketTeamRole.findMany({
    where: { categoryId },
    select: { roleId: true },
    orderBy: { createdAt: 'asc' },
  });
  return roles.map((role) => role.roleId);
}

export async function listTeamRolesForGuild(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketTeamRole[]> {
  return db.ticketTeamRole.findMany({ where: { guildId } });
}

/**
 * Substitui integralmente os cargos da categoria.
 * Executa em transacao para nunca deixar a categoria momentaneamente sem equipe.
 */
export async function replaceTeamRoles(
  params: { guildId: string; categoryId: string; roleIds: readonly string[]; actorId: string },
  db: DatabaseClient = getPrisma(),
): Promise<TicketTeamRole[]> {
  const unique = [...new Set(params.roleIds)];

  await db.ticketTeamRole.deleteMany({
    where: { categoryId: params.categoryId, roleId: { notIn: unique.length > 0 ? unique : [''] } },
  });

  for (const roleId of unique) {
    await db.ticketTeamRole.upsert({
      where: { categoryId_roleId: { categoryId: params.categoryId, roleId } },
      create: {
        guildId: params.guildId,
        categoryId: params.categoryId,
        roleId,
        createdById: params.actorId,
      },
      update: {},
    });
  }

  return listTeamRoles(params.categoryId, db);
}

export async function clearTeamRoles(
  categoryId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  const result = await db.ticketTeamRole.deleteMany({ where: { categoryId } });
  return result.count;
}
