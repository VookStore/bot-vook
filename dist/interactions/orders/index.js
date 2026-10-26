"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderModals = exports.orderSelects = exports.orderButtons = void 0;
exports.showCustomerOrder = showCustomerOrder;
exports.parseOrderNumberInput = parseOrderNumberInput;
exports.renderCustomerOrdersForCommand = renderCustomerOrdersForCommand;
exports.renderAdminOrdersForCommand = renderAdminOrdersForCommand;
exports.renderCustomerLookupForCommand = renderCustomerLookupForCommand;
exports.renderStaffOrderForCommand = renderStaffOrderForCommand;
exports.renderProductionQueueForCommand = renderProductionQueueForCommand;
const client_1 = require("@prisma/client");
const reply_1 = require("../../components/reply");
const DemandBoardService_1 = require("../../modules/demands/services/DemandBoardService");
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const errors_1 = require("../../core/errors");
const Logger_1 = require("../../core/logger/Logger");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const discord_1 = require("../../utils/discord");
const sanitize_1 = require("../../utils/sanitize");
const CouponService_1 = require("../../modules/coupons/services/CouponService");
const OrderBuilders_1 = require("../../modules/catalog/builders/OrderBuilders");
const OrderPaymentService_1 = require("../../modules/catalog/services/OrderPaymentService");
const OrderNotificationService_1 = require("../../modules/catalog/services/OrderNotificationService");
const OrderService_1 = require("../../modules/catalog/services/OrderService");
const PaymentCardService_1 = require("../../modules/payments/services/PaymentCardService");
const ReceiptBuilders_1 = require("../../modules/catalog/builders/ReceiptBuilders");
const OrderReceiptService_1 = require("../../modules/catalog/services/OrderReceiptService");
const OrderRepository_1 = require("../../modules/catalog/repositories/OrderRepository");
const shared_1 = require("../catalog/shared");
const logger = (0, Logger_1.createLogger)('order:view');
/**
 * Mantem o quadro de demandas em dia depois de uma transicao.
 *
 * Fica AQUI, e nao nos botoes do quadro, de proposito: a mesma transicao pode
 * vir do cartao publico, do painel efemero, da fila de producao ou do
 * `/entregar`. Se so os botoes do quadro atualizassem o cartao, qualquer
 * mudanca feita em outra tela o deixaria mentindo — e um quadro que mente e
 * pior que nao ter quadro.
 *
 * NUNCA LANCA: o pedido ja mudou de estado no banco quando isto roda. Uma
 * mensagem que nao pode ser reescrita nao pode virar erro para quem clicou.
 */
