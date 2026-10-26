"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_COUPON_SELECT_VALUE = void 0;
exports.pixManualTransferLine = pixManualTransferLine;
exports.buildPaymentCard = buildPaymentCard;
exports.buildPaymentManagePanel = buildPaymentManagePanel;
exports.buildChargeDraftPanel = buildChargeDraftPanel;
exports.buildCouponSelectMenu = buildCouponSelectMenu;
exports.buildCouponSelectionPanel = buildCouponSelectionPanel;
exports.buildCancelModal = buildCancelModal;
exports.buildAmountModal = buildAmountModal;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const money_1 = require("../../../utils/money");
const time_1 = require("../../../utils/time");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const CouponCalculator_1 = require("../../coupons/services/CouponCalculator");
const PaymentService_1 = require("../services/PaymentService");
const PixKeyValidator_1 = require("../validators/PixKeyValidator");
/** Cartao de cobranca PIX, painel de gerenciamento e confirmacao de criacao. */
const NO_COUPON_VALUE = 'none';
function statusAccent(status) {
    switch (status) {
        case client_1.PaymentStatus.APPROVED:
            return branding_1.COLORS.SUCCESS;
        case client_1.PaymentStatus.CANCELLED:
            return branding_1.COLORS.DANGER;
        case client_1.PaymentStatus.EXPIRED:
            return branding_1.COLORS.NEUTRAL;
        default:
            return branding_1.COLORS.BRAND;
    }
}
function statusIcon(status) {
    switch (status) {
        case client_1.PaymentStatus.APPROVED:
            return branding_1.EMOJIS.APPROVE;
        case client_1.PaymentStatus.CANCELLED:
            return branding_1.EMOJIS.CLOSE;
        case client_1.PaymentStatus.EXPIRED:
            return '⌛';
        default:
            return branding_1.EMOJIS.PENDING;
    }
}
/** `**Rotulo** valor` numa linha so, no lugar do bloco de duas do `fields()`. */
function inline(label, value) {
    return `**${label}** ${value}`;
}
/**
 * Terceiro caminho de pagamento: copiar a CHAVE.
 *
 * O QR atende quem escaneia e o copia e cola atende quem cola. Faltava quem
 * digita a chave direto no app do banco — e ate aqui esse cliente so tinha a
 * chave se a loja a tivesse DESENHADO na arte do QR. Sem arte cadastrada nao
 * havia chave em lugar nenhum do Discord, e ele voltava ao ticket para pedir.
 *
 * NAO E VAZAMENTO. A mesma chave ja viaja em texto puro dentro do `pixPayload`
 * impresso na linha de cima. A regra de mascarar (`maskPixKey`) vale para os
 * PAINEIS DA EQUIPE, onde a chave e dado administrativo listado ao lado de
 * outras contas; no cartao ela e exatamente o que o cliente precisa para pagar.
 *
 * O aviso do valor nao e enfeite: transferencia por chave NAO carrega valor —
 * quem digita a chave digita o total tambem, e total errado e o defeito mais
 * comum desse caminho (e o que vira comprovante divergente depois).
 *
 * Sem escape de markdown: `pixKey` sai validada pelo `PixKeyValidator` (CPF,
 * CNPJ, e-mail, telefone ou UUID) e `receiverName` sai de `normalizePixText`,
 * que so deixa passar `[A-Za-z0-9 .-]`. Nenhum dos dois carrega marcacao.
 *
 * EXPORTADA porque o copia e cola aparece em tres telas — o cartao do canal, a
 * DM da cobranca e `/meus-pedidos` — e as tres precisam dizer a MESMA coisa. O
 * aviso do valor perde a serventia se so uma delas o der.
 */
function pixManualTransferLine(receiver) {
    if (receiver === undefined)
        return null;
    const key = `\`${receiver.key}\``;
    return (`-# Ou copie a chave **${(0, PixKeyValidator_1.describePixKeyType)(receiver.keyType)}** ${key} — ` +
        `**${receiver.holder}** • por aqui o valor nao vai junto: confira o total acima.`);
}
/**
 * Descricao sem o prefixo que o cartao ja mostra na linha do pedido.
 *
 * A cobranca do catalogo nasce descrita como `Pedido #VK-000184 — Cabelos`.
 * Com o numero agora estampado em campo proprio, repetir o prefixo gastava uma
 * linha inteira para dizer duas vezes a mesma coisa.
 */
