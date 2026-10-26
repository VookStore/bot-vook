"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatOrderNumber = formatOrderNumber;
exports.describeOrderStatus = describeOrderStatus;
exports.orderStatusIcon = orderStatusIcon;
exports.isFinanciallyOpen = isFinanciallyOpen;
exports.getOrder = getOrder;
exports.requireOrder = requireOrder;
exports.requireCustomerOrder = requireCustomerOrder;
exports.toOrderView = toOrderView;
exports.getOrderByNumber = getOrderByNumber;
exports.listCustomerOrders = listCustomerOrders;
exports.listOrdersByStatus = listOrdersByStatus;
exports.getOrderTotals = getOrderTotals;
exports.createOrderForPack = createOrderForPack;
exports.checkoutCart = checkoutCart;
exports.createOrderForCharge = createOrderForCharge;
exports.discardOrderForFailedCharge = discardOrderForFailedCharge;
exports.applyOrderCoupon = applyOrderCoupon;
exports.priceOrder = priceOrder;
exports.linkPaymentToOrder = linkPaymentToOrder;
exports.syncOrderPaid = syncOrderPaid;
exports.syncOrderPaymentClosed = syncOrderPaymentClosed;
exports.startOrderProgress = startOrderProgress;
exports.claimOrder = claimOrder;
exports.releaseOrder = releaseOrder;
exports.assignOrderTo = assignOrderTo;
exports.claimNextOrder = claimNextOrder;
exports.deliverOrder = deliverOrder;
exports.completeOrder = completeOrder;
exports.cancelOrder = cancelOrder;
exports.closeCartAfterCheckout = closeCartAfterCheckout;
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const prisma_1 = require("../../../core/database/prisma");
const LockService_1 = require("../../../core/locks/LockService");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const money_1 = require("../../../utils/money");
const CouponService_1 = require("../../coupons/services/CouponService");
const DeliveryEstimateService_1 = require("./DeliveryEstimateService");
const CatalogAuditRepository_1 = require("../repositories/CatalogAuditRepository");
const OrderRepository_1 = require("../repositories/OrderRepository");
const CartService_1 = require("./CartService");
const CatalogService_1 = require("./CatalogService");
/**
 * Pedidos do catalogo.
 *
 * REGRA ARQUITETURAL DO MODULO
 *   CATALOGO NAO COBRA. CATALOGO CRIA PEDIDO. O `PaymentService` COBRA.
 * Nada aqui gera PIX, fala com provider ou calcula cobranca por conta propria:
 * o preco final e sempre o que o modulo central de pagamentos determinar.
 *
 * SNAPSHOT: cada `OrderItem` guarda nome, SKU e preco do momento da compra.
 * Mudar o preco do pack amanha nao reescreve o pedido de hoje.
 *
 * CUPOM: o cliente nunca escolhe nem digita cupom. Quem aplica e o vendedor,
 * pelo painel comercial, usando a validacao do modulo central de cupons.
 */
const logger = (0, Logger_1.createLogger)('order');
const ORDER_BUSY_MESSAGE = 'Este pedido esta sendo processado. Aguarde alguns segundos.';
/** Numero visivel do pedido: `VK-000184`. */
function formatOrderNumber(orderNumber) {
    return `VK-${String(Math.max(0, Math.trunc(orderNumber))).padStart(6, '0')}`;
}
function describeOrderStatus(status) {
    switch (status) {
        case client_1.OrderStatus.PENDING:
            return 'Aguardando vendedor';
        case client_1.OrderStatus.AWAITING_PAYMENT:
            return 'Aguardando pagamento';
        case client_1.OrderStatus.PAID:
            return 'Pago — preparando entrega';
        case client_1.OrderStatus.IN_PROGRESS:
            return 'Em preparacao';
        case client_1.OrderStatus.DELIVERED:
            return 'Entregue';
        case client_1.OrderStatus.COMPLETED:
            return 'Concluido';
        case client_1.OrderStatus.CANCELLED:
            return 'Cancelado';
        default:
            return String(status);
    }
}
function orderStatusIcon(status) {
    switch (status) {
        case client_1.OrderStatus.PAID:
            return '🟢';
        case client_1.OrderStatus.IN_PROGRESS:
            return '🛠️';
        case client_1.OrderStatus.DELIVERED:
            return '📦';
        case client_1.OrderStatus.COMPLETED:
            return '✅';
        case client_1.OrderStatus.CANCELLED:
            return '❌';
        default:
            return '🟡';
    }
}
/** True quando o pedido ainda aceita mudanca de valores (cupom, cobranca). */
function isFinanciallyOpen(order) {
    return order.status === client_1.OrderStatus.PENDING || order.status === client_1.OrderStatus.AWAITING_PAYMENT;
}
// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
/** Pedido da guild pelo id. `null` quando nao existe ou e de outra guild. */
async function getOrder(guildId, orderId) {
    const order = await (0, OrderRepository_1.findOrderById)(orderId);
    if (order === null || order.guildId !== guildId)
        return null;
    return order;
}
async function requireOrder(guildId, orderId) {
    const order = await getOrder(guildId, orderId);
    if (order === null) {
        throw new errors_1.ValidationError(`Pedido inexistente: ${orderId}`, {
            userMessage: 'Este pedido nao foi encontrado.',
            context: { guildId, entityType: 'order', entityId: orderId },
        });
    }
    return order;
}
/**
 * Pedido de um CLIENTE especifico.
 *
 * O id vem de um customId, que nao autoriza nada: sem esta checagem, trocar o
 * id na mao daria acesso ao pedido de outra pessoa.
 */
