"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_STATUS_VALUE = exports.NO_COUPON_VALUE = void 0;
exports.isChargeClosed = isChargeClosed;
exports.buildOrderCustomerView = buildOrderCustomerView;
exports.buildOrderChargeDm = buildOrderChargeDm;
exports.buildOrderListView = buildOrderListView;
exports.buildOrderSelect = buildOrderSelect;
exports.buildOrderStaffView = buildOrderStaffView;
exports.buildNewOrderNotice = buildNewOrderNotice;
exports.buildOrderCouponPanel = buildOrderCouponPanel;
exports.buildOrderAccountPanel = buildOrderAccountPanel;
exports.buildOrderAdminPanel = buildOrderAdminPanel;
exports.buildOrderStatusFilter = buildOrderStatusFilter;
exports.isOrderStatusFilter = isOrderStatusFilter;
exports.buildOrderCancelModal = buildOrderCancelModal;
exports.buildOrderSearchModal = buildOrderSearchModal;
exports.buildOrderCustomerPicker = buildOrderCustomerPicker;
exports.buildOrderCustomerLookup = buildOrderCustomerLookup;
exports.buildOrderNotFound = buildOrderNotFound;
exports.buildOrderChargeClosedDm = buildOrderChargeClosedDm;
exports.buildOrderPaidDm = buildOrderPaidDm;
exports.buildOrderDeliveredDm = buildOrderDeliveredDm;
exports.buildProductionQueue = buildProductionQueue;
exports.isQueueView = isQueueView;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const money_1 = require("../../../utils/money");
const DeliveryEstimateService_1 = require("../services/DeliveryEstimateService");
const sanitize_1 = require("../../../utils/sanitize");
const time_1 = require("../../../utils/time");
const discord_1 = require("../../../utils/discord");
const CouponCalculator_1 = require("../../coupons/services/CouponCalculator");
// A linha da chave vem de pagamentos, e nao copiada para ca: o aviso de que a
// transferencia por chave nao carrega valor precisa ser identico nas tres telas.
const PaymentBuilders_1 = require("../../payments/builders/PaymentBuilders");
const OrderService_1 = require("../services/OrderService");
const CatalogBuilders_1 = require("./CatalogBuilders");
/**
 * Pedidos (Components V2).
 *
 * Duas visoes distintas, de proposito:
 *  - CLIENTE: acompanha o proprio pedido. Nenhum botao financeiro, nenhum
 *    cupom, nenhuma acao de equipe.
 *  - EQUIPE: painel comercial com cupom, cobranca, entrega e cancelamento.
 *
 * Todo botao aqui e apenas um atalho: o handler revalida permissao e recarrega
 * o pedido no banco antes de qualquer acao.
 */
/** Valor do select que representa "nenhum cupom". */
exports.NO_COUPON_VALUE = 'none';
/** Valor do filtro que representa "todos os status". */
exports.ALL_STATUS_VALUE = 'all';
function orderButton(action, emoji, label, ...args) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, action, ...args))
        .setEmoji(emoji)
        .setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.BUTTON_LABEL))
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/**
 * Lista de itens do pedido.
 *
 * Pedido de VENDA DE BALCAO nao tem item: ele nasce de `/pagamento criar`, onde
 * nao existe pack do catalogo para fotografar. Nesses casos quem descreve a
 * venda e a descricao da cobranca — sem ela o painel exibia um bloco "Itens"
 * vazio, que o cliente le como pedido corrompido.
 */
function itemLines(items, chargeDescription) {
    if (items.length === 0) {
        const description = chargeDescription ?? '';
        return description.length > 0 ? `• ${(0, sanitize_1.truncate)(description, 80)}` : '• Venda avulsa';
    }
    return items
        .map((item) => `• ${(0, sanitize_1.truncate)(item.nameSnapshot, 60)}${item.skuSnapshot !== null ? ` (\`${item.skuSnapshot}\`)` : ''} — ${(0, money_1.formatCents)(item.priceSnapshot)}`)
        .join('\n');
}
/**
 * Pedido ainda aguardando pagamento cuja cobranca expirou ou foi cancelada.
 * E um estado real e comum (o PIX vence em minutos), nao um erro — mas o
 * cliente precisa ser informado, senao a tela some com o PIX sem explicacao.
 */
function isChargeClosed(order) {
    const charge = order.payment;
    if (charge === null)
        return false;
    if (order.status !== client_1.OrderStatus.AWAITING_PAYMENT)
        return false;
    return charge.status === client_1.PaymentStatus.EXPIRED || charge.status === client_1.PaymentStatus.CANCELLED;
}
function totalsBlock(order) {
    const lines = [['Subtotal', (0, money_1.formatCents)(order.subtotalAmount)]];
    if (order.couponCodeSnapshot !== null) {
        lines.push(['Cupom', `\`${order.couponCodeSnapshot}\``]);
        lines.push(['Desconto', `- ${(0, money_1.formatCents)(order.discountAmount)}`]);
    }
    else {
        lines.push(['Cupom', 'Nenhum']);
        lines.push(['Desconto', (0, money_1.formatCents)(0)]);
    }
    return `${(0, v2_1.fields)(lines)}\n\n**TOTAL**\n# ${(0, money_1.formatCents)(order.finalAmount)}`;
}
// ---------------------------------------------------------------------------
// Visao do cliente
// ---------------------------------------------------------------------------
/**
 * Pedido na visao do CLIENTE.
 * Sem acoes financeiras: acompanhar, e so. O cliente nao aplica cupom, nao
 * gera cobranca e nao muda status.
 */
/**
 * Linha da previsao de entrega, ou vazio quando nao ha prazo.
 *
 * Tudo na loja e feito sob encomenda, entao "quando chega" e a pergunta que o
 * cliente faz logo depois de pagar. Categoria sem prazo cadastrado nao gera
 * linha nenhuma — melhor silencio que uma data inventada, porque a data vira
 * cobranca depois.
 *
 * O ATRASO E DITO, nao escondido. Um pedido vencido que continua exibindo a
 * data original como se estivesse tudo bem e pior que nao ter prazo: o cliente
 * percebe sozinho e perde a confianca no resto.
 */
