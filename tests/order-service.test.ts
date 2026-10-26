import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import type { CatalogPack, Order, OrderItem, Payment } from '@prisma/client';

import { ValidationError } from '../src/core/errors';
import { locks } from '../src/core/locks/LockService';
import {
  applyOrderCoupon,
  cancelOrder,
  checkoutCart,
  completeOrder,
  createOrderForCharge,
  createOrderForPack,
  deliverOrder,
  describeOrderStatus,
  formatOrderNumber,
  isFinanciallyOpen,
  priceOrder,
  requireCustomerOrder,
  startOrderProgress,
  syncOrderPaid,
} from '../src/modules/catalog/services/OrderService';

/**
 * Pedidos: numeracao, snapshot, idempotencia e transicoes.
 *
 * O que estes testes protegem:
 *  - o preco do pedido e FOTOGRAFADO na criacao (alterar o pack depois nao
 *    reescreve pedido antigo);
 *  - duplo clique nao cria dois pedidos iguais;
 *  - "cobranca aprovada -> pedido pago" e idempotente (webhook repetido,
 *    recovery pos-restart e clique duplo produzem o mesmo estado);
 *  - cupom no pedido usa a validacao do modulo CENTRAL de cupons.
 */

const GUILD_ID = '111111111111111111';
const CUSTOMER_ID = '222222222222222222';
const STAFF_ID = '333333333333333333';
const ORDER_ID = 'ckorder00000000000000001';
const CATEGORY_ID = 'ckcategoria000000000000';

/**
 * `vi.hoisted` porque o Vitest sobe as chamadas `vi.mock` para o topo do
 * arquivo: sem isso, a fabrica do mock rodaria antes destes objetos existirem.
 */
const orderRepo = vi.hoisted(() => ({
  reserveOrderNumber: vi.fn(),
  createOrder: vi.fn(),
  findOrderById: vi.fn(),
  findOrderByNumber: vi.fn(),
  findOrderByPaymentId: vi.fn(),
  findRecentDuplicateOrder: vi.fn(),
  listOrders: vi.fn(),
  countOrders: vi.fn(),
  countOrdersByStatus: vi.fn(),
  updateOrderPricing: vi.fn(),
  attachPayment: vi.fn(),
  markOrderPaid: vi.fn(),
  markOrderInProgress: vi.fn(),
  markOrderDelivered: vi.fn(),
  markOrderCompleted: vi.fn(),
  markOrderCancelled: vi.fn(),
  setOrderAssignee: vi.fn(),
  listProductionQueue: vi.fn(),
}));

const auditRepo = vi.hoisted(() => ({ recordOrderAudit: vi.fn() }));
const cartService = vi.hoisted(() => ({ getCartView: vi.fn(), finishCart: vi.fn() }));
const catalogService = vi.hoisted(() => ({ getSellablePack: vi.fn() }));
const couponService = vi.hoisted(() => ({ validateCouponForPayment: vi.fn() }));
const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));

