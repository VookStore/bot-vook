"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClosureDm = buildClosureDm;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const v2_1 = require("../../../components/v2");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const ReviewBuilders_1 = require("../../reviews/builders/ReviewBuilders");
const TicketInternalPanelBuilder_1 = require("./TicketInternalPanelBuilder");
/**
 * Motivo em UMA linha.
 *
 * Ele divide linha com o rotulo, entao uma quebra digitada no modal pelo
 * atendente empurraria o texto para fora do alinhamento do bloco.
 */
function oneLine(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function buildClosureDm(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.NEUTRAL);
    /*
     * O banner abre o cartao, sem cabecalho de texto: o titulo escrito repetiria
     * o que a arte da loja ja diz. Sem banner configurado, o cartao comeca na
     * saudacao — a arte e enfeite e nunca decide se a DM sai.
     */
    const banner = params.bannerUrl;
    if (banner !== null && (0, sanitize_1.isSafeImageUrl)(banner)) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([banner], `${params.storeName} — atendimento encerrado`));
        root.addSeparatorComponents((0, v2_1.separator)());
    }
    root.addTextDisplayComponents((0, v2_1.text)(`Ola, ${(0, discord_1.userMention)(params.ownerId)}!\n\n` +
        `Seu atendimento foi encerrado em **${params.storeName}**. ` +
        'Aqui estao os detalhes do seu atendimento:'));
    root.addSeparatorComponents((0, v2_1.separator)());
    const closedBy = params.closedById === null
        ? 'Nao informado'
        : `${(0, discord_1.userMention)(params.closedById)}${params.closedByLabel === null ? '' : ` (${params.closedByLabel})`}`;
    root.addTextDisplayComponents((0, v2_1.text)([
        `${branding_1.EMOJIS.TICKET_FOLDER} Categoria: ${params.categoryName}`,
        `${branding_1.EMOJIS.TICKET} Protocolo: \`${(0, TicketInternalPanelBuilder_1.formatTicketNumber)(params.ticketNumber)}\``,
        `${branding_1.EMOJIS.LOCK} Encerrado por: ${closedBy}`,
        `${branding_1.EMOJIS.NOTIFY} Motivo do encerramento: ${params.closeReason === null
            ? 'Nenhum motivo informado.'
            : oneLine((0, sanitize_1.truncate)(params.closeReason, 300))}`,
    ].join('\n')));
    /*
     * As duas acoes dividem UMA linha de botoes.
     *
     * Avaliar e ler o historico sao coisas diferentes, mas nenhuma das duas
     * merece um bloco proprio num cartao que ja tem quatro campos — e o container
     * tem dez filhos no total. Cada uma aparece quando faz sentido: sem avaliacao
     * pendente, so o transcript; sem hospedagem configurada, so a avaliacao.
     */
    const actions = [];
    if (params.reviewTicketId !== null) {
        actions.push((0, ReviewBuilders_1.buildReviewInviteButton)(params.reviewTicketId));
    }
    if (params.transcriptUrl !== undefined && params.transcriptUrl !== null) {
        actions.push(new discord_js_1.ButtonBuilder()
            .setStyle(discord_js_1.ButtonStyle.Link)
            .setLabel('Ver histórico do atendimento')
            .setEmoji(branding_1.EMOJIS.LIST)
            .setURL(params.transcriptUrl));
    }
    if (actions.length === 0) {
        root.addTextDisplayComponents((0, v2_1.footerNote)(`Obrigado por entrar em contato com a ${params.storeName}.`));
        return root;
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(params.reviewTicketId !== null
        ? `${branding_1.EMOJIS.REVIEW} Com base no atendimento recebido, gostariamos de convida-lo(a) a ` +
            '**avaliar nosso suporte** para que possamos melhorar cada vez mais nossos servicos.'
        : `${branding_1.EMOJIS.LIST} O historico completo deste atendimento ficou guardado no link abaixo.`));
    root.addActionRowComponents((0, v2_1.buttonRow)(...actions));
    root.addTextDisplayComponents((0, v2_1.footerNote)(params.reviewTicketId !== null
        ? `${params.storeName} — a avaliacao e opcional e leva menos de um minuto.`
        : `Obrigado por entrar em contato com a ${params.storeName}.`));
    /*
     * Contagem no caminho mais pesado (com banner e com convite): galeria,
     * separador, saudacao, separador, detalhes, separador, convite, botao e
     * rodape = 9 dos 10 filhos que um Container aceita.
     */
    return root;
}
//# sourceMappingURL=TicketClosureBuilder.js.map