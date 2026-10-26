import {
  OrderStatus,
  PaymentStatus,
  type CouponType,
  type Order,
  type OrderItem,
  type Payment,
  type Prisma,
} from '@prisma/client';

import {
  getPrisma,
  isUniqueConstraintError,
  type DatabaseClient,
} from '../../../core/database/prisma';
import { delay } from '../../../utils/time';

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

export type OrderWithItems = Order & { items: OrderItem[] };
export type OrderWithItemsAndPayment = Order & { items: OrderItem[]; payment: Payment | null };

/** Estados em que o pedido ainda esta "vivo" para a equipe. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.IN_PROGRESS,
];

/**
 * Reserva o proximo numero de pedido da guild de forma atomica.
 *
 * Identico ao contador de tickets: o incremento acontece no banco, entao duas
 * compras simultaneas recebem numeros diferentes. A corrida na PRIMEIRA
 * insercao (duas INSERTs concorrentes) devolve P2002 e a operacao e repetida —
 * a segunda tentativa ja cai no caminho de UPDATE.
 */
export async function reserveOrderNumber(
  guildId: string,
  db: DatabaseClient = getPrisma(),
  attempt = 0,
): Promise<number> {
  try {
    const counter = await db.guildCounter.upsert({
      where: { guildId_name: { guildId, name: ORDER_COUNTER_NAME } },
      create: { guildId, name: ORDER_COUNTER_NAME, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  } catch (error) {
    if (isUniqueConstraintError(error) && attempt < 3) {
      await delay(25 * (attempt + 1));
      return reserveOrderNumber(guildId, db, attempt + 1);
    }
    throw error;
  }
}

export async function currentOrderCounter(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  const counter = await db.guildCounter.findUnique({
    where: { guildId_name: { guildId, name: ORDER_COUNTER_NAME } },
  });
  return counter?.value ?? 0;
}

export interface CreateOrderItemInput {
  packId: string;
  skuSnapshot: string | null;
  nameSnapshot: string;
  priceSnapshot: number;
  quantity: number;
}

export interface CreateOrderInput {
  guildId: string;
  orderNumber: number;
  customerId: string;
  channelId: string | null;
  subtotalAmount: number;
  items: readonly CreateOrderItemInput[];
}

/** Cria o pedido e seus itens dentro da MESMA transacao. */
export async function createOrder(
  input: CreateOrderInput,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItems> {
  return db.order.create({
    data: {
      guildId: input.guildId,
      orderNumber: input.orderNumber,
      customerId: input.customerId,
      channelId: input.channelId,
      status: OrderStatus.PENDING,
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

export async function findOrderById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItemsAndPayment | null> {
  return db.order.findUnique({
    where: { id },
    include: { items: { orderBy: { createdAt: 'asc' } }, payment: true },
  });
}

export async function findOrderByNumber(
  guildId: string,
  orderNumber: number,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItemsAndPayment | null> {
  return db.order.findUnique({
    where: { guildId_orderNumber: { guildId, orderNumber } },
    include: { items: { orderBy: { createdAt: 'asc' } }, payment: true },
  });
}

export async function findOrderByPaymentId(
  paymentId: string,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItems | null> {
  return db.order.findUnique({
    where: { paymentId },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
}

/** Numero e estado dos pedidos abertos a partir de um canal. */
export interface ChannelOrderSummary {
  orderNumber: number;
  status: OrderStatus;
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
export async function listOrdersByChannel(
  guildId: string,
  channelId: string,
  take = 10,
  db: DatabaseClient = getPrisma(),
): Promise<ChannelOrderSummary[]> {
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
export async function findDeliverableOrderByChannel(
  guildId: string,
  channelId: string,
  customerId: string,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItems | null> {
  return db.order.findFirst({
    where: {
      guildId,
      channelId,
      customerId,
      status: { in: [OrderStatus.PAID, OrderStatus.IN_PROGRESS] },
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
export async function findDeliverableOrderInChannel(
  guildId: string,
  channelId: string,
  db: DatabaseClient = getPrisma(),
): Promise<{ orderNumber: number; customerId: string } | null> {
  return db.order.findFirst({
    where: {
      guildId,
      channelId,
      status: { in: [OrderStatus.PAID, OrderStatus.IN_PROGRESS] },
    },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true, customerId: true },
  });
}

export interface ListOrdersOptions {
  customerId?: string;
  statuses?: readonly OrderStatus[];
  skip?: number;
  take?: number;
}

function listWhere(guildId: string, options: ListOrdersOptions): Prisma.OrderWhereInput {
  return {
    guildId,
    ...(options.customerId !== undefined ? { customerId: options.customerId } : {}),
    ...(options.statuses !== undefined ? { status: { in: [...options.statuses] } } : {}),
  };
}

export async function listOrders(
  guildId: string,
  options: ListOrdersOptions = {},
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItems[]> {
  return db.order.findMany({
    where: listWhere(guildId, options),
    orderBy: { createdAt: 'desc' },
    skip: options.skip ?? 0,
    take: options.take ?? 25,
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function countOrders(
  guildId: string,
  options: ListOrdersOptions = {},
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.order.count({ where: listWhere(guildId, options) });
}

/** Total de pedidos por status, em UMA consulta agregada (painel de status). */
export async function countOrdersByStatus(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<Map<OrderStatus, number>> {
  const rows = await db.order.groupBy({
    by: ['status'],
    where: { guildId },
    _count: { _all: true },
  });

  const totals = new Map<OrderStatus, number>();
  for (const row of rows) totals.set(row.status, row._count._all);
  return totals;
}

/**
 * Pedido recente e IDENTICO do mesmo cliente (mesma lista de packs).
 *
 * E a protecao PERSISTENTE contra duplo clique: o lock em memoria some num
 * restart e nao cobre duas instancias do processo, mas esta consulta cobre.
 */
export async function findRecentDuplicateOrder(
  guildId: string,
  customerId: string,
  packIds: readonly string[],
  since: Date,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItems | null> {
  const candidates = await db.order.findMany({
    where: {
      guildId,
      customerId,
      createdAt: { gte: since },
      status: { in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT] },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });

  const wanted = [...packIds].sort().join('|');
  return (
    candidates.find(
      (order) =>
        order.items
          .map((item) => item.packId)
          .sort()
          .join('|') === wanted,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Transicoes (sempre condicionais ao status atual)
// ---------------------------------------------------------------------------

export interface OrderPricingUpdate {
  discountAmount: number;
  finalAmount: number;
  couponId: string | null;
  couponCodeSnapshot: string | null;
  couponTypeSnapshot: CouponType | null;
  couponValueSnapshot: number | null;
}

/**
 * Aplica/remove cupom. So vale enquanto o pedido nao foi pago e a cobranca nao
 * existe — depois disso, valor de pedido e historico.
 */
export async function updateOrderPricing(
  id: string,
  pricing: OrderPricingUpdate,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id, status: { in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT] } },
    data: pricing,
  });
  return result.count === 1;
}

/** Vincula a cobranca recem-criada e move o pedido para AWAITING_PAYMENT. */
export async function attachPayment(
  id: string,
  paymentId: string,
  pricing: OrderPricingUpdate,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id, status: { in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT] } },
    data: { ...pricing, paymentId, status: OrderStatus.AWAITING_PAYMENT },
  });
  return result.count === 1;
}

/**
 * AWAITING_PAYMENT -> PAID.
 *
 * Idempotente por construcao: se o pedido ja saiu de AWAITING_PAYMENT (por
 * outro clique, pelo webhook ou pelo recovery), `count` e 0 e nada acontece.
 */
export async function markOrderPaid(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id, status: OrderStatus.AWAITING_PAYMENT },
    data: { status: OrderStatus.PAID, paidAt: new Date() },
  });
  return result.count === 1;
}

export async function markOrderInProgress(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id, status: OrderStatus.PAID },
    data: { status: OrderStatus.IN_PROGRESS },
  });
  return result.count === 1;
}

export async function markOrderDelivered(
  id: string,
  deliveredById: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id, status: { in: [OrderStatus.PAID, OrderStatus.IN_PROGRESS] } },
    data: { status: OrderStatus.DELIVERED, deliveredById, deliveredAt: new Date() },
  });
  return result.count === 1;
}

export async function markOrderCompleted(
  id: string,
  completedById: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id, status: OrderStatus.DELIVERED },
    data: { status: OrderStatus.COMPLETED, completedById, completedAt: new Date() },
  });
  return result.count === 1;
}

export async function markOrderCancelled(
  id: string,
  cancelledById: string,
  cancelReason: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id, status: { in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT] } },
    data: {
      status: OrderStatus.CANCELLED,
      cancelledById,
      cancelledAt: new Date(),
      cancelReason,
    },
  });
  return result.count === 1;
}

export async function setOrderPanelMessage(
  id: string,
  channelId: string,
  messageId: string,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.order.update({
    where: { id },
    data: { panelChannelId: channelId, panelMessageId: messageId },
  });
}

export async function clearOrderPanelMessage(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
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
export async function setDemandMessage(
  id: string,
  channelId: string | null,
  messageId: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.order.update({
    where: { id },
    data: { demandChannelId: channelId, demandMessageId: messageId },
  });
}

export async function setDemandDoneMessage(
  id: string,
  channelId: string | null,
  messageId: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
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
export async function findOrderAwaitingConfirmation(
  guildId: string,
  channelId: string,
  customerId: string,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItems | null> {
  return db.order.findFirst({
    where: { guildId, channelId, customerId, status: OrderStatus.DELIVERED },
    orderBy: { orderNumber: 'desc' },
    include: { items: true },
  });
}

export async function setDemandStartedMessage(
  id: string,
  channelId: string | null,
  messageId: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
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
export async function listOrdersPaidButNotSynced(
  limit: number,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItems[]> {
  return db.order.findMany({
    where: {
      status: OrderStatus.AWAITING_PAYMENT,
      payment: { is: { status: PaymentStatus.APPROVED } },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
}

/** Pedido da fila de producao, com as categorias dos seus itens resolvidas. */
export type ProductionQueueOrder = Order & {
  items: Array<OrderItem & { pack: { category: { name: string } | null } }>;
};

/**
 * Status que contam como "em producao".
 *
 * DELIVERED fica de fora de proposito: o trabalho ja saiu e o pedido esta
 * aguardando conclusao — nao ha o que produzir, e mante-lo na fila empurraria
 * para baixo o que ainda precisa de mao.
 */
export const PRODUCTION_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.IN_PROGRESS,
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
export async function listDemandsWithoutCard(
  guildId: string,
  take: number,
  db: DatabaseClient = getPrisma(),
): Promise<OrderWithItemsAndPayment[]> {
  return db.order.findMany({
    where: {
      guildId,
      status: { in: [...PRODUCTION_STATUSES] },
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
export async function listProductionQueue(
  guildId: string,
  take: number,
  assignee: QueueAssigneeFilter = undefined,
  db: DatabaseClient = getPrisma(),
): Promise<ProductionQueueOrder[]> {
  return db.order.findMany({
    where: {
      guildId,
      status: { in: [...PRODUCTION_STATUSES] },
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
 * Recorte da fila por responsavel.
 *
 * `undefined` = todos; `null` = so as demandas livres; string = so as daquele
 * membro. Tres valores distintos de proposito: "sem filtro" e "sem responsavel"
 * sao perguntas diferentes, e confundi-los esconderia metade da fila.
 */
export type QueueAssigneeFilter = string | null | undefined;

/** Numeros da fila inteira — nunca so da pagina exibida. */
export interface ProductionQueueStats {
  total: number;
  unassigned: number;
  /** Demandas por responsavel, da maior carga para a menor. */
  workload: Array<{ assigneeId: string; count: number }>;
}

/**
 * Total, livres e carga por pessoa, numa consulta so.
 *
 * Tudo sai do mesmo `groupBy`, entao os tres numeros sempre batem entre si:
 * total = livres + soma das cargas.
 */
export async function getProductionQueueStats(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<ProductionQueueStats> {
  const groups = await db.order.groupBy({
    by: ['assignedToId'],
    where: { guildId, status: { in: [...PRODUCTION_STATUSES] } },
    _count: { _all: true },
  });

  let total = 0;
  let unassigned = 0;
  const workload: ProductionQueueStats['workload'] = [];

  for (const group of groups) {
    const count = group._count._all;
    total += count;
    if (group.assignedToId === null) unassigned += count;
    else workload.push({ assigneeId: group.assignedToId, count });
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
export async function setOrderAssignee(
  id: string,
  from: string | null,
  to: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id, status: { in: [...PRODUCTION_STATUSES] }, assignedToId: from },
    data: { assignedToId: to, assignedAt: to === null ? null : new Date() },
  });
  return result.count === 1;
}