function deliveryFields(dueAt) {
    if (dueAt === null || dueAt === undefined)
        return [];
    const status = (0, DeliveryEstimateService_1.dueStatusOf)(dueAt);
    const rotulo = status === 'atrasado' ? 'Previsao (atrasado)' : 'Previsao de entrega';
    return [[rotulo, (0, time_1.discordTimestamp)(dueAt, 'D')]];
}
function buildOrderCustomerView(order, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, `${branding_1.TITLES.ORDER} #${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}`);
    if (options.notice !== undefined && options.notice.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(options.notice));
    }
    // Itens e totais num bloco so: o Container aceita 10 filhos e o caminho com
    // cobranca pendente (galeria + copia e cola) e o mais pesado desta tela.
    root.addTextDisplayComponents((0, v2_1.text)(`**Itens**\n${itemLines(order.items, order.payment?.description)}\n\n${totalsBlock(order)}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    const charge = order.payment;
    const awaitingPix = charge !== null && charge.status === client_1.PaymentStatus.PENDING;
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Status', `${(0, OrderService_1.orderStatusIcon)(order.status)} ${(0, OrderService_1.describeOrderStatus)(order.status)}`],
        ['Criado em', (0, time_1.discordTimestamp)(order.createdAt, 'f')],
        ...deliveryFields(order.dueAt),
        ...(awaitingPix
            ? [['Pague ate', (0, time_1.discordTimestamp)(charge.expiresAt, 'R')]]
            : []),
        // Entra como CAMPO, e nao como bloco proprio: o Container ja esta perto
        // do teto de 10 filhos no caminho com QR + copia e cola.
        ...(options.receiptNote !== undefined
            ? [['Comprovante', options.receiptNote]]
            : []),
        ...(order.status === client_1.OrderStatus.CANCELLED && order.cancelReason !== null
            ? [['Motivo', (0, sanitize_1.truncate)(order.cancelReason, 200)]]
            : []),
    ])));
    /*
     * COBRANCA PENDENTE: o cliente paga AQUI.
     *
     * Esta mensagem e efemera e o pedido ja foi conferido como sendo dele
     * (`requireCustomerOrder`), entao mostrar o copia e cola aqui e o lugar mais
     * seguro que existe — melhor que um cartao publicado em canal, que qualquer
     * um do canal enxerga.
     */
    if (awaitingPix) {
        if (options.qrFilename !== undefined) {
            root.addMediaGalleryComponents((0, v2_1.mediaGallery)([`attachment://${options.qrFilename}`], 'QR Code do pagamento PIX'));
        }
        const manual = (0, PaymentBuilders_1.pixManualTransferLine)(options.receiver);
        root.addTextDisplayComponents((0, v2_1.text)('Escaneie o QR Code acima ou use o **PIX Copia e Cola** abaixo:\n' +
            `\`\`\`\n${charge.pixPayload}\n\`\`\`\n` +
            (manual !== null ? `${manual}\n` : '') +
            '-# Apos pagar, aguarde a equipe confirmar. O status atualiza no botao **Atualizar**.'));
    }
    else if (isChargeClosed(order)) {
        /*
         * O pedido continua AGUARDANDO PAGAMENTO, mas a cobranca morreu.
         *
         * Sem este bloco o cliente ve "aguardando pagamento" com o PIX simplesmente
         * DESAPARECIDO da tela — nenhum QR, nenhum copia e cola e nenhuma
         * explicacao. Dizer o que aconteceu e o minimo; a equipe emite outra pelo
         * botao "Gerar Nova Cobranca".
         */
        root.addTextDisplayComponents((0, v2_1.text)(charge?.status === client_1.PaymentStatus.EXPIRED
            ? '⌛ **A cobranca anterior expirou.**\nA equipe da Vook Store vai gerar uma nova para voce. ' +
                'Toque em **Atualizar** em instantes para ver o novo PIX.'
            : '❌ **A cobranca anterior foi cancelada.**\nFale com a equipe da Vook Store para receber uma nova.'));
    }
    root.addActionRowComponents((0, v2_1.buttonRow)(
    // Atualizar re-le o pedido: o cliente confere sozinho quando a equipe
    // confirma o pagamento ou marca a entrega, sem precisar perguntar.
    orderButton(customIds_1.ORDER_ACTION.VIEW, branding_1.EMOJIS.REFRESH, 'Atualizar', order.id), orderButton(customIds_1.ORDER_ACTION.LIST, branding_1.EMOJIS.PACKAGE, 'Meus Pedidos', '1'), (0, CatalogBuilders_1.catalogHomeButton)('Catalogo')));
    // Com PIX na tela, a orientacao ja esta no bloco acima: um rodape a mais so
    // consumiria o ultimo filho disponivel do Container.
    if (!awaitingPix) {
        root.addTextDisplayComponents((0, v2_1.footerNote)('A equipe da Vook Store prepara o pagamento e acompanha a entrega.'));
    }
    return root;
}
/**
 * DM enviada ao cliente no momento em que a equipe gera a cobranca.
 *
 * Sem ela o cliente so descobriria que existe cobranca abrindo `/meus-pedidos`
 * por conta propria — e o cartao publicado fica no canal em que o VENDEDOR
 * estava, que nem sempre e um canal que o cliente ve.
 */