async function requireCustomerOrder(guildId, customerId, orderId) {
    const order = await requireOrder(guildId, orderId);
    if (order.customerId !== customerId) {
        throw new errors_1.ValidationError(`Pedido de outro cliente: ${orderId}`, {
            userMessage: 'Este pedido nao pertence a voce.',
            context: { guildId, entityType: 'order', entityId: orderId, userId: customerId },
        });
    }
    return order;
}
function toOrderView(order) {
    return { order, items: order.items, payment: order.payment };
}
async function getOrderByNumber(guildId, orderNumber) {
    return (0, OrderRepository_1.findOrderByNumber)(guildId, orderNumber);
}
async function listCustomerOrders(guildId, customerId, page) {
    return paginateOrders(guildId, { customerId }, page);
}
async function listOrdersByStatus(guildId, statuses, page) {
    return paginateOrders(guildId, statuses === undefined ? {} : { statuses }, page);
}
async function paginateOrders(guildId, filter, page) {
    const size = limits_1.BUSINESS_LIMITS.ORDER_PAGE_SIZE;
    const total = await (0, OrderRepository_1.countOrders)(guildId, filter);
    const totalPages = Math.max(1, Math.ceil(total / size));
    const safePage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
    const items = await (0, OrderRepository_1.listOrders)(guildId, {
        ...filter,
        skip: (safePage - 1) * size,
        take: size,
    });
    return { items, page: safePage, totalPages, total };
}
async function getOrderTotals(guildId) {
    return (0, OrderRepository_1.countOrdersByStatus)(guildId);
}
/** Snapshot de um pack no momento da compra. */
function toOrderItem(pack) {
    return {
        packId: pack.id,
        skuSnapshot: pack.sku,
        nameSnapshot: pack.name,
        priceSnapshot: pack.price,
        quantity: 1,
    };
}
/** Itens e subtotal de uma compra do catalogo. */
function fromPacks(packs) {
    const items = packs.map(toOrderItem);
    return {
        items,
        subtotalAmount: items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0),
    };
}
/**
 * Cria o pedido a partir de uma lista de packs JA revalidada.
 *
 * Tudo em UMA transacao: reserva do numero, pedido, itens e (quando houver)
 * encerramento do carrinho. Se qualquer passo falhar, nada sobra pela metade.
 * Operacoes do Discord ficam FORA — elas nao participam da transacao.
 */
async function persistOrder(params) {
    return (0, prisma_1.getPrisma)().$transaction(async (tx) => {
        if (params.cartId !== null) {
            // Encerrar o carrinho e CONDICIONAL ao status ATIVO. Perder essa corrida
            // significa que outro clique ja fechou este carrinho: aborta tudo.
            const closed = await finishCartInTransaction(params.cartId, tx);
            if (!closed) {
                throw new errors_1.ValidationError(`Carrinho ja finalizado: ${params.cartId}`, {
                    userMessage: 'Este carrinho ja foi finalizado. Confira seus pedidos.',
                });
            }
        }
        const orderNumber = await (0, OrderRepository_1.reserveOrderNumber)(params.guildId, tx);
        return (0, OrderRepository_1.createOrder)({
            guildId: params.guildId,
            orderNumber,
            customerId: params.customerId,
            channelId: params.channelId,
            subtotalAmount: params.subtotalAmount,
            items: params.items,
        }, tx);
    });
}
/**
 * `finishCart` dentro da transacao do pedido (mesmo update condicional).
 * Precisa rodar no MESMO `tx` do pedido: se a criacao falhar, o carrinho
 * volta a existir para o cliente tentar de novo.
 */