function describeCharge(payment, orderLabel) {
    if (orderLabel === undefined)
        return payment.description;
    const prefix = `Pedido #${orderLabel} — `;
    return payment.description.startsWith(prefix)
        ? payment.description.slice(prefix.length)
        : payment.description;
}
/**
 * Linha de estado: icone, situacao e o unico prazo que interessa.
 *
 * Cobranca resolvida absorve aqui o proprio desfecho (quem aprovou, por que
 * cancelou) em vez de gastar um TextDisplay so para isso. E o prazo some
 * quando ja nao ha o que esperar — "expirava" numa cobranca aprovada e ruido.
 */
function statusLine(payment) {
    const head = `${statusIcon(payment.status)} **${(0, PaymentService_1.describeStatus)(payment.status)}**`;
    switch (payment.status) {
        case client_1.PaymentStatus.PENDING:
            return `${head} • expira ${(0, time_1.discordTimestamp)(payment.expiresAt, 'R')}`;
        case client_1.PaymentStatus.APPROVED:
            return payment.approvedById === null
                ? head
                : `${head} • ${(0, discord_1.userMention)(payment.approvedById)}`;
        case client_1.PaymentStatus.CANCELLED:
            return `${head}\n-# Motivo: ${payment.cancelReason ?? 'nao informado.'}`;
        case client_1.PaymentStatus.EXPIRED:
            return `${head}\n-# Solicite uma nova cobranca a equipe.`;
        default:
            return head;
    }
}
/**
 * Cartao da cobranca.
 *
 * DENSIDADE E REQUISITO, NAO ESTILO. O cartao e lido no celular, dentro de um
 * ticket, por alguem que so quer saber quanto pagar e para onde. A versao
 * anterior gastava dezessete linhas em rotulos empilhados (`**Cliente**` numa
 * linha, o valor na seguinte, linha em branco, repete) e tres divisores; o
 * QR Code so aparecia depois de rolar a tela. Aqui cada dado ocupa UMA linha,
 * o total vem primeiro e o que e secundario (cupom, motivo) desce para
 * subtexto.
 *
 * O que NAO foi cortado: total, prazo, estado e o copia e cola. Sao o contrato
 * do pagamento — compactar nao pode virar esconder. A chave em texto entrou
 * pela mesma regra, como subtexto dentro do bloco que ja existia: quem paga
 * digitando a chave nao tinha por onde, e um caminho a mais nao pode custar um
 * componente a mais.
 *
 * Os botoes administrativos ficam no cartao porque a equipe precisa agir sobre
 * ele a qualquer momento; TODO clique e revalidado no servidor
 * (`assertCanManagePayments`), entao o cliente nunca consegue aprovar,
 * cancelar ou alterar a propria cobranca. O botao de comprovante e a excecao:
 * ele e do CLIENTE e sai revalidado pelo dono da cobranca.
 *
 * LIMITE DO DISCORD: um Container aceita no maximo 10 componentes filhos. O
 * caminho PENDING com QR agora usa 8 (cabecalho 2 + galeria + dados + divisor +
 * PIX + botoes + rodape) e o resolvido usa 3. A folga e de proposito: foi a
 * falta dela que obrigou o comprovante a dividir linha com os botoes da equipe.
 */
