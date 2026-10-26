"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFY_BUTTON_LABEL = void 0;
exports.buildClientNotifyDm = buildClientNotifyDm;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const v2_1 = require("../../../components/v2");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const time_1 = require("../../../utils/time");
const TicketInternalPanelBuilder_1 = require("./TicketInternalPanelBuilder");
/**
 * DM de "a equipe esta te aguardando".
 *
 * O QUE MUDOU E POR QUE. A versao anterior dizia apenas "Seu atendimento
 * recebeu uma atualizacao" e listava Ticket, Categoria e Atendente em blocos
 * empilhados. O cliente tinha de abrir o ticket so para descobrir o que estavam
 * perguntando — e essa ida e justamente o atrito que a notificacao existe para
 * remover. Agora a DM carrega a ULTIMA MENSAGEM DA EQUIPE: da para responder
 * sabendo do que se trata, ou perceber que ja respondeu.
 */
/** Quanto da mensagem citada cabe na DM antes de virar parede de texto. */
const QUOTE_MAX = 600;
/** Rotulo do botao que leva ao atendimento. */
exports.NOTIFY_BUTTON_LABEL = 'Ir para o atendimento';
/**
 * Citacao da mensagem da equipe.
 *
 * `escapeMarkdownLayout` neutraliza `#`, `>`, crase e colchete: sem isso, uma
 * mensagem que comece com `#` viraria titulo dentro da DM e uma crase solta
 * abriria bloco de codigo engolindo o resto do cartao. O texto continua legivel
 * — o escape mexe so no que quebraria a estrutura.
 *
 * Cada linha ganha `> ` porque `>>>` transformaria em citacao tudo que viesse
 * depois, inclusive o rodape.
 */
function quote(content) {
    const limpo = (0, sanitize_1.escapeMarkdownLayout)((0, sanitize_1.truncate)(content.trim(), QUOTE_MAX));
    return limpo
        .split('\n')
        .map((linha) => (linha.trim().length === 0 ? '>' : `> ${linha}`))
        .join('\n');
}
function buildClientNotifyDm(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    const banner = params.bannerUrl;
    if (banner !== null && (0, sanitize_1.isSafeImageUrl)(banner)) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([banner], params.storeName));
        root.addSeparatorComponents((0, v2_1.separator)());
    }
    root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.NOTIFY} **A equipe esta aguardando sua resposta.**\n\n` +
        `Ola, ${(0, discord_1.userMention)(params.ownerId)}! ${(0, discord_1.userMention)(params.staffId)} respondeu no seu ` +
        `atendimento em **${params.storeName}**.`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.TICKET} Ticket \`${(0, TicketInternalPanelBuilder_1.formatTicketNumber)(params.ticketNumber)}\`  •  ` +
        `${branding_1.EMOJIS.TICKET_FOLDER} ${params.categoryName}`));
    /*
     * A citacao e o coracao desta DM. Sem ela, "seu atendimento recebeu uma
     * atualizacao" obriga o cliente a abrir o ticket para descobrir o que
     * perguntaram — e quem esta ocupado simplesmente adia.
     */
    if (params.lastMessage !== null) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.LIST} **${(0, sanitize_1.escapeMarkdownLayout)(params.lastMessage.authorName)}** ` +
            `— ${(0, time_1.discordTimestamp)(params.lastMessage.createdAt, 'R')}\n` +
            quote(params.lastMessage.content)));
    }
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setStyle(discord_js_1.ButtonStyle.Link)
        .setLabel(exports.NOTIFY_BUTTON_LABEL)
        .setEmoji(branding_1.EMOJIS.TICKET)
        .setURL((0, discord_1.channelUrl)(params.guildId, params.channelId))));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Responda por la — a equipe da ${params.storeName} esta acompanhando.`));
    /*
     * Contagem no pior caso: galeria, separador, saudacao, separador, dados,
     * separador, citacao, botao e rodape = 9 dos 10 filhos do Container.
     */
    return root;
}
//# sourceMappingURL=TicketNotifyBuilder.js.map