async function finishCartInTransaction(cartId, tx) {
    const result = await tx.cart.updateMany({
        where: { id: cartId, status: client_1.CartStatus.ACTIVE },
        data: { status: client_1.CartStatus.CHECKED_OUT, activeCustomerId: null },
    });
    return result.count === 1;
}
/**
 * "Comprar Agora": um unico pack, sem passar pelo carrinho.
 *
 * O lock e por cliente e o banco confere duplicata recente: duplo clique nao
 * gera dois pedidos iguais, nem mesmo depois de um restart do processo.
 */
async function createOrderForPack(params) {
    const pack = await (0, CatalogService_1.getSellablePack)(params.guildId, params.packId);
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.ORDER_CREATE, `${params.guildId}:${params.customerId}`, async () => {
        const duplicate = await (0, OrderRepository_1.findRecentDuplicateOrder)(params.guildId, params.customerId, [pack.id], new Date(Date.now() - limits_1.BUSINESS_LIMITS.ORDER_DUPLICATE_WINDOW_MS));
        if (duplicate !== null)
            return { order: duplicate, duplicated: true };
        const order = await persistOrder({
            guildId: params.guildId,
            customerId: params.customerId,
            channelId: params.channelId,
            ...fromPacks([pack]),
            cartId: null,
        });
        await auditCreation(order, 'buy-now');
        return { order, duplicated: false };
    }, { userMessage: 'Seu pedido ja esta sendo criado. Aguarde alguns segundos.' });
}
/**
 * Checkout do carrinho.
 *
 * REVALIDA tudo no momento do fechamento (o item pode estar no carrinho ha
 * horas): produto existe, esta ativo, categoria ativa e preco valido. O preco
 * vinculante e capturado AGORA, na criacao do pedido.
 */
async function checkoutCart(params) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.ORDER_CREATE, `${params.guildId}:${params.customerId}`, async () => {
        const view = await (0, CartService_1.getCartView)(params.guildId, params.customerId);
        if (view.cart === null || view.lines.length === 0) {
            throw new errors_1.ValidationError('Carrinho vazio no checkout.', {
                userMessage: 'Seu carrinho esta vazio. Adicione um pack antes de finalizar.',
            });
        }
        const sellable = view.lines.filter((line) => !line.unavailable);
        if (sellable.length === 0) {
            throw new errors_1.ValidationError('Carrinho sem itens vendaveis.', {
                userMessage: 'Nenhum item do seu carrinho esta disponivel para compra. Remova os itens indisponiveis.',
            });
        }
        if (sellable.length !== view.lines.length) {
            throw new errors_1.ValidationError('Carrinho com itens indisponiveis.', {
                userMessage: 'Alguns itens do seu carrinho ficaram indisponiveis. Remova-os antes de finalizar a compra.',
            });
        }
        if (sellable.length > limits_1.BUSINESS_LIMITS.MAX_ORDER_ITEMS) {
            throw new errors_1.ValidationError(`Pedido com itens demais: ${sellable.length}`, {
                userMessage: `Um pedido aceita no maximo ${limits_1.BUSINESS_LIMITS.MAX_ORDER_ITEMS} itens.`,
            });
        }
        // Revalidacao final item a item, contra o banco (nao contra o cache).
        const packs = [];
        for (const line of sellable) {
            packs.push(await (0, CatalogService_1.getSellablePack)(params.guildId, line.pack.id));
        }
        const duplicate = await (0, OrderRepository_1.findRecentDuplicateOrder)(params.guildId, params.customerId, packs.map((pack) => pack.id), new Date(Date.now() - limits_1.BUSINESS_LIMITS.ORDER_DUPLICATE_WINDOW_MS));
        if (duplicate !== null) {
            // O carrinho ja foi encerrado pelo pedido anterior; nada a fazer.
            return { order: duplicate, duplicated: true };
        }
        /*
         * O inicio do checkout e registrado no log estruturado, nao em
         * `OrderAuditLog`: aquela tabela tem FK obrigatoria para um pedido, e
         * neste ponto o pedido ainda nao existe. Assim que ele nasce, o evento
         * ORDER_CREATED entra na auditoria com a origem ("cart").
         */
        logCheckoutStarted(params.guildId, params.customerId, view.cart.id, packs.length);
        const order = await persistOrder({
            guildId: params.guildId,
            customerId: params.customerId,
            channelId: params.channelId,
            ...fromPacks(packs),
            cartId: view.cart.id,
        });
        await auditCreation(order, 'cart');
        return { order, duplicated: false };
    }, { userMessage: 'Sua compra ja esta sendo finalizada. Aguarde alguns segundos.' });
}
/**
 * Pedido de uma venda avulsa (`/pagamento criar`).
 *
 * POR QUE TODA COBRANCA VIRA PEDIDO: comprovante, historico do cliente e
 * status de entrega moram no PEDIDO. Enquanto a venda feita no ticket nao
 * tinha pedido, ela ficava fora dos tres — o cliente pagava e nao tinha onde
 * anexar o comprovante, e a venda nao aparecia em `/meus-pedidos` nem no painel
 * comercial. Agora o numero `VK-` existe para toda cobranca, seja ela do
 * catalogo ou do balcao.
 *
 * SEM ITENS de proposito: nao existe pack no catalogo para fotografar. O valor
 * vinculante e o subtotal, que vem da propria cobranca, e a descricao do que
 * foi vendido continua vivendo na cobranca (o painel do pedido a exibe no lugar
 * da lista de itens).
 *
 * Quem cria e a EQUIPE, entao a auditoria registra o vendedor — nao o cliente,
 * como nas compras que o proprio cliente fecha.
 */
