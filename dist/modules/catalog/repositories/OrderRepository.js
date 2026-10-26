"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCTION_STATUSES = exports.OPEN_ORDER_STATUSES = void 0;
exports.reserveOrderNumber = reserveOrderNumber;
exports.currentOrderCounter = currentOrderCounter;
exports.createOrder = createOrder;
exports.findOrderById = findOrderById;
exports.findOrderByNumber = findOrderByNumber;
exports.findOrderByPaymentId = findOrderByPaymentId;
exports.listOrdersByChannel = listOrdersByChannel;
exports.findDeliverableOrderByChannel = findDeliverableOrderByChannel;
exports.findDeliverableOrderInChannel = findDeliverableOrderInChannel;
exports.listOrders = listOrders;
exports.countOrders = countOrders;
exports.countOrdersByStatus = countOrdersByStatus;
exports.findRecentDuplicateOrder = findRecentDuplicateOrder;
exports.updateOrderPricing = updateOrderPricing;
exports.attachPayment = attachPayment;
exports.markOrderPaid = markOrderPaid;
exports.markOrderInProgress = markOrderInProgress;
exports.markOrderDelivered = markOrderDelivered;
exports.markOrderCompleted = markOrderCompleted;
exports.markOrderCancelled = markOrderCancelled;
exports.setOrderPanelMessage = setOrderPanelMessage;
exports.clearOrderPanelMessage = clearOrderPanelMessage;
exports.setDemandMessage = setDemandMessage;
exports.setDemandDoneMessage = setDemandDoneMessage;
exports.findOrderAwaitingConfirmation = findOrderAwaitingConfirmation;
exports.setDemandStartedMessage = setDemandStartedMessage;
exports.listOrdersPaidButNotSynced = listOrdersPaidButNotSynced;
exports.listDemandsWithoutCard = listDemandsWithoutCard;
exports.listProductionQueue = listProductionQueue;
exports.getProductionQueueStats = getProductionQueueStats;
exports.setOrderAssignee = setOrderAssignee;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../../core/database/prisma");
const time_1 = require("../../../utils/time");
/**
 * Persistencia de pedidos.
 *
 * REGRAS DESTE ARQUIVO
 *  - Numeracao vem de `GuildCounter` com `increment` ATOMICO. Nunca count()+1.
 *  - Toda transicao de status usa `updateMany` com o status atual no `where`:
 *    dois cliques simultaneos nunca aplicam a mesma transicao duas vezes.
 *  - `OrderItem` guarda SNAPSHOT (nome, SKU e preco): mudar o pack depois nao
 *    reescreve pedido antigo.
 */
const ORDER_COUNTER_NAME = 'order';
/** Estados em que o pedido ainda esta "vivo" para a equipe. */
exports.OPEN_ORDER_STATUSES = [
    client_1.OrderStatus.PENDING,
    client_1.OrderStatus.AWAITING_PAYMENT,
    client_1.OrderStatus.PAID,
    client_1.OrderStatus.IN_PROGRESS,
];
/**
 * Reserva o proximo numero de pedido da guild de forma atomica.
 *
 * Identico ao contador de tickets: o incremento acontece no banco, entao duas
 * compras simultaneas recebem numeros diferentes. A corrida na PRIMEIRA
 * insercao (duas INSERTs concorrentes) devolve P2002 e a operacao e repetida —
 * a segunda tentativa ja cai no caminho de UPDATE.
 */