function buildPaymentCard(payment, options = {}) {
    const pending = payment.status === client_1.PaymentStatus.PENDING;
    const root = (0, v2_1.container)(statusAccent(payment.status));
    (0, v2_1.addHeader)(root, branding_1.TITLES.PAYMENT); // 1 texto + 1 separador
    if (options.qrFilename !== undefined && pending) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([`attachment://${options.qrFilename}`], 'QR Code do pagamento PIX'));
    }
    const lines = [
        // O total abre o bloco: e a primeira pergunta de quem vai pagar, e um `##`
        // responde sem custar as duas linhas do rotulo + `#` de antes.
        `## ${(0, money_1.formatCents)(payment.finalAmount)}`,
    ];
    // Pedido e cliente dividem a linha: sao duas identificacoes curtas, e o
    // numero e o que liga a cobranca ao historico e ao comprovante.
    const identity = [
        ...(options.orderLabel !== undefined
            ? [inline('Pedido', `\`#${options.orderLabel}\``)]
            : []),
        inline('Cliente', (0, discord_1.userMention)(payment.customerId)),
    ];
    lines.push(identity.join('  •  '));
    const description = describeCharge(payment, options.orderLabel);
    if (description.length > 0)
        lines.push(inline('Descricao', description));
    /*
     * O cupom so aparece quando existe.
     *
     * "Cupom: Nenhum" era uma linha inteira para informar ausencia — ruido puro
     * para o cliente. Quando existe, o desconto entra como subtexto: o cliente
     * precisa poder conferir a conta, mas o numero que ele paga ja esta no topo.
     */
    if (payment.couponCodeSnapshot !== null) {
        lines.push(`-# Cupom \`${payment.couponCodeSnapshot}\` • de ${(0, money_1.formatCents)(payment.originalAmount)} ` +
            `• desconto -${(0, money_1.formatCents)(payment.discountAmount)}`);
    }
    lines.push(statusLine(payment));
    root.addTextDisplayComponents((0, v2_1.text)(lines.join('\n')));
    if (!pending)
        return root;
    root.addSeparatorComponents((0, v2_1.separator)());
    // A chave sobe no MESMO TextDisplay do copia e cola em vez de ganhar um
    // componente proprio: e o mesmo assunto ("como pagar"), e a folga do
    // container existe para uma segunda linha de botoes, nao para mais texto.
    const howToPay = [
        `Escaneie o QR acima ou copie o **PIX Copia e Cola**:`,
        `\`\`\`\n${payment.pixPayload}\n\`\`\``,
    ];
    const manual = pixManualTransferLine(options.receiver);
    if (manual !== null)
        howToPay.push(manual);
    root.addTextDisplayComponents((0, v2_1.text)(howToPay.join('\n')));
    root.addActionRowComponents((0, v2_1.buttonRow)(...buildPaymentButtons(payment)));
    root.addTextDisplayComponents((0, v2_1.footerNote)(actionsNote(payment)));
    return root;
}
/**
 * Botoes do cartao PENDENTE.
 *
 * O comprovante fica AQUI, no mesmo lugar onde o cliente acabou de ler o PIX —
 * antes ele precisava sair da tela e digitar `/comprovante enviar` com o numero
 * do pedido na mao, e quem paga fecha o Discord antes de fazer isso.
 *
 * So aparece com pedido vinculado: o comprovante e gravado NO PEDIDO
 * (`OrderReceipt.orderId`), entao numa cobranca manual nao existe onde guardar
 * a evidencia — e botao que so sabe responder "nao da" e pior que botao nenhum.
 *
 * Aparecer nao autoriza: `payment:receipt` reconfere no servidor que quem
 * clicou e o cliente desta cobranca, exatamente como as acoes de equipe
 * reconferem a permissao.
 */
function buildPaymentButtons(payment) {
    const buttons = [];
    if ((0, PaymentService_1.linkedOrderId)(payment) !== null) {
        buttons.push(new discord_js_1.ButtonBuilder()
            .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.RECEIPT, payment.id))
            .setLabel('Enviar Comprovante')
            .setEmoji(branding_1.EMOJIS.RECEIPT)
            .setStyle(discord_js_1.ButtonStyle.Secondary));
    }
    buttons.push(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.APPROVE, payment.id))
        .setLabel('Aprovar')
        .setEmoji(branding_1.EMOJIS.APPROVE)
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.MANAGE, payment.id))
        .setLabel('Gerenciar')
        .setEmoji(branding_1.EMOJIS.ADMIN)
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.CANCEL, payment.id))
        .setLabel('Cancelar')
        .setEmoji(branding_1.EMOJIS.CLOSE)
        .setStyle(discord_js_1.ButtonStyle.Secondary));
    return buttons;
}
/**
 * Rodape do cartao.
 *
 * Com o comprovante na linha, o cartao passa a ter DOIS publicos: uma acao do
 * cliente e tres da equipe. Manter o aviso antigo ("as acoes acima sao
 * restritas a equipe") espantaria o cliente justamente do unico botao que e
 * dele.
 */
function actionsNote(payment) {
    return (0, PaymentService_1.linkedOrderId)(payment) === null
        ? 'As acoes acima sao restritas a equipe da Vook Store.'
        : 'Comprovante e do cliente; as demais acoes sao restritas a equipe.';
}
/** Painel efemero de gerenciamento da cobranca (somente equipe). */
function buildPaymentManagePanel(payment) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.PAYMENT_MANAGE);
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Cliente', (0, discord_1.userMention)(payment.customerId)],
        ['Descricao', payment.description],
        ['Valor original', (0, money_1.formatCents)(payment.originalAmount)],
        [
            'Cupom aplicado',
            payment.couponCodeSnapshot !== null
                ? `\`${payment.couponCodeSnapshot}\` (- ${(0, money_1.formatCents)(payment.discountAmount)})`
                : 'Nenhum',
        ],
        ['Total atual', (0, money_1.formatCents)(payment.finalAmount)],
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.COUPON, 'payment', payment.id))
        .setLabel('Alterar Cupom')
        .setEmoji(branding_1.EMOJIS.COUPON)
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.COUPON_REMOVE, payment.id))
        .setLabel('Remover Cupom')
        .setEmoji(branding_1.EMOJIS.DELETE)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(payment.couponId === null), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.AMOUNT, payment.id))
        .setLabel('Alterar Valor')
        .setEmoji(branding_1.EMOJIS.EDIT)
        .setStyle(discord_js_1.ButtonStyle.Secondary)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Alterar cupom ou valor regenera automaticamente o QR Code e o Copia e Cola.'));
    return root;
}
/**
 * Painel de confirmacao exibido ao vendedor ANTES de gerar a cobranca.
 * E aqui que o vendedor — nunca o cliente — escolhe o cupom.
 */