function buildOrderChargeDm(params) {
    const { order, payment } = params;
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDER_CHARGE);
    root.addTextDisplayComponents((0, v2_1.text)(`Sua cobranca do pedido **#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}** esta pronta.\n\n` +
        `**Itens**\n${itemLines(order.items, payment.description)}`));
    if (params.qrFilename !== undefined) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([`attachment://${params.qrFilename}`], 'QR Code do pagamento PIX'));
    }
    const manual = (0, PaymentBuilders_1.pixManualTransferLine)(params.receiver);
    root.addTextDisplayComponents((0, v2_1.text)(`**TOTAL**\n# ${(0, money_1.formatCents)(payment.finalAmount)}\n\n` +
        `Expira ${(0, time_1.discordTimestamp)(payment.expiresAt, 'R')}\n\n` +
        'Escaneie o QR Code acima ou use o **PIX Copia e Cola** abaixo:\n' +
        `\`\`\`\n${payment.pixPayload}\n\`\`\`` +
        (manual !== null ? `\n${manual}` : '')));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`${params.storeName} confirma o pagamento e avisa voce por aqui.`));
    return root;
}
/** Historico paginado do cliente. */
function buildOrderListView(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDERS);
    if (params.orders.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Voce ainda nao possui pedidos.\n\nExplore o catalogo da Vook Store para comecar.'));
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)((0, CatalogBuilders_1.catalogHomeButton)('Abrir Catalogo')));
        return root;
    }
    root.addTextDisplayComponents((0, v2_1.text)(params.orders
        .map((order) => {
        const first = order.items[0];
        const extra = order.items.length > 1 ? ` +${order.items.length - 1}` : '';
        return (`**#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}**\n` +
            `${(0, sanitize_1.truncate)(first?.nameSnapshot ?? 'Pedido', 60)}${extra}\n` +
            `${(0, money_1.formatCents)(order.finalAmount)} • ${(0, OrderService_1.orderStatusIcon)(order.status)} ${(0, OrderService_1.describeOrderStatus)(order.status)}`);
    })
        .join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.selectRow)(buildOrderSelect(params.orders, customIds_1.ORDER_ACTION.LIST_SELECT)));
    const navigation = [];
    if (params.totalPages > 1) {
        navigation.push(orderButton(customIds_1.ORDER_ACTION.LIST, branding_1.EMOJIS.PREVIOUS, 'Anterior', String(params.page - 1 < 1 ? params.totalPages : params.page - 1)), orderButton(customIds_1.ORDER_ACTION.LIST, branding_1.EMOJIS.NEXT, 'Proxima', String(params.page + 1 > params.totalPages ? 1 : params.page + 1)));
    }
    navigation.push((0, CatalogBuilders_1.catalogHomeButton)('Catalogo'));
    root.addActionRowComponents((0, v2_1.buttonRow)(...navigation));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Pagina ${params.page}/${params.totalPages} • ${params.total} pedido(s)`));
    return root;
}
/** Select de pedidos usado tanto pelo cliente quanto pela equipe. */
function buildOrderSelect(orders, action) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, action))
        .setPlaceholder('Selecione um pedido')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(orders.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((order) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(`#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}`, limits_1.DISCORD_LIMITS.SELECT_LABEL))
        .setDescription((0, sanitize_1.truncate)(`${(0, money_1.formatCents)(order.finalAmount)} • ${(0, OrderService_1.describeOrderStatus)(order.status)}`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
        .setValue(order.id)));
    return menu;
}
// ---------------------------------------------------------------------------
// Visao da equipe
// ---------------------------------------------------------------------------
/**
 * Painel comercial do pedido.
 *
 * As acoes disponiveis dependem do ESTADO: depois de pago, os botoes
 * financeiros somem — valor de pedido pago e historico, nao rascunho.
 */