async function syncDemandBoard(guild, order, options = {}) {
    try {
        if (options.started === true) {
            await (0, DemandBoardService_1.announceDemandStarted)(guild, order);
            return;
        }
        await (0, DemandBoardService_1.refreshDemandCards)(guild, order);
    }
    catch (error) {
        logger.warn('Falha ao atualizar o quadro de demandas.', {
            guildId: guild.id,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}
/**
 * Pedidos.
 *
 * SEPARACAO DE PAPEIS
 *  - Cliente: ve apenas os PROPRIOS pedidos, sem nenhuma acao financeira.
 *  - Equipe: painel comercial completo (cupom, cobranca, entrega, cancelamento).
 *
 * SEGURANCA: o orderId chega por customId e nao autoriza nada. Todo handler de
 * cliente passa por `requireCustomerOrder` (que confere o dono) e todo handler
 * de equipe revalida a permissao com o membro real antes de agir.
 *
 * PAGAMENTO: nenhuma cobranca nasce aqui. `createOrderPayment` apenas traduz o
 * pedido para o `PaymentService` — o mesmo motor usado por `/pagamento criar`.
 */
// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------
/**
 * Pedido do cliente, com o PIX quando ha cobranca pendente.
 *
 * O QR e gerado a partir do `pixPayload` salvo no banco, pelo mesmo caminho do
 * cartao publicado — nunca de um payload recalculado aqui. Falha ao gerar a
 * imagem nao esconde o pedido: o copia e cola continua na tela.
 *
 * Exportado porque catalogo e carrinho tambem terminam nesta tela depois de
 * criar um pedido, e todos precisam mostrar o PIX do mesmo jeito.
 */
async function showCustomerOrder(interaction, order, notice) {
    const charge = order.payment;
    const pending = charge !== null && charge.status === client_1.PaymentStatus.PENDING;
    // Comprovante ja enviado vira uma linha no painel: sem isso o cliente que
    // acabou de mandar o arquivo ve a mesma tela de antes e manda de novo.
    const receipt = await (0, OrderReceiptService_1.getLatestReceipt)(order.id).catch(() => null);
    const receiptNote = (0, ReceiptBuilders_1.describeReceiptForCustomer)(receipt);
    const base = {
        ...(notice !== undefined ? { notice } : {}),
        ...(receiptNote !== null ? { receiptNote } : {}),
    };
    if (!pending) {
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderCustomerView)(order, base));
        return;
    }
    // Resolvido ANTES do try de proposito: se o QR falhar, a chave em texto e o
    // que sobra ao lado do copia e cola — e e ai que ela mais serve.
    const receiver = await (0, PaymentCardService_1.resolvePixReceiver)(charge);
    const payable = { ...base, ...(receiver !== undefined ? { receiver } : {}) };
    try {
        const { attachment, filename } = await (0, PaymentCardService_1.buildPaymentQr)(charge);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderCustomerView)(order, { ...payable, qrFilename: filename }), { files: [attachment] });
    }
    catch (error) {
        logger.warn('Falha ao gerar o QR do pedido; exibindo apenas o copia e cola.', {
            guildId: order.guildId,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderCustomerView)(order, payable));
    }
}
async function renderCustomerList(interaction, guildId, customerId, page) {
    const result = await (0, OrderService_1.listCustomerOrders)(guildId, customerId, page);
    await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderListView)({
        orders: result.items,
        page: result.page,
        totalPages: result.totalPages,
        total: result.total,
    }));
}
const listButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.LIST,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const page = (0, shared_1.parsePage)(parsed.args[0]);
        await (0, shared_1.beginPanel)(interaction);
        await renderCustomerList(interaction, guild.id, member.id, page);
    },
};
const viewButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.VIEW,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        // Confere o DONO do pedido: um id trocado na mao nao abre pedido alheio.
        const order = await (0, OrderService_1.requireCustomerOrder)(guild.id, member.id, orderId);
        await showCustomerOrder(interaction, order);
    },
};
const listSelect = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.LIST_SELECT,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const orderId = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        const order = await (0, OrderService_1.requireCustomerOrder)(guild.id, member.id, orderId);
        await showCustomerOrder(interaction, order);
    },
};
// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------
async function renderStaffOrder(interaction, guildId, orderId, notice) {
    const order = await (0, OrderService_1.requireOrder)(guildId, orderId);
    await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, notice === undefined ? {} : { notice }));
}
const staffButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.STAFF,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        await renderStaffOrder(interaction, guild.id, orderId);
    },
};
/**
 * Aplicar cupom — VENDEDOR, nunca cliente.
 * Os cupons elegiveis vem do modulo central, avaliados para o subtotal deste
 * pedido e para este cliente.
 */
const couponButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.COUPON,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanApplyOrderCoupon)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        const order = await (0, OrderService_1.requireOrder)(guild.id, orderId);
        const options = await (0, CouponService_1.listSelectableCoupons)(guild.id, order.subtotalAmount, order.customerId);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderCouponPanel)(orderId, options, order.couponId));
    },
};
const couponSelect = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.COUPON_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanApplyOrderCoupon)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        const raw = (0, shared_1.readSelectedValue)(interaction);
        const couponId = raw === OrderBuilders_1.NO_COUPON_VALUE ? null : raw;
        await (0, shared_1.beginPanel)(interaction);
        const { order, couponCode } = await (0, OrderService_1.applyOrderCoupon)(guild.id, member, orderId, couponId);
        await (0, OrderNotificationService_1.refreshOrderNotice)(guild, order);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, {
            notice: couponCode === null
                ? `${branding_1.EMOJIS.DELETE} Cupom removido do pedido.`
                : `${branding_1.EMOJIS.COUPON} Cupom \`${couponCode}\` aplicado ao pedido.`,
        }));
    },
};
/**
 * Gerar cobranca.
 *
 * Com uma unica conta PIX ativa, cobra direto; com varias, pergunta qual antes.
 * A cobranca em si e emitida pelo `PaymentService`.
 */
const paymentButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.PAYMENT,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanCreateOrderPayment)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        const accounts = await (0, OrderPaymentService_1.listPaymentAccountsForOrder)(guild.id);
        if (accounts.length > 1) {
            await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderAccountPanel)(orderId, accounts));
            return;
        }
        await generatePayment(interaction, orderId, null);
    },
};
const paymentAccountSelect = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.PAYMENT_ACCOUNT,
    async handle(interaction, parsed) {
        const { member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanCreateOrderPayment)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        const accountId = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        await generatePayment(interaction, orderId, accountId);
    },
};
/**
 * Emite a cobranca no canal ONDE A EQUIPE ESTA — o mesmo comportamento de
 * `/pagamento criar`. O vendedor gera a cobranca no canal em que o cliente
 * consegue ve-la (tipicamente o ticket do atendimento).
 */
async function generatePayment(interaction, orderId, accountId) {
    const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
    // `interaction.channel` pode ser DM; o cartao da cobranca so faz sentido em
    // canal de servidor, onde o cliente consegue ver o PIX.
    const channel = interaction.channel !== null && !interaction.channel.isDMBased()
        ? interaction.channel
        : null;
    // Aceita TOPICO: e dentro do atendimento que o cliente ve o PIX.
    if (!(0, discord_1.isSendableConversation)(channel)) {
        throw new errors_1.ValidationError('Canal invalido para publicar a cobranca.', {
            userMessage: 'Nao e possivel publicar a cobranca aqui. Use o canal ou o topico do atendimento, onde o cliente ve o PIX.',
        });
    }
    const { order, payment } = await (0, OrderPaymentService_1.createOrderPayment)({
        guild,
        staff: member,
        orderId,
        accountId,
        channel,
    });
    await (0, OrderNotificationService_1.refreshOrderNotice)(guild, order);
    /*
     * O cliente precisa RECEBER a cobranca, nao ir procurar por ela: o cartao
     * publicado fica no canal em que o vendedor estava, que nem sempre e um canal
     * que o cliente enxerga. A DM leva o QR e o copia e cola direto para ele.
     *
     * DM fechada nao invalida nada — o PIX tambem aparece em `/meus-pedidos`.
     */
    const dmSent = await (0, OrderNotificationService_1.notifyOrderCharge)(guild, order, payment);
    await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, {
        notice: `${branding_1.EMOJIS.PAYMENT} Cobranca gerada pelo sistema de pagamentos da loja e publicada neste canal.` +
            (payment.couponCodeSnapshot !== null
                ? `\nCupom \`${payment.couponCodeSnapshot}\` aplicado na cobranca.`
                : '') +
            (dmSent
                ? '\nO cliente recebeu o QR e o copia e cola por DM.'
                : '\n⚠️ Nao foi possivel enviar a DM ao cliente. Ele ainda consegue pagar por `/meus-pedidos`.'),
    }));
}
const cancelButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.CANCEL,
    async handle(interaction, parsed) {
        const { member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanCancelOrder)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        // `showModal` precisa ser a PRIMEIRA resposta da interacao.
        await interaction.showModal((0, OrderBuilders_1.buildOrderCancelModal)(orderId));
    },
};
const cancelModal = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.CANCEL_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanCancelOrder)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        const reason = (0, sanitize_1.sanitizeReason)(interaction.fields.getTextInputValue('reason'));
        await beginModalReply(interaction);
        /*
         * Cancelar o PEDIDO e cancelar a COBRANCA sao decisoes distintas — mas
         * deixar um PIX pagavel de um pedido morto seria caro. Por isso a cobranca
         * pendente e cancelada junto; cobranca ja aprovada nunca e tocada.
         */
        const current = await (0, OrderService_1.requireOrder)(guild.id, orderId);
        const chargeCancelled = await (0, OrderPaymentService_1.cancelOrderPayment)(guild, member, current, `Pedido #${(0, OrderService_1.formatOrderNumber)(current.orderNumber)} cancelado pela equipe.`);
        const order = await (0, OrderService_1.cancelOrder)(guild.id, member, orderId, reason);
        await syncDemandBoard(guild, order);
        await (0, OrderNotificationService_1.refreshOrderNotice)(guild, order);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, {
            notice: `${branding_1.EMOJIS.CLOSE} Pedido cancelado.` +
                (chargeCancelled ? '\nA cobranca pendente tambem foi cancelada.' : ''),
        }));
    },
};
const progressButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.PROGRESS,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        const order = await (0, OrderService_1.startOrderProgress)(guild.id, member, orderId);
        await syncDemandBoard(guild, order, { started: true });
        await (0, OrderNotificationService_1.refreshOrderNotice)(guild, order);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, { notice: `${branding_1.EMOJIS.PREPARING} Pedido em preparacao.` }));
    },
};
const deliverButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.DELIVER,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanMarkOrderDelivered)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        const order = await (0, OrderService_1.deliverOrder)(guild.id, member, orderId);
        await syncDemandBoard(guild, order);
        // DM fechada NAO quebra a entrega: o aviso e best-effort.
        const dmSent = await (0, OrderNotificationService_1.notifyOrderDelivered)(guild, order);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, {
            notice: `${branding_1.EMOJIS.DELIVER} Pedido marcado como entregue.` +
                (dmSent ? '' : '\n⚠️ Nao foi possivel avisar o cliente por DM.'),
        }));
    },
};
const completeButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.COMPLETE,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        const order = await (0, OrderService_1.completeOrder)(guild.id, member, orderId);
        await syncDemandBoard(guild, order);
        await (0, OrderNotificationService_1.refreshOrderNotice)(guild, order);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, { notice: `${branding_1.EMOJIS.APPROVE} Pedido concluido.` }));
    },
};
// ---------------------------------------------------------------------------
// Painel administrativo de pedidos
// ---------------------------------------------------------------------------
function statusesForFilter(filter) {
    if (filter === OrderBuilders_1.ALL_STATUS_VALUE)
        return undefined;
    return [filter];
}
async function renderAdminOrders(interaction, guildId, filter, page) {
    const safeFilter = (0, OrderBuilders_1.isOrderStatusFilter)(filter) ? filter : OrderBuilders_1.ALL_STATUS_VALUE;
    const [result, totals] = await Promise.all([
        (0, OrderService_1.listOrdersByStatus)(guildId, statusesForFilter(safeFilter), page),
        (0, OrderService_1.getOrderTotals)(guildId),
    ]);
    await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderAdminPanel)({
        orders: result.items,
        status: safeFilter,
        page: result.page,
        totalPages: result.totalPages,
        total: result.total,
        totals,
    }));
}
const adminListButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.ADMIN_LIST,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const filter = parsed.args[0] ?? OrderBuilders_1.ALL_STATUS_VALUE;
        const page = (0, shared_1.parsePage)(parsed.args[1]);
        await (0, shared_1.beginPanel)(interaction);
        await renderAdminOrders(interaction, guild.id, filter, page);
    },
};
const adminFilterSelect = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.ADMIN_FILTER,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const filter = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        await renderAdminOrders(interaction, guild.id, filter, 1);
    },
};
const adminSelect = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.ADMIN_SELECT,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const orderId = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        await renderStaffOrder(interaction, guild.id, orderId);
    },
};
async function renderCustomerLookup(interaction, guildId, customerId, page) {
    const result = await (0, OrderService_1.listCustomerOrders)(guildId, customerId, page);
    await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderCustomerLookup)({
        customerId,
        orders: result.items,
        page: result.page,
        totalPages: result.totalPages,
        total: result.total,
    }));
}
/**
 * Busca por cliente (§123).
 *
 * Sem argumento abre o seletor de usuario; com `customerId` lista os pedidos
 * daquele cliente. O id vem do componente, mas nao autoriza nada: a permissao
 * de equipe e revalidada aqui e a consulta e sempre filtrada pela guild.
 */
const adminCustomerButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.ADMIN_CUSTOMER,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const customerId = parsed.args[0];
        await (0, shared_1.beginPanel)(interaction);
        if (customerId === undefined || !/^\d{17,20}$/.test(customerId)) {
            await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderCustomerPicker)());
            return;
        }
        await renderCustomerLookup(interaction, guild.id, customerId, (0, shared_1.parsePage)(parsed.args[1]));
    },
};
const adminCustomerSelect = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.ADMIN_CUSTOMER_SELECT,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        if (!interaction.isUserSelectMenu()) {
            throw new errors_1.ValidationError('Select de cliente com tipo inesperado.', {
                userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
            });
        }
        const customerId = interaction.values[0];
        if (customerId === undefined) {
            await (0, reply_1.replyError)(interaction, 'Nenhum cliente selecionado.');
            return;
        }
        await (0, shared_1.beginPanel)(interaction);
        await renderCustomerLookup(interaction, guild.id, customerId, 1);
    },
};
const searchButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.SEARCH,
    async handle(interaction) {
        const { member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        await interaction.showModal((0, OrderBuilders_1.buildOrderSearchModal)());
    },
};
const searchModal = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.SEARCH_MODAL,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const raw = interaction.fields.getTextInputValue('numero');
        const number = parseOrderNumberInput(raw);
        if (number === null) {
            await (0, reply_1.replyError)(interaction, 'Numero invalido. Use 184, VK-000184 ou #VK-000184.');
            return;
        }
        await beginModalReply(interaction);
        const order = await (0, OrderService_1.getOrderByNumber)(guild.id, number);
        if (order === null) {
            await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderNotFound)(number));
            return;
        }
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order));
    },
};
/** Aceita "184", "VK-000184" e "#VK-000184". */
function parseOrderNumberInput(raw) {
    const digits = String(raw ?? '').replace(/[^0-9]/g, '');
    if (digits.length === 0)
        return null;
    const value = Number.parseInt(digits, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}
/** Modal enviado de um painel efemero mantem a mesma mensagem. */
async function beginModalReply(interaction) {
    if (interaction.deferred || interaction.replied)
        return;
    if (interaction.isFromMessage()) {
        await interaction.deferUpdate();
        return;
    }
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
}
/** Historico aberto por comando (`/meus-pedidos`). */
async function renderCustomerOrdersForCommand(interaction, guildId, customerId, page) {
    await renderCustomerList(interaction, guildId, customerId, page);
}
/** Painel da equipe aberto por comando (`/pedidos gerenciar`). */
async function renderAdminOrdersForCommand(interaction, guildId, filter, page) {
    await renderAdminOrders(interaction, guildId, filter, page);
}
/** Pedidos de um cliente, abertos por comando (`/pedidos buscar cliente:`). */
async function renderCustomerLookupForCommand(interaction, guildId, customerId, page) {
    await renderCustomerLookup(interaction, guildId, customerId, page);
}
/** Pedido especifico aberto por comando (`/pedidos buscar`). */
async function renderStaffOrderForCommand(interaction, guildId, orderId) {
    await renderStaffOrder(interaction, guildId, orderId);
}
// ---------------------------------------------------------------------------
// Demandas (fila de producao)
// ---------------------------------------------------------------------------
/**
 * Demandas por pagina da fila.
 *
 * A tela e para varrer, nao para paginar: vinte linhas cabem no orcamento de
 * texto e cobrem qualquer dia realista desta loja. O total real vai no
 * cabecalho, entao o corte nunca esconde o tamanho da fila.
 */
const QUEUE_PAGE = 20;
function assigneeFilterFor(view, viewerId) {
    if (view === 'all')
        return undefined;
    if (view === 'free')
        return null;
    return viewerId;
}
/** Recorte vindo do customId; valor desconhecido cai em "todas", nunca em erro. */
function queueViewFrom(parsed) {
    const raw = parsed.args[0];
    return (0, OrderBuilders_1.isQueueView)(raw) ? raw : 'all';
}
async function renderQueue(interaction, guildId, viewerId, view, notice) {
    const [orders, stats] = await Promise.all([
        (0, OrderRepository_1.listProductionQueue)(guildId, QUEUE_PAGE, assigneeFilterFor(view, viewerId)),
        (0, OrderRepository_1.getProductionQueueStats)(guildId),
    ]);
    await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildProductionQueue)({
        orders,
        stats,
        view,
        viewerId,
        ...(notice !== undefined ? { notice } : {}),
    }));
}
function claimedNotice(result) {
    return (`${branding_1.EMOJIS.CLAIM} Demanda assumida por voce` +
        (result.started ? ' e colocada em preparacao.' : '.'));
}
const queueButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.QUEUE,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        await (0, shared_1.beginPanel)(interaction);
        await renderQueue(interaction, guild.id, member.id, queueViewFrom(parsed));
    },
};
/**
 * Pegar a proxima demanda livre — a que vence primeiro.
 *
 * Quem clica nao escolhe: a fila escolhe. E isso que impede a demanda chata de
 * ficar para tras enquanto as faceis sao pegas.
 */
const queueNextButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.QUEUE_NEXT,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        await (0, shared_1.beginPanel)(interaction);
        const result = await (0, OrderService_1.claimNextOrder)(guild.id, member);
        if (result === null) {
            await renderQueue(interaction, guild.id, member.id, queueViewFrom(parsed), `${branding_1.EMOJIS.INFO} Nenhuma demanda livre agora: tudo que esta em producao ja tem responsavel.`);
            return;
        }
        if (result.started)
            await (0, OrderNotificationService_1.refreshOrderNotice)(guild, result.order);
        await syncDemandBoard(guild, result.order, { started: result.started });
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(result.order, { notice: claimedNotice(result) }));
    },
};
const claimButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.CLAIM,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        const result = await (0, OrderService_1.claimOrder)(guild.id, member, orderId);
        await syncDemandBoard(guild, result.order, { started: result.started });
        if (result.started)
            await (0, OrderNotificationService_1.refreshOrderNotice)(guild, result.order);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(result.order, { notice: claimedNotice(result) }));
    },
};
const releaseButton = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.RELEASE,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        await (0, shared_1.beginPanel)(interaction);
        const order = await (0, OrderService_1.releaseOrder)(guild.id, member, orderId);
        await syncDemandBoard(guild, order);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, {
            notice: `${branding_1.EMOJIS.BACK} Demanda devolvida a fila, sem responsavel.`,
        }));
    },
};
/**
 * Entregar a demanda a alguem da equipe.
 *
 * O select de usuario do Discord oferece o servidor inteiro, entao quem pode
 * RECEBER e conferido aqui, com o membro real: precisa estar no servidor, nao
 * ser bot e ter a permissao de equipe. Sem isso uma demanda iria parar com um
 * cliente — e sumiria da vista de todo mundo que trabalha.
 */
const assignSelect = {
    namespace: customIds_1.NAMESPACE.ORDER,
    action: customIds_1.ORDER_ACTION.ASSIGN,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanManageOrders)(member);
        const orderId = (0, customIds_1.requireArg)(parsed, 0, 'pedido');
        if (!interaction.isUserSelectMenu()) {
            throw new errors_1.ValidationError('Select de responsavel com tipo inesperado.', {
                userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
            });
        }
        const targetId = interaction.values[0];
        if (targetId === undefined) {
            await (0, reply_1.replyError)(interaction, 'Nenhum membro selecionado.');
            return;
        }
        await (0, shared_1.beginPanel)(interaction);
        const target = await (0, discord_1.fetchMemberSafe)(guild, targetId);
        if (target === null) {
            throw new errors_1.ValidationError('Responsavel escolhido fora do servidor.', {
                userMessage: 'Este membro nao esta mais no servidor.',
            });
        }
        if (target.user.bot) {
            throw new errors_1.ValidationError('Bot escolhido como responsavel.', {
                userMessage: 'Bot nao produz pedido. Escolha alguem da equipe.',
            });
        }
        if (!(await (0, PermissionService_1.canManageOrders)(target))) {
            throw new errors_1.ValidationError('Responsavel escolhido fora da equipe.', {
                userMessage: `${(0, discord_1.userMention)(target.id)} nao e da equipe da loja, entao nao pode receber demanda.`,
            });
        }
        const order = await (0, OrderService_1.assignOrderTo)(guild.id, member, orderId, target.id);
        await syncDemandBoard(guild, order);
        await (0, shared_1.showPanel)(interaction, (0, OrderBuilders_1.buildOrderStaffView)(order, {
            notice: `${branding_1.EMOJIS.TRANSFER} Demanda atribuida a ${(0, discord_1.userMention)(target.id)}.`,
        }));
    },
};
/** Fila de demandas aberta por comando (`/pedidos fila`). */
async function renderProductionQueueForCommand(interaction, guildId, viewerId, view) {
    await renderQueue(interaction, guildId, viewerId, view);
}
exports.orderButtons = [
    listButton,
    viewButton,
    staffButton,
    couponButton,
    paymentButton,
    cancelButton,
    progressButton,
    deliverButton,
    completeButton,
    adminListButton,
    adminCustomerButton,
    searchButton,
    queueButton,
    queueNextButton,
    claimButton,
    releaseButton,
];
exports.orderSelects = [
    listSelect,
    couponSelect,
    paymentAccountSelect,
    adminFilterSelect,
    adminSelect,
    adminCustomerSelect,
    assignSelect,
];
exports.orderModals = [cancelModal, searchModal];
//# sourceMappingURL=index.js.map