async function createOrderForCharge(params) {
    if (params.amountCents < limits_1.BUSINESS_LIMITS.PAYMENT_MIN_CENTS) {
        throw new errors_1.ValidationError(`Valor invalido para pedido avulso: ${params.amountCents}`, {
            userMessage: 'O valor desta cobranca e invalido.',
        });
    }
    const order = await persistOrder({
        guildId: params.guildId,
        customerId: params.customerId,
        channelId: params.channelId,
        items: [],
        subtotalAmount: params.amountCents,
        cartId: null,
    });
    await auditCreation(order, 'charge', params.staffId);
    return order;
}
/**
 * Descarta o pedido que nasceu para uma cobranca que nao chegou a existir.
 *
 * O pedido precisa vir ANTES da cobranca (e dele que sai o numero estampado no
 * cartao), entao uma conta PIX desativada entre o rascunho e o clique deixaria
 * um pedido "aguardando vendedor" fantasma na fila comercial a cada tentativa.
 *
 * Nao lanca: e limpeza de um caminho que ja esta falhando, e o erro que
 * interessa ao vendedor e o da cobranca.
 */
async function discardOrderForFailedCharge(orderId, staffId) {
    await (0, OrderRepository_1.markOrderCancelled)(orderId, staffId, 'A cobranca deste pedido nao pode ser gerada.').catch(() => undefined);
}
function logCheckoutStarted(guildId, customerId, cartId, itemCount) {
    logger.info('Checkout iniciado.', {
        guildId,
        userId: customerId,
        entityType: 'cart',
        entityId: cartId,
        items: itemCount,
    });
}
async function auditCreation(order, origin, actorId = order.customerId) {
    await (0, CatalogAuditRepository_1.recordOrderAudit)({
        guildId: order.guildId,
        orderId: order.id,
        action: client_1.OrderAuditAction.ORDER_CREATED,
        performedById: actorId,
        newValue: (0, money_1.formatCents)(order.subtotalAmount),
        metadata: {
            origin,
            orderNumber: order.orderNumber,
            items: order.items.map((item) => item.nameSnapshot),
        },
    });
    logger.info('Pedido criado.', {
        guildId: order.guildId,
        userId: actorId,
        entityType: 'order',
        entityId: order.id,
        orderNumber: order.orderNumber,
        subtotal: order.subtotalAmount,
    });
}
/**
 * Aplica (ou remove) o cupom do pedido.
 *
 * A validacao e a MESMA de `/pagamento`: `validateCouponForPayment` confere
 * validade, valor minimo e limites de uso lendo o banco na hora. O calculo do
 * desconto vem do CouponCalculator central — nada e reimplementado aqui.
 *
 * O valor gravado no pedido e uma PREVIA comercial: a palavra final sobre o
 * quanto sera cobrado continua sendo do `PaymentService`, na emissao.
 */
