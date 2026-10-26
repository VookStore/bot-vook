import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, ComponentType } from 'discord.js';
import type { ContainerBuilder } from 'discord.js';
import {
  OrderStatus,
  PaymentSource,
  PaymentStatus,
  PixKeyType,
  ReceiptCheckStatus,
} from '@prisma/client';
import type { Order, OrderItem, OrderReceipt, Payment } from '@prisma/client';

import { RateLimitError, ValidationError } from '../src/core/errors';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../src/constants/limits';
import { cooldowns, locks } from '../src/core/locks/LockService';

/**
 * Recepcao do comprovante.
 *
 * A REGRA QUE ESTES TESTES TRAVAM: comprovante nunca aprova pagamento.
 * O servico grava evidencia e entrega para a equipe conferir — em nenhum
 * caminho ele toca no status do pedido ou da cobranca.
 */

const GUILD_ID = '111111111111111111';
const CUSTOMER_ID = '222222222222222222';
const ORDER_ID = 'ckorder00000000000000001';

const orderService = vi.hoisted(() => ({ requireCustomerOrder: vi.fn() }));
const receiptRepo = vi.hoisted(() => ({
  createOrderReceipt: vi.fn(),
  countOrderReceipts: vi.fn(),
  findLatestReceipt: vi.fn(),
}));
const downloader = vi.hoisted(() => ({ downloadDiscordAttachment: vi.fn() }));
const ocr = vi.hoisted(() => ({ readReceiptText: vi.fn(), canReadWithOcr: vi.fn() }));
const accounts = vi.hoisted(() => ({ getAccountById: vi.fn() }));
const config = vi.hoisted(() => ({ getGuildConfig: vi.fn() }));
const discord = vi.hoisted(() => ({ sendV2: vi.fn() }));

vi.mock('../src/modules/catalog/services/OrderService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireCustomerOrder: (...args: unknown[]): unknown =>
      orderService.requireCustomerOrder(...args),
  };
});

vi.mock('../src/modules/catalog/repositories/OrderReceiptRepository', () => ({
  createOrderReceipt: (...args: unknown[]): unknown => receiptRepo.createOrderReceipt(...args),
  countOrderReceipts: (...args: unknown[]): unknown => receiptRepo.countOrderReceipts(...args),
  findLatestReceipt: (...args: unknown[]): unknown => receiptRepo.findLatestReceipt(...args),
  listOrderReceipts: () => Promise.resolve([]),
}));

vi.mock('../src/utils/download', () => ({
  downloadDiscordAttachment: (...args: unknown[]): unknown =>
    downloader.downloadDiscordAttachment(...args),
}));

vi.mock('../src/modules/catalog/services/ReceiptOcrService', () => ({
  readReceiptText: (...args: unknown[]): unknown => ocr.readReceiptText(...args),
  canReadWithOcr: (...args: unknown[]): unknown => ocr.canReadWithOcr(...args),
  shutdownOcr: () => Promise.resolve(undefined),
}));

vi.mock('../src/modules/payments/services/PaymentAccountService', () => ({
  getAccountById: (...args: unknown[]): unknown => accounts.getAccountById(...args),
}));

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]): unknown => config.getGuildConfig(...args),
}));

vi.mock('../src/components/reply', () => ({
  sendV2: (...args: unknown[]): unknown => discord.sendV2(...args),
}));

import { submitReceipt } from '../src/modules/catalog/services/OrderReceiptService';
import {
  RECEIPT_UPLOAD_FIELD,
  buildReceiptCustomerAck,
  buildReceiptStaffNotice,
  buildReceiptUploadModal,
  describeReceiptForCustomer,
} from '../src/modules/catalog/builders/ReceiptBuilders';
import {
  buildPaymentCard,
  type PixReceiver,
} from '../src/modules/payments/builders/PaymentBuilders';
import { analyzeReceiptText } from '../src/modules/catalog/validators/receiptParser';

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