async function reserveOrderNumber(guildId, db = (0, prisma_1.getPrisma)(), attempt = 0) {
    try {
        const counter = await db.guildCounter.upsert({
            where: { guildId_name: { guildId, name: ORDER_COUNTER_NAME } },
            create: { guildId, name: ORDER_COUNTER_NAME, value: 1 },
            update: { value: { increment: 1 } },
        });
        return counter.value;
    }
    catch (error) {
        if ((0, prisma_1.isUniqueConstraintError)(error) && attempt < 3) {
            await (0, time_1.delay)(25 * (attempt + 1));
            return reserveOrderNumber(guildId, db, attempt + 1);
        }
        throw error;
    }
}
async function currentOrderCounter(guildId, db = (0, prisma_1.getPrisma)()) {
    const counter = await db.guildCounter.findUnique({
        where: { guildId_name: { guildId, name: ORDER_COUNTER_NAME } },
    });
    return counter?.value ?? 0;
}
/** Cria o pedido e seus itens dentro da MESMA transacao. */
async function createOrder(input, db = (0, prisma_1.getPrisma)()) {
    return db.order.create({
        data: {
            guildId: input.guildId,
            orderNumber: input.orderNumber,
            customerId: input.customerId,
            channelId: input.channelId,
            status: client_1.OrderStatus.PENDING,
            subtotalAmount: input.subtotalAmount,
            discountAmount: 0,
            finalAmount: input.subtotalAmount,
            items: {
                create: input.items.map((item) => ({
                    packId: item.packId,
                    skuSnapshot: item.skuSnapshot,
                    nameSnapshot: item.nameSnapshot,
                    priceSnapshot: item.priceSnapshot,
                    quantity: item.quantity,
                })),
            },
        },
        include: { items: true },
    });
}
async function findOrderById(id, db = (0, prisma_1.getPrisma)()) {
    return db.order.findUnique({
        where: { id },
        include: { items: { orderBy: { createdAt: 'asc' } }, payment: true },
    });
}
async function findOrderByNumber(guildId, orderNumber, db = (0, prisma_1.getPrisma)()) {
    return db.order.findUnique({
        where: { guildId_orderNumber: { guildId, orderNumber } },
        include: { items: { orderBy: { createdAt: 'asc' } }, payment: true },
    });
}
async function findOrderByPaymentId(paymentId, db = (0, prisma_1.getPrisma)()) {
    return db.order.findUnique({
        where: { paymentId },
        include: { items: { orderBy: { createdAt: 'asc' } } },
    });
}
/**
 * Pedidos nascidos em um canal — o painel do ticket os estampa no topo.
 *
 * O `take` existe porque o resultado vira TEXTO num painel com teto de
 * caracteres: um canal antigo com dezenas de vendas nao pode empurrar o painel
 * para o limite do Discord.
 *
 * A consulta anda pelo prefixo `guildId` dos indices existentes e filtra o
 * canal; nao ha indice proprio para `channelId` porque o painel do ticket e
 * reconstruido por acao humana, nunca em laco.
 */
async function listOrdersByChannel(guildId, channelId, take = 10, db = (0, prisma_1.getPrisma)()) {
    return db.order.findMany({
        where: { guildId, channelId },
        orderBy: { orderNumber: 'asc' },
        take,
        select: { orderNumber: true, status: true },
    });
}
/**
 * O pedido que a entrega do ticket marca como ENTREGUE.
 *
 * CRITERIO ESTREITO DE PROPOSITO: mesmo canal, mesmo cliente, e so PAID ou
 * IN_PROGRESS — os dois estados em que a producao ja foi paga e ainda nao foi
 * entregue. Nao ha busca de reserva "qualquer pedido pago deste cliente": um
 * pedido de outra venda, aberto em outro ticket, seria fechado por uma entrega
 * que nao e dele. Sem candidato, a entrega acontece do mesmo jeito e a equipe
 * marca o pedido na mao — e o que ela ja faz hoje.
 *
 * O mais NOVO primeiro: quando a mesma venda gerou cobranca refeita, o pedido
 * que interessa e o ultimo.
 *
 * Anda pelo prefixo `guildId` dos indices existentes e filtra canal e cliente;
 * como `listOrdersByChannel`, roda por acao humana e nunca em laco.
 */
async function findDeliverableOrderByChannel(guildId, channelId, customerId, db = (0, prisma_1.getPrisma)()) {
    return db.order.findFirst({
        where: {
            guildId,
            channelId,
            customerId,
            status: { in: [client_1.OrderStatus.PAID, client_1.OrderStatus.IN_PROGRESS] },
        },
        orderBy: { orderNumber: 'desc' },
        include: { items: true },
    });
}
/**
 * O mesmo pedido entregavel, mas SEM filtrar por cliente.
 *
 * Existe para uma pergunta so: "nao achei pedido deste cliente — sera que ha
 * um pedido pago aqui, de outra pessoa?". E o que separa "nada a marcar" de
 * "voce selecionou o cliente errado", que sao coisas muito diferentes para
 * quem acabou de entregar um produto.
 *
 * So e consultada quando a busca por cliente voltou vazia, entao nao custa
 * nada no caminho normal.
 */