async function applyOrderCoupon(guildId, staff, orderId, couponId) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.ORDER_ACTION, orderId, async () => {
        const order = await requireOrder(guildId, orderId);
        if (!isFinanciallyOpen(order)) {
            throw new errors_1.ValidationError(`Pedido nao aceita mais cupom: ${order.status}`, {
                userMessage: 'Este pedido ja esta pago ou encerrado. Valores de pedido pago sao historicos.',
            });
        }
        if (order.payment !== null && order.payment.status === client_1.PaymentStatus.PENDING) {
            throw new errors_1.ValidationError('Pedido com cobranca pendente.', {
                userMessage: 'Ja existe uma cobranca pendente para este pedido. Altere o cupom pelo painel ' +
                    'da cobranca (`Gerenciar`) ou cancele a cobranca antes.',
            });
        }
        const pricing = await priceOrder(guildId, order.customerId, order.subtotalAmount, couponId);
        const updated = await (0, OrderRepository_1.updateOrderPricing)(orderId, pricing);
        if (!updated) {
            throw new errors_1.ValidationError('Pedido mudou de estado durante a aplicacao do cupom.', {
                userMessage: 'Este pedido acabou de mudar de estado. Atualize o painel.',
            });
        }
        await (0, CatalogAuditRepository_1.recordOrderAudit)({
            guildId,
            orderId,
            action: couponId === null
                ? client_1.OrderAuditAction.ORDER_COUPON_REMOVED
                : client_1.OrderAuditAction.ORDER_COUPON_APPLIED,
            performedById: staff.id,
            oldValue: order.couponCodeSnapshot,
            newValue: pricing.couponCodeSnapshot,
            metadata: {
                discountAmount: pricing.discountAmount,
                finalAmount: pricing.finalAmount,
            },
        });
        const reloaded = await requireOrder(guildId, orderId);
        return { order: reloaded, couponCode: pricing.couponCodeSnapshot };
    }, { userMessage: ORDER_BUSY_MESSAGE });
}
/** Calcula a previa do total do pedido usando o modulo central de cupons. */
async function priceOrder(guildId, customerId, subtotal, couponId) {
    if (couponId === null) {
        return {
            discountAmount: 0,
            finalAmount: subtotal,
            couponId: null,
            couponCodeSnapshot: null,
            couponTypeSnapshot: null,
            couponValueSnapshot: null,
        };
    }
    const { coupon, discount } = await (0, CouponService_1.validateCouponForPayment)(guildId, couponId, subtotal, customerId);
    return {
        discountAmount: discount.discountAmount,
        finalAmount: discount.finalAmount,
        couponId: coupon.id,
        couponCodeSnapshot: coupon.code,
        couponTypeSnapshot: coupon.type,
        couponValueSnapshot: coupon.value,
    };
}
/**
 * Vincula a cobranca criada pelo modulo central e move o pedido para
 * AWAITING_PAYMENT, copiando os valores EFETIVAMENTE cobrados.
 *
 * Os numeros vem do `Payment` — nunca de um calculo paralelo daqui: pedido e
 * cobranca precisam contar a mesma historia.
 */
async function linkPaymentToOrder(guildId, actorId, orderId, payment) {
    const linked = await (0, OrderRepository_1.attachPayment)(orderId, payment.id, {
        discountAmount: payment.discountAmount,
        finalAmount: payment.finalAmount,
        couponId: payment.couponId,
        couponCodeSnapshot: payment.couponCodeSnapshot,
        couponTypeSnapshot: payment.couponTypeSnapshot,
        couponValueSnapshot: payment.couponValueSnapshot,
    });
    if (!linked) {
        throw new errors_1.ValidationError(`Pedido nao aceitou a cobranca: ${orderId}`, {
            userMessage: 'Este pedido mudou de estado. Atualize o painel e tente novamente.',
        });
    }
    await (0, CatalogAuditRepository_1.recordOrderAudit)({
        guildId,
        orderId,
        action: client_1.OrderAuditAction.ORDER_PAYMENT_CREATED,
        performedById: actorId,
        newValue: (0, money_1.formatCents)(payment.finalAmount),
        metadata: {
            paymentId: payment.id,
            couponCode: payment.couponCodeSnapshot,
            discountAmount: payment.discountAmount,
        },
    });
    return requireOrder(guildId, orderId);
}
// ---------------------------------------------------------------------------
// Sincronizacao com o modulo central de pagamentos
// ---------------------------------------------------------------------------
/**
 * Cobranca APROVADA -> pedido PAGO.
 *
 * IDEMPOTENTE: o update e condicional a AWAITING_PAYMENT, entao chamar de novo
 * (webhook repetido, recovery pos-restart, clique duplo) nao faz nada. Retorna
 * o pedido apenas quando a transicao realmente aconteceu — e o que autoriza o
 * chamador a avisar o cliente uma unica vez.
 */