function buildOrderStaffView(order, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, `${branding_1.TITLES.ORDER} #${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}`);
    if (options.notice !== undefined && options.notice.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(options.notice));
    }
    root.addTextDisplayComponents((0, v2_1.text)(`**Cliente**\n${(0, discord_1.userMention)(order.customerId)}\n\n**Itens**\n${itemLines(order.items, order.payment?.description)}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(totalsBlock(order)));
    root.addSeparatorComponents((0, v2_1.separator)());
    const payment = order.payment;
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Status', `${(0, OrderService_1.orderStatusIcon)(order.status)} ${(0, OrderService_1.describeOrderStatus)(order.status)}`],
        [
            'Cobranca',
            payment === null
                ? 'Nenhuma cobranca gerada'
                : `${describePaymentLabel(payment.status)} • ${(0, money_1.formatCents)(payment.finalAmount)}` +
                    (payment.status === client_1.PaymentStatus.PENDING
                        ? ` • expira ${(0, time_1.discordTimestamp)(payment.expiresAt, 'R')}`
                        : ''),
        ],
        ['Criado em', (0, time_1.discordTimestamp)(order.createdAt, 'f')],
        // A equipe precisa do prazo mais que o cliente: e por ele que a fila de
        // producao se ordena.
        ...deliveryFields(order.dueAt),
        ...assigneeFields(order),
    ])));
    for (const row of buildStaffActionRows(order)) {
        root.addActionRowComponents(row);
    }
    // O rodape explica a COBRANCA, entao so aparece enquanto ha o que cobrar.
    // Depois do pagamento ele nao dizia nada util — e ocupava o filho do
    // container que o select de responsavel precisa.
    if (order.status === client_1.OrderStatus.PENDING || order.status === client_1.OrderStatus.AWAITING_PAYMENT) {
        root.addTextDisplayComponents((0, v2_1.footerNote)('A cobranca usa o mesmo sistema de `/pagamento`: conta, PIX, cupons e expiracao configurados na loja.'));
    }
    return root;
}
function isInProduction(order) {
    return order.status === client_1.OrderStatus.PAID || order.status === client_1.OrderStatus.IN_PROGRESS;
}
/**
 * Responsavel pela demanda.
 *
 * Em producao, "ninguem" tambem e informacao: e o que diz que o pedido esta
 * parado esperando alguem pegar. Depois da entrega o campo fica como registro
 * de quem produziu.
 */
function assigneeFields(order) {
    if (order.assignedToId !== null) {
        const since = isInProduction(order) && order.assignedAt !== null
            ? ` · desde ${(0, time_1.discordTimestamp)(order.assignedAt, 'R')}`
            : '';
        return [['Responsavel', `${(0, discord_1.userMention)(order.assignedToId)}${since}`]];
    }
    return isInProduction(order) ? [['Responsavel', 'ninguem — demanda livre na fila']] : [];
}
/**
 * Entregar a demanda a alguem da equipe.
 *
 * O select de usuario oferece o servidor inteiro; quem pode RECEBER e
 * conferido no handler, com o membro real.
 */
function assignSelect(order) {
    const menu = new discord_js_1.UserSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.ASSIGN, order.id))
        .setPlaceholder(order.assignedToId === null
        ? 'Atribuir a alguem da equipe'
        : 'Transferir para outra pessoa da equipe')
        .setMinValues(1)
        .setMaxValues(1);
    if (order.assignedToId !== null)
        menu.setDefaultUsers(order.assignedToId);
    return menu;
}
function describePaymentLabel(status) {
    switch (status) {
        case client_1.PaymentStatus.PENDING:
            return '🟡 Pendente';
        case client_1.PaymentStatus.APPROVED:
            return '✅ Aprovada';
        case client_1.PaymentStatus.CANCELLED:
            return '❌ Cancelada';
        case client_1.PaymentStatus.EXPIRED:
            return '⌛ Expirada';
        default:
            return String(status);
    }
}
/**
 * Linhas de acao da equipe.
 *
 * Pedido pago NAO mostra "Aplicar Cupom" nem "Gerar Pagamento": alterar valor
 * de uma compra ja paga so pode acontecer por um fluxo administrativo proprio
 * e auditado — jamais por um botao solto no painel.
 */
function buildStaffActionRows(order) {
    const rows = [];
    const payment = order.payment;
    const hasPendingCharge = payment !== null && payment.status === client_1.PaymentStatus.PENDING;
    if (order.status === client_1.OrderStatus.PENDING || order.status === client_1.OrderStatus.AWAITING_PAYMENT) {
        const chargeLabel = payment === null
            ? 'Gerar Pagamento'
            : payment.status === client_1.PaymentStatus.PENDING
                ? 'Cobranca Pendente'
                : 'Gerar Nova Cobranca';
        rows.push((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.COUPON, branding_1.EMOJIS.COUPON, 'Aplicar Cupom', order.id).setDisabled(hasPendingCharge), orderButton(customIds_1.ORDER_ACTION.PAYMENT, payment === null ? branding_1.EMOJIS.PAYMENT : branding_1.EMOJIS.REFRESH, chargeLabel, order.id).setDisabled(hasPendingCharge), orderButton(customIds_1.ORDER_ACTION.CANCEL, branding_1.EMOJIS.CLOSE, 'Cancelar Pedido', order.id), orderButton(customIds_1.ORDER_ACTION.STAFF, branding_1.EMOJIS.REFRESH, 'Atualizar', order.id)));
        return rows;
    }
    if (isInProduction(order)) {
        rows.push((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.PROGRESS, branding_1.EMOJIS.PREPARING, 'Em Preparacao', order.id).setDisabled(order.status === client_1.OrderStatus.IN_PROGRESS), 
        // Assumir OU liberar, nunca os dois: com dono, assumir seria tomar a
        // demanda de alguem — e isso e o select de transferir, explicito.
        order.assignedToId === null
            ? orderButton(customIds_1.ORDER_ACTION.CLAIM, branding_1.EMOJIS.CLAIM, 'Assumir', order.id)
            : orderButton(customIds_1.ORDER_ACTION.RELEASE, branding_1.EMOJIS.BACK, 'Liberar', order.id), orderButton(customIds_1.ORDER_ACTION.DELIVER, branding_1.EMOJIS.DELIVER, 'Marcar como Entregue', order.id), orderButton(customIds_1.ORDER_ACTION.STAFF, branding_1.EMOJIS.REFRESH, 'Atualizar', order.id), orderButton(customIds_1.ORDER_ACTION.QUEUE, branding_1.EMOJIS.LIST, 'Fila', 'all')), (0, v2_1.selectRow)(assignSelect(order)));
        return rows;
    }
    if (order.status === client_1.OrderStatus.DELIVERED) {
        rows.push((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.COMPLETE, branding_1.EMOJIS.APPROVE, 'Concluir Pedido', order.id), orderButton(customIds_1.ORDER_ACTION.STAFF, branding_1.EMOJIS.REFRESH, 'Atualizar', order.id)));
        return rows;
    }
    rows.push((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.STAFF, branding_1.EMOJIS.REFRESH, 'Atualizar', order.id)));
    return rows;
}
/**
 * Aviso publicado no canal de pedidos quando uma compra e criada.
 *
 * `chargeState` deixa o card gritar quando a equipe PRECISA agir — cobranca
 * expirada, por exemplo. Sem isso o aviso continuaria dizendo apenas "aguardando
 * pagamento" e ninguem descobriria que e preciso emitir outra.
 */
function buildNewOrderNotice(order, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDER_NEW);
    if (options.chargeState !== undefined && options.chargeState.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(options.chargeState));
    }
    // Cinco dados em duas linhas: o total e o que a equipe procura primeiro, e
    // ele abre o bloco em vez de aparecer como quarto rotulo empilhado.
    root.addTextDisplayComponents((0, v2_1.text)(`## ${(0, money_1.formatCents)(order.subtotalAmount)}\n` +
        `**Pedido** \`#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}\`  •  ` +
        `**Cliente** ${(0, discord_1.userMention)(order.customerId)}\n` +
        `${(0, OrderService_1.orderStatusIcon)(order.status)} ${(0, OrderService_1.describeOrderStatus)(order.status)} • ` +
        `${order.items.length} item(ns)`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.STAFF, branding_1.EMOJIS.LIST, 'Abrir Pedido', order.id)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Somente a equipe da Vook Store consegue operar este pedido.'));
    return root;
}
/** Seletor de cupons elegiveis — visivel SOMENTE para a equipe. */
function buildOrderCouponPanel(orderId, options, selectedCouponId) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.COUPONS, {
        subtitle: 'Somente a equipe aplica cupons. O cliente nunca escolhe desconto.',
    });
    if (options.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhum cupom elegivel para este cliente e este valor agora.\n' +
            'Confira validade, valor minimo e limites de uso em `/cupom gerenciar`.'));
    }
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.COUPON_SELECT, orderId))
        .setPlaceholder('Selecione o cupom a aplicar')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions([
        new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel('Nenhum cupom')
            .setDescription('Cobrar o valor integral')
            .setValue(exports.NO_COUPON_VALUE)
            .setDefault(selectedCouponId === null),
        ...options.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS - 1).map((entry) => new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel((0, sanitize_1.truncate)(`${entry.coupon.code} — ${(0, CouponCalculator_1.describeCouponValue)(entry.coupon)}`, limits_1.DISCORD_LIMITS.SELECT_LABEL))
            .setDescription((0, sanitize_1.truncate)(`Desconto ${(0, money_1.formatCents)(entry.discount.discountAmount)} • Total ${(0, money_1.formatCents)(entry.discount.finalAmount)}`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
            .setValue(entry.coupon.id)
            .setDefault(entry.coupon.id === selectedCouponId)),
    ]);
    root.addActionRowComponents((0, v2_1.selectRow)(menu));
    root.addActionRowComponents((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.STAFF, branding_1.EMOJIS.BACK, 'Voltar ao Pedido', orderId)));
    return root;
}
/** Seletor da conta PIX que recebera o valor do pedido. */
function buildOrderAccountPanel(orderId, accounts) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.PAYMENT_ACCOUNTS, {
        subtitle: 'Escolha a conta que recebera o valor deste pedido.',
    });
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.PAYMENT_ACCOUNT, orderId))
        .setPlaceholder('Selecione a conta PIX')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(accounts.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((account) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(account.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
        .setDescription((0, sanitize_1.truncate)(`${account.identifier} • expira em ${account.defaultExpirationMinutes} min`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
        .setValue(account.id)));
    root.addActionRowComponents((0, v2_1.selectRow)(menu));
    root.addActionRowComponents((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.STAFF, branding_1.EMOJIS.BACK, 'Voltar ao Pedido', orderId)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('A cobranca sera gerada pelo mesmo sistema usado em `/pagamento criar`.'));
    return root;
}
/** Painel administrativo de pedidos com filtro por status. */
function buildOrderAdminPanel(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDERS_ADMIN);
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Aguardando vendedor', String(params.totals.get(client_1.OrderStatus.PENDING) ?? 0)],
        ['Aguardando pagamento', String(params.totals.get(client_1.OrderStatus.AWAITING_PAYMENT) ?? 0)],
        [
            'Pagos / em preparacao',
            String((params.totals.get(client_1.OrderStatus.PAID) ?? 0) +
                (params.totals.get(client_1.OrderStatus.IN_PROGRESS) ?? 0)),
        ],
        ['Entregues', String(params.totals.get(client_1.OrderStatus.DELIVERED) ?? 0)],
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    if (params.orders.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhum pedido neste filtro.'));
    }
    else {
        root.addTextDisplayComponents((0, v2_1.text)(params.orders
            .map((order) => `**#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}** — ${(0, discord_1.userMention)(order.customerId)}\n` +
            `${(0, money_1.formatCents)(order.finalAmount)} • ${(0, OrderService_1.orderStatusIcon)(order.status)} ${(0, OrderService_1.describeOrderStatus)(order.status)}`)
            .join('\n\n')));
    }
    root.addActionRowComponents((0, v2_1.selectRow)(buildOrderStatusFilter(params.status)));
    if (params.orders.length > 0) {
        root.addActionRowComponents((0, v2_1.selectRow)(buildOrderSelect(params.orders, customIds_1.ORDER_ACTION.ADMIN_SELECT)));
    }
    const navigation = [];
    if (params.totalPages > 1) {
        navigation.push(orderButton(customIds_1.ORDER_ACTION.ADMIN_LIST, branding_1.EMOJIS.PREVIOUS, 'Anterior', params.status, String(params.page - 1 < 1 ? params.totalPages : params.page - 1)), orderButton(customIds_1.ORDER_ACTION.ADMIN_LIST, branding_1.EMOJIS.NEXT, 'Proxima', params.status, String(params.page + 1 > params.totalPages ? 1 : params.page + 1)));
    }
    navigation.push(orderButton(customIds_1.ORDER_ACTION.SEARCH, branding_1.EMOJIS.SEARCH, 'Buscar Pedido'), orderButton(customIds_1.ORDER_ACTION.ADMIN_CUSTOMER, branding_1.EMOJIS.ROLE, 'Por Cliente'));
    root.addActionRowComponents((0, v2_1.buttonRow)(...navigation));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Pagina ${params.page}/${params.totalPages} • ${params.total} pedido(s) no filtro`));
    return root;
}
const STATUS_FILTERS = [
    { value: exports.ALL_STATUS_VALUE, label: 'Todos', description: 'Todos os pedidos da loja' },
    { value: client_1.OrderStatus.PENDING, label: 'Pendentes', description: 'Aguardando o vendedor' },
    {
        value: client_1.OrderStatus.AWAITING_PAYMENT,
        label: 'Aguardando pagamento',
        description: 'Cobranca gerada, ainda nao paga',
    },
    { value: client_1.OrderStatus.PAID, label: 'Pagos', description: 'Pagos, aguardando preparacao' },
    { value: client_1.OrderStatus.IN_PROGRESS, label: 'Em preparacao', description: 'Sendo preparados' },
    { value: client_1.OrderStatus.DELIVERED, label: 'Entregues', description: 'Entregues ao cliente' },
    { value: client_1.OrderStatus.COMPLETED, label: 'Concluidos', description: 'Ciclo encerrado' },
    { value: client_1.OrderStatus.CANCELLED, label: 'Cancelados', description: 'Pedidos cancelados' },
];
function buildOrderStatusFilter(selected) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.ADMIN_FILTER))
        .setPlaceholder('Filtrar por status')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(STATUS_FILTERS.map((filter) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel(filter.label)
        .setDescription(filter.description)
        .setValue(filter.value)
        .setDefault(filter.value === selected)));
    return menu;
}
function isOrderStatusFilter(value) {
    return STATUS_FILTERS.some((filter) => filter.value === value);
}
/** Modal do motivo de cancelamento do pedido. */
function buildOrderCancelModal(orderId) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.CANCEL_MODAL, orderId))
        .setTitle('Cancelar pedido');
    modal.addLabelComponents(new discord_js_1.LabelBuilder()
        .setLabel('Motivo do cancelamento')
        .setDescription('Fica registrado na auditoria do pedido.')
        .setTextInputComponent(new discord_js_1.TextInputBuilder()
        .setCustomId('reason')
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(limits_1.BUSINESS_LIMITS.CLOSE_REASON_MAX)
        .setPlaceholder('Ex.: cliente desistiu da compra.')));
    return modal;
}
/** Modal de busca de pedido (numero ou id do cliente). */
function buildOrderSearchModal() {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.SEARCH_MODAL))
        .setTitle('Buscar pedido');
    modal.addLabelComponents(new discord_js_1.LabelBuilder()
        .setLabel('Numero do pedido')
        .setDescription('Aceita 184, VK-000184 ou #VK-000184.')
        .setTextInputComponent(new discord_js_1.TextInputBuilder()
        .setCustomId('numero')
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setPlaceholder('VK-000184')));
    return modal;
}
/**
 * Seletor de cliente para a busca da equipe.
 *
 * Usa `UserSelectMenu` em vez de pedir o ID digitado: o vendedor conhece o
 * cliente pelo nome, nao pelo snowflake, e digitar ID errado devolveria "nenhum
 * pedido" sem dizer que o erro foi de digitacao.
 */
function buildOrderCustomerPicker() {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDERS_ADMIN, { subtitle: 'Buscar pedidos por cliente' });
    root.addTextDisplayComponents((0, v2_1.text)('Escolha o cliente para ver todos os pedidos dele neste servidor.'));
    root.addActionRowComponents((0, v2_1.selectRow)(new discord_js_1.UserSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.ADMIN_CUSTOMER_SELECT))
        .setPlaceholder('Selecione o cliente')
        .setMinValues(1)
        .setMaxValues(1)));
    root.addActionRowComponents((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.ADMIN_LIST, branding_1.EMOJIS.BACK, 'Voltar', exports.ALL_STATUS_VALUE, '1')));
    return root;
}
/** Pedidos de um cliente especifico, na visao da equipe. */
function buildOrderCustomerLookup(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDERS_ADMIN, {
        subtitle: `Pedidos de ${(0, discord_1.userMention)(params.customerId)}`,
    });
    if (params.orders.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Este cliente ainda nao possui pedidos neste servidor.'));
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.ADMIN_CUSTOMER, branding_1.EMOJIS.ROLE, 'Outro Cliente'), orderButton(customIds_1.ORDER_ACTION.ADMIN_LIST, branding_1.EMOJIS.BACK, 'Voltar', exports.ALL_STATUS_VALUE, '1')));
        return root;
    }
    root.addTextDisplayComponents((0, v2_1.text)(params.orders
        .map((order) => `**#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}** — ${(0, money_1.formatCents)(order.finalAmount)}\n` +
        `${(0, OrderService_1.orderStatusIcon)(order.status)} ${(0, OrderService_1.describeOrderStatus)(order.status)} • ${(0, time_1.discordTimestamp)(order.createdAt, 'd')}`)
        .join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.selectRow)(buildOrderSelect(params.orders, customIds_1.ORDER_ACTION.ADMIN_SELECT)));
    const navigation = [];
    if (params.totalPages > 1) {
        navigation.push(orderButton(customIds_1.ORDER_ACTION.ADMIN_CUSTOMER, branding_1.EMOJIS.PREVIOUS, 'Anterior', params.customerId, String(params.page - 1 < 1 ? params.totalPages : params.page - 1)), orderButton(customIds_1.ORDER_ACTION.ADMIN_CUSTOMER, branding_1.EMOJIS.NEXT, 'Proxima', params.customerId, String(params.page + 1 > params.totalPages ? 1 : params.page + 1)));
    }
    navigation.push(orderButton(customIds_1.ORDER_ACTION.ADMIN_CUSTOMER, branding_1.EMOJIS.ROLE, 'Outro Cliente'), orderButton(customIds_1.ORDER_ACTION.ADMIN_LIST, branding_1.EMOJIS.BACK, 'Voltar', exports.ALL_STATUS_VALUE, '1'));
    root.addActionRowComponents((0, v2_1.buttonRow)(...navigation));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Pagina ${params.page}/${params.totalPages} • ${params.total} pedido(s)`));
    return root;
}
/** Resposta da busca quando o numero informado nao existe na guild. */
function buildOrderNotFound(orderNumber) {
    const root = (0, v2_1.container)(branding_1.COLORS.WARNING);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDERS_ADMIN, { subtitle: 'Pedido nao encontrado' });
    root.addTextDisplayComponents((0, v2_1.text)(`Nenhum pedido **#${(0, OrderService_1.formatOrderNumber)(orderNumber)}** existe neste servidor.\n` +
        'Confira o numero e tente novamente.'));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.ADMIN_LIST, branding_1.EMOJIS.LIST, 'Ver Pedidos', exports.ALL_STATUS_VALUE, '1'), orderButton(customIds_1.ORDER_ACTION.SEARCH, branding_1.EMOJIS.SEARCH, 'Buscar Outro')));
    return root;
}
/**
 * DM avisando que a cobranca expirou ou foi cancelada.
 *
 * Existe porque o cliente recebeu o PIX por DM: se a cobranca morre em silencio,
 * ele fica com um QR invalido no historico da conversa achando que ainda vale.
 */