async function findDeliverableOrderInChannel(guildId, channelId, db = (0, prisma_1.getPrisma)()) {
    return db.order.findFirst({
        where: {
            guildId,
            channelId,
            status: { in: [client_1.OrderStatus.PAID, client_1.OrderStatus.IN_PROGRESS] },
        },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true, customerId: true },
    });
}
function listWhere(guildId, options) {
    return {
        guildId,
        ...(options.customerId !== undefined ? { customerId: options.customerId } : {}),
        ...(options.statuses !== undefined ? { status: { in: [...options.statuses] } } : {}),
    };
}
async function listOrders(guildId, options = {}, db = (0, prisma_1.getPrisma)()) {
    return db.order.findMany({
        where: listWhere(guildId, options),
        orderBy: { createdAt: 'desc' },
        skip: options.skip ?? 0,
        take: options.take ?? 25,
        include: { items: { orderBy: { createdAt: 'asc' } } },
    });
}
async function countOrders(guildId, options = {}, db = (0, prisma_1.getPrisma)()) {
    return db.order.count({ where: listWhere(guildId, options) });
}
/** Total de pedidos por status, em UMA consulta agregada (painel de status). */
async function countOrdersByStatus(guildId, db = (0, prisma_1.getPrisma)()) {
    const rows = await db.order.groupBy({
        by: ['status'],
        where: { guildId },
        _count: { _all: true },
    });
    const totals = new Map();
    for (const row of rows)
        totals.set(row.status, row._count._all);
    return totals;
}
/**
 * Pedido recente e IDENTICO do mesmo cliente (mesma lista de packs).
 *
 * E a protecao PERSISTENTE contra duplo clique: o lock em memoria some num
 * restart e nao cobre duas instancias do processo, mas esta consulta cobre.
 */
