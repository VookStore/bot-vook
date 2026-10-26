import type { Guild, Message } from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import type { SendableGuildChannel } from '../../../utils/discord';
import {
  publishBoundPanel,
  refreshBoundPanel,
  type PanelBinding,
  type PanelContent,
  type PanelRefreshResult,
} from '../../configuration/services/PublishedPanelService';
import { buildBoosterPanel } from '../builders/BoosterBuilder';
import { boosterArt } from './BoosterArtService';

/**
 * Publicacao do anuncio de booster.
 *
 * A mecanica de publicar-e-reescrever mora em `PublishedPanelService`; aqui
 * ficam apenas as duas colunas deste painel e como ele e montado.
 *
 * O CONTEUDO NAO VEM DAQUI. Os beneficios moram em `data/boosterTiers.ts`.
 */

const BINDING: PanelBinding = {
  name: 'Anuncio de booster',
  read: (config) => ({
    channelId: config.boosterChannelId,
    messageId: config.boosterMessageId,
  }),
  write: (channelId, messageId) => ({
    boosterChannelId: channelId,
    boosterMessageId: messageId,
  }),
};

export type { PanelRefreshResult as BoosterRefreshResult };

/**
 * Monta componentes e anexo juntos.
 *
 * A arte so e referenciada quando o arquivo existe: apontar a miniatura para um
 * `attachment://` sem anexar nada deixaria um quadrado quebrado no anuncio.
 */
export function renderBoosterPanel(guildId: string, config: GuildConfig): PanelContent {
  const art = boosterArt(guildId);

  return {
    root: buildBoosterPanel(config, art?.filename ?? null),
    ...(art === null ? {} : { files: [art.attachment] }),
  };
}

/** Publica o anuncio num canal e memoriza a mensagem. */
export async function publishBoosterPanel(
  guild: Guild,
  channel: SendableGuildChannel,
): Promise<Message> {
  return publishBoundPanel(guild, channel, BINDING, (config) =>
    renderBoosterPanel(guild.id, config),
  );
}

/** Reescreve o anuncio ja publicado com os beneficios atuais do codigo. */
export async function refreshBoosterPanel(guild: Guild): Promise<PanelRefreshResult> {
  return refreshBoundPanel(guild, BINDING, (config) => renderBoosterPanel(guild.id, config));
}
