"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishPricingPanel = publishPricingPanel;
exports.refreshPricingPanel = refreshPricingPanel;
const PublishedPanelService_1 = require("../../configuration/services/PublishedPanelService");
const PricingBuilder_1 = require("../builders/PricingBuilder");
/**
 * Publicacao da tabela de precos.
 *
 * A mecanica de publicar-e-reescrever mora em `PublishedPanelService`; aqui
 * ficam apenas as duas colunas que esta tabela usa e como ela e desenhada.
 *
 * O CONTEUDO NAO VEM DAQUI. Os valores moram em `data/priceTable.ts`; este
 * arquivo so decide onde e quando a tabela aparece.
 */
const BINDING = {
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
/** Publica a tabela num canal e memoriza a mensagem. */
async function publishPricingPanel(guild, channel) {
    return (0, PublishedPanelService_1.publishBoundPanel)(guild, channel, BINDING, (config) => ({
        root: (0, PricingBuilder_1.buildPricingPanel)(config),
    }));
}
/** Reescreve a tabela ja publicada com os valores atuais do codigo. */
async function refreshPricingPanel(guild) {
    return (0, PublishedPanelService_1.refreshBoundPanel)(guild, BINDING, (config) => ({
        root: (0, PricingBuilder_1.buildPricingPanel)(config),
    }));
}
//# sourceMappingURL=PricingPanelService.js.map