async function syncOrderPaid(payment) {
    const order = await (0, OrderRepository_1.findOrderByPaymentId)(payment.id);
    if (order === null)
        return null;
    if (payment.status !== client_1.PaymentStatus.APPROVED)
        return null;
    const applied = await (0, OrderRepository_1.markOrderPaid)(order.id);
    if (!applied)
        return null;
    await (0, CatalogAuditRepository_1.recordOrderAudit)({
        guildId: order.guildId,
        orderId: order.id,
        action: client_1.OrderAuditAction.ORDER_PAID,
        performedById: payment.approvedById,
        oldValue: client_1.OrderStatus.AWAITING_PAYMENT,
        newValue: client_1.OrderStatus.PAID,
        metadata: { paymentId: payment.id, finalAmount: payment.finalAmount },
    });
    /*
     * A previsao de entrega nasce AQUI, no pagamento — nao na criacao do pedido.
     * Antes de o dinheiro entrar nao ha compromisso e a producao nao comecou; um
     * pedido que passou tres dias aguardando pagamento nao pode nascer com o
     * prazo ja consumido. Melhor-esforco: falha aqui nao desfaz um pagamento.
     */
    await (0, DeliveryEstimateService_1.setDeliveryEstimate)(order);
    logger.info('Pedido marcado como pago pela cobranca aprovada.', {
        guildId: order.guildId,
        entityType: 'order',
        entityId: order.id,
        orderNumber: order.orderNumber,
        paymentId: payment.id,
    });
    return (0, OrderRepository_1.findOrderByPaymentId)(payment.id);
}
/**
 * Cobranca expirada/cancelada.
 *
 * O pedido NAO e cancelado: ele continua aguardando pagamento e a equipe pode
 * emitir uma nova cobranca. Cancelar pedido e cancelar cobranca sao decisoes
 * diferentes, e so a segunda aconteceu aqui.
 */
async function syncOrderPaymentClosed(payment) {
    const order = await (0, OrderRepository_1.findOrderByPaymentId)(payment.id);
    if (order === null)
        return null;
    if (order.status !== client_1.OrderStatus.AWAITING_PAYMENT)
        return null;
    await (0, CatalogAuditRepository_1.recordOrderAudit)({
        guildId: order.guildId,
        orderId: order.id,
        action: payment.status === client_1.PaymentStatus.EXPIRED
            ? client_1.OrderAuditAction.ORDER_PAYMENT_EXPIRED
            : client_1.OrderAuditAction.ORDER_PAYMENT_CANCELLED,
        performedById: payment.cancelledById,
        newValue: payment.status,
        metadata: { paymentId: payment.id },
    });
    return order;
}
// ---------------------------------------------------------------------------
// Ciclo operacional
// ---------------------------------------------------------------------------
/**
 * PAID -> IN_PROGRESS. Quem poe o pedido em preparacao passa a ser o
 * responsavel — se ninguem era.
 *
 * Sem isso "Em Preparacao" criaria exatamente a ambiguidade que a fila de
 * demandas existe para eliminar: pedido sendo feito, sem ninguem dono dele.
 * Demanda que ja tem responsavel NAO muda de mao por este botao; transferir e
 * uma acao propria ("Atribuir"), para ninguem tomar pedido alheio sem querer.
 */
async function startOrderProgress(guildId, staff, orderId) {
    const order = await transition(guildId, orderId, {
        apply: () => (0, OrderRepository_1.markOrderInProgress)(orderId),
        action: client_1.OrderAuditAction.ORDER_IN_PROGRESS,
        actorId: staff.id,
        newValue: client_1.OrderStatus.IN_PROGRESS,
        failureMessage: 'Somente um pedido pago pode entrar em preparacao.',
    });
    if (order.assignedToId !== null)
        return order;
    // Condicional: se alguem assumiu entre a transicao e aqui, fica com quem
    // assumiu — e o pedido volta como esta, sem erro.
    const taken = await (0, OrderRepository_1.setOrderAssignee)(orderId, null, staff.id);
    if (!taken)
        return requireOrder(guildId, orderId);
    await (0, CatalogAuditRepository_1.recordOrderAudit)({
        guildId,
        orderId,
        action: client_1.OrderAuditAction.ORDER_ASSIGNED,
        performedById: staff.id,
        oldValue: null,
        newValue: staff.id,
        metadata: { via: 'em-preparacao' },
    });
    return requireOrder(guildId, orderId);
}
/**
 * Candidatos avaliados por "Pegar proxima".
 *
 * Mais de um porque o primeiro pode ser tomado por outra pessoa no mesmo
 * instante; cinco cobre qualquer disputa realista sem virar varredura.
 */
