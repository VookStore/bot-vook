"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECEIPT_UPLOAD_FIELD = void 0;
exports.buildReceiptUploadModal = buildReceiptUploadModal;
exports.buildReceiptStaffNotice = buildReceiptStaffNotice;
exports.buildReceiptCustomerAck = buildReceiptCustomerAck;
exports.describeReceiptForCustomer = describeReceiptForCustomer;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
const time_1 = require("../../../utils/time");
const discord_1 = require("../../../utils/discord");
const receiptParser_1 = require("../validators/receiptParser");
const OrderService_1 = require("../services/OrderService");
/**
 * Comprovante enviado pelo cliente (Components V2).
 *
 * O PAINEL NAO APROVA NADA SOZINHO. Ele coloca lado a lado o que a cobranca
 * esperava e o que o OCR leu, e deixa o vendedor decidir com a imagem na tela.
 * O texto avisa, em toda tela, que comprovante e falsificavel — porque a pessoa
 * que clica em "Aprovar" precisa saber exatamente o que esta assumindo.
 */
function statusHeadline(status) {
    switch (status) {
        case client_1.ReceiptCheckStatus.MATCH:
            return '🟢 **Confere com a cobranca**';
        case client_1.ReceiptCheckStatus.MISMATCH:
            return '🔴 **DIVERGENCIA encontrada**';
        case client_1.ReceiptCheckStatus.SKIPPED:
            return '🟡 **Nao analisado automaticamente**';
        default:
            return '🟡 **Nao foi possivel conferir**';
    }
}
function accentFor(status) {
    if (status === client_1.ReceiptCheckStatus.MATCH)
        return branding_1.COLORS.SUCCESS;
    if (status === client_1.ReceiptCheckStatus.MISMATCH)
        return branding_1.COLORS.DANGER;
    return branding_1.COLORS.WARNING;
}
/** Campo do modal que carrega o arquivo. */
exports.RECEIPT_UPLOAD_FIELD = 'arquivo';
/**
 * Modal de envio, aberto pelo botao `Enviar Comprovante` do cartao da cobranca.
 *
 * POR QUE ELE PASSOU A EXISTIR: enquanto o modal do Discord nao aceitava
 * arquivo, anexo so existia como opcao de slash command — dai
 * `/comprovante enviar`. Com o componente de upload em modal, quem pagou manda
 * o arquivo sem sair da mensagem onde acabou de ler o PIX e sem ter de decorar
 * o numero do pedido. O comando continua valendo para quem prefere digitar.
 *
 * O `paymentId` viaja no customId apenas para IDENTIFICAR a cobranca. Ele nao
 * autoriza nada: dono, estado do pedido e limites sao reconferidos no servidor
 * quando o arquivo chega.
 */
function buildReceiptUploadModal(paymentId) {
    const maxMegabytes = Math.floor(limits_1.BUSINESS_LIMITS.RECEIPT_MAX_BYTES / (1024 * 1024));
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.RECEIPT_MODAL, paymentId))
        .setTitle((0, sanitize_1.truncate)('Enviar comprovante do PIX', limits_1.DISCORD_LIMITS.MODAL_TITLE))
        .addLabelComponents(new discord_js_1.LabelBuilder()
        .setLabel('Comprovante do pagamento')
        .setDescription(`Imagem (PNG, JPG, WEBP) ou PDF de ate ${maxMegabytes} MB.`)
        .setFileUploadComponent(new discord_js_1.FileUploadBuilder()
        .setCustomId(exports.RECEIPT_UPLOAD_FIELD)
        .setMinValues(1)
        // UM arquivo por envio: cada comprovante vira um registro proprio e
        // custa um OCR. Aceitar varios de uma vez furaria o limite
        // anti-abuso por pedido sem que ninguem percebesse.
        .setMaxValues(1)
        .setRequired(true)));
}
/**
 * Aviso publicado para a EQUIPE, com a imagem do comprovante anexada.
 *
 * `imageFilename` vem do reenvio do arquivo pelo bot: o anexo original do
 * cliente tem URL assinada e expira, entao a imagem precisa viver numa mensagem
 * que o bot controla.
 */
