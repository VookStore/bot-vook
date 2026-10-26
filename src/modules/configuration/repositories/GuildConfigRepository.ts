import type { GuildConfig, Prisma } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Acesso a configuracao da guild.
 *
 * Toda consulta e sempre filtrada por `guildId` — o sistema e multi-guild por
 * construcao e nunca assume um unico servidor.
 */

export type GuildConfigUpdate = Prisma.GuildConfigUncheckedUpdateInput;

export async function findGuildConfig(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<GuildConfig | null> {
  return db.guildConfig.findUnique({ where: { guildId } });
}

/**
 * Retorna a configuracao da guild, criando-a com os padroes na primeira vez.
 * Idempotente e seguro sob concorrencia (upsert).
 */
export async function ensureGuildConfig(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<GuildConfig> {
  return db.guildConfig.upsert({
    where: { guildId },
    update: {},
    create: { guildId },
  });
}

export async function updateGuildConfig(
  guildId: string,
  data: GuildConfigUpdate,
  db: DatabaseClient = getPrisma(),
): Promise<GuildConfig> {
  await ensureGuildConfig(guildId, db);
  return db.guildConfig.update({ where: { guildId }, data });
}

export async function listGuildConfigs(
  db: DatabaseClient = getPrisma(),
): Promise<GuildConfig[]> {
  return db.guildConfig.findMany({ orderBy: { createdAt: 'asc' } });
}

/** Guilds que possuem painel publico publicado (usado no recovery). */
export async function listGuildConfigsWithPanel(
  db: DatabaseClient = getPrisma(),
): Promise<GuildConfig[]> {
  return db.guildConfig.findMany({
    where: { ticketPanelChannelId: { not: null }, ticketPanelMessageId: { not: null } },
  });
}