function buildOrderChargeClosedDm(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.WARNING);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDER_CHARGE);
    root.addTextDisplayComponents((0, v2_1.text)(params.expired
        ? `⌛ O PIX do pedido **#${(0, OrderService_1.formatOrderNumber)(params.order.orderNumber)}** **expirou** e nao pode mais ser pago.\n\n` +
            'Seu pedido continua reservado. A equipe vai gerar uma nova cobranca — ' +
            'voce recebe o novo QR Code por aqui.'
        : `❌ A cobranca do pedido **#${(0, OrderService_1.formatOrderNumber)(params.order.orderNumber)}** foi **cancelada**.\n\n` +
            'Se voce ja pagou, fale com a equipe antes de pagar de novo.'));
    root.addTextDisplayComponents((0, v2_1.text)(`-# Total do pedido: **${(0, money_1.formatCents)(params.order.finalAmount)}**`));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`${params.storeName} — use \`/meus-pedidos\` para acompanhar.`));
    return root;
}
/** DM enviada ao cliente quando o pagamento e confirmado. */
function buildOrderPaidDm(order, storeName) {
    const root = (0, v2_1.container)(branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDER_PAID);
    root.addTextDisplayComponents((0, v2_1.text)(`Seu pagamento referente ao pedido **#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}** foi confirmado.`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(`## ${(0, money_1.formatCents)(order.finalAmount)}\n` +
        `**Itens**\n${itemLines(order.items)}\n` +
        `${branding_1.EMOJIS.PREPARING} Preparando a entrega.`));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`${storeName} agradece a sua compra.`));
    return root;
}
/** DM enviada ao cliente quando o pedido e entregue. */
function buildOrderDeliveredDm(order, storeName) {
    const root = (0, v2_1.container)(branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, branding_1.TITLES.ORDER_DELIVERED);
    root.addTextDisplayComponents((0, v2_1.text)(`Seu pedido **#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}** foi marcado como entregue.\n\n` +
        `Obrigado por comprar na ${storeName}.`));
    return root;
}
/**
 * Prazo de um pedido, em texto.
 *
 * TEXTO E NAO COR, pela politica visual da loja: nenhuma cor carrega
 * significado aqui. O atraso e dito com todas as letras porque e a unica
 * informacao da linha que exige acao hoje.
 */