vi.mock('../src/modules/catalog/repositories/OrderRepository', () => ({
  reserveOrderNumber: (...args: unknown[]): unknown => orderRepo.reserveOrderNumber(...args),
  createOrder: (...args: unknown[]): unknown => orderRepo.createOrder(...args),
  findOrderById: (...args: unknown[]): unknown => orderRepo.findOrderById(...args),
  findOrderByNumber: (...args: unknown[]): unknown => orderRepo.findOrderByNumber(...args),
  findOrderByPaymentId: (...args: unknown[]): unknown => orderRepo.findOrderByPaymentId(...args),
  findRecentDuplicateOrder: (...args: unknown[]): unknown => orderRepo.findRecentDuplicateOrder(...args),
  listOrders: (...args: unknown[]): unknown => orderRepo.listOrders(...args),
  countOrders: (...args: unknown[]): unknown => orderRepo.countOrders(...args),
  countOrdersByStatus: (...args: unknown[]): unknown => orderRepo.countOrdersByStatus(...args),
  updateOrderPricing: (...args: unknown[]): unknown => orderRepo.updateOrderPricing(...args),
  attachPayment: (...args: unknown[]): unknown => orderRepo.attachPayment(...args),
  markOrderPaid: (...args: unknown[]): unknown => orderRepo.markOrderPaid(...args),
  markOrderInProgress: (...args: unknown[]): unknown => orderRepo.markOrderInProgress(...args),
  markOrderDelivered: (...args: unknown[]): unknown => orderRepo.markOrderDelivered(...args),
  markOrderCompleted: (...args: unknown[]): unknown => orderRepo.markOrderCompleted(...args),
  markOrderCancelled: (...args: unknown[]): unknown => orderRepo.markOrderCancelled(...args),
  setOrderAssignee: (...args: unknown[]): unknown => orderRepo.setOrderAssignee(...args),
  listProductionQueue: (...args: unknown[]): unknown => orderRepo.listProductionQueue(...args),
  PRODUCTION_STATUSES: ['PAID', 'IN_PROGRESS'],
}));

vi.mock('../src/modules/catalog/repositories/CatalogAuditRepository', () => ({
  recordOrderAudit: (...args: unknown[]): unknown => auditRepo.recordOrderAudit(...args),
}));

vi.mock('../src/modules/catalog/services/CartService', () => ({
  getCartView: (...args: unknown[]): unknown => cartService.getCartView(...args),
  finishCart: (...args: unknown[]): unknown => cartService.finishCart(...args),
}));

vi.mock('../src/modules/catalog/services/CatalogService', () => ({
  getSellablePack: (...args: unknown[]): unknown => catalogService.getSellablePack(...args),
}));

vi.mock('../src/modules/coupons/services/CouponService', () => ({
  validateCouponForPayment: (...args: unknown[]): unknown => couponService.validateCouponForPayment(...args),
}));

vi.mock('../src/core/database/prisma', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, getPrisma: () => prismaMock };
});

