"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REVIEW_COMMENT_INPUT_ID = exports.REVIEW_RATINGS = exports.REVIEW_RATING_MAX = exports.REVIEW_RATING_MIN = void 0;
exports.formatTicketNumber = formatTicketNumber;
exports.buildReviewInviteButton = buildReviewInviteButton;
exports.buildReviewRequest = buildReviewRequest;
exports.buildReviewCommentModal = buildReviewCommentModal;
exports.buildPublishedReview = buildPublishedReview;
exports.buildReviewThanks = buildReviewThanks;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const sanitize_1 = require("../../../utils/sanitize");
const time_1 = require("../../../utils/time");
/**
 * Interface da avaliacao pos-atendimento (Components V2).
 *
 * PRIVACIDADE — regra que nao pode ser flexibilizada:
 * a publicacao no canal publico mostra SOMENTE nota, cliente, numero do ticket,
 * categoria, atendente, comentario sanitizado e data. Assunto do ticket,
 * transcript, motivo de encerramento, valores, cobrancas e chave PIX NUNCA
 * entram aqui — nem sequer sao parametros destas funcoes.
 */
/** Menor e maior nota aceitas. */
exports.REVIEW_RATING_MIN = 1;
exports.REVIEW_RATING_MAX = 5;
/** Notas disponiveis no painel de avaliacao (1..5). */
exports.REVIEW_RATINGS = [1, 2, 3, 4, 5];
/**
 * Id do CAMPO de texto do modal (lido pelo handler via `interaction.fields`).
 *
 * Nao e um customId de roteamento: campos de modal nao passam pelo router, por
 * isso usam um nome simples em vez de `namespace:action` (que daria a entender,
 * erradamente, que existe um handler escutando `review:comment`).
 */
exports.REVIEW_COMMENT_INPUT_ID = 'comment';
/** Numero do atendimento no formato visual da Vook Store: `#0125`. */
function formatTicketNumber(ticketNumber) {
    return `#${String(Math.max(0, Math.trunc(ticketNumber))).padStart(4, '0')}`;
}
/**
 * Convite de avaliacao no cartao de encerramento.
 *
 * UM botao, e nao as cinco notas direto: o cartao de encerramento e um aviso, e
 * cinco estrelas ali dentro competem com os detalhes do atendimento que o
 * cliente foi ler. O clique abre o painel de notas, que ai sim so trata disso.
 */
function buildReviewInviteButton(ticketId) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.REVIEW, customIds_1.REVIEW_ACTION.START, ticketId))
        .setLabel('Avaliar este atendimento')
        .setEmoji(branding_1.EMOJIS.REVIEW)
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/** Um botao por nota, com o alvo embutido no customId. */
function buildRatingButton(ticketId, rating) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.REVIEW, customIds_1.REVIEW_ACTION.RATE, ticketId, String(rating)))
        .setLabel(`${branding_1.EMOJIS.REVIEW} ${rating}`)
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/**
 * Painel enviado por DM ao cliente quando o atendimento e encerrado.
 * As cinco notas ficam em UMA action row (limite real do Discord: 5 botoes).
 */
function buildReviewRequest(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.REVIEW_REQUEST);
    root.addTextDisplayComponents((0, v2_1.text)(`Seu atendimento ${formatTicketNumber(params.ticketNumber)} foi concluido.\n` +
        'Como foi sua experiencia com nossa equipe?'));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.field)('Categoria', params.categoryName)));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(...exports.REVIEW_RATINGS.map((rating) => buildRatingButton(params.ticketId, rating))));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`${params.storeName} — sua avaliacao e opcional e leva menos de um minuto.`));
    return root;
}
/**
 * Modal de comentario. O campo e OPCIONAL: quem so quer dar a nota confirma
 * sem escrever nada.
 */
function buildReviewCommentModal(ticketId, rating) {
    const commentInput = new discord_js_1.TextInputBuilder()
        .setCustomId(exports.REVIEW_COMMENT_INPUT_ID)
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(limits_1.BUSINESS_LIMITS.REVIEW_COMMENT_MAX)
        .setPlaceholder('Opcional — pode enviar em branco.');
    const commentLabel = new discord_js_1.LabelBuilder()
        .setLabel((0, sanitize_1.truncate)('Conte um pouco sobre sua experiencia', limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setTextInputComponent(commentInput);
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.REVIEW, customIds_1.REVIEW_ACTION.COMMENT_MODAL, ticketId, String(rating)))
        .setTitle((0, sanitize_1.truncate)(`Avaliacao ${rating}/5 — Vook Store`, limits_1.DISCORD_LIMITS.MODAL_TITLE))
        .addLabelComponents(commentLabel);
}
/**
 * Publicacao no canal publico de avaliacoes.
 * Recebe apenas dados nao sensiveis — ver o bloco de PRIVACIDADE no topo.
 */
function buildPublishedReview(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.GOLD);
    (0, v2_1.addHeader)(root, branding_1.TITLES.REVIEW_PUBLISHED);
    root.addTextDisplayComponents((0, v2_1.text)(`${(0, branding_1.renderStars)(params.rating)}  **${params.rating}/5**`));
    root.addSeparatorComponents((0, v2_1.separator)());
    // Quatro dados em duas linhas. A NOTA e o comentario sao o conteudo desta
    // publicacao; ficha tecnica empilhada empurrava os dois para baixo da dobra.
    root.addTextDisplayComponents((0, v2_1.text)(`**Cliente** <@${params.customerId}>  •  **Atendente** ${params.staffId !== null && params.staffId.length > 0
        ? `<@${params.staffId}>`
        : 'nao atribuido'}\n` +
        `-# Atendimento ${formatTicketNumber(params.ticketNumber)} · ${params.categoryName}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    // O comentario e o UNICO texto livre de cliente que a loja republica em canal
    // publico. Escapar a sintaxe de layout impede que ele finja ser um anuncio
    // oficial (link mascarado, cabecalho, bloco de codigo). O escape vem DEPOIS
    // do corte para nao cortar no meio de uma barra invertida.
    const comment = params.comment;
    const commentBlock = comment !== null && comment.trim().length > 0
        ? `"${(0, sanitize_1.escapeMarkdownLayout)((0, sanitize_1.truncate)(comment.trim(), limits_1.BUSINESS_LIMITS.REVIEW_COMMENT_MAX))}"`
        : 'Nenhum comentario informado.';
    // O comentario abre o bloco sem rotulo: entre aspas ele ja se anuncia, e
    // "Comentario:" gastava uma linha para nomear o obvio.
    root.addTextDisplayComponents((0, v2_1.text)(`${commentBlock}
-# Avaliado ${(0, time_1.discordTimestamp)(params.createdAt, 'R')}`));
    root.addTextDisplayComponents((0, v2_1.footerNote)(params.storeName));
    return root;
}
/** Agradecimento efemero exibido ao cliente logo apos avaliar. */
function buildReviewThanks(rating) {
    const root = (0, v2_1.container)(branding_1.COLORS.SUCCESS);
    root.addTextDisplayComponents((0, v2_1.text)('✅ **Avaliacao registrada. Muito obrigado!**'));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(`${(0, branding_1.renderStars)(rating)}  **${rating}/5**`));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Sua opiniao ajuda a Vook Store a melhorar o atendimento.'));
    return root;
}
//# sourceMappingURL=ReviewBuilders.js.map