function dueLabel(dueAt) {
    switch ((0, DeliveryEstimateService_1.dueStatusOf)(dueAt)) {
        case 'atrasado':
            return `**ATRASADO** — venceu ${(0, time_1.discordTimestamp)(dueAt, 'R')}`;
        case 'hoje':
            return '**VENCE HOJE**';
        case 'no-prazo':
            return `vence ${(0, time_1.discordTimestamp)(dueAt, 'D')}`;
        default:
            // Nao e erro: e categoria sem prazo cadastrado. Dizer isso na fila e o
            // que faz alguem ir configurar.
            return 'sem prazo definido';
    }
}
/** Categorias distintas dos itens, na ordem em que aparecem. */
function categoriesOf(order) {
    const nomes = [
        ...new Set(order.items.flatMap((item) => item.pack.category === null ? [] : [item.pack.category.name])),
    ];
    return nomes.length === 0 ? 'sem categoria' : nomes.join(', ');
}
/**
 * Fila de producao ordenada por vencimento.
 *
 * O QUE ESTA TELA RESPONDE: "o que vence primeiro?". Ate aqui o bot mostrava a
 * previsao de entrega um pedido por vez — a data existia, era exibida, e nenhuma
 * listagem ordenava por ela. Na pratica o prazo era controlado de cabeca ou numa
 * anotacao paralela, e o atraso chegava pela reclamacao do cliente.
 *
 * UMA LINHA POR PEDIDO, densa de proposito: quem abre isto quer varrer a lista,
 * nao ler cada item. Numero, cliente, categoria e prazo cabem numa linha; o
 * detalhe fica a um `/pedidos buscar` de distancia.
 */