function makeItem(): OrderItem {
  return {
    id: 'ckitem1',
    orderId: ORDER_ID,
    packId: 'ckpack1',
    skuSnapshot: 'PCK-001',
    nameSnapshot: 'Cabelos',
    priceSnapshot: 120000,
    quantity: 1,
    createdAt: new Date(),
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'ckpayment1',
    guildId: GUILD_ID,
    customerId: CUSTOMER_ID,
    createdById: '333333333333333333',
    accountId: 'ckaccount1',
    description: 'Pedido #VK-000001',
    originalAmount: 120000,
    discountAmount: 36000,
    finalAmount: 84000,
    couponId: null,
    couponCodeSnapshot: 'VOOK30',
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    pixPayload: '00020126...',
    sourceType: 'CATALOG_ORDER',
    sourceId: ORDER_ID,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 600_000),
    channelId: 'ckcanal',
    messageId: 'ckmensagem',
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

function makeOrder(
  overrides: Partial<Order> = {},
  payment: Payment | null = makePayment(),
): Order & { items: OrderItem[]; payment: Payment | null } {
  return {
    id: ORDER_ID,
    guildId: GUILD_ID,
    orderNumber: 1,
    dueAt: null,
    customerId: CUSTOMER_ID,
    status: OrderStatus.AWAITING_PAYMENT,
    subtotalAmount: 120000,
    discountAmount: 36000,
    finalAmount: 84000,
    couponId: null,
    couponCodeSnapshot: 'VOOK30',
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    paymentId: payment?.id ?? null,
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
    items: [makeItem()],
    payment,
  };
}

/** Canal de texto minimo que passa por `isSendableTextChannel`. */
const STAFF_CHANNEL = {
  id: 'ckcanal',
  type: ChannelType.GuildText,
  isTextBased: () => true,
};

const GUILD = {
  id: GUILD_ID,
  channels: {
    cache: { get: (id: string) => (id === STAFF_CHANNEL.id ? STAFF_CHANNEL : undefined) },
    fetch: (id: string) => Promise.resolve(id === STAFF_CHANNEL.id ? STAFF_CHANNEL : null),
  },
} as never;

function attachment(overrides: Partial<{ name: string; contentType: string | null; size: number }> = {}) {
  return {
    url: 'https://cdn.discordapp.com/attachments/1/2/comprovante.png',
    name: overrides.name ?? 'comprovante.png',
    contentType: overrides.contentType === undefined ? 'image/png' : overrides.contentType,
    size: overrides.size ?? 120_000,
  };
}

function submit(over: Partial<Parameters<typeof submitReceipt>[0]> = {}) {
  return submitReceipt({
    guild: GUILD,
    customerId: CUSTOMER_ID,
    orderId: ORDER_ID,
    attachment: attachment(),
    ...over,
  });
}

/**
 * Data do comprovante no formato que o banco imprime, sempre no MESMO dia da
 * cobranca.
 *
 * NAO fixar aqui e proposital. A cobranca destes testes usa `new Date()` e o
 * parser reprova comprovante mais de 36 h anterior a ela — entao uma data
 * literal (`24/08/2026`) fazia o teste passar na semana em que foi escrito e
 * comecar a acusar MISMATCH sozinho depois, sem uma linha de codigo mudar. O
 * que ele quer afirmar e "comprovante do dia da cobranca confere", e isso nao
 * depende de qual dia e hoje.
 *
 * Quando o alvo do teste E a data (comprovante velho, data no futuro), os dois
 * lados sao fixados juntos — como no bloco do painel da equipe, mais abaixo.
 */
function receiptDateToday(): string {
  return new Date().toLocaleDateString('pt-BR');
}

beforeEach(() => {
  vi.resetAllMocks();
  locks.clearAll();
  cooldowns.clearAll();

  orderService.requireCustomerOrder.mockResolvedValue(makeOrder());
  receiptRepo.countOrderReceipts.mockResolvedValue(0);
  receiptRepo.createOrderReceipt.mockImplementation((input: unknown) =>
    Promise.resolve({ id: 'ckreceipt1', createdAt: new Date(), ...(input as object) }),
  );
  downloader.downloadDiscordAttachment.mockResolvedValue({
    bytes: Buffer.from('imagem'),
    contentType: 'image/png',
  });
  ocr.canReadWithOcr.mockImplementation((type: string) => type.startsWith('image/'));
  ocr.readReceiptText.mockResolvedValue(
    `Valor R$ 840,00 Data ${receiptDateToday()} ENRICK DA SILVA MELLO`,
  );
  accounts.getAccountById.mockResolvedValue({
    id: 'ckaccount1',
    receiverName: 'ENRICK DA SILVA MELLO',
    pixKey: '+5517988012002',
  });
  config.getGuildConfig.mockResolvedValue({ orderChannelId: null, storeName: 'Vook Store' });
  discord.sendV2.mockResolvedValue({ id: 'ckmensagemnova' });
});

// ---------------------------------------------------------------------------
// Estado do pedido
// ---------------------------------------------------------------------------

describe('quando o comprovante e aceito', () => {
  it('pedido sem cobranca gerada recusa (nao ha o que comprovar)', async () => {
    orderService.requireCustomerOrder.mockResolvedValue(
      makeOrder({ status: OrderStatus.PENDING }, null),
    );

    await expect(submit()).rejects.toBeInstanceOf(ValidationError);
    expect(receiptRepo.createOrderReceipt).not.toHaveBeenCalled();
  });

  it('pedido ja pago recusa em vez de aceitar arquivo inutil', async () => {
    orderService.requireCustomerOrder.mockResolvedValue(makeOrder({ status: OrderStatus.PAID }));

    await expect(submit()).rejects.toBeInstanceOf(ValidationError);
  });

  it('pedido cancelado recusa', async () => {
    orderService.requireCustomerOrder.mockResolvedValue(
      makeOrder({ status: OrderStatus.CANCELLED }),
    );

    await expect(submit()).rejects.toBeInstanceOf(ValidationError);
  });

  it('pedido aguardando pagamento aceita', async () => {
    const resultado = await submit();
    expect(resultado.receipt).toBeDefined();
    expect(receiptRepo.createOrderReceipt).toHaveBeenCalledTimes(1);
  });

  it('a dona do pedido e sempre conferida antes de qualquer coisa', async () => {
    await submit();
    expect(orderService.requireCustomerOrder).toHaveBeenCalledWith(
      GUILD_ID,
      CUSTOMER_ID,
      ORDER_ID,
    );
  });
});

// ---------------------------------------------------------------------------
// Arquivo
// ---------------------------------------------------------------------------

describe('validacao do arquivo', () => {
  it('recusa tipo nao suportado', async () => {
    await expect(
      submit({ attachment: attachment({ name: 'virus.exe', contentType: 'application/x-msdownload' }) }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(downloader.downloadDiscordAttachment).not.toHaveBeenCalled();
  });

  it('recusa arquivo acima do teto antes de baixar', async () => {
    await expect(
      submit({ attachment: attachment({ size: BUSINESS_LIMITS.RECEIPT_MAX_BYTES + 1 }) }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(downloader.downloadDiscordAttachment).not.toHaveBeenCalled();
  });

  it('deduz o tipo pela extensao quando o Discord nao informa', async () => {
    const resultado = await submit({
      attachment: attachment({ name: 'comprovante.jpg', contentType: null }),
    });
    expect(resultado.receipt).toBeDefined();
  });

  it('PDF e aceito, mas nao passa por OCR', async () => {
    const resultado = await submit({
      attachment: attachment({ name: 'comprovante.pdf', contentType: 'application/pdf' }),
    });

    expect(ocr.readReceiptText).not.toHaveBeenCalled();
    expect(resultado.analysis.status).toBe(ReceiptCheckStatus.SKIPPED);
  });
});

// ---------------------------------------------------------------------------
// Anti-abuso
// ---------------------------------------------------------------------------

describe('anti-abuso', () => {
  it('segundo envio seguido cai no cooldown', async () => {
    await submit();
    await expect(submit()).rejects.toBeInstanceOf(RateLimitError);
  });

  it('recusa depois do limite de comprovantes do pedido', async () => {
    receiptRepo.countOrderReceipts.mockResolvedValue(BUSINESS_LIMITS.MAX_RECEIPTS_PER_ORDER);

    await expect(submit()).rejects.toBeInstanceOf(ValidationError);
    expect(receiptRepo.createOrderReceipt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Conferencia e entrega
// ---------------------------------------------------------------------------

describe('conferencia e entrega para a equipe', () => {
  it('compara com a cobranca e guarda o resultado', async () => {
    const resultado = await submit();

    expect(resultado.analysis.status).toBe(ReceiptCheckStatus.MATCH);

    const gravado = receiptRepo.createOrderReceipt.mock.calls[0]?.[0] as {
      checkStatus: string;
      detectedAmount: number | null;
      paymentId: string | null;
    };
    expect(gravado.checkStatus).toBe(ReceiptCheckStatus.MATCH);
    expect(gravado.detectedAmount).toBe(84000);
    expect(gravado.paymentId).toBe('ckpayment1');
  });

  it('divergencia de valor e registrada como MISMATCH', async () => {
    // Data do dia: o que precisa reprovar aqui e o VALOR, nao o prazo.
    ocr.readReceiptText.mockResolvedValue(`Valor R$ 10,00 Data ${receiptDateToday()}`);

    const resultado = await submit();
    expect(resultado.analysis.status).toBe(ReceiptCheckStatus.MISMATCH);
  });

  it('OCR que falha vira conferencia manual, nao recusa', async () => {
    ocr.readReceiptText.mockResolvedValue(null);

    const resultado = await submit();
    expect(resultado.analysis.status).toBe(ReceiptCheckStatus.SKIPPED);
    expect(receiptRepo.createOrderReceipt).toHaveBeenCalledTimes(1);
  });

  it('guarda a URL da mensagem do BOT, nao a do anexo do cliente', async () => {
    // O anexo do cliente tem link assinado que expira: guardar essa URL daria
    // evidencia morta em algumas horas.
    const gravado = (await submit(), receiptRepo.createOrderReceipt.mock.calls[0]?.[0]) as {
      fileUrl: string;
    };

    expect(gravado.fileUrl).toContain('discord.com/channels/');
    expect(gravado.fileUrl).not.toContain('cdn.discordapp.com');
  });

  it('sem canal da equipe o comprovante ainda e gravado', async () => {
    config.getGuildConfig.mockResolvedValue({ orderChannelId: null, storeName: 'Vook Store' });
    orderService.requireCustomerOrder.mockResolvedValue(
      makeOrder({}, makePayment({ channelId: null })),
    );

    const resultado = await submit();

    expect(resultado.deliveredToStaff).toBe(false);
    expect(receiptRepo.createOrderReceipt).toHaveBeenCalledTimes(1);
  });

  it('falha ao publicar para a equipe nao perde o comprovante', async () => {
    discord.sendV2.mockRejectedValue(new Error('sem permissao'));

    const resultado = await submit();

    expect(resultado.deliveredToStaff).toBe(false);
    expect(receiptRepo.createOrderReceipt).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// O comprovante nunca aprova
// ---------------------------------------------------------------------------

describe('comprovante NAO aprova pagamento', () => {
  it('nenhum caminho toca no status do pedido ou da cobranca', async () => {
    const pedido = makeOrder();
    orderService.requireCustomerOrder.mockResolvedValue(pedido);

    await submit();

    // O servico so grava evidencia: o pedido continua exatamente como estava.
    expect(pedido.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(pedido.payment?.status).toBe('PENDING');
    expect(pedido.paidAt).toBeNull();
  });

  it('nem mesmo com conferencia perfeita o pedido e aprovado', async () => {
    const pedido = makeOrder();
    orderService.requireCustomerOrder.mockResolvedValue(pedido);

    const resultado = await submit();

    expect(resultado.analysis.status).toBe(ReceiptCheckStatus.MATCH);
    expect(pedido.status).toBe(OrderStatus.AWAITING_PAYMENT);
  });
});

// ---------------------------------------------------------------------------
// Paineis
// ---------------------------------------------------------------------------

interface JsonNode {
  type: ComponentType;
  content?: string;
  custom_id?: string;
  components?: JsonNode[];
  accessory?: JsonNode;
}

function measure(root: ContainerBuilder): { children: number; textTotal: number } {
  const json = root.toJSON() as unknown as JsonNode;
  const children = json.components ?? [];
  let textTotal = 0;
  const walk = (node: JsonNode): void => {
    if (node.type === ComponentType.TextDisplay && typeof node.content === 'string') {
      textTotal += node.content.length;
    }
    for (const child of node.components ?? []) walk(child);
    if (node.accessory !== undefined) walk(node.accessory);
  };
  for (const child of children) walk(child);
  return { children: children.length, textTotal };
}

function allText(root: ContainerBuilder): string {
  const json = root.toJSON() as unknown as JsonNode;
  const parts: string[] = [];
  const walk = (node: JsonNode): void => {
    if (node.type === ComponentType.TextDisplay && typeof node.content === 'string') {
      parts.push(node.content);
    }
    for (const child of node.components ?? []) walk(child);
    if (node.accessory !== undefined) walk(node.accessory);
  };
  for (const child of json.components ?? []) walk(child);
  return parts.join('\n');
}

describe('painel da equipe', () => {
  const analise = analyzeReceiptText(
    'Valor R$ 840,00 Data 24/08/2026 ENRICK DA SILVA MELLO',
    {
      amountCents: 84000,
      chargedAt: new Date(2026, 7, 24, 10),
      receiverName: 'ENRICK DA SILVA MELLO',
      pixKey: '+5517988012002',
    },
    new Date(2026, 7, 24, 15),
  );

  const notice = buildReceiptStaffNotice({
    order: makeOrder(),
    payment: makePayment(),
    analysis: analise,
    uploadedById: CUSTOMER_ID,
    imageFilename: 'comprovante.png',
    fileName: 'comprovante.png',
  });

  it('cabe nos limites do Discord', () => {
    const { children, textTotal } = measure(notice);
    expect(children).toBeLessThanOrEqual(10);
    expect(textTotal).toBeLessThanOrEqual(4000);
  });

  it('AVISA que comprovante e falsificavel — e onde a pessoa decide aprovar', () => {
    const texto = allText(notice).toLowerCase();
    expect(texto).toContain('forjado');
    expect(texto).toContain('auxilio');
  });

  it('nunca imprime a chave PIX completa da loja', () => {
    expect(allText(notice)).not.toContain('+5517988012002');
  });

  it('mostra cada conferencia com o resultado', () => {
    const texto = allText(notice);
    expect(texto).toContain('Valor');
    expect(texto).toContain('Data');
    expect(texto).toContain('Recebedor');
  });
});

describe('confirmacao para o cliente', () => {
  const ack = buildReceiptCustomerAck(makeOrder(), analyzeReceiptText('   ', {
    amountCents: 84000,
    chargedAt: new Date(),
    receiverName: 'X',
    pixKey: '1234',
  }));

  it('cabe nos limites e confirma o recebimento', () => {
    expect(measure(ack).children).toBeLessThanOrEqual(10);
    expect(allText(ack)).toContain('Comprovante recebido');
  });

  it('NAO revela ao cliente o resultado da conferencia automatica', () => {
    // Dizer "confere" a quem forjou soaria como aprovacao; dizer "divergencia"
    // a quem pagou certo gera atrito. Quem le o detalhe e a equipe.
    const texto = allText(ack).toLowerCase();
    expect(texto).not.toContain('divergencia');
    expect(texto).not.toContain('confere com a cobranca');
  });

  it('deixa claro que quem confirma e uma pessoa', () => {
    expect(allText(ack).toLowerCase()).toContain('nao automaticamente');
  });
});

describe('linha do comprovante no pedido do cliente', () => {
  it('sem comprovante nao gera linha', () => {
    expect(describeReceiptForCustomer(null)).toBeNull();
  });

  it('com comprovante mostra que aguarda conferencia', () => {
    const linha = describeReceiptForCustomer({
      createdAt: new Date(),
    } as OrderReceipt);

    expect(linha).toContain('aguardando conferencia');
  });
});

// ---------------------------------------------------------------------------
// Envio pelo proprio cartao da cobranca
// ---------------------------------------------------------------------------

/**
 * O comprovante deixou de exigir `/comprovante enviar` com o numero do pedido
 * na mao: ele e um botao na mesma mensagem em que o cliente acabou de ler o
 * PIX. Isso cria duas obrigacoes, e sao elas que estes testes travam.
 *
 *  1. O botao so pode aparecer onde existe pedido para receber a evidencia.
 *  2. O modal precisa pedir UM arquivo, no campo que o handler realmente le —
 *     um campo com outro nome renderiza igual e some com o comprovante.
 */

function buttonIdsOf(root: ContainerBuilder): Array<string | undefined> {
  const json = root.toJSON() as unknown as JsonNode;
  return (json.components ?? [])
    .filter((node) => node.type === ComponentType.ActionRow)
    .flatMap((row) => (row.components ?? []).filter((node) => node.type === ComponentType.Button))
    .map((button) => button.custom_id);
}

const RECEIPT_BUTTON_ID = 'payment:receipt:ckpayment1';

/** Venda de balcao: `/pagamento criar` abre o pedido e aponta para ele. */
const counterCharge = (): Payment =>
  makePayment({ sourceType: PaymentSource.MANUAL_COMMAND, sourceId: ORDER_ID });

/**
 * Cobranca ANTIGA, emitida antes de toda venda abrir pedido. Nao tem para onde
 * mandar comprovante, e e o unico caso em que o botao some.
 */
const chargeWithoutOrder = (): Payment =>
  makePayment({ sourceType: PaymentSource.MANUAL_COMMAND, sourceId: null });

describe('botao de comprovante no cartao da cobranca', () => {
  it('cobranca de pedido do catalogo oferece o envio ao cliente', () => {
    const ids = buttonIdsOf(buildPaymentCard(makePayment(), { qrFilename: 'pix.png' }));

    expect(ids).toContain(RECEIPT_BUTTON_ID);
    // O cartao so tem UMA linha de botoes (o Container ja esta no teto de 10
    // filhos), e uma linha aceita 5.
    expect(ids.length).toBeLessThanOrEqual(DISCORD_LIMITS.BUTTONS_PER_ROW);
  });

  /*
   * A correcao do relato "falha quando usa o /pagamento": o que decide o botao
   * e a cobranca ter PEDIDO, nunca ela ter vindo do catalogo. Venda de balcao
   * agora abre pedido, entao ela tambem aceita comprovante.
   */
  it('venda de balcao tambem oferece: ela abre pedido igual ao catalogo', () => {
    expect(buttonIdsOf(buildPaymentCard(counterCharge(), { qrFilename: 'pix.png' }))).toContain(
      RECEIPT_BUTTON_ID,
    );
  });

  it('cobranca antiga, sem pedido, nao tem onde gravar a evidencia', () => {
    expect(
      buttonIdsOf(buildPaymentCard(chargeWithoutOrder(), { qrFilename: 'pix.png' })),
    ).not.toContain(RECEIPT_BUTTON_ID);
  });

  it('cobranca ja aprovada nao pede comprovante', () => {
    const card = buildPaymentCard(makePayment({ status: PaymentStatus.APPROVED }));
    expect(buttonIdsOf(card)).not.toContain(RECEIPT_BUTTON_ID);
  });

  it('o rodape deixa de dizer que TODA acao e da equipe', () => {
    // O aviso antigo ("as acoes acima sao restritas a equipe") mandaria embora
    // justamente quem precisa clicar no unico botao que e do cliente.
    const texto = allText(buildPaymentCard(makePayment(), { qrFilename: 'pix.png' }));

    expect(texto).toContain('Comprovante e do cliente');
    expect(texto).toContain('restritas a equipe');
  });

  it('sem o botao, o rodape continua sendo o aviso de acoes so da equipe', () => {
    expect(allText(buildPaymentCard(chargeWithoutOrder(), { qrFilename: 'pix.png' }))).toContain(
      'As acoes acima sao restritas a equipe',
    );
  });

  it('o cartao com o botao continua dentro dos limites do Discord', () => {
    const { children, textTotal } = measure(
      buildPaymentCard(makePayment({ pixPayload: '0'.repeat(400) }), {
        qrFilename: 'pix.png',
        orderLabel: 'VK-000190',
      }),
    );

    expect(children).toBeLessThanOrEqual(10);
    expect(textTotal).toBeLessThanOrEqual(4000);
  });
});

/**
 * O numero do pedido no cartao.
 *
 * E por ele que o cliente acha a compra em `/meus-pedidos` e que a equipe acha
 * a venda no painel comercial — sem ele, a venda de balcao so existia como uma
 * mensagem de PIX perdida canal acima.
 */
describe('numero do pedido no cartao da cobranca', () => {
  it('estampa o pedido no topo do cartao', () => {
    const texto = allText(
      buildPaymentCard(counterCharge(), { qrFilename: 'pix.png', orderLabel: 'VK-000190' }),
    );

    expect(texto).toContain('**Pedido**');
    expect(texto).toContain('#VK-000190');
  });

  it('sem numero resolvido, o cartao sai sem a linha e continua pagavel', () => {
    // O numero e identificacao, nao pre-requisito: falha ao resolver o pedido
    // nao pode tirar o QR nem o copia e cola da frente do cliente.
    const texto = allText(buildPaymentCard(counterCharge(), { qrFilename: 'pix.png' }));

    expect(texto).not.toContain('**Pedido**');
    expect(texto).toContain('PIX Copia e Cola');
  });
});

describe('modal de envio do comprovante', () => {
  interface FieldJson {
    type: ComponentType;
    custom_id: string;
    min_values?: number;
    max_values?: number;
    required?: boolean;
  }
  interface ModalJson {
    custom_id: string;
    title: string;
    components: Array<{ type: ComponentType; component: FieldJson }>;
  }

  const modal = buildReceiptUploadModal('ckpayment1').toJSON() as unknown as ModalJson;
  const campo = modal.components[0]?.component;

  it('cai no handler de comprovante da cobranca', () => {
    expect(modal.custom_id).toBe('payment:receipt-modal:ckpayment1');
    expect(modal.title.length).toBeLessThanOrEqual(DISCORD_LIMITS.MODAL_TITLE);
  });

  it('pede UM arquivo, no campo que o handler le', () => {
    expect(campo?.type).toBe(ComponentType.FileUpload);
    expect(campo?.custom_id).toBe(RECEIPT_UPLOAD_FIELD);
    expect(campo?.min_values).toBe(1);
    // Varios arquivos por envio furariam o limite anti-abuso por pedido, que
    // conta REGISTROS de comprovante.
    expect(campo?.max_values).toBe(1);
    expect(campo?.required).toBe(true);
  });
});

/**
 * Densidade do cartao.
 *
 * O cartao e lido no celular, dentro de um ticket. A versao anterior empilhava
 * cada dado em duas linhas mais uma em branco (dezessete linhas ao todo) e tres
 * divisores, o que empurrava o QR Code para baixo da dobra. Estes testes
 * seguram a compactacao: sem eles, o cartao volta a inchar um bloco por vez.
 */
describe('densidade do cartao da cobranca', () => {
  const STAFF = '999999999999999999';

  it('o cartao pendente cabe em 8 filhos — dois abaixo do teto do container', () => {
    const card = buildPaymentCard(counterCharge(), {
      qrFilename: 'pix.png',
      orderLabel: 'VK-000190',
    });

    // A folga e o que permite, um dia, uma segunda linha de botoes: foi a falta
    // dela que obrigou o comprovante a dividir espaco com as acoes da equipe.
    expect(measure(card).children).toBeLessThanOrEqual(8);
  });

  it('cobranca resolvida absorve o desfecho na propria linha de estado', () => {
    const card = buildPaymentCard(
      makePayment({ status: PaymentStatus.APPROVED, approvedById: STAFF }),
    );

    // Cabecalho + divisor + bloco de dados. O "quem aprovou" nao gasta um
    // TextDisplay so para ele.
    expect(measure(card).children).toBeLessThanOrEqual(3);
    const texto = allText(card);
    expect(texto).toContain('Aprovado pela equipe');
    expect(texto).toContain(STAFF);
  });

  it('sem cupom nao existe linha de cupom', () => {
    // "Cupom: Nenhum" era uma linha inteira para informar ausencia.
    const texto = allText(
      buildPaymentCard(makePayment({ couponCodeSnapshot: null }), { qrFilename: 'pix.png' }),
    );

    expect(texto).not.toContain('Cupom');
  });

  it('com cupom, o cliente ainda consegue conferir a conta', () => {
    const texto = allText(
      buildPaymentCard(makePayment({ couponCodeSnapshot: 'VOOK30' }), { qrFilename: 'pix.png' }),
    );

    // Compactar nao pode virar esconder: valor original e desconto continuam
    // legiveis, so que como subtexto.
    expect(texto).toContain('VOOK30');
    expect(texto).toContain('de R$ 1.200,00');
    expect(texto).toContain('desconto -R$ 360,00');
  });

  it('a descricao nao repete o numero do pedido que ja esta no campo proprio', () => {
    const texto = allText(
      buildPaymentCard(
        makePayment({ description: 'Pedido #VK-000190 — Cabelos' }),
        { qrFilename: 'pix.png', orderLabel: 'VK-000190' },
      ),
    );

    expect(texto).toContain('**Descricao** Cabelos');
    expect(texto).not.toContain('Descricao** Pedido #VK-000190');
  });
});

/**
 * A chave PIX em texto.
 *
 * Existiam dois caminhos para pagar — escanear o QR e colar o payload — e um
 * terceiro cliente, o que digita a chave no app do banco, sem nenhum. A chave
 * so aparecia se a loja a tivesse DESENHADO na arte do QR; loja sem arte
 * cadastrada nao mostrava chave em lugar nenhum, e o cliente voltava a pedir no
 * ticket.
 */
describe('chave PIX em texto no cartao da cobranca', () => {
  const RECEIVER: PixReceiver = {
    key: 'pagamentos@vookstore.com',
    keyType: PixKeyType.EMAIL,
    holder: 'VOOK STORE LTDA',
  };

  it('estampa tipo, chave completa e titular', () => {
    const texto = allText(
      buildPaymentCard(makePayment(), { qrFilename: 'pix.png', receiver: RECEIVER }),
    );

    // A chave sai INTEIRA: mascarada (`maskPixKey`) ela nao serve para pagar.
    // Mascarar e regra dos paineis da equipe, onde a chave e dado
    // administrativo — aqui ela e o proprio meio de pagamento.
    expect(texto).toContain('pagamentos@vookstore.com');
    expect(texto).toContain('E-mail');
    expect(texto).toContain('VOOK STORE LTDA');
  });

  it('avisa que a transferencia por chave nao carrega o valor', () => {
    // O defeito classico desse caminho e o cliente digitar o total errado — e
    // um total errado vira comprovante divergente na conferencia depois.
    const texto = allText(
      buildPaymentCard(makePayment(), { qrFilename: 'pix.png', receiver: RECEIVER }),
    );

    expect(texto).toContain('o valor nao vai junto');
  });

  it('sem conta resolvida o cartao continua pagavel pelos outros dois caminhos', () => {
    const texto = allText(buildPaymentCard(makePayment(), { qrFilename: 'pix.png' }));

    expect(texto).not.toContain('Ou copie a chave');
    expect(texto).toContain('PIX Copia e Cola');
  });

  it('a chave nao gasta um componente: sobe no bloco do copia e cola', () => {
    // A folga de dois filhos no container e o que permite, um dia, uma segunda
    // linha de botoes. Um caminho de pagamento a mais nao pode consumi-la.
    const card = buildPaymentCard(makePayment(), {
      qrFilename: 'pix.png',
      orderLabel: 'VK-000190',
      receiver: RECEIVER,
    });

    expect(measure(card).children).toBeLessThanOrEqual(8);
  });

  it('cobranca ja resolvida nao mostra chave nenhuma', () => {
    // Nao ha bloco de pagamento no cartao aprovado; chave ali so convidaria a
    // pagar de novo uma cobranca que ja morreu.
    const texto = allText(
      buildPaymentCard(makePayment({ status: PaymentStatus.APPROVED }), { receiver: RECEIVER }),
    );

    expect(texto).not.toContain('pagamentos@vookstore.com');
  });
});
