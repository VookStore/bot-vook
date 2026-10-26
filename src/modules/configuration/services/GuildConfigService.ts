import type { GuildConfig } from '@prisma/client';

import { CACHE_NAMESPACE, cache } from '../../../core/cache/CacheService';
import { CACHE_TTL } from '../../../constants/limits';
import { createLogger } from '../../../core/logger/Logger';
import {
  ensureGuildConfig,
  listGuildConfigs,
  updateGuildConfig as persistGuildConfig,
  type GuildConfigUpdate,
} from '../repositories/GuildConfigRepository';

const logger = createLogger('config');

/**
 * Configuracao da guild com cache.
 *
 * Fluxo obrigatorio de escrita:
 *   banco -> commit bem sucedido -> invalidacao/atualizacao do cache.
 * Nunca atualizar apenas a RAM.
 */

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  return cache.getOrLoad(
    CACHE_NAMESPACE.GUILD_CONFIG,
    guildId,
    () => ensureGuildConfig(guildId),
    CACHE_TTL.GUILD_CONFIG_MS,
  );
}

/** Persiste e so entao atualiza o cache com o registro retornado pelo banco. */
export async function updateGuildConfig(
  guildId: string,
  data: GuildConfigUpdate,
): Promise<GuildConfig> {
  const updated = await persistGuildConfig(guildId, data);
  cache.set(CACHE_NAMESPACE.GUILD_CONFIG, guildId, updated, CACHE_TTL.GUILD_CONFIG_MS);
  logger.debug('Configuracao da guild atualizada.', {
    guildId,
    fields: Object.keys(data).join(','),
  });
  return updated;
}

export function invalidateGuildConfig(guildId: string): void {
  cache.delete(CACHE_NAMESPACE.GUILD_CONFIG, guildId);
}

/** Pre-carrega todas as configuracoes conhecidas no startup. */
export async function preloadGuildConfigs(): Promise<number> {
  const configs = await listGuildConfigs();
  for (const config of configs) {
    cache.set(CACHE_NAMESPACE.GUILD_CONFIG, config.guildId, config, CACHE_TTL.GUILD_CONFIG_MS);
  }
  return configs.length;
}

/** Nome visual da loja configurado para a guild. */
export async function getStoreName(guildId: string): Promise<string> {
  const config = await getGuildConfig(guildId);
  return config.storeName;
}
