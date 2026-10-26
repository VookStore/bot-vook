import { MessageFlags } from 'discord.js';
import type { Guild, Message } from 'discord.js';

import { sendV2 } from '../../../components/reply';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import { ConfigurationError } from '../../../core/errors';
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
import { buildTicketPanel } from '../builders/TicketPanelBuilder';
import { getCategories } from './TicketConfigService';

/**
 * Painel publico da central de atendimento.
 *
 * O par (ticketPanelChannelId, ticketPanelMessageId) e guardado na configuracao
 * para que "atualizar" EDITE a mensagem existente em vez de duplicar o painel.
 */

const logger = createLogger('ticket:panel');

/** Publica o painel em um canal e memoriza a mensagem. */
export async function publishPanel(
  guild: Guild,
  channel: SendableGuildChannel,
): Promise<Message> {
  return locks.withLock(LOCK_NAMESPACE.PANEL_UPDATE, guild.id, async () => {
    const config = await getGuildConfig(guild.id);
    const categories = await getCategories(guild.id);

    // Remove o painel anterior para nao deixar dois paineis ativos.
    await removePanelMessage(guild).catch(() => undefined);

    const message = await sendV2(channel, buildTicketPanel(config, categories));

    await updateGuildConfig(guild.id, {
      ticketPanelChannelId: channel.id,
      ticketPanelMessageId: message.id,
    });

    logger.info('Painel publico publicado.', {
      guildId: guild.id,
      channelId: channel.id,
      entityType: 'panel',
      entityId: message.id,
    });

    return message;
  });
}

export interface PanelRefreshResult {
  updated: boolean;
  reason?: string;
}

/** Reconstroi o painel publico editando a mensagem ja existente. */
export async function refreshPublicPanel(guild: Guild): Promise<PanelRefreshResult> {
  return locks.withLock(LOCK_NAMESPACE.PANEL_UPDATE, guild.id, async () => {
    const config = await getGuildConfig(guild.id);

    if (config.ticketPanelChannelId === null || config.ticketPanelMessageId === null) {
      return { updated: false, reason: 'Nenhum painel publicado ainda.' };
    }

    const channel = await fetchChannelSafe(guild, config.ticketPanelChannelId);
    if (!isSendableTextChannel(channel)) {
      return {
        updated: false,
        reason: 'O canal do painel nao existe mais ou o bot perdeu acesso a ele.',
      };
    }

    const categories = await getCategories(guild.id);

    try {
      const message = await channel.messages.fetch(config.ticketPanelMessageId);
      await message.edit({
        components: [buildTicketPanel(config, categories)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: NO_MENTIONS,
      });
      return { updated: true };
    } catch (error) {
      if (!isUnknownResourceError(error)) throw error;

      // A mensagem foi apagada: republica e atualiza a referencia.
      const message = await sendV2(channel, buildTicketPanel(config, categories));
      await updateGuildConfig(guild.id, { ticketPanelMessageId: message.id });
      logger.warn('Painel publico havia sido apagado; foi republicado.', {
        guildId: guild.id,
        channelId: channel.id,
      });
      return { updated: true, reason: 'A mensagem anterior nao existia mais e foi republicada.' };
    }
  });
}

/** Apaga a mensagem do painel (sem limpar a configuracao). */
async function removePanelMessage(guild: Guild): Promise<boolean> {
  const config = await getGuildConfig(guild.id);
  if (config.ticketPanelChannelId === null || config.ticketPanelMessageId === null) return false;

  const channel = await fetchChannelSafe(guild, config.ticketPanelChannelId);
  if (!isSendableTextChannel(channel)) return false;

  try {
    const message = await channel.messages.fetch(config.ticketPanelMessageId);
    await message.delete();
    return true;
  } catch (error) {
    if (isUnknownResourceError(error)) return false;
    throw error;
  }
}

/** Remove o painel publico e limpa a referencia salva. */
export async function removePanel(guild: Guild): Promise<boolean> {
  return locks.withLock(LOCK_NAMESPACE.PANEL_UPDATE, guild.id, async () => {
    const removed = await removePanelMessage(guild);
    await updateGuildConfig(guild.id, {
      ticketPanelChannelId: null,
      ticketPanelMessageId: null,
    });
    logger.info('Painel publico removido.', { guildId: guild.id, removed });
    return removed;
  });
}

/** Garante que existe painel publicado (usado no recovery de startup). */
export async function ensurePanelHealthy(guild: Guild): Promise<PanelRefreshResult> {
  const config = await getGuildConfig(guild.id);
  if (config.ticketPanelChannelId === null || config.ticketPanelMessageId === null) {
    return { updated: false, reason: 'Painel nunca foi publicado nesta guild.' };
  }
  try {
    return await refreshPublicPanel(guild);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return { updated: false, reason: error.userMessage };
    }
    throw error;
  }
}
