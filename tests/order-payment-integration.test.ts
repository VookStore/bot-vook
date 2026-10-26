import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, PaymentSource, PaymentStatus } from '@prisma/client';
import type { Order, OrderItem, Payment, PaymentAccount } from '@prisma/client';

import { ValidationError } from '../src/core/errors';
import { locks } from '../src/core/locks/LockService';
import {
  cancelOrderPayment,
  createOrderPayment,
  describePaymentState,
} from '../src/modules/catalog/services/OrderPaymentService';

/**
 * REQUISITO CRITICO DA ARQUITETURA
 *
 *   CATALOGO NAO COBRA. CATALOGO CRIA PEDIDO. O PAYMENT SERVICE COBRA.
 *
 * Estes testes existem para impedir a regressao mais cara possivel neste
 * sistema: alguem implementar um "gateway do catalogo" em paralelo ao modulo
 * central. Duas verificacoes independentes:
 *
 *  1. COMPORTAMENTO — gerar a cobranca de um pedido chama exatamente o
 *     `PaymentService.createCharge` usado por `/pagamento criar`, com os
 *     valores do pedido, e os totais voltam DA cobranca.
 *  2. ESTRUTURA — varredura do fonte provando que o modulo do catalogo nao
 *     importa gerador de PIX, QR Code ou provider, e que nao existe
 *     configuracao financeira propria do catalogo no schema.
 */

const GUILD_ID = '111111111111111111';
const CUSTOMER_ID = '222222222222222222';
const STAFF_ID = '333333333333333333';
const ORDER_ID = 'ckorder00000000000000001';
const ACCOUNT_ID = 'ckaccount00000000000001';

/**
 * `vi.hoisted` porque o Vitest sobe as chamadas `vi.mock` para o topo do
 * arquivo: sem isso, a fabrica do mock rodaria antes destes objetos existirem.
 */
const paymentService = vi.hoisted(() => ({ createCharge: vi.fn(), cancelPayment: vi.fn() }));
const cardService = vi.hoisted(() => ({
  publishPaymentCard: vi.fn(),
  refreshPaymentCard: vi.fn(),
}));
const accountService = vi.hoisted(() => ({
  getAccountById: vi.fn(),
  getEnabledAccounts: vi.fn(),
}));
const paymentRepo = vi.hoisted(() => ({
  cancelPaymentAtomic: vi.fn(),
  findPaymentById: vi.fn(),
}));
const orderService = vi.hoisted(() => ({
  requireOrder: vi.fn(),
  linkPaymentToOrder: vi.fn(),
}));

vi.mock('../src/modules/payments/services/PaymentService', () => ({
  createCharge: (...args: unknown[]): unknown => paymentService.createCharge(...args),
  cancelPayment: (...args: unknown[]): unknown => paymentService.cancelPayment(...args),
}));

vi.mock('../src/modules/payments/services/PaymentCardService', () => ({
  publishPaymentCard: (...args: unknown[]): unknown => cardService.publishPaymentCard(...args),
  refreshPaymentCard: (...args: unknown[]): unknown => cardService.refreshPaymentCard(...args),
}));

vi.mock('../src/modules/payments/services/PaymentAccountService', () => ({
  getAccountById: (...args: unknown[]): unknown => accountService.getAccountById(...args),
  getEnabledAccounts: (...args: unknown[]): unknown => accountService.getEnabledAccounts(...args),
}));

vi.mock('../src/modules/payments/repositories/PaymentRepository', () => ({
  cancelPaymentAtomic: (...args: unknown[]): unknown => paymentRepo.cancelPaymentAtomic(...args),
  findPaymentById: (...args: unknown[]): unknown => paymentRepo.findPaymentById(...args),
}));