const CLAIM_CANDIDATES = 5;
/**
 * Assumir uma demanda coloca o pedido em preparacao quando ele ainda esta
 * apenas pago — assumir E comecar. Deixar os dois separados produzia pedido
 * "com dono" e "pago" ao mesmo tempo, que ninguem sabe dizer se ja comecou.
 */
async function startIfPaid(guildId, actorId, orderId) {
    const started = await (0, OrderRepository_1.markOrderInProgress)(orderId);
    if (started) {
        await (0, CatalogAuditRepository_1.recordOrderAudit)({
            guildId,
            orderId,
            action: client_1.OrderAuditAction.ORDER_IN_PROGRESS,
            performedById: actorId,
            oldValue: client_1.OrderStatus.PAID,
            newValue: client_1.OrderStatus.IN_PROGRESS,
        });
    }
    return { order: await requireOrder(guildId, orderId), started };
}
/**
 * Troca o responsavel sob lock, com auditoria.
 *
 * `decide` recebe o pedido FRESCO do banco e devolve o novo responsavel (ou
 * `null` para liberar); pode lancar para recusar. Mesmo responsavel de antes e
 * uma operacao vazia: nada e gravado nem auditado.
 */
async function reassign(guildId, orderId, actorId, decide) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.ORDER_ACTION, orderId, async () => {
        const order = await requireOrder(guildId, orderId);
        if (!OrderRepository_1.PRODUCTION_STATUSES.includes(order.status)) {
            throw new errors_1.ValidationError(`Responsavel fora da producao (${order.status}) em ${orderId}`, {
                userMessage: 'So pedido pago ou em preparacao tem responsavel. Este pedido ja saiu da fila.',
            });
        }
        const from = order.assignedToId;
        const to = decide(order);
        if (from === to)
            return order;
        const applied = await (0, OrderRepository_1.setOrderAssignee)(orderId, from, to);
        if (!applied) {
            throw new errors_1.ValidationError(`Responsavel mudou durante a troca em ${orderId}`, {
                userMessage: 'O responsavel deste pedido mudou enquanto voce olhava. Atualize e tente de novo.',
            });
        }
        await (0, CatalogAuditRepository_1.recordOrderAudit)({
            guildId,
            orderId,
            action: to === null ? client_1.OrderAuditAction.ORDER_UNASSIGNED : client_1.OrderAuditAction.ORDER_ASSIGNED,
            performedById: actorId,
            oldValue: from,
            newValue: to,
        });
        logger.info('Demanda mudou de responsavel.', {
            guildId,
            userId: actorId,
            entityType: 'order',
            entityId: orderId,
            from,
            to,
        });
        return requireOrder(guildId, orderId);
    }, { userMessage: ORDER_BUSY_MESSAGE });
}
/**
 * Assumir UMA demanda especifica.
 *
 * Demanda de outra pessoa e recusada, com o nome de quem esta com ela: tomar
 * pedido alheio e transferencia, e transferencia tem botao proprio.
 */
async function claimOrder(guildId, staff, orderId) {
    await reassign(guildId, orderId, staff.id, (order) => {
        if (order.assignedToId !== null && order.assignedToId !== staff.id) {
            throw new errors_1.ValidationError(`Demanda ja atribuida em ${orderId}`, {
                userMessage: `Esta demanda ja esta com ${(0, discord_1.userMention)(order.assignedToId)}. ` +
                    'Para transferir, use "Atribuir a alguem da equipe".',
            });
        }
        return staff.id;
    });
    return startIfPaid(guildId, staff.id, orderId);
}
/** Devolve a demanda a fila, sem responsavel. */
async function releaseOrder(guildId, staff, orderId) {
    return reassign(guildId, orderId, staff.id, (order) => {
        if (order.assignedToId === null) {
            throw new errors_1.ValidationError(`Demanda ja livre em ${orderId}`, {
                userMessage: 'Esta demanda ja esta livre na fila.',
            });
        }
        return null;
    });
}
/**
 * Entrega a demanda a alguem da equipe (inclusive tirando de outra pessoa).
 *
 * Quem pode RECEBER e decidido por quem chama — o handler confere que o alvo e
 * da equipe com o membro real. Aqui fica so a troca e a auditoria, com quem fez.
 */
