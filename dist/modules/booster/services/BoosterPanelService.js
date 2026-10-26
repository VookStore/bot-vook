"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBoosterPanel = renderBoosterPanel;
exports.publishBoosterPanel = publishBoosterPanel;
exports.refreshBoosterPanel = refreshBoosterPanel;
const PublishedPanelService_1 = require("../../configuration/services/PublishedPanelService");
const BoosterBuilder_1 = require("../builders/BoosterBuilder");
const BoosterArtService_1 = require("./BoosterArtService");
/**
 * Publicacao do anuncio de booster.
 *
 * A mecanica de publicar-e-reescrever mora em `PublishedPanelService`; aqui
 * ficam apenas as duas colunas deste painel e como ele e montado.
 *
 * O CONTEUDO NAO VEM DAQUI. Os beneficios moram em `data/boosterTiers.ts`.
 */
const BINDING = {
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
/**
 * Monta componentes e anexo juntos.
 *
 * A arte so e referenciada quando o arquivo existe: apontar a miniatura para um
 * `attachment://` sem anexar nada deixaria um quadrado quebrado no anuncio.
 */
function renderBoosterPanel(guildId, config) {
    const art = (0, BoosterArtService_1.boosterArt)(guildId);
    return {
        root: (0, BoosterBuilder_1.buildBoosterPanel)(config, art?.filename ?? null),
        ...(art === null ? {} : { files: [art.attachment] }),
    };
}
/** Publica o anuncio num canal e memoriza a mensagem. */
async function publishBoosterPanel(guild, channel) {
    return (0, PublishedPanelService_1.publishBoundPanel)(guild, channel, BINDING, (config) => renderBoosterPanel(guild.id, config));
}
/** Reescreve o anuncio ja publicado com os beneficios atuais do codigo. */
async function refreshBoosterPanel(guild) {
    return (0, PublishedPanelService_1.refreshBoundPanel)(guild, BINDING, (config) => renderBoosterPanel(guild.id, config));
}
//# sourceMappingURL=BoosterPanelService.js.map