vi.mock('../src/modules/catalog/services/OrderService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireOrder: (...args: unknown[]): unknown => orderService.requireOrder(...args),
    linkPaymentToOrder: (...args: unknown[]): unknown => orderService.linkPaymentToOrder(...args),
  };
});

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'ckitem0000000000000001',
    orderId: ORDER_ID,
    packId: 'ckpack00000000000000001',
    skuSnapshot: 'VEH-001',
    nameSnapshot: 'Vook Vehicles Collection',
    priceSnapshot: 14990,
    quantity: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeOrder(
  overrides: Partial<Order> = {},
  items: OrderItem[] = [makeItem()],
): Order & { items: OrderItem[]; payment: Payment | null } {
  const subtotal = items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
  return {
    id: ORDER_ID,
    guildId: GUILD_ID,
    orderNumber: 184,
    dueAt: null,
    customerId: CUSTOMER_ID,
    status: OrderStatus.PENDING,
    subtotalAmount: subtotal,
    discountAmount: 0,
    finalAmount: subtotal,
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
    payment: null,
    ...overrides,
    items,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'ckpayment000000000000001',
    guildId: GUILD_ID,
    customerId: CUSTOMER_ID,
    createdById: STAFF_ID,
    accountId: ACCOUNT_ID,
    description: 'Pedido #VK-000184',
    originalAmount: 14990,
    discountAmount: 0,
    finalAmount: 14990,
    couponId: null,
    couponCodeSnapshot: null,
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    pixPayload: '00020126...',
    sourceType: PaymentSource.CATALOG_ORDER,
    sourceId: ORDER_ID,
    status: PaymentStatus.PENDING,
    expiresAt: new Date(Date.now() + 1_800_000),
    channelId: 'ckcanal',
    messageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: null,
    approvedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    ...overrides,
  } as Payment;
}