function makePack(overrides: Partial<CatalogPack> = {}): CatalogPack {
  return {
    id: 'ckpack00000000000000001',
    guildId: GUILD_ID,
    categoryId: CATEGORY_ID,
    name: 'Vook Vehicles Collection',
    slug: 'vook-vehicles',
    sku: 'VEH-001',
    shortDescription: null,
    description: null,
    price: 14990,
    position: 0,
    enabled: true,
    featured: false,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeItem(pack: CatalogPack): OrderItem {
  return {
    id: `ckitem-${pack.id}`,
    orderId: ORDER_ID,
    packId: pack.id,
    skuSnapshot: pack.sku,
    nameSnapshot: pack.name,
    priceSnapshot: pack.price,
    quantity: 1,
    createdAt: new Date(),
  };
}

function makeOrder(overrides: Partial<Order> = {}, items: OrderItem[] = []): Order & {
  items: OrderItem[];
  payment: Payment | null;
} {
  return {
    id: ORDER_ID,
    guildId: GUILD_ID,
    orderNumber: 184,
    dueAt: null,
    customerId: CUSTOMER_ID,
    status: OrderStatus.PENDING,
    subtotalAmount: 14990,
    discountAmount: 0,
    finalAmount: 14990,
    couponId: null,
    couponCodeSnapshot: null,
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    paymentId: null,
    channelId: null,
    panelChannelId: null,
    panelMessageId: null,
    demandChannelId: null,
    demandMessageId: null,
    demandStartedChannelId: null,
    demandStartedMessageId: null,
    demandDoneChannelId: null,
    demandDoneMessageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    deliveredAt: null,
    deliveredById: null,
    completedAt: null,
    completedById: null,
    assignedToId: null,
    assignedAt: null,
    ...overrides,
    items,
    payment: null,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'ckpayment000000000000001',
    guildId: GUILD_ID,
    customerId: CUSTOMER_ID,
    createdById: STAFF_ID,
    accountId: 'ckaccount00000000000001',
    description: 'Pedido #VK-000184',
    originalAmount: 14990,
    discountAmount: 0,
    finalAmount: 14990,
    couponId: null,
    couponCodeSnapshot: null,
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    pixPayload: '000201...',
    sourceType: 'CATALOG_ORDER',
    sourceId: ORDER_ID,
    status: PaymentStatus.APPROVED,
    expiresAt: new Date(Date.now() + 60_000),
    channelId: null,
    messageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedById: STAFF_ID,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    ...overrides,
  } as Payment;
}

/** Membro de equipe minimo (os services so usam `id`). */
const STAFF = { id: STAFF_ID } as never;

beforeEach(() => {
  vi.resetAllMocks();
  locks.clearAll();
  auditRepo.recordOrderAudit.mockResolvedValue(null);
  // A transacao roda o callback com um "tx" que e o proprio mock.
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        cart: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
  );
});

// ---------------------------------------------------------------------------
// Numeracao
// ---------------------------------------------------------------------------

describe('numeracao do pedido', () => {
  it('formata com prefixo da loja e seis digitos', () => {
    expect(formatOrderNumber(1)).toBe('VK-000001');
    expect(formatOrderNumber(184)).toBe('VK-000184');
    expect(formatOrderNumber(1234567)).toBe('VK-1234567');
  });

  it('numero invalido nunca vira texto quebrado', () => {
    expect(formatOrderNumber(-5)).toBe('VK-000000');
    expect(formatOrderNumber(1.9)).toBe('VK-000001');
  });

  it('a reserva do numero acontece DENTRO da transacao do pedido', async () => {
    const pack = makePack();
    catalogService.getSellablePack.mockResolvedValue(pack);
    orderRepo.findRecentDuplicateOrder.mockResolvedValue(null);
    orderRepo.reserveOrderNumber.mockResolvedValue(184);
    orderRepo.createOrder.mockResolvedValue(makeOrder({}, [makeItem(pack)]));

    await createOrderForPack({
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      packId: pack.id,
      channelId: null,
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(orderRepo.reserveOrderNumber).toHaveBeenCalledTimes(1);
    // O contador e reservado com o cliente transacional, nunca com count()+1.
    expect(orderRepo.reserveOrderNumber.mock.calls[0]?.[1]).toBeDefined();
  });

  /*
   * O elo que faltava: reservar o numero e GRAVAR o numero reservado sao coisas
   * diferentes. O tipo obriga o campo a existir, mas nao obriga que o valor
   * seja o que o contador acabou de devolver — um pedido gravado com numero
   * errado nasceria com codigo duplicado ou colidindo com outro.
   */
  it('grava no pedido exatamente o numero que o contador reservou', async () => {
    const pack = makePack();
    catalogService.getSellablePack.mockResolvedValue(pack);
    orderRepo.findRecentDuplicateOrder.mockResolvedValue(null);
    orderRepo.reserveOrderNumber.mockResolvedValue(184);
    orderRepo.createOrder.mockResolvedValue(makeOrder({}, [makeItem(pack)]));

    const { order } = await createOrderForPack({
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      packId: pack.id,
      channelId: null,
    });

    const payload = orderRepo.createOrder.mock.calls[0]?.[0] as { orderNumber: number };

    expect(payload.orderNumber).toBe(184);
    // E o codigo que o cliente enxerga na tela do pedido.
    expect(formatOrderNumber(order.orderNumber)).toBe('VK-000184');
  });
});

// ---------------------------------------------------------------------------
// Comprar agora
// ---------------------------------------------------------------------------

describe('comprar agora', () => {
  it('cria o pedido com SNAPSHOT do produto', async () => {
    const pack = makePack();
    catalogService.getSellablePack.mockResolvedValue(pack);
    orderRepo.findRecentDuplicateOrder.mockResolvedValue(null);
    orderRepo.reserveOrderNumber.mockResolvedValue(184);
    orderRepo.createOrder.mockResolvedValue(makeOrder({}, [makeItem(pack)]));

    const { order, duplicated } = await createOrderForPack({
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      packId: pack.id,
      channelId: 'ckcanal',
    });

    expect(duplicated).toBe(false);

    const payload = orderRepo.createOrder.mock.calls[0]?.[0] as {
      subtotalAmount: number;
      items: Array<{ priceSnapshot: number; nameSnapshot: string; skuSnapshot: string | null }>;
    };

    expect(payload.subtotalAmount).toBe(14990);
    expect(payload.items).toEqual([
      {
        packId: pack.id,
        skuSnapshot: 'VEH-001',
        nameSnapshot: 'Vook Vehicles Collection',
        priceSnapshot: 14990,
        quantity: 1,
      },
    ]);
    expect(order.items[0]?.priceSnapshot).toBe(14990);
  });

  it('duplo clique NAO cria dois pedidos iguais', async () => {
    const pack = makePack();
    const existente = makeOrder({}, [makeItem(pack)]);
    catalogService.getSellablePack.mockResolvedValue(pack);
    orderRepo.findRecentDuplicateOrder.mockResolvedValue(existente);

    const { order, duplicated } = await createOrderForPack({
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      packId: pack.id,
      channelId: null,
    });

    expect(duplicated).toBe(true);
    expect(order.id).toBe(existente.id);
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
    expect(orderRepo.reserveOrderNumber).not.toHaveBeenCalled();
  });

  it('pack indisponivel nao vira pedido', async () => {
    catalogService.getSellablePack.mockRejectedValue(
      new ValidationError('Pack desativado', { userMessage: 'indisponivel' }),
    );

    await expect(
      createOrderForPack({
        guildId: GUILD_ID,
        customerId: CUSTOMER_ID,
        packId: 'ckpack-x',
        channelId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Checkout do carrinho
// ---------------------------------------------------------------------------

describe('checkout do carrinho', () => {
  const packA = makePack({ id: 'ckpack-a', price: 14990 });
  const packB = makePack({ id: 'ckpack-b', price: 11990, name: 'Clothing Pack' });

  function cartWith(lines: Array<{ pack: CatalogPack; unavailable?: boolean }>): unknown {
    return {
      cart: { id: 'ckcart0000000000000001' },
      lines: lines.map((line) => ({
        item: { id: `ckitem-${line.pack.id}`, packId: line.pack.id },
        pack: line.pack,
        unavailable: line.unavailable === true,
        reason: line.unavailable === true ? 'Indisponivel.' : null,
      })),
      subtotal: lines
        .filter((line) => line.unavailable !== true)
        .reduce((sum, line) => sum + line.pack.price, 0),
      sellableCount: lines.filter((line) => line.unavailable !== true).length,
    };
  }

  it('REVALIDA cada item no banco antes de fechar o pedido', async () => {
    cartService.getCartView.mockResolvedValue(cartWith([{ pack: packA }, { pack: packB }]));
    catalogService.getSellablePack
      .mockResolvedValueOnce(packA)
      .mockResolvedValueOnce(packB);
    orderRepo.findRecentDuplicateOrder.mockResolvedValue(null);
    orderRepo.reserveOrderNumber.mockResolvedValue(185);
    orderRepo.createOrder.mockResolvedValue(
      makeOrder({ orderNumber: 185, subtotalAmount: 26980 }, [makeItem(packA), makeItem(packB)]),
    );

    await checkoutCart({ guildId: GUILD_ID, customerId: CUSTOMER_ID, channelId: null });

    // A revalidacao le do banco, nao do carrinho: um item desativado no meio
    // do caminho e barrado aqui.
    expect(catalogService.getSellablePack).toHaveBeenCalledTimes(2);
  });

  it('o pedido fechado pelo carrinho tambem nasce numerado', async () => {
    cartService.getCartView.mockResolvedValue(cartWith([{ pack: packA }]));
    catalogService.getSellablePack.mockResolvedValue(packA);
    orderRepo.findRecentDuplicateOrder.mockResolvedValue(null);
    orderRepo.reserveOrderNumber.mockResolvedValue(185);
    orderRepo.createOrder.mockResolvedValue(makeOrder({ orderNumber: 185 }, [makeItem(packA)]));

    await checkoutCart({ guildId: GUILD_ID, customerId: CUSTOMER_ID, channelId: null });

    const payload = orderRepo.createOrder.mock.calls[0]?.[0] as { orderNumber: number };

    expect(orderRepo.reserveOrderNumber).toHaveBeenCalledTimes(1);
    expect(payload.orderNumber).toBe(185);
  });

  it('captura o preco ATUAL no momento do pedido, nao o do carrinho', async () => {
    // Carrinho montado quando o pack custava 10000...
    cartService.getCartView.mockResolvedValue(
      cartWith([{ pack: makePack({ id: 'ckpack-a', price: 10000 }) }]),
    );
    // ...mas o preco vigente na hora do checkout e 12000.
    catalogService.getSellablePack.mockResolvedValue(makePack({ id: 'ckpack-a', price: 12000 }));
    orderRepo.findRecentDuplicateOrder.mockResolvedValue(null);
    orderRepo.reserveOrderNumber.mockResolvedValue(186);
    orderRepo.createOrder.mockResolvedValue(makeOrder({ subtotalAmount: 12000 }));

    await checkoutCart({ guildId: GUILD_ID, customerId: CUSTOMER_ID, channelId: null });

    const payload = orderRepo.createOrder.mock.calls[0]?.[0] as {
      subtotalAmount: number;
      items: Array<{ priceSnapshot: number }>;
    };

    expect(payload.items[0]?.priceSnapshot).toBe(12000);
    expect(payload.subtotalAmount).toBe(12000);
  });

  it('carrinho vazio nao gera pedido', async () => {
    cartService.getCartView.mockResolvedValue(cartWith([]));

    await expect(
      checkoutCart({ guildId: GUILD_ID, customerId: CUSTOMER_ID, channelId: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });

  it('carrinho com item indisponivel exige limpeza antes de fechar', async () => {
    cartService.getCartView.mockResolvedValue(
      cartWith([{ pack: packA }, { pack: packB, unavailable: true }]),
    );

    await expect(
      checkoutCart({ guildId: GUILD_ID, customerId: CUSTOMER_ID, channelId: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });

  it('duplo clique no checkout devolve o pedido ja criado', async () => {
    const existente = makeOrder({}, [makeItem(packA)]);
    cartService.getCartView.mockResolvedValue(cartWith([{ pack: packA }]));
    catalogService.getSellablePack.mockResolvedValue(packA);
    orderRepo.findRecentDuplicateOrder.mockResolvedValue(existente);

    const { duplicated, order } = await checkoutCart({
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      channelId: null,
    });

    expect(duplicated).toBe(true);
    expect(order.id).toBe(existente.id);
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cupom (equipe)
// ---------------------------------------------------------------------------

describe('cupom no pedido', () => {
  it('sem cupom, o total e o subtotal', async () => {
    const pricing = await priceOrder(GUILD_ID, CUSTOMER_ID, 26980, null);

    expect(pricing).toEqual({
      discountAmount: 0,
      finalAmount: 26980,
      couponId: null,
      couponCodeSnapshot: null,
      couponTypeSnapshot: null,
      couponValueSnapshot: null,
    });
    expect(couponService.validateCouponForPayment).not.toHaveBeenCalled();
  });

  it('o desconto e calculado pelo MODULO CENTRAL de cupons', async () => {
    couponService.validateCouponForPayment.mockResolvedValue({
      coupon: { id: 'ckcupom1', code: 'VOOK20', type: 'PERCENTAGE', value: 2000 },
      discount: { originalAmount: 26980, discountAmount: 5396, finalAmount: 21584 },
    });

    const pricing = await priceOrder(GUILD_ID, CUSTOMER_ID, 26980, 'ckcupom1');

    expect(couponService.validateCouponForPayment).toHaveBeenCalledWith(
      GUILD_ID,
      'ckcupom1',
      26980,
      CUSTOMER_ID,
    );
    expect(pricing.discountAmount).toBe(5396);
    expect(pricing.finalAmount).toBe(21584);
    expect(pricing.couponCodeSnapshot).toBe('VOOK20');
    expect(pricing.couponValueSnapshot).toBe(2000);
  });

  it('cupom recusado pelo modulo central nao e aplicado ao pedido', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder());
    couponService.validateCouponForPayment.mockRejectedValue(
      new ValidationError('Cupom expirado', { userMessage: 'expirado' }),
    );

    await expect(
      applyOrderCoupon(GUILD_ID, STAFF, ORDER_ID, 'ckcupom1'),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(orderRepo.updateOrderPricing).not.toHaveBeenCalled();
  });

  it('pedido pago NAO aceita mais cupom (valor pago e historico)', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ status: OrderStatus.PAID }));

    await expect(
      applyOrderCoupon(GUILD_ID, STAFF, ORDER_ID, 'ckcupom1'),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(orderRepo.updateOrderPricing).not.toHaveBeenCalled();
  });

  it('pedido com cobranca pendente exige mexer na cobranca, nao no pedido', async () => {
    const order = makeOrder({ status: OrderStatus.AWAITING_PAYMENT });
    order.payment = makePayment({ status: PaymentStatus.PENDING });
    orderRepo.findOrderById.mockResolvedValue(order);

    await expect(
      applyOrderCoupon(GUILD_ID, STAFF, ORDER_ID, 'ckcupom1'),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(orderRepo.updateOrderPricing).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sincronizacao com o pagamento
// ---------------------------------------------------------------------------

describe('pagamento aprovado -> pedido pago', () => {
  it('marca o pedido como pago e registra auditoria', async () => {
    const order = makeOrder({ status: OrderStatus.AWAITING_PAYMENT, paymentId: 'ckpay1' });
    orderRepo.findOrderByPaymentId.mockResolvedValue(order);
    orderRepo.markOrderPaid.mockResolvedValue(true);

    const result = await syncOrderPaid(makePayment({ status: PaymentStatus.APPROVED }));

    expect(result).not.toBeNull();
    expect(orderRepo.markOrderPaid).toHaveBeenCalledWith(ORDER_ID);
    expect(auditRepo.recordOrderAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ORDER_PAID' }),
    );
  });

  it('e IDEMPOTENTE: o segundo evento nao repete nada', async () => {
    const order = makeOrder({ status: OrderStatus.AWAITING_PAYMENT, paymentId: 'ckpay1' });
    orderRepo.findOrderByPaymentId.mockResolvedValue(order);
    // A transicao condicional nao encontra mais o pedido em AWAITING_PAYMENT.
    orderRepo.markOrderPaid.mockResolvedValue(false);

    const result = await syncOrderPaid(makePayment({ status: PaymentStatus.APPROVED }));

    expect(result).toBeNull();
    expect(auditRepo.recordOrderAudit).not.toHaveBeenCalled();
  });

  it('cobranca EXPIRADA nunca marca o pedido como pago', async () => {
    const order = makeOrder({ status: OrderStatus.AWAITING_PAYMENT, paymentId: 'ckpay1' });
    orderRepo.findOrderByPaymentId.mockResolvedValue(order);

    const result = await syncOrderPaid(makePayment({ status: PaymentStatus.EXPIRED }));

    expect(result).toBeNull();
    expect(orderRepo.markOrderPaid).not.toHaveBeenCalled();
  });

  it('cobranca CANCELADA nunca marca o pedido como pago', async () => {
    const order = makeOrder({ status: OrderStatus.AWAITING_PAYMENT, paymentId: 'ckpay1' });
    orderRepo.findOrderByPaymentId.mockResolvedValue(order);

    const result = await syncOrderPaid(makePayment({ status: PaymentStatus.CANCELLED }));

    expect(result).toBeNull();
    expect(orderRepo.markOrderPaid).not.toHaveBeenCalled();
  });

  it('cobranca sem pedido vinculado e ignorada em silencio', async () => {
    orderRepo.findOrderByPaymentId.mockResolvedValue(null);

    expect(await syncOrderPaid(makePayment())).toBeNull();
    expect(orderRepo.markOrderPaid).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Ciclo operacional
// ---------------------------------------------------------------------------

describe('transicoes de estado', () => {
  it('entregar so vale para pedido pago', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ status: OrderStatus.PENDING }));
    orderRepo.markOrderDelivered.mockResolvedValue(false);

    await expect(deliverOrder(GUILD_ID, STAFF, ORDER_ID)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('entrega bem-sucedida audita a mudanca', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ status: OrderStatus.PAID }));
    orderRepo.markOrderDelivered.mockResolvedValue(true);

    await deliverOrder(GUILD_ID, STAFF, ORDER_ID);

    expect(orderRepo.markOrderDelivered).toHaveBeenCalledWith(ORDER_ID, STAFF_ID);
    expect(auditRepo.recordOrderAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ORDER_DELIVERED', performedById: STAFF_ID }),
    );
  });

  it('preparacao so vale para pedido pago', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ status: OrderStatus.DELIVERED }));
    orderRepo.markOrderInProgress.mockResolvedValue(false);

    await expect(startOrderProgress(GUILD_ID, STAFF, ORDER_ID)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('concluir so vale para pedido entregue', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ status: OrderStatus.PAID }));
    orderRepo.markOrderCompleted.mockResolvedValue(false);

    await expect(completeOrder(GUILD_ID, STAFF, ORDER_ID)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('pedido pago NAO pode ser cancelado pelo painel', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ status: OrderStatus.PAID }));
    orderRepo.markOrderCancelled.mockResolvedValue(false);

    await expect(cancelOrder(GUILD_ID, STAFF, ORDER_ID, 'motivo')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('cancelar pedido pendente registra o motivo', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ status: OrderStatus.PENDING }));
    orderRepo.markOrderCancelled.mockResolvedValue(true);

    await cancelOrder(GUILD_ID, STAFF, ORDER_ID, 'cliente desistiu');

    expect(orderRepo.markOrderCancelled).toHaveBeenCalledWith(
      ORDER_ID,
      STAFF_ID,
      'cliente desistiu',
    );
  });

  it('isFinanciallyOpen so aceita os estados anteriores ao pagamento', () => {
    expect(isFinanciallyOpen(makeOrder({ status: OrderStatus.PENDING }))).toBe(true);
    expect(isFinanciallyOpen(makeOrder({ status: OrderStatus.AWAITING_PAYMENT }))).toBe(true);
    expect(isFinanciallyOpen(makeOrder({ status: OrderStatus.PAID }))).toBe(false);
    expect(isFinanciallyOpen(makeOrder({ status: OrderStatus.DELIVERED }))).toBe(false);
    expect(isFinanciallyOpen(makeOrder({ status: OrderStatus.CANCELLED }))).toBe(false);
  });

  it('todo status tem descricao propria em portugues', () => {
    for (const status of Object.values(OrderStatus)) {
      const descricao = describeOrderStatus(status);
      expect(descricao).not.toBe(status);
      expect(descricao.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Seguranca
// ---------------------------------------------------------------------------

describe('acesso ao pedido', () => {
  it('cliente NAO acessa o pedido de outra pessoa', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ customerId: CUSTOMER_ID }));

    await expect(
      requireCustomerOrder(GUILD_ID, '999999999999999999', ORDER_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('pedido de outra guild nao e alcancavel nem pelo dono', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ guildId: '999999999999999999' }));

    await expect(
      requireCustomerOrder(GUILD_ID, CUSTOMER_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('o proprio dono acessa normalmente', async () => {
    orderRepo.findOrderById.mockResolvedValue(makeOrder({ customerId: CUSTOMER_ID }));

    const order = await requireCustomerOrder(GUILD_ID, CUSTOMER_ID, ORDER_ID);
    expect(order.id).toBe(ORDER_ID);
  });
});

// ---------------------------------------------------------------------------
// Venda de balcao: /pagamento criar tambem abre pedido
// ---------------------------------------------------------------------------

/**
 * A cobranca avulsa deixou de ser um evento solto e passou a abrir pedido.
 *
 * Isso e o que devolve numero `VK-`, historico e — o motivo original da
 * mudanca — um lugar onde o comprovante do PIX pode ser gravado. Antes disso,
 * quem pagava uma cobranca feita por `/pagamento criar` nao tinha para onde
 * mandar o comprovante: o botao nao existia e o comando exigia numero de pedido.
 */
describe('pedido da venda de balcao', () => {
  const STAFF_ACTOR = STAFF_ID;

  function arrangeCharge(orderNumber = 190): void {
    orderRepo.reserveOrderNumber.mockResolvedValue(orderNumber);
    orderRepo.createOrder.mockResolvedValue(
      makeOrder({ orderNumber, subtotalAmount: 25000, finalAmount: 25000 }, []),
    );
  }

  it('reserva numero e grava o pedido com o valor da cobranca', async () => {
    arrangeCharge(190);

    const order = await createOrderForCharge({
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      channelId: 'ckcanal',
      amountCents: 25000,
      staffId: STAFF_ACTOR,
    });

    const payload = orderRepo.createOrder.mock.calls[0]?.[0] as {
      orderNumber: number;
      subtotalAmount: number;
      channelId: string | null;
      items: unknown[];
    };

    expect(orderRepo.reserveOrderNumber).toHaveBeenCalledTimes(1);
    expect(payload.orderNumber).toBe(190);
    // O valor vinculante e o da cobranca que o vendedor digitou: nao ha
    // snapshot de pack para somar.
    expect(payload.subtotalAmount).toBe(25000);
    expect(payload.items).toEqual([]);
    // O canal viaja junto porque e por ele que o painel do ticket acha a venda.
    expect(payload.channelId).toBe('ckcanal');
    expect(formatOrderNumber(order.orderNumber)).toBe('VK-000190');
  });

  it('nasce numa transacao, igual a compra do catalogo', async () => {
    arrangeCharge();

    await createOrderForCharge({
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      channelId: null,
      amountCents: 25000,
      staffId: STAFF_ACTOR,
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(orderRepo.reserveOrderNumber.mock.calls[0]?.[1]).toBeDefined();
  });

  it('a auditoria registra o VENDEDOR, nao o cliente', async () => {
    arrangeCharge();

    await createOrderForCharge({
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      channelId: null,
      amountCents: 25000,
      staffId: STAFF_ACTOR,
    });

    const audit = auditRepo.recordOrderAudit.mock.calls[0]?.[0] as {
      performedById: string;
      metadata: { origin: string };
    };

    // Quem fecha a venda de balcao e a equipe; a compra do catalogo continua
    // sendo registrada no nome de quem comprou.
    expect(audit.performedById).toBe(STAFF_ACTOR);
    expect(audit.metadata.origin).toBe('charge');
  });

  it('valor abaixo do minimo nao vira pedido', async () => {
    await expect(
      createOrderForCharge({
        guildId: GUILD_ID,
        customerId: CUSTOMER_ID,
        channelId: null,
        amountCents: 0,
        staffId: STAFF_ACTOR,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(orderRepo.reserveOrderNumber).not.toHaveBeenCalled();
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });
});
