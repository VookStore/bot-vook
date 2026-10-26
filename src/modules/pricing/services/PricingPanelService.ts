import type { Guild, Message } from 'discord.js';

import type { SendableGuildChannel } from '../../../utils/discord';
import {
  publishBoundPanel,
  refreshBoundPanel,
  type PanelBinding,
  type PanelRefreshResult,
} from '../../configuration/services/PublishedPanelService';
import { buildPricingPanel } from '../builders/PricingBuilder';

/**
 * Publicacao da tabela de precos.
 *
 * A mecanica de publicar-e-reescrever mora em `PublishedPanelService`; aqui
 * ficam apenas as duas colunas que esta tabela usa e como ela e desenhada.
 *
 * O CONTEUDO NAO VEM DAQUI. Os valores moram em `data/priceTable.ts`; este
 * arquivo so decide onde e quando a tabela aparece.
 */

const BINDING: PanelBinding = {
  name: 'Tabela de precos',
  read: (config) => ({
    channelId: config.pricingChannelId,
    messageId: config.pricingMessageId,
  }),
  write: (channelId, messageId) => ({
    pricingChannelId: channelId,
    pricingMessageId: messageId,
  }),
};

export type { PanelRefreshResult as PricingRefreshResult };

/** Publica a tabela num canal e memoriza a mensagem. */
export async function publishPricingPanel(
  guild: Guild,
  channel: SendableGuildChannel,
): Promise<Message> {
  return publishBoundPanel(guild, channel, BINDING, (config) => ({
    root: buildPricingPanel(config),
  }));
}

/** Reescreve a tabela ja publicada com os valores atuais do codigo. */
export async function refreshPricingPanel(guild: Guild): Promise<PanelRefreshResult> {
  return refreshBoundPanel(guild, BINDING, (config) => ({
    root: buildPricingPanel(config),
  }));
}