function makeAccount(overrides: Partial<PaymentAccount> = {}): PaymentAccount {
  return {
    id: ACCOUNT_ID,
    guildId: GUILD_ID,
    name: 'Conta principal',
    identifier: 'principal',
    description: null,
    receiverName: 'VOOK STORE',
    pixKey: 'chave@vook.store',
    pixKeyType: 'EMAIL',
    city: 'SAO PAULO',
    enabled: true,
    defaultExpirationMinutes: 30,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

const GUILD = { id: GUILD_ID } as never;
const STAFF = { id: STAFF_ID } as never;
const CHANNEL = { id: 'ckcanal' } as never;

beforeEach(() => {
  vi.resetAllMocks();
  locks.clearAll();
  accountService.getEnabledAccounts.mockResolvedValue([makeAccount()]);
  cardService.publishPaymentCard.mockResolvedValue({ id: 'ckmensagem' });
  cardService.refreshPaymentCard.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// 1. Comportamento
// ---------------------------------------------------------------------------

describe('o pedido cobra pelo PaymentService central', () => {
  it('chama createCharge com os valores do pedido e a origem rastreavel', async () => {
    const order = makeOrder();
    const payment = makePayment();
    orderService.requireOrder.mockResolvedValue(order);
    orderService.linkPaymentToOrder.mockResolvedValue({ ...order, payment });
    paymentService.createCharge.mockResolvedValue(payment);

    await createOrderPayment({
      guild: GUILD,
      staff: STAFF,
      orderId: ORDER_ID,
      accountId: null,
      channel: CHANNEL,
    });

    expect(paymentService.createCharge).toHaveBeenCalledTimes(1);

    const params = paymentService.createCharge.mock.calls[0]?.[0] as {
      customerId: string;
      accountId: string;
      amountCents: number;
      couponId: string | null;
      description: string;
      source: { type: string; id: string };
    };

    expect(params.customerId).toBe(CUSTOMER_ID);
    expect(params.accountId).toBe(ACCOUNT_ID);
    // O valor cobrado e o SUBTOTAL: o desconto e responsabilidade do
    // PaymentService, que aplica o cupom com a regra central.
    expect(params.amountCents).toBe(order.subtotalAmount);
    expect(params.couponId).toBeNull();
    expect(params.description).toContain('VK-000184');
    // Rastreabilidade Order -> Payment -> provider.
    expect(params.source).toEqual({ type: PaymentSource.CATALOG_ORDER, id: ORDER_ID });
  });

  it('repassa o cupom do pedido para o modulo central decidir o desconto', async () => {
    const order = makeOrder({ couponId: 'ckcupom1', couponCodeSnapshot: 'VOOK20' });
    const payment = makePayment({
      couponId: 'ckcupom1',
      couponCodeSnapshot: 'VOOK20',
      discountAmount: 2998,
      finalAmount: 11992,
    });
    orderService.requireOrder.mockResolvedValue(order);
    orderService.linkPaymentToOrder.mockResolvedValue({ ...order, payment });
    paymentService.createCharge.mockResolvedValue(payment);

    const result = await createOrderPayment({
      guild: GUILD,
      staff: STAFF,
      orderId: ORDER_ID,
      accountId: null,
      channel: CHANNEL,
    });

    const params = paymentService.createCharge.mock.calls[0]?.[0] as { couponId: string | null };
    expect(params.couponId).toBe('ckcupom1');

    // Os totais do pedido vem DA cobranca — nunca de um calculo paralelo.
    const linked = orderService.linkPaymentToOrder.mock.calls[0]?.[3] as Payment;
    expect(linked.discountAmount).toBe(2998);
    expect(linked.finalAmount).toBe(11992);
    expect(result.payment.id).toBe(payment.id);
  });

  it('publica o cartao ANTES de vincular a cobranca ao pedido', async () => {
    const order = makeOrder();
    const payment = makePayment();
    const sequencia: string[] = [];

    orderService.requireOrder.mockResolvedValue(order);
    paymentService.createCharge.mockImplementation(() => {
      sequencia.push('createCharge');
      return Promise.resolve(payment);
    });
    cardService.publishPaymentCard.mockImplementation(() => {
      sequencia.push('publishCard');
      return Promise.resolve({ id: 'ckmensagem' });
    });
    orderService.linkPaymentToOrder.mockImplementation(() => {
      sequencia.push('link');
      return Promise.resolve({ ...order, payment });
    });

    await createOrderPayment({
      guild: GUILD,
      staff: STAFF,
      orderId: ORDER_ID,
      accountId: null,
      channel: CHANNEL,
    });

    expect(sequencia).toEqual(['createCharge', 'publishCard', 'link']);
  });

  it('cobranca que nao chega ao cliente e CANCELADA (nada de PIX orfao)', async () => {
    const order = makeOrder();
    const payment = makePayment();
    orderService.requireOrder.mockResolvedValue(order);
    paymentService.createCharge.mockResolvedValue(payment);
    cardService.publishPaymentCard.mockRejectedValue(new Error('sem permissao no canal'));
    paymentRepo.cancelPaymentAtomic.mockResolvedValue(true);
    paymentRepo.findPaymentById.mockResolvedValue(
      makePayment({ status: PaymentStatus.CANCELLED }),
    );

    await expect(
      createOrderPayment({
        guild: GUILD,
        staff: STAFF,
        orderId: ORDER_ID,
        accountId: null,
        channel: CHANNEL,
      }),
    ).rejects.toBeDefined();

    expect(paymentRepo.cancelPaymentAtomic).toHaveBeenCalledWith(
      payment.id,
      STAFF_ID,
      expect.any(String),
    );
    expect(orderService.linkPaymentToOrder).not.toHaveBeenCalled();
  });

  it('pedido ja pago nao gera nova cobranca', async () => {
    orderService.requireOrder.mockResolvedValue(makeOrder({ status: OrderStatus.PAID }));

    await expect(
      createOrderPayment({
        guild: GUILD,
        staff: STAFF,
        orderId: ORDER_ID,
        accountId: null,
        channel: CHANNEL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(paymentService.createCharge).not.toHaveBeenCalled();
  });

  it('pedido com cobranca PENDENTE exige cancelar antes de emitir outra', async () => {
    const order = makeOrder({ status: OrderStatus.AWAITING_PAYMENT });
    order.payment = makePayment({ status: PaymentStatus.PENDING });
    orderService.requireOrder.mockResolvedValue(order);

    await expect(
      createOrderPayment({
        guild: GUILD,
        staff: STAFF,
        orderId: ORDER_ID,
        accountId: null,
        channel: CHANNEL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(paymentService.createCharge).not.toHaveBeenCalled();
  });

  it('cobranca EXPIRADA permite gerar uma nova (payload antigo nunca e reusado)', async () => {
    const order = makeOrder({ status: OrderStatus.AWAITING_PAYMENT });
    order.payment = makePayment({ status: PaymentStatus.EXPIRED });
    const nova = makePayment({ id: 'ckpayment000000000000002' });

    orderService.requireOrder.mockResolvedValue(order);
    paymentService.createCharge.mockResolvedValue(nova);
    orderService.linkPaymentToOrder.mockResolvedValue({ ...order, payment: nova });

    const result = await createOrderPayment({
      guild: GUILD,
      staff: STAFF,
      orderId: ORDER_ID,
      accountId: null,
      channel: CHANNEL,
    });

    // Uma cobranca NOVA e criada pelo modulo central, com payload novo.
    expect(paymentService.createCharge).toHaveBeenCalledTimes(1);
    expect(result.payment.id).toBe('ckpayment000000000000002');
  });

  it('subtotal divergente dos snapshots bloqueia a cobranca', async () => {
    // Total do pedido nao bate com a soma dos itens: dado inconsistente nao
    // pode virar cobranca.
    orderService.requireOrder.mockResolvedValue(makeOrder({ subtotalAmount: 999 }));

    await expect(
      createOrderPayment({
        guild: GUILD,
        staff: STAFF,
        orderId: ORDER_ID,
        accountId: null,
        channel: CHANNEL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(paymentService.createCharge).not.toHaveBeenCalled();
  });

  it('pedido com total zerado nao pode ser cobrado', async () => {
    orderService.requireOrder.mockResolvedValue(makeOrder({ subtotalAmount: 0 }, []));

    await expect(
      createOrderPayment({
        guild: GUILD,
        staff: STAFF,
        orderId: ORDER_ID,
        accountId: null,
        channel: CHANNEL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  /*
   * Pedido de VENDA DE BALCAO nao tem item — ele nasce de `/pagamento criar`,
   * onde nao existe pack para fotografar. Enquanto a ausencia de item barrava a
   * cobranca, reemitir o PIX de uma venda de balcao cujo primeiro expirou era
   * impossivel pelo painel do pedido: o cliente ficava sem como pagar.
   */
  it('pedido de venda de balcao (sem itens) pode ser cobrado pelo subtotal', async () => {
    const order = makeOrder({ subtotalAmount: 25000, finalAmount: 25000 }, []);
    const payment = makePayment({ originalAmount: 25000, finalAmount: 25000 });
    orderService.requireOrder.mockResolvedValue(order);
    orderService.linkPaymentToOrder.mockResolvedValue({ ...order, payment });
    paymentService.createCharge.mockResolvedValue(payment);

    await createOrderPayment({
      guild: GUILD,
      staff: STAFF,
      orderId: ORDER_ID,
      accountId: null,
      channel: CHANNEL,
    });

    const params = paymentService.createCharge.mock.calls[0]?.[0] as {
      amountCents: number;
      description: string;
    };

    // O valor combinado e o subtotal do pedido, nao uma soma de snapshots.
    expect(params.amountCents).toBe(25000);
    // A descricao nao pode reaproveitar a da cobranca anterior, senao cada
    // reemissao aninharia "Pedido #... — Pedido #...".
    expect(params.description).toContain('Venda avulsa');
  });

  it('conta escolhida pelo vendedor e revalidada antes de cobrar', async () => {
    orderService.requireOrder.mockResolvedValue(makeOrder());
    accountService.getAccountById.mockResolvedValue(makeAccount({ enabled: false }));

    await expect(
      createOrderPayment({
        guild: GUILD,
        staff: STAFF,
        orderId: ORDER_ID,
        accountId: ACCOUNT_ID,
        channel: CHANNEL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(paymentService.createCharge).not.toHaveBeenCalled();
  });

  it('sem conta PIX ativa, o catalogo NAO inventa forma de pagamento', async () => {
    orderService.requireOrder.mockResolvedValue(makeOrder());
    accountService.getEnabledAccounts.mockResolvedValue([]);

    await expect(
      createOrderPayment({
        guild: GUILD,
        staff: STAFF,
        orderId: ORDER_ID,
        accountId: null,
        channel: CHANNEL,
      }),
    ).rejects.toBeDefined();

    expect(paymentService.createCharge).not.toHaveBeenCalled();
  });
});

describe('cancelamento da cobranca do pedido', () => {
  it('usa o cancelamento do modulo central', async () => {
    const order = makeOrder({ status: OrderStatus.AWAITING_PAYMENT });
    order.payment = makePayment({ status: PaymentStatus.PENDING });
    paymentService.cancelPayment.mockResolvedValue(
      makePayment({ status: PaymentStatus.CANCELLED }),
    );

    const cancelou = await cancelOrderPayment(GUILD, STAFF, order, 'pedido cancelado');

    expect(cancelou).toBe(true);
    expect(paymentService.cancelPayment).toHaveBeenCalledWith(
      GUILD_ID,
      STAFF,
      order.payment.id,
      'pedido cancelado',
    );
  });

  it('NUNCA cancela uma cobranca ja aprovada', async () => {
    const order = makeOrder({ status: OrderStatus.PAID });
    order.payment = makePayment({ status: PaymentStatus.APPROVED });

    expect(await cancelOrderPayment(GUILD, STAFF, order, 'motivo')).toBe(false);
    expect(paymentService.cancelPayment).not.toHaveBeenCalled();
  });

  it('pedido sem cobranca nao tenta cancelar nada', async () => {
    expect(await cancelOrderPayment(GUILD, STAFF, makeOrder(), 'motivo')).toBe(false);
    expect(paymentService.cancelPayment).not.toHaveBeenCalled();
  });
});

describe('descricao do estado da cobranca', () => {
  it('cobre todos os status do modulo central', () => {
    expect(describePaymentState(null)).toContain('Nenhuma cobranca');
    expect(describePaymentState(makePayment({ status: PaymentStatus.PENDING }))).toContain(
      'pendente',
    );
    expect(describePaymentState(makePayment({ status: PaymentStatus.APPROVED }))).toContain(
      'aprovada',
    );
    expect(describePaymentState(makePayment({ status: PaymentStatus.EXPIRED }))).toContain(
      'expirada',
    );
    expect(describePaymentState(makePayment({ status: PaymentStatus.CANCELLED }))).toContain(
      'cancelada',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Estrutura (varredura do fonte)
// ---------------------------------------------------------------------------

const SRC = resolve(__dirname, '..', 'src');

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = listFiles(SRC).map((path) => ({
  relative: path.slice(SRC.length + 1).split(sep).join('/'),
  source: readFileSync(path, 'utf8'),
}));

/** Arquivos do catalogo, carrinho e pedidos (inclusive handlers e comandos). */
const CATALOG_FILES = FILES.filter(
  (file) =>
    file.relative.startsWith('modules/catalog/') ||
    file.relative.startsWith('interactions/catalog/') ||
    file.relative.startsWith('interactions/cart/') ||
    file.relative.startsWith('interactions/orders/') ||
    file.relative.startsWith('commands/catalog/'),
);

describe('o catalogo nao possui gateway proprio', () => {
  it('existem arquivos de catalogo para varrer (protege o proprio teste)', () => {
    expect(CATALOG_FILES.length).toBeGreaterThan(10);
  });

  it('nenhum arquivo do catalogo gera PIX ou QR Code', () => {
    const proibidos = ['PixPayloadService', 'QrCodeService', 'buildPixPayload', 'generateQrCode'];
    const infratores: string[] = [];

    for (const file of CATALOG_FILES) {
      for (const termo of proibidos) {
        if (file.source.includes(termo)) infratores.push(`${file.relative} -> ${termo}`);
      }
    }

    expect(infratores).toEqual([]);
  });

  it('nenhum arquivo do catalogo fala com um provider externo', () => {
    const infratores: string[] = [];
    for (const file of CATALOG_FILES) {
      if (/mercadopago|mercado_pago|MercadoPago/i.test(file.source)) {
        infratores.push(`${file.relative} -> provider externo`);
      }
      // `fetch` GLOBAL (chamada HTTP). `channel.messages.fetch(...)` do
      // discord.js e metodo de objeto e nao conta — por isso o `[^.\w]`.
      if (/(^|[^.\w])fetch\s*\(/m.test(file.source) || /axios|node-fetch|undici/.test(file.source)) {
        infratores.push(`${file.relative} -> chamada HTTP direta`);
      }
    }

    expect(infratores).toEqual([]);
  });

  it('somente a PONTE importa o PaymentService', () => {
    const importadores = CATALOG_FILES.filter((file) =>
      /from '.*payments\/services\/PaymentService'/.test(file.source),
    ).map((file) => file.relative);

    expect(importadores).toEqual(['modules/catalog/services/OrderPaymentService.ts']);
  });

  it('nenhum arquivo do catalogo escreve na tabela de pagamentos por fora', () => {
    const infratores = CATALOG_FILES.filter((file) =>
      /\.payment\.(create|update|updateMany|delete)/.test(file.source),
    ).map((file) => file.relative);

    expect(infratores).toEqual([]);
  });

  it('o catalogo nao cria nenhuma tabela de cobranca propria', () => {
    const infratores = CATALOG_FILES.filter((file) =>
      /catalogPayment|orderPayment\.create|CatalogCharge|PackPayment/.test(file.source),
    ).map((file) => file.relative);

    expect(infratores).toEqual([]);
  });
});

describe('o catalogo nao duplica configuracao financeira', () => {
  const schema = readFileSync(resolve(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

  it('o schema nao possui configuracao de pagamento exclusiva do catalogo', () => {
    for (const campo of [
      'catalogPaymentProvider',
      'catalogPixAccount',
      'catalogPixKey',
      'catalogMercadoPagoToken',
      'catalogPaymentAccountId',
      'orderPixKey',
    ]) {
      expect(schema).not.toContain(campo);
    }
  });

  it('o pedido aponta para a MESMA tabela de pagamentos do /pagamento', () => {
    expect(schema).toMatch(/payment\s+Payment\?\s+@relation\(fields: \[paymentId\]/);
    expect(schema).toContain('paymentId String? @unique');
  });

  it('a cobranca guarda a origem para permitir rastrear Order -> Payment', () => {
    expect(schema).toContain('sourceType PaymentSource');
    expect(schema).toContain('enum PaymentSource');
    expect(schema).toContain('CATALOG_ORDER');
  });
});