function buildReceiptStaffNotice(params) {
    const { order, payment, analysis } = params;
    const root = (0, v2_1.container)(accentFor(analysis.status));
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDER_RECEIPT, {
        subtitle: `Pedido #${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}`,
    });
    root.addTextDisplayComponents((0, v2_1.text)(`${statusHeadline(analysis.status)}\n\n` +
        `**Cliente** ${(0, discord_1.userMention)(params.uploadedById)}  •  **Cobranca** ` +
        `${payment === null ? 'nao vinculada' : (0, money_1.formatCents)(payment.finalAmount)}\n` +
        `-# Enviado ${(0, time_1.discordTimestamp)(new Date(), 'R')}`));
    if (params.imageFilename !== undefined) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([`attachment://${params.imageFilename}`], 'Comprovante enviado pelo cliente'));
    }
    root.addTextDisplayComponents((0, v2_1.text)(`**Conferencia automatica**\n${analysis.checks
        .map((check) => `${(0, receiptParser_1.checkIcon)(check.status)} **${check.label}** — ${check.detail}`)
        .join('\n')}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    const actions = [];
    if (payment !== null) {
        actions.push(new discord_js_1.ButtonBuilder()
            .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.APPROVE, payment.id))
            .setEmoji(branding_1.EMOJIS.APPROVE)
            .setLabel((0, sanitize_1.truncate)('Confirmar Recebimento', limits_1.DISCORD_LIMITS.BUTTON_LABEL))
            .setStyle(discord_js_1.ButtonStyle.Secondary));
    }
    actions.push(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.STAFF, order.id))
        .setEmoji(branding_1.EMOJIS.LIST)
        .setLabel('Abrir Pedido')
        .setStyle(discord_js_1.ButtonStyle.Secondary));
    root.addActionRowComponents((0, v2_1.buttonRow)(...actions));
    /*
     * O aviso e o ponto exato em que alguem decide dar o produto por pago. E aqui
     * que precisa estar escrito que imagem de comprovante se falsifica — a
     * conferencia acima pega engano, nao pega fraude.
     */
    root.addTextDisplayComponents((0, v2_1.footerNote)(`${params.fileName} • Comprovante e IMAGEM e pode ser forjado. ` +
        'A conferencia acima e auxilio, nao prova: confirme o recebimento na sua conta antes de aprovar.'));
    return root;
}
/** Confirmacao efemera para o cliente que enviou o comprovante. */
function buildReceiptCustomerAck(order, analysis) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDER_RECEIPT, {
        subtitle: `Pedido #${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}`,
    });
    root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.RECEIPT} **Comprovante recebido.**\n\n` +
        'A equipe da Vook Store vai conferir o recebimento e confirmar o pagamento. ' +
        'Voce recebe um aviso por aqui assim que for confirmado.'));
    // O cliente NAO ve o resultado da conferencia automatica: dizer "divergencia"
    // para quem pagou certo gera atrito, e dizer "confere" para quem forjou daria
    // a impressao de aprovacao. Quem le esse detalhe e a equipe.
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(analysis.status === client_1.ReceiptCheckStatus.SKIPPED
        ? '-# Arquivos PDF sao conferidos manualmente pela equipe.'
        : '-# A confirmacao e feita por uma pessoa da equipe, nao automaticamente.'));
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.VIEW, order.id))
        .setEmoji(branding_1.EMOJIS.REFRESH)
        .setLabel('Ver Pedido')
        .setStyle(discord_js_1.ButtonStyle.Secondary)));
    return root;
}
/** Linha exibida no pedido do cliente quando ja existe comprovante enviado. */
function describeReceiptForCustomer(receipt) {
    if (receipt === null)
        return null;
    return `${branding_1.EMOJIS.RECEIPT} Enviado ${(0, time_1.discordTimestamp)(receipt.createdAt, 'R')} — aguardando conferencia`;
}
//# sourceMappingURL=ReceiptBuilders.js.map