async function findRecentDuplicateOrder(guildId, customerId, packIds, since, db = (0, prisma_1.getPrisma)()) {
    const candidates = await db.order.findMany({
        where: {
            guildId,
            customerId,
            createdAt: { gte: since },
            status: { in: [client_1.OrderStatus.PENDING, client_1.OrderStatus.AWAITING_PAYMENT] },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    const wanted = [...packIds].sort().join('|');
    return (candidates.find((order) => order.items
        .map((item) => item.packId)
        .sort()
        .join('|') === wanted) ?? null);
}
/**
 * Aplica/remove cupom. So vale enquanto o pedido nao foi pago e a cobranca nao
 * existe — depois disso, valor de pedido e historico.
 */
async function updateOrderPricing(id, pricing, db = (0, prisma_1.getPrisma)()) {
    const result = await db.order.updateMany({
        where: { id, status: { in: [client_1.OrderStatus.PENDING, client_1.OrderStatus.AWAITING_PAYMENT] } },
        data: pricing,
    });
    return result.count === 1;
}
/** Vincula a cobranca recem-criada e move o pedido para AWAITING_PAYMENT. */
async function attachPayment(id, paymentId, pricing, db = (0, prisma_1.getPrisma)()) {
    const result = await db.order.updateMany({
        where: { id, status: { in: [client_1.OrderStatus.PENDING, client_1.OrderStatus.AWAITING_PAYMENT] } },
        data: { ...pricing, paymentId, status: client_1.OrderStatus.AWAITING_PAYMENT },
    });
    return result.count === 1;
}
/**
 * AWAITING_PAYMENT -> PAID.
 *
 * Idempotente por construcao: se o pedido ja saiu de AWAITING_PAYMENT (por
 * outro clique, pelo webhook ou pelo recovery), `count` e 0 e nada acontece.
 */
async function markOrderPaid(id, db = (0, prisma_1.getPrisma)()) {
    const result = await db.order.updateMany({
        where: { id, status: client_1.OrderStatus.AWAITING_PAYMENT },
        data: { status: client_1.OrderStatus.PAID, paidAt: new Date() },
    });
    return result.count === 1;
}
async function markOrderInProgress(id, db = (0, prisma_1.getPrisma)()) {
    const result = await db.order.updateMany({
        where: { id, status: client_1.OrderStatus.PAID },
        data: { status: client_1.OrderStatus.IN_PROGRESS },
    });
    return result.count === 1;
}
async function markOrderDelivered(id, deliveredById, db = (0, prisma_1.getPrisma)()) {
    const result = await db.order.updateMany({
        where: { id, status: { in: [client_1.OrderStatus.PAID, client_1.OrderStatus.IN_PROGRESS] } },
        data: { status: client_1.OrderStatus.DELIVERED, deliveredById, deliveredAt: new Date() },
    });
    return result.count === 1;
}
async function markOrderCompleted(id, completedById, db = (0, prisma_1.getPrisma)()) {
    const result = await db.order.updateMany({
        where: { id, status: client_1.OrderStatus.DELIVERED },
        data: { status: client_1.OrderStatus.COMPLETED, completedById, completedAt: new Date() },
    });
    return result.count === 1;
}
async function markOrderCancelled(id, cancelledById, cancelReason, db = (0, prisma_1.getPrisma)()) {
    const result = await db.order.updateMany({
        where: { id, status: { in: [client_1.OrderStatus.PENDING, client_1.OrderStatus.AWAITING_PAYMENT] } },
        data: {
            status: client_1.OrderStatus.CANCELLED,
            cancelledById,
            cancelledAt: new Date(),
            cancelReason,
        },
    });
    return result.count === 1;
}
async function setOrderPanelMessage(id, channelId, messageId, db = (0, prisma_1.getPrisma)()) {
    await db.order.update({
        where: { id },
        data: { panelChannelId: channelId, panelMessageId: messageId },
    });
}
async function clearOrderPanelMessage(id, db = (0, prisma_1.getPrisma)()) {
    await db.order.update({
        where: { id },
        data: { panelChannelId: null, panelMessageId: null },
    });
}
/**
 * Onde o cartao desta demanda foi publicado, no quadro e no canal de iniciadas.
 *
 * O canal vai junto do id da mensagem porque o canal configurado pode mudar: um
 * id de mensagem sozinho faria o bot procurar a mensagem antiga no lugar novo e
 * concluir que ela sumiu.
 *
 * `null` nos dois campos apaga a referencia — e o que se faz quando a mensagem
 * ja nao existe, para o bot parar de tentar reescreve-la.
 */
async function setDemandMessage(id, channelId, messageId, db = (0, prisma_1.getPrisma)()) {
    await db.order.update({
        where: { id },
        data: { demandChannelId: channelId, demandMessageId: messageId },
    });
}
async function setDemandDoneMessage(id, channelId, messageId, db = (0, prisma_1.getPrisma)()) {
    await db.order.update({
        where: { id },
        data: { demandDoneChannelId: channelId, demandDoneMessageId: messageId },
    });
}
/**
 * O pedido que a CONFIRMACAO do cliente conclui.
 *
 * O par de `findDeliverableOrderByChannel`, um passo adiante: mesmo canal, mesmo
 * cliente, mas so DELIVERED — o arquivo ja saiu e falta o cliente dizer que
 * recebeu. Sem busca de reserva pelo mesmo motivo de la: um pedido de outra
 * venda nao pode ser concluido pela confirmacao desta.
 */
async function findOrderAwaitingConfirmation(guildId, channelId, customerId, db = (0, prisma_1.getPrisma)()) {
    return db.order.findFirst({
        where: { guildId, channelId, customerId, status: client_1.OrderStatus.DELIVERED },
        orderBy: { orderNumber: 'desc' },
        include: { items: true },
    });
}
async function setDemandStartedMessage(id, channelId, messageId, db = (0, prisma_1.getPrisma)()) {
    await db.order.update({
        where: { id },
        data: { demandStartedChannelId: channelId, demandStartedMessageId: messageId },
    });
}
/**
 * Pedidos aguardando pagamento cuja cobranca JA foi aprovada.
 * Usado pelo recovery: se o bot caiu entre a aprovacao e a sincronizacao, o
 * pedido nao pode ficar preso em "aguardando pagamento" para sempre.
 */
async function listOrdersPaidButNotSynced(limit, db = (0, prisma_1.getPrisma)()) {
    return db.order.findMany({
        where: {
            status: client_1.OrderStatus.AWAITING_PAYMENT,
            payment: { is: { status: client_1.PaymentStatus.APPROVED } },
        },
        orderBy: { updatedAt: 'asc' },
        take: limit,
        include: { items: { orderBy: { createdAt: 'asc' } } },
    });
}
/**
 * Status que contam como "em producao".
 *
 * DELIVERED fica de fora de proposito: o trabalho ja saiu e o pedido esta
 * aguardando conclusao — nao ha o que produzir, e mante-lo na fila empurraria
 * para baixo o que ainda precisa de mao.
 */
exports.PRODUCTION_STATUSES = [
    client_1.OrderStatus.PAID,
    client_1.OrderStatus.IN_PROGRESS,
];
/**
 * Demandas em producao que ainda nao tem cartao no quadro.
 *
 * Existe para o primeiro dia do quadro: sem isto, ele nasceria vazio e so
 * mostraria as vendas seguintes — as que ja estao em producao, que sao
 * justamente as que precisam de acompanhamento, ficariam de fora para sempre.
 *
 * `take` porque o resultado vira uma mensagem por demanda: publicar cem
 * cartoes de uma vez bateria no limite de taxa do Discord no meio.
 */
async function listDemandsWithoutCard(guildId, take, db = (0, prisma_1.getPrisma)()) {
    return db.order.findMany({
        where: {
            guildId,
            status: { in: [...exports.PRODUCTION_STATUSES] },
            demandMessageId: null,
        },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { orderNumber: 'asc' }],
        take,
        include: { items: { orderBy: { createdAt: 'asc' } }, payment: true },
    });
}
/**
 * Fila de producao, do vencimento mais proximo para o mais distante.
 *
 * PEDIDO SEM PRAZO ENTRA, no fim da lista. Excluir quem nao tem `dueAt` deixaria
 * a fila vazia justamente quando nenhuma categoria tem prazo cadastrado — e uma
 * tela vazia parece defeito, nao configuracao faltando. Aparecendo marcado como
 * "sem prazo", o proprio pedido cobra o cadastro.
 *
 * `orderNumber` desempata: dois pedidos que vencem no mesmo dia sao atendidos
 * na ordem em que entraram.
 */
async function listProductionQueue(guildId, take, assignee = undefined, db = (0, prisma_1.getPrisma)()) {
    return db.order.findMany({
        where: {
            guildId,
            status: { in: [...exports.PRODUCTION_STATUSES] },
            ...(assignee === undefined ? {} : { assignedToId: assignee }),
        },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { orderNumber: 'asc' }],
        take,
        include: {
            items: {
                orderBy: { createdAt: 'asc' },
                include: { pack: { select: { category: { select: { name: true } } } } },
            },
        },
    });
}
/**
 * Total, livres e carga por pessoa, numa consulta so.
 *
 * Tudo sai do mesmo `groupBy`, entao os tres numeros sempre batem entre si:
 * total = livres + soma das cargas.
 */
async function getProductionQueueStats(guildId, db = (0, prisma_1.getPrisma)()) {
    const groups = await db.order.groupBy({
        by: ['assignedToId'],
        where: { guildId, status: { in: [...exports.PRODUCTION_STATUSES] } },
        _count: { _all: true },
    });
    let total = 0;
    let unassigned = 0;
    const workload = [];
    for (const group of groups) {
        const count = group._count._all;
        total += count;
        if (group.assignedToId === null)
            unassigned += count;
        else
            workload.push({ assigneeId: group.assignedToId, count });
    }
    workload.sort((a, b) => b.count - a.count || a.assigneeId.localeCompare(b.assigneeId));
    return { total, unassigned, workload };
}
/**
 * Troca o responsavel — SO se ele ainda for quem a tela mostrou (`from`).
 *
 * E a mesma garantia das transicoes de status: o `where` carrega o estado
 * esperado, entao dois membros clicando "Assumir" no mesmo pedido nao geram
 * dois donos. Quem chegou segundo recebe `false` e uma mensagem, nunca um
 * pedido tomado em silencio.
 *
 * Restrito a pedidos em producao: responsavel de pedido nao pago ou ja
 * entregue nao e demanda, e historico.
 */
async function setOrderAssignee(id, from, to, db = (0, prisma_1.getPrisma)()) {
    const result = await db.order.updateMany({
        where: { id, status: { in: [...exports.PRODUCTION_STATUSES] }, assignedToId: from },
        data: { assignedToId: to, assignedAt: to === null ? null : new Date() },
    });
    return result.count === 1;
}
//# sourceMappingURL=OrderRepository.js.map