function buildChargeDraftPanel(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.PAYMENT, { subtitle: 'Confira os dados antes de gerar a cobranca.' });
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Cliente', (0, discord_1.userMention)(params.customerId)],
        ['Descricao', params.description],
        ['Conta PIX', `${params.account.name} • ${params.account.receiverName}`],
        ['Valor original', (0, money_1.formatCents)(params.pricing.originalAmount)],
        [
            'Cupom',
            params.couponCode !== null
                ? `\`${params.couponCode}\` (- ${(0, money_1.formatCents)(params.pricing.discountAmount)})`
                : 'Nenhum',
        ],
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(`**TOTAL**\n# ${(0, money_1.formatCents)(params.pricing.finalAmount)}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.COUPON, 'draft', params.draftId))
        .setLabel('Selecionar Cupom')
        .setEmoji(branding_1.EMOJIS.COUPON)
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.CONFIRM, params.draftId))
        .setLabel('Gerar Cobranca')
        .setEmoji(branding_1.EMOJIS.PAYMENT)
        .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.DISCARD, params.draftId))
        .setLabel('Descartar')
        .setEmoji(branding_1.EMOJIS.CLOSE)
        .setStyle(discord_js_1.ButtonStyle.Secondary)));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`A cobranca expira em ${params.expirationMinutes} minuto(s) apos ser gerada.`));
    return root;
}
function buildCouponSelectMenu(kind, target, options, selectedCouponId) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.COUPON_SELECT, kind, target))
        .setPlaceholder('Selecione o cupom a aplicar')
        .setMinValues(1)
        .setMaxValues(1);
    const items = [
        new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel('Nenhum cupom')
            .setDescription('Cobrar o valor integral')
            .setValue(NO_COUPON_VALUE)
            .setDefault(selectedCouponId === null),
        ...options.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS - 1).map((entry) => new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel((0, sanitize_1.truncate)(`${entry.coupon.code} — ${(0, CouponCalculator_1.describeCouponValue)(entry.coupon)}`, limits_1.DISCORD_LIMITS.SELECT_LABEL))
            .setDescription((0, sanitize_1.truncate)(`Desconto ${(0, money_1.formatCents)(entry.discount.discountAmount)} • Total ${(0, money_1.formatCents)(entry.discount.finalAmount)}`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
            .setValue(entry.coupon.id)
            .setDefault(entry.coupon.id === selectedCouponId)),
    ];
    menu.addOptions(items);
    return menu;
}
exports.NO_COUPON_SELECT_VALUE = NO_COUPON_VALUE;
/** Painel com o seletor de cupons. */
function buildCouponSelectionPanel(kind, target, options, selectedCouponId) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.COUPONS, { subtitle: 'Somente a equipe aplica cupons.' });
    if (options.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhum cupom elegivel para este cliente e este valor no momento.\n' +
            'Verifique validade, valor minimo e limites de uso em `/cupom gerenciar`.'));
    }
    root.addActionRowComponents((0, v2_1.selectRow)(buildCouponSelectMenu(kind, target, options, selectedCouponId)));
    return root;
}
/** Modal do motivo de cancelamento. */
function buildCancelModal(paymentId) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.CANCEL_MODAL, paymentId))
        .setTitle('Cancelar cobranca');
    const reason = new discord_js_1.TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Motivo do cancelamento')
        .setPlaceholder('Ex.: cliente desistiu da compra.')
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(limits_1.BUSINESS_LIMITS.CLOSE_REASON_MAX);
    modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(reason));
    return modal;
}
/** Modal de alteracao do valor da cobranca. */
function buildAmountModal(paymentId, currentAmount) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.PAYMENT, customIds_1.PAYMENT_ACTION.AMOUNT_MODAL, paymentId))
        .setTitle('Alterar valor da cobranca');
    const amount = new discord_js_1.TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Novo valor original (sem desconto)')
        .setPlaceholder('Ex.: 250,00')
        .setValue((0, money_1.formatCents)(currentAmount).replace('R$ ', ''))
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);
    modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(amount));
    return modal;
}
//# sourceMappingURL=PaymentBuilders.js.map