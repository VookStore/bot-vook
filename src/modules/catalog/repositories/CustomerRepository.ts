import { CartStatus, OrderStatus } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Historico comercial de um cliente, resumido.
 *
 * Existe para a equipe saber COM QUEM esta falando no momento em que abre o
 * ticket. Antes o painel mostrava apenas os pedidos daquele canal, entao um
 * cliente de dez compras e um que nunca comprou chegavam identicos na tela — e
 * eram atendidos igual.
 *
 * UMA CONSULTA AGREGADA, nao uma lista. O painel precisa de quatro numeros, e
 * carregar todos os pedidos do cliente para soma-los em JavaScript custaria
 * caro justo no caminho da abertura do ticket, que ja segura um lock.
 */

/** Pedidos que contam como venda concretizada. */
const PAID_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.IN_PROGRESS,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
];

/** Pedidos ainda em andamento. */
const OPEN_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.IN_PROGRESS,
  OrderStatus.DELIVERED,
];

export interface CustomerSummary {
  /** Pedidos que chegaram a ser pagos, em qualquer estagio depois disso. */
  paidOrders: number;
  /** Soma em centavos do que foi efetivamente cobrado nesses pedidos. */
  spentCents: number;
  /** Pedidos ainda em andamento (inclui os pagos e nao entregues). */
  openOrders: number;
  /** Data do ultimo pedido pago; `null` para quem nunca comprou. */
  lastPurchaseAt: Date | null;
  /** Itens parados no carrinho agora. */
  cartItems: number;
}

export async function getCustomerSummary(
  guildId: string,
  customerId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CustomerSummary> {
  const [paid, open, last, cart] = await Promise.all([
    /*
     * `finalAmount` e nao `subtotalAmount`: o que interessa e quanto o cliente
     * REALMENTE pagou, ja com cupom aplicado. Somar o subtotal inflaria o
     * historico de quem so comprou com desconto.
     */
    db.order.aggregate({
      where: { guildId, customerId, status: { in: [...PAID_STATUSES] } },
      _count: { _all: true },
      _sum: { finalAmount: true },
    }),
    db.order.count({
      where: { guildId, customerId, status: { in: [...OPEN_STATUSES] } },
    }),
    db.order.findFirst({
      where: { guildId, customerId, status: { in: [...PAID_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    db.cartItem.count({
      where: { cart: { guildId, customerId, status: CartStatus.ACTIVE } },
    }),
  ]);

  return {
    paidOrders: paid._count._all,
    spentCents: paid._sum.finalAmount ?? 0,
    openOrders: open,
    lastPurchaseAt: last?.createdAt ?? null,
    cartItems: cart,
  };
}