async function assignOrderTo(guildId, staff, orderId, targetId) {
    return reassign(guildId, orderId, staff.id, () => targetId);
}
/**
 * Pega a proxima demanda LIVRE, na ordem da fila (vencimento mais proximo).
 *
 * Sem lock de proposito: o `updateMany` condicional ja impede dois donos, e um
 * candidato ocupado por outro clique deve ser PULADO — nao virar erro de "pedido
 * ocupado" para quem so queria a proxima.
 *
 * `null` quando nao ha nenhuma demanda livre.
 */
async function claimNextOrder(guildId, staff) {
    const candidates = await (0, OrderRepository_1.listProductionQueue)(guildId, CLAIM_CANDIDATES, null);
    for (const candidate of candidates) {
        const taken = await (0, OrderRepository_1.setOrderAssignee)(candidate.id, null, staff.id);
        if (!taken)
            continue;
        await (0, CatalogAuditRepository_1.recordOrderAudit)({
            guildId,
            orderId: candidate.id,
            action: client_1.OrderAuditAction.ORDER_ASSIGNED,
            performedById: staff.id,
            oldValue: null,
            newValue: staff.id,
            metadata: { via: 'proxima-da-fila' },
        });
        return startIfPaid(guildId, staff.id, candidate.id);
    }
    return null;
}
async function deliverOrder(guildId, staff, orderId) {
    return transition(guildId, orderId, {
        apply: () => (0, OrderRepository_1.markOrderDelivered)(orderId, staff.id),
        action: client_1.OrderAuditAction.ORDER_DELIVERED,
        actorId: staff.id,
        newValue: client_1.OrderStatus.DELIVERED,
        failureMessage: 'Somente um pedido pago pode ser marcado como entregue.',
    });
}
async function completeOrder(guildId, staff, orderId) {
    return transition(guildId, orderId, {
        apply: () => (0, OrderRepository_1.markOrderCompleted)(orderId, staff.id),
        action: client_1.OrderAuditAction.ORDER_COMPLETED,
        actorId: staff.id,
        newValue: client_1.OrderStatus.COMPLETED,
        failureMessage: 'Somente um pedido entregue pode ser concluido.',
    });
}
async function cancelOrder(guildId, staff, orderId, reason) {
    return transition(guildId, orderId, {
        apply: () => (0, OrderRepository_1.markOrderCancelled)(orderId, staff.id, reason),
        action: client_1.OrderAuditAction.ORDER_CANCELLED,
        actorId: staff.id,
        newValue: client_1.OrderStatus.CANCELLED,
        failureMessage: 'Este pedido nao pode mais ser cancelado. Pedidos pagos seguem para atendimento.',
        metadata: { reason },
    });
}
/**
 * Executa uma transicao de status sob lock + update condicional.
 *
 * O lock cobre o duplo clique; o `updateMany` com o status atual no `where` e a
 * garantia real: mesmo com dois processos, so um aplica a mudanca.
 */
async function transition(guildId, orderId, options) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.ORDER_ACTION, orderId, async () => {
        const order = await requireOrder(guildId, orderId);
        const applied = await options.apply();
        if (!applied) {
            throw new errors_1.ValidationError(`Transicao recusada (${order.status} -> ${options.newValue}) em ${orderId}`, { userMessage: options.failureMessage });
        }
        await (0, CatalogAuditRepository_1.recordOrderAudit)({
            guildId,
            orderId,
            action: options.action,
            performedById: options.actorId,
            oldValue: order.status,
            newValue: options.newValue,
            ...(options.metadata !== undefined
                ? { metadata: options.metadata }
                : {}),
        });
        logger.info('Pedido mudou de estado.', {
            guildId,
            userId: options.actorId,
            entityType: 'order',
            entityId: orderId,
            from: order.status,
            to: options.newValue,
        });
        return requireOrder(guildId, orderId);
    }, { userMessage: ORDER_BUSY_MESSAGE });
}
/** Encerra o carrinho fora da transacao (usado em fluxos de compensacao). */
async function closeCartAfterCheckout(cartId) {
    return (0, CartService_1.finishCart)(cartId);
}
//# sourceMappingURL=OrderService.js.map