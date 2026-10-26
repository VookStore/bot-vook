"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrderPayment = createOrderPayment;
exports.cancelOrderPayment = cancelOrderPayment;
exports.listPaymentAccountsForOrder = listPaymentAccountsForOrder;
exports.registerOrderPaymentListeners = registerOrderPaymentListeners;
exports.resetOrderPaymentListeners = resetOrderPaymentListeners;
exports.describePaymentState = describePaymentState;
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const PaymentEvents_1 = require("../../../core/events/PaymentEvents");
const Logger_1 = require("../../../core/logger/Logger");
const LockService_1 = require("../../../core/locks/LockService");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
const PaymentRepository_1 = require("../../payments/repositories/PaymentRepository");
const OrderRepository_1 = require("../repositories/OrderRepository");
const PaymentAccountService_1 = require("../../payments/services/PaymentAccountService");
const PaymentCardService_1 = require("../../payments/services/PaymentCardService");
const PaymentService_1 = require("../../payments/services/PaymentService");
const OrderService_1 = require("./OrderService");
/**
 * PONTE entre o pedido e o modulo central de pagamentos.
 *
 * REGRA ABSOLUTA: este arquivo NAO cobra nada. Ele apenas traduz "pedido" para
 * os parametros que o `PaymentService` — o mesmo usado por `/pagamento criar` —
 * ja sabe processar: cliente, valor, descricao, conta e cupom.
 *
 * Consequencia direta: qualquer provider configurado no modulo central
 * (PIX manual hoje, outro amanha) passa a valer para o catalogo sem uma linha a
 * mais aqui — nao existe configuracao financeira propria do catalogo.
 */
const logger = (0, Logger_1.createLogger)('order:payment');
/**
 * Gera a cobranca do pedido.
 *
 * Sequencia: valida o pedido -> escolhe a conta -> `PaymentService.createCharge`
 * (que precifica, aplica o cupom e emite o PIX) -> publica o cartao -> vincula
 * a cobranca ao pedido. Se qualquer passo depois da emissao falhar, a cobranca
 * e cancelada: melhor nenhum PIX do que um PIX orfao que o cliente pode pagar.
 */
async function createOrderPayment(params) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.ORDER_ACTION, params.orderId, async () => {
        const guildId = params.guild.id;
        const order = await (0, OrderService_1.requireOrder)(guildId, params.orderId);
        if (!(0, OrderService_1.isFinanciallyOpen)(order)) {
            throw new errors_1.ValidationError(`Pedido nao aceita cobranca: ${order.status}`, {
                userMessage: 'Este pedido nao esta mais aguardando pagamento. Nenhuma cobranca nova pode ser gerada.',
            });
        }
        if (order.payment !== null && order.payment.status === client_1.PaymentStatus.PENDING) {
            throw new errors_1.ValidationError(`Pedido ja possui cobranca pendente: ${order.payment.id}`, {
                userMessage: 'Este pedido ja possui uma cobranca pendente. Cancele-a antes de gerar outra.',
            });
        }
        /*
         * Consistencia antes de cobrar: numa compra do catalogo o subtotal tem de
         * bater com a soma dos snapshots. Divergencia ali significa dado
         * corrompido — e cobrar por cima disso seria cobrar um valor que ninguem
         * combinou.
         *
         * Pedido de VENDA AVULSA nao tem item para conferir: ele nasce da
         * cobranca que o vendedor digitou, e o subtotal ja E o valor combinado.
         * Sem esta excecao, reemitir a cobranca de uma venda de balcao — a
         * primeira expirou, o cliente ainda quer pagar — era impossivel pelo
         * painel do pedido.
         */
        if (order.items.length > 0) {
            const snapshotTotal = order.items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
            if (snapshotTotal !== order.subtotalAmount) {
                throw new errors_1.ValidationError(`Subtotal divergente no pedido ${order.id}: ${order.subtotalAmount} != ${snapshotTotal}`, {
                    userMessage: 'Os valores deste pedido estao inconsistentes. Cancele-o e peca ao cliente para refazer a compra.',
                });
            }
        }
        if (order.subtotalAmount < limits_1.BUSINESS_LIMITS.PAYMENT_MIN_CENTS) {
            throw new errors_1.ValidationError(`Pedido com total invalido: ${order.subtotalAmount}`, {
                userMessage: 'O total deste pedido e invalido para uma cobranca.',
            });
        }
        const account = await resolveAccount(guildId, params.accountId);
        const description = (0, sanitize_1.truncate)(`Pedido #${(0, OrderService_1.formatOrderNumber)(order.orderNumber)} — ${describeItems(order)}`, limits_1.BUSINESS_LIMITS.PAYMENT_DESCRIPTION_MAX);
        // AQUI mora toda a regra financeira — no modulo central, nao neste arquivo.
        const payment = await (0, PaymentService_1.createCharge)({
            guild: params.guild,
            createdBy: params.staff,
            customerId: order.customerId,
            accountId: account.id,
            description,
            amountCents: order.subtotalAmount,
            couponId: order.couponId,
            channelId: params.channel.id,
            source: { type: client_1.PaymentSource.CATALOG_ORDER, id: order.id },
        });
        try {
            await (0, PaymentCardService_1.publishPaymentCard)(params.channel, payment);
            const updated = await (0, OrderService_1.linkPaymentToOrder)(guildId, params.staff.id, order.id, payment);
            logger.info('Cobranca do pedido gerada pelo modulo central de pagamentos.', {
                guildId,
                userId: params.staff.id,
                entityType: 'order',
                entityId: order.id,
                paymentId: payment.id,
                finalAmount: payment.finalAmount,
            });
            return { order: updated, payment };
        }
        catch (error) {
            await rollbackCharge(params.guild, payment, params.staff.id);
            throw error;
        }
    }, { userMessage: 'Este pedido ja esta sendo processado. Aguarde alguns segundos.' });
}
/**
 * Desfaz uma cobranca que nao pode ser entregue ao cliente.
 * Sem isso a cobranca ficaria PENDING e invisivel — contando como pendente ate
 * expirar e, pior, pagavel se o cartao tiver chegado a aparecer.
 */
async function rollbackCharge(guild, payment, staffId) {
    await (0, PaymentRepository_1.cancelPaymentAtomic)(payment.id, staffId, 'Falha ao vincular a cobranca ao pedido do catalogo.').catch(() => undefined);
    const updated = await (0, PaymentRepository_1.findPaymentById)(payment.id).catch(() => null);
    if (updated !== null) {
        await (0, PaymentCardService_1.refreshPaymentCard)(guild, updated).catch(() => undefined);
    }
}
function describeItems(order) {
    const first = order.items[0];
    // Pedido sem item e venda avulsa (nasceu de `/pagamento criar`): nao existe
    // pack para nomear, e repetir a descricao da cobranca antiga acabaria
    // aninhando "Pedido #... — Pedido #..." a cada reemissao.
    if (first === undefined)
        return 'Venda avulsa';
    if (order.items.length === 1)
        return first.nameSnapshot;
    return `${first.nameSnapshot} +${order.items.length - 1}`;
}
/** Conta PIX do pedido: a escolhida pelo vendedor ou a padrao ativa da loja. */
async function resolveAccount(guildId, accountId) {
    if (accountId !== null) {
        const account = await (0, PaymentAccountService_1.getAccountById)(guildId, accountId);
        if (account === null || account.deletedAt !== null || !account.enabled) {
            throw new errors_1.ValidationError(`Conta PIX indisponivel: ${accountId}`, {
                userMessage: 'Esta conta PIX nao esta mais disponivel. Escolha outra.',
            });
        }
        return account;
    }
    const enabled = await (0, PaymentAccountService_1.getEnabledAccounts)(guildId);
    const first = enabled[0];
    if (first === undefined) {
        throw new errors_1.ConfigurationError('Nenhuma conta PIX ativa para cobrar o pedido.', {
            userMessage: 'Nenhuma conta PIX ativa foi encontrada. Cadastre uma em `/config-pagamento gerenciar`.',
            context: { guildId },
        });
    }
    return first;
}
/**
 * Cancela a cobranca PENDENTE de um pedido.
 * Usado quando a equipe cancela o pedido: cobranca e pedido sao coisas
 * diferentes, mas deixar um PIX pagavel de um pedido morto seria um bug caro.
 */
async function cancelOrderPayment(guild, staff, order, reason) {
    if (order.payment === null || order.payment.status !== client_1.PaymentStatus.PENDING)
        return false;
    const cancelled = await (0, PaymentService_1.cancelPayment)(guild.id, staff, order.payment.id, reason);
    await (0, PaymentCardService_1.refreshPaymentCard)(guild, cancelled).catch(() => undefined);
    return true;
}
/** Contas ativas para o seletor do painel comercial. */
async function listPaymentAccountsForOrder(guildId) {
    return (0, PaymentAccountService_1.getEnabledAccounts)(guildId);
}
let paidHandler = null;
let chargeClosedHandler = null;
let registered = false;
/**
 * Liga o pedido ao ciclo de vida da cobranca.
 *
 * NAO existe webhook proprio do catalogo, nem polling: quem descobre a
 * aprovacao e o modulo central (aprovacao manual hoje, provider automatico
 * amanha) e apenas ANUNCIA. Aqui so traduzimos o anuncio para o pedido.
 *
 * Idempotente por construcao: `syncOrderPaid` usa update condicional, entao um
 * evento repetido nao gera efeito nem notificacao duplicada.
 */
function registerOrderPaymentListeners(handlers = {}) {
    if (handlers.onPaid !== undefined)
        paidHandler = handlers.onPaid;
    if (handlers.onChargeClosed !== undefined)
        chargeClosedHandler = handlers.onChargeClosed;
    if (registered)
        return;
    registered = true;
    /*
     * Pedido -> cartao da cobranca.
     *
     * O modulo de pagamentos nao pode importar catalogo (senao o catalogo deixa
     * de ser substituivel), entao e o catalogo que se apresenta: ensina o cartao
     * a estampar `VK-000185` sem que o outro lado saiba o que e um pedido.
     */
    (0, PaymentCardService_1.registerOrderLabelResolver)(async (payment) => {
        const orderId = (0, PaymentService_1.linkedOrderId)(payment);
        if (orderId === null)
            return null;
        const order = await (0, OrderRepository_1.findOrderById)(orderId);
        return order === null ? null : (0, OrderService_1.formatOrderNumber)(order.orderNumber);
    });
    (0, PaymentEvents_1.onPaymentEvent)('approved', async ({ payment }) => {
        // Vale para as duas origens: o que decide e a cobranca ter pedido, nao ele
        // ter vindo do catalogo. Venda avulsa aprovada tambem marca o pedido pago.
        if ((0, PaymentService_1.linkedOrderId)(payment) === null)
            return;
        const order = await (0, OrderService_1.syncOrderPaid)(payment);
        if (order === null)
            return;
        if (paidHandler !== null)
            await paidHandler(order, payment);
    });
    /*
     * Expirou ou foi cancelada: o pedido NAO morre junto — ele volta a esperar
     * uma cobranca nova. Mas os dois lados precisam ser avisados, senao o cliente
     * fica com um QR morto na DM e a equipe nao descobre que precisa emitir outro.
     */
    const announceClosed = async (payment) => {
        if ((0, PaymentService_1.linkedOrderId)(payment) === null)
            return;
        const order = await (0, OrderService_1.syncOrderPaymentClosed)(payment);
        if (order === null)
            return;
        if (chargeClosedHandler !== null)
            await chargeClosedHandler(order, payment);
    };
    (0, PaymentEvents_1.onPaymentEvent)('expired', ({ payment }) => announceClosed(payment));
    (0, PaymentEvents_1.onPaymentEvent)('cancelled', ({ payment }) => announceClosed(payment));
    logger.info('Sincronizacao pedido <- pagamento registrada.');
}
/** Somente para testes. */
function resetOrderPaymentListeners() {
    registered = false;
    paidHandler = null;
    chargeClosedHandler = null;
}
/** Texto curto do estado da cobranca para o painel do pedido. */
function describePaymentState(payment) {
    if (payment === null)
        return 'Nenhuma cobranca gerada.';
    switch (payment.status) {
        case client_1.PaymentStatus.PENDING:
            return `Cobranca pendente de ${(0, money_1.formatCents)(payment.finalAmount)}.`;
        case client_1.PaymentStatus.APPROVED:
            return `Cobranca aprovada de ${(0, money_1.formatCents)(payment.finalAmount)}.`;
        case client_1.PaymentStatus.EXPIRED:
            return 'Cobranca expirada. Gere uma nova cobranca.';
        case client_1.PaymentStatus.CANCELLED:
            return 'Cobranca cancelada. Gere uma nova cobranca.';
        default:
            return String(payment.status);
    }
}
//# sourceMappingURL=OrderPaymentService.js.map