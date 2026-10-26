import { MessageFlags } from 'discord.js';
import type { Guild, Message } from 'discord.js';

import { sendV2 } from '../../../components/reply';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import { createLogger } from '../../../core/logger/Logger';
import {
  NO_MENTIONS,
  fetchChannelSafe,
  isSendableTextChannel,
  isUnknownResourceError,
  type SendableGuildChannel,
} from '../../../utils/discord';
import {
  getGuildConfig,
  updateGuildConfig,
} from '../../configuration/services/GuildConfigService';
import { buildCatalogPanel } from '../builders/CatalogBuilders';
import { getEnabledCatalogCategories } from './CatalogCategoryService';
import { listVisiblePacks } from './CatalogService';

/**
 * Painel publico do catalogo.
 *
 * O par (catalogChannelId, catalogMessageId) fica na configuracao da guild para
 * que "atualizar" EDITE a mensagem existente — publicar de novo a cada mudanca
 * encheria o canal de paineis duplicados.
 *
 * O painel nao expoe nada de cliente: carrinho e pedidos abrem em resposta
 * efemera, so para quem clicou.
 */

const logger = createLogger('catalog:panel');

/** Chave do lock: um painel por guild. */
function panelKey(guildId: string): string {
  return `catalog:${guildId}`;
}

async function buildPanel(guild: Guild): Promise<ReturnType<typeof buildCatalogPanel>> {
  const [config, packs, categories] = await Promise.all([
    getGuildConfig(guild.id),
    listVisiblePacks(guild.id),
    getEnabledCatalogCategories(guild.id),
  ]);

  return buildCatalogPanel(config, { packs: packs.length, categories: categories.length });
}

export async function publishCatalogPanel(
  guild: Guild,
  channel: SendableGuildChannel,
): Promise<Message> {
  return locks.withLock(LOCK_NAMESPACE.PANEL_UPDATE, panelKey(guild.id), async () => {
    // Remove o painel anterior para nao deixar dois paineis vivos no servidor.
    await removePanelMessage(guild).catch(() => undefined);

    const message = await sendV2(channel, await buildPanel(guild));

    await updateGuildConfig(guild.id, {
      catalogChannelId: channel.id,
      catalogMessageId: message.id,
    });

    logger.info('Painel do catalogo publicado.', {
      guildId: guild.id,
      channelId: channel.id,
      entityType: 'catalog-panel',
      entityId: message.id,
    });

    return message;
  });
}

export interface CatalogPanelResult {
  updated: boolean;
  reason?: string;
}

/**
 * Reconstroi o painel editando a mensagem existente.
 * Se a mensagem foi apagada, republica e corrige a referencia — o operador nao
 * pode ficar sem painel so porque alguem limpou o canal.
 */
export async function refreshCatalogPanel(guild: Guild): Promise<CatalogPanelResult> {
  return locks.withLock(LOCK_NAMESPACE.PANEL_UPDATE, panelKey(guild.id), async () => {
    const config = await getGuildConfig(guild.id);

    if (config.catalogChannelId === null || config.catalogMessageId === null) {
      return { updated: false, reason: 'Nenhum painel de catalogo publicado ainda.' };
    }

    const channel = await fetchChannelSafe(guild, config.catalogChannelId);
    if (!isSendableTextChannel(channel)) {
      return {
        updated: false,
        reason: 'O canal do painel do catalogo nao existe mais ou o bot perdeu acesso.',
      };
    }

    const panel = await buildPanel(guild);

    try {
      const message = await channel.messages.fetch(config.catalogMessageId);
      await message.edit({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: NO_MENTIONS,
      });
      return { updated: true };
    } catch (error) {
      if (!isUnknownResourceError(error)) throw error;

      const message = await sendV2(channel, panel);
      await updateGuildConfig(guild.id, { catalogMessageId: message.id });
      logger.warn('Painel do catalogo havia sido apagado; foi republicado.', {
        guildId: guild.id,
        channelId: channel.id,
      });
      return { updated: true, reason: 'A mensagem anterior nao existia mais e foi republicada.' };
    }
  });
}

async function removePanelMessage(guild: Guild): Promise<boolean> {
  const config = await getGuildConfig(guild.id);
  if (config.catalogChannelId === null || config.catalogMessageId === null) return false;

  const channel = await fetchChannelSafe(guild, config.catalogChannelId);
  if (!isSendableTextChannel(channel)) return false;

  try {
    const message = await channel.messages.fetch(config.catalogMessageId);
    await message.delete();
    return true;
  } catch (error) {
    if (isUnknownResourceError(error)) return false;
    throw error;
  }
}

export async function removeCatalogPanel(guild: Guild): Promise<boolean> {
  return locks.withLock(LOCK_NAMESPACE.PANEL_UPDATE, panelKey(guild.id), async () => {
    const removed = await removePanelMessage(guild);
    await updateGuildConfig(guild.id, { catalogChannelId: null, catalogMessageId: null });
    logger.info('Painel do catalogo removido.', { guildId: guild.id, removed });
    return removed;
  });
}

/**
 * Reconfere o painel no startup.
 * Nunca lanca: painel quebrado nao pode impedir o bot de subir.
 */
export async function ensureCatalogPanelHealthy(guild: Guild): Promise<CatalogPanelResult> {
  const config = await getGuildConfig(guild.id);
  if (config.catalogChannelId === null || config.catalogMessageId === null) {
    return { updated: false, reason: 'Painel do catalogo nunca foi publicado nesta guild.' };
  }
  return refreshCatalogPanel(guild);
}