function buildProductionQueue(params) {
    const { orders, stats, view } = params;
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, 'VOOK STORE — FILA DE PRODUCAO');
    if (params.notice !== undefined && params.notice.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(params.notice));
    }
    // Os botoes aparecem mesmo com a lista vazia: "Minhas" vazio e exatamente a
    // hora de trocar de recorte ou pegar a proxima.
    if (orders.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)(emptyQueueText(view, stats)));
        root.addActionRowComponents(queueButtons(view, stats));
        return root;
    }
    const atrasados = orders.filter((order) => (0, DeliveryEstimateService_1.dueStatusOf)(order.dueAt) === 'atrasado').length;
    const semPrazo = orders.filter((order) => (0, DeliveryEstimateService_1.dueStatusOf)(order.dueAt) === 'sem-prazo').length;
    const resumo = [`**${stats.total}** em producao`];
    if (stats.unassigned > 0)
        resumo.push(`**${stats.unassigned} livre(s)**`);
    if (atrasados > 0)
        resumo.push(`**${atrasados} atrasado(s)**`);
    if (semPrazo > 0)
        resumo.push(`${semPrazo} sem prazo`);
    const cabecalho = [resumo.join(' · ')];
    const carga = workloadLine(stats);
    if (carga !== null)
        cabecalho.push(carga);
    cabecalho.push(`-# Mostrando ${QUEUE_VIEW_LABEL[view]} (${viewTotal(params)}), ` +
        'do vencimento mais proximo ao mais distante.');
    root.addTextDisplayComponents((0, v2_1.text)(cabecalho.join('\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    const linhas = orders.map((order) => `${(0, OrderService_1.orderStatusIcon)(order.status)} **${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}** · ` +
        `${(0, discord_1.userMention)(order.customerId)} · ${categoriesOf(order)}\n` +
        `-# ${dueLabel(order.dueAt)} · ${assigneeLabel(order.assignedToId)}`);
    root.addTextDisplayComponents((0, v2_1.text)(linhas.join('\n')));
    // Rodapes num bloco so: o container tem dez filhos, e o select e os botoes
    // precisam caber mesmo com aviso no topo.
    const rodape = [];
    const restantes = viewTotal(params) - orders.length;
    if (restantes > 0) {
        rodape.push(`-# e mais ${restantes} pedido(s) neste recorte, fora desta pagina.`);
    }
    if (semPrazo > 0) {
        rodape.push('-# Pedido sem prazo vem de categoria sem prazo cadastrado. ' +
            'Defina em `/catalogo-painel prazo`.');
    }
    if (rodape.length > 0)
        root.addTextDisplayComponents((0, v2_1.text)(rodape.join('\n')));
    root.addActionRowComponents((0, v2_1.selectRow)(queueSelect(orders)));
    root.addActionRowComponents(queueButtons(view, stats));
    return root;
}
function isQueueView(value) {
    return value === 'all' || value === 'mine' || value === 'free';
}
const QUEUE_VIEW_LABEL = {
    all: 'todas as demandas',
    mine: 'suas demandas',
    free: 'as demandas livres',
};
/** Carga maxima listada por pessoa antes de resumir em "e mais N". */
const WORKLOAD_SHOWN = 8;
/** Total do recorte atual, vindo do banco — nunca o tamanho da pagina. */
function viewTotal(params) {
    if (params.view === 'all')
        return params.stats.total;
    if (params.view === 'free')
        return params.stats.unassigned;
    return params.stats.workload.find((item) => item.assigneeId === params.viewerId)?.count ?? 0;
}
function assigneeLabel(assignedToId) {
    return assignedToId === null ? '**livre**' : `${branding_1.EMOJIS.CLAIM} ${(0, discord_1.userMention)(assignedToId)}`;
}
/**
 * Quem esta com quantas demandas.
 *
 * E o que torna a fila GERENCIAVEL: sem a carga, distribuir trabalho e
 * perguntar no chat quem esta livre.
 */
function workloadLine(stats) {
    if (stats.workload.length === 0)
        return null;
    const shown = stats.workload
        .slice(0, WORKLOAD_SHOWN)
        .map((item) => `${(0, discord_1.userMention)(item.assigneeId)} ${item.count}`);
    const hidden = stats.workload.length - WORKLOAD_SHOWN;
    if (hidden > 0)
        shown.push(`e mais ${hidden} pessoa(s)`);
    return `Carga da equipe: ${shown.join(' · ')}`;
}
function emptyQueueText(view, stats) {
    if (view === 'mine') {
        return ('Nenhuma demanda com voce agora.\n-# ' +
            (stats.unassigned > 0
                ? `Ha ${stats.unassigned} livre(s): **Pegar Proxima** assume a que vence primeiro.`
                : 'E nao ha demanda livre na fila.'));
    }
    if (view === 'free') {
        return ('Nenhuma demanda livre.\n-# ' +
            (stats.total > 0
                ? 'Tudo que esta em producao ja tem responsavel.'
                : 'Nao ha pedido em producao.'));
    }
    return ('Nenhum pedido em producao.\n' +
        '-# Entram aqui os pedidos pagos e em preparacao. Pedido entregue sai da fila.');
}
/**
 * Prazo em texto puro para a descricao do select, que nao renderiza markdown
 * nem timestamp do Discord.
 */
function plainDue(dueAt) {
    switch ((0, DeliveryEstimateService_1.dueStatusOf)(dueAt)) {
        case 'atrasado':
            return 'ATRASADO';
        case 'hoje':
            return 'Vence hoje';
        case 'no-prazo':
            return `Vence ${dueAt.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                timeZone: 'America/Sao_Paulo',
            })}`;
        default:
            return 'Sem prazo';
    }
}
/**
 * Select para abrir uma demanda da pagina.
 *
 * Reusa a rota do painel de pedidos (`admin-sel`): o destino e a mesma tela da
 * equipe, com os mesmos botoes — nao ha segunda versao dela para manter.
 */
function queueSelect(orders) {
    return new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.ADMIN_SELECT))
        .setPlaceholder('Abrir uma demanda')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(orders.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((order) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(`${(0, OrderService_1.formatOrderNumber)(order.orderNumber)} · ${categoriesOf(order)}`, limits_1.DISCORD_LIMITS.SELECT_LABEL))
        .setDescription((0, sanitize_1.truncate)(`${plainDue(order.dueAt)} · ${order.assignedToId === null ? 'livre' : 'com responsavel'}`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
        .setValue(order.id)));
}
function queueButtons(view, stats) {
    const filter = (target, emoji, label) => orderButton(customIds_1.ORDER_ACTION.QUEUE, emoji, label, target).setDisabled(view === target);
    return (0, v2_1.buttonRow)(orderButton(customIds_1.ORDER_ACTION.QUEUE_NEXT, branding_1.EMOJIS.BUY_NOW, 'Pegar Proxima', view).setDisabled(stats.unassigned === 0), filter('all', branding_1.EMOJIS.LIST, 'Todas'), filter('mine', branding_1.EMOJIS.CLAIM, 'Minhas'), filter('free', branding_1.EMOJIS.PACKAGE, 'Livres'), 
    // Arg extra so para o id nao repetir o do filtro atual: o Discord recusa a
    // mensagem INTEIRA quando dois componentes tem o mesmo customId.
    orderButton(customIds_1.ORDER_ACTION.QUEUE, branding_1.EMOJIS.REFRESH, 'Atualizar', view, 'r'));
}
//# sourceMappingURL=OrderBuilders.js.map