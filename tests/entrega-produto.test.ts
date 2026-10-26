import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  DiscordAPIError,
  GuildPremiumTier,
  PermissionFlagsBits,
} from 'discord.js';
import type { Guild, GuildMember, User } from 'discord.js';
import { OrderStatus, TicketPriority, TicketStatus } from '@prisma/client';
import type { Order, OrderItem, Ticket } from '@prisma/client';

import {
  ConfigurationError,
  PermissionError,
  TicketNotFoundError,
  TicketStateError,
  ValidationError,
} from '../src/core/errors';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../src/constants/limits';

/**
 * Entrega do produto no ticket.
 *
 * O QUE ESTES TESTES TRAVAM, em ordem de gravidade:
 *  1. o arquivo sai como ANEXO DO BOT (ou link da loja) — a URL do upload do
 *     formulario expira em horas, e um produto que some da mao do cliente no
 *     dia seguinte nao foi entregue;
 *  2. o PEDIDO so e marcado ENTREGUE DEPOIS de o arquivo sair. Marcar antes
 *     deixaria no historico uma entrega que nunca aconteceu;
 *  3. o teto de anexo da DM e OUTRO — fora do servidor nao existe nivel de
 *     impulsos. Um pacote de 50 MB que cabe no ticket de um servidor nivel 2
 *     nao cabe na DM, e a DM precisa dizer onde o arquivo esta em vez de
 *     chegar vazia dizendo "seu produto esta anexado";
 *  4. DM fechada e pedido que recusa a transicao NAO derrubam a entrega — o
 *     arquivo ja esta com o cliente quando isso acontece;
 *  5. o formato vem dos BYTES: um RAR renomeado para `.zip` chega ao cliente
 *     como arquivo que o computador dele nao abre;
 *  6. o cartao so convida a avaliar quando ha canal configurado — um botao de
 *     link sem URL derruba a mensagem inteira.
 */

const GUILD_ID = '111111111111111111';
const TICKET_CHANNEL_ID = '222222222222222222';
const REVIEW_CHANNEL_ID = '333333333333333333';
const STAFF_ID = '444444444444444444';
const CUSTOMER_ID = '555555555555555555';
const DM_CHANNEL_ID = '666666666666666666';
const MESSAGE_ID = '777777777777777777';
/** Dono do pedido do ticket, quando a equipe seleciona outra pessoa. */
const OUTRO_ID = '888888888888888888';
/** A pessoa errada, selecionada no formulario. */
const OUTRO_CLIENTE_ID = '999999999999999999';
const CDN_URL = 'https://cdn.discordapp.com/ephemeral-attachments/1/2/pack.zip';
const HOSTED_URL = 'https://transcripts.vook.example/a/0123456789abcdef0123456789abcdef.zip';

const MIB = 1024 * 1024;
/** Servidor sem impulso: o Discord aceita 20 MB. */
const SERVER_20MB = 20 * MIB;
/** Servidor nivel 2: 50 MB no servidor, mas a DM continua em 20. */
const SERVER_50MB = 50 * MIB;

const config = vi.hoisted(() => ({ getGuildConfig: vi.fn() }));
const downloader = vi.hoisted(() => ({ downloadDiscordAttachment: vi.fn() }));
const discord = vi.hoisted(() => ({ sendV2: vi.fn(), sendV2WithLargeFile: vi.fn() }));
const hosting = vi.hoisted(() => ({ hostAsset: vi.fn(), isAssetHostingEnabled: vi.fn() }));
const orders = vi.hoisted(() => ({
  findDeliverableOrderByChannel: vi.fn(),
  findDeliverableOrderInChannel: vi.fn(),
  findOrderAwaitingConfirmation: vi.fn(),
}));
const orderService = vi.hoisted(() => ({ deliverOrder: vi.fn(), completeOrder: vi.fn() }));
const orderNotify = vi.hoisted(() => ({ refreshOrderNotice: vi.fn() }));

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]): unknown => config.getGuildConfig(...args),
}));

vi.mock('../src/utils/download', () => ({
  downloadDiscordAttachment: (...args: unknown[]): unknown =>
    downloader.downloadDiscordAttachment(...args),
}));

vi.mock('../src/components/reply', () => ({
  sendV2: (...args: unknown[]): unknown => discord.sendV2(...args),
  sendV2WithLargeFile: (...args: unknown[]): unknown => discord.sendV2WithLargeFile(...args),
}));

vi.mock('../src/modules/hosting/AssetHostingService', () => ({
  hostAsset: (...args: unknown[]): unknown => hosting.hostAsset(...args),
  isAssetHostingEnabled: (): unknown => hosting.isAssetHostingEnabled(),
}));

vi.mock('../src/modules/catalog/repositories/OrderRepository', () => ({
  findDeliverableOrderByChannel: (...args: unknown[]): unknown =>
    orders.findDeliverableOrderByChannel(...args),
  findDeliverableOrderInChannel: (...args: unknown[]): unknown =>
    orders.findDeliverableOrderInChannel(...args),
  findOrderAwaitingConfirmation: (...args: unknown[]): unknown =>
    orders.findOrderAwaitingConfirmation(...args),
}));

vi.mock('../src/modules/catalog/services/OrderService', () => ({
  deliverOrder: (...args: unknown[]): unknown => orderService.deliverOrder(...args),
  completeOrder: (...args: unknown[]): unknown => orderService.completeOrder(...args),
  formatOrderNumber: (value: number): string => `VK-${String(value).padStart(6, '0')}`,
}));

vi.mock('../src/modules/catalog/services/OrderNotificationService', () => ({
  refreshOrderNotice: (...args: unknown[]): unknown => orderNotify.refreshOrderNotice(...args),
}));

/*
 * Ticket: repositorio, cartao de concluidos e fechamento.
 *
 * Mockados por caminho como o resto. Sem isto a entrega chamava o
 * `markTicketDelivered` REAL e o teste chegava ate o Prisma — nada era gravado
 * (o id e falso), mas teste nao pode depender de banco nenhum.
 */
const ticketRepo = vi.hoisted(() => ({
  findTicketById: vi.fn(),
  findTicketByChannelId: vi.fn(),
  markTicketDelivered: vi.fn(),
}));
const ticketDone = vi.hoisted(() => ({ announceTicketDelivered: vi.fn() }));
const ticketClose = vi.hoisted(() => ({ closeTicket: vi.fn() }));
const locator = vi.hoisted(() => ({ grantDeliveredLocatorAccess: vi.fn() }));

vi.mock('../src/modules/tickets/repositories/TicketRepository', () => ({
  findTicketById: (...args: unknown[]): unknown => ticketRepo.findTicketById(...args),
  findTicketByChannelId: (...args: unknown[]): unknown => ticketRepo.findTicketByChannelId(...args),
  markTicketDelivered: (...args: unknown[]): unknown => ticketRepo.markTicketDelivered(...args),
}));

vi.mock('../src/modules/tickets/services/TicketDoneService', () => ({
  announceTicketDelivered: (...args: unknown[]): unknown =>
    ticketDone.announceTicketDelivered(...args),
}));

vi.mock('../src/modules/tickets/services/TicketCloseService', () => ({
  closeTicket: (...args: unknown[]): unknown => ticketClose.closeTicket(...args),
}));

vi.mock('../src/modules/tickets/services/TicketLocatorService', () => ({
  grantDeliveredLocatorAccess: (...args: unknown[]): unknown =>
    locator.grantDeliveredLocatorAccess(...args),
}));

import {
  DELIVERY_FIELD,
  buildDeliveryCard,
  buildDeliveryDm,
  buildDeliveryModal,
  buildDeliverySummary,
  readDeliveryNote,
  type DeliveryCardData,
  type DeliverySummaryData,
} from '../src/modules/delivery/builders/DeliveryBuilders';
import {
  assertProductDeclaration,
  describeProductMaxSize,
  detectProductFormat,
  discordProductLimit,
  effectiveProductLimit,
  formatFileSize,
  productTransferTimeoutMs,
} from '../src/modules/delivery/validators/product';
import {
  assertCanConfirmReceipt,
  confirmReceipt,
  deliverProduct,
} from '../src/modules/delivery/services/DeliveryService';

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const ZIP_VAZIO = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
const RAR = Buffer.concat([Buffer.from('Rar!', 'latin1'), Buffer.from([0x1a, 0x07, 0x01, 0x00])]);
const SETE_ZIP = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes de um ZIP com o tamanho pedido (a assinatura mais enchimento). */
function zipOf(size: number): Buffer {
  return Buffer.concat([ZIP, Buffer.alloc(Math.max(0, size - ZIP.length))]);
}

const THREAD_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.AttachFiles,
];

interface FakeThread {
  id: string;
  type: ChannelType;
  isTextBased: () => boolean;
  archived: boolean;
  locked: boolean;
  setArchived: ReturnType<typeof vi.fn>;
  permissionsFor: () => { has: (flag: bigint) => boolean };
}

function makeThread(
  granted: readonly bigint[] = THREAD_PERMISSIONS,
  over: Partial<FakeThread> = {},
): FakeThread {
  return {
    id: TICKET_CHANNEL_ID,
    type: ChannelType.PrivateThread,
    isTextBased: () => true,
    archived: false,
    locked: false,
    setArchived: vi.fn(() => Promise.resolve(undefined)),
    permissionsFor: () => ({ has: (flag: bigint) => granted.includes(flag) }),
    ...over,
  };
}

function makeGuild(
  channel: FakeThread | null = makeThread(),
  premiumTier: GuildPremiumTier = GuildPremiumTier.Tier3,
): Guild {
  return {
    id: GUILD_ID,
    premiumTier,
    members: { me: { id: 'bot' } },
    client: { user: { id: 'bot' } },
    channels: {
      cache: { get: (id: string) => (channel !== null && id === channel.id ? channel : undefined) },
      fetch: (id: string) =>
        Promise.resolve(channel !== null && id === channel.id ? channel : null),
    },
  } as unknown as Guild;
}

function makeStaff(): GuildMember {
  return { id: STAFF_ID, guild: { id: GUILD_ID } } as unknown as GuildMember;
}

function makeCustomer(over: Record<string, unknown> = {}): User {
  return {
    id: CUSTOMER_ID,
    bot: false,
    createDM: vi.fn(() => Promise.resolve({ id: DM_CHANNEL_ID, isTextBased: () => true })),
    ...over,
  } as unknown as User;
}

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ckticket0000000000000001',
    guildId: GUILD_ID,
    ticketNumber: 42,
    categoryId: 'ckcat00000000000000000001',
    ownerId: CUSTOMER_ID,
    subject: 'Quero um pack',
    channelId: TICKET_CHANNEL_ID,
    channelName: 'ticket-0042',
    status: TicketStatus.CLAIMED,
    priority: TicketPriority.NORMAL,
    claimedById: STAFF_ID,
    claimedAt: new Date('2026-09-01T10:00:00Z'),
    closedById: null,
    closedAt: null,
    closeReason: null,
    panelMessageId: null,
    transcriptUrl: null,
    transcriptAssetIds: [],
    doneCardChannelId: null,
    doneCardMessageId: null,
    deliveredAt: null,
    deliveredById: null,
    lastClientNotifyAt: null,
    lastRenamedAt: null,
    createdAt: new Date('2026-09-01T09:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...over,
  };
}

function makeOrder(over: Partial<Order> = {}): Order & { items: OrderItem[] } {
  return {
    id: 'ckorder00000000000000001',
    guildId: GUILD_ID,
    orderNumber: 184,
    customerId: CUSTOMER_ID,
    status: OrderStatus.PAID,
    subtotalAmount: 5000,
    discountAmount: 0,
    finalAmount: 5000,
    couponId: null,
    couponCodeSnapshot: null,
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    dueAt: null,
    assignedToId: null,
    assignedAt: null,
    paymentId: null,
    channelId: TICKET_CHANNEL_ID,
    panelChannelId: null,
    panelMessageId: null,
    demandChannelId: null,
    demandMessageId: null,
    demandStartedChannelId: null,
    demandStartedMessageId: null,
    demandDoneChannelId: null,
    demandDoneMessageId: null,
    createdAt: new Date('2026-09-01T09:30:00Z'),
    updatedAt: new Date('2026-09-01T09:30:00Z'),
    paidAt: new Date('2026-09-01T09:40:00Z'),
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    deliveredAt: null,
    deliveredById: null,
    completedAt: null,
    completedById: null,
    items: [],
    ...over,
  };
}

function upload(over: Record<string, unknown> = {}) {
  return {
    url: CDN_URL,
    name: 'pack-lobo.zip',
    contentType: 'application/zip',
    size: 4 * MIB,
    ...over,
  };
}

function deliver(over: Record<string, unknown> = {}) {
  const guild = (over.guild as Guild | undefined) ?? makeGuild();
  return deliverProduct({
    guild,
    staff: makeStaff(),
    ticket: makeTicket(),
    customer: makeCustomer(),
    note: null,
    upload: upload(),
    maxBytes: effectiveProductLimit(guild, true),
    ...over,
  });
}

function cardData(over: Partial<DeliveryCardData> = {}): DeliveryCardData {
  return {
    storeName: 'Vook Store',
    ticketId: 'ckticket0000000000000001',
    customerId: CUSTOMER_ID,
    staffId: STAFF_ID,
    ticketLabel: '#0042',
    orderLabel: 'VK-000184',
    fileName: 'pack-lobo.zip',
    fileSize: '4,0 MB',
    deliveredAt: new Date('2026-09-28T12:00:00Z'),
    note: null,
    fileUrl: 'attachment://pack-lobo.zip',
    hosted: false,
    guildId: GUILD_ID,
    reviewChannelId: REVIEW_CHANNEL_ID,
    ...over,
  };
}

type Json = Record<string, unknown>;

function json(builder: { toJSON: () => unknown }): Json {
  return builder.toJSON() as Json;
}

function childrenOf(builder: { toJSON: () => unknown }): Json[] {
  return (json(builder).components ?? []) as Json[];
}

/** Todo texto do container, concatenado. */
function allText(builder: { toJSON: () => unknown }): string {
  const parts: string[] = [];
  const walk = (nodes: Json[]): void => {
    for (const node of nodes) {
      if (typeof node.content === 'string') parts.push(node.content);
      if (Array.isArray(node.components)) walk(node.components as Json[]);
    }
  };
  walk(childrenOf(builder));
  return parts.join('\n');
}

function buttonsOf(builder: { toJSON: () => unknown }): Json[] {
  const found: Json[] = [];
  const walk = (nodes: Json[]): void => {
    for (const node of nodes) {
      if (node.type === ComponentType.Button) found.push(node);
      if (Array.isArray(node.components)) walk(node.components as Json[]);
    }
  };
  walk(childrenOf(builder));
  return found;
}

/** Chamadas de envio que foram para o canal do ticket (e nao para a DM). */
function ticketSends(): unknown[][] {
  return [
    ...discord.sendV2.mock.calls.filter(
      (call) => (call[0] as { id?: string } | undefined)?.id === TICKET_CHANNEL_ID,
    ),
    ...discord.sendV2WithLargeFile.mock.calls.filter(
      (call) => (call[0] as { id?: string } | undefined)?.id === TICKET_CHANNEL_ID,
    ),
  ];
}

/** Chamadas de envio que foram para a DM do cliente. */
function dmSends(): unknown[][] {
  return [
    ...discord.sendV2.mock.calls.filter(
      (call) => (call[0] as { id?: string } | undefined)?.id === DM_CHANNEL_ID,
    ),
    ...discord.sendV2WithLargeFile.mock.calls.filter(
      (call) => (call[0] as { id?: string } | undefined)?.id === DM_CHANNEL_ID,
    ),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();

  config.getGuildConfig.mockResolvedValue({
    storeName: 'Vook Store',
    reviewChannelId: REVIEW_CHANNEL_ID,
  });
  downloader.downloadDiscordAttachment.mockResolvedValue({
    bytes: zipOf(4 * MIB),
    contentType: 'application/zip',
  });
  discord.sendV2.mockResolvedValue({ id: MESSAGE_ID, channelId: TICKET_CHANNEL_ID });
  discord.sendV2WithLargeFile.mockResolvedValue({ id: MESSAGE_ID, channelId: TICKET_CHANNEL_ID });
  hosting.isAssetHostingEnabled.mockReturnValue(true);
  hosting.hostAsset.mockResolvedValue(HOSTED_URL);
  orders.findDeliverableOrderByChannel.mockResolvedValue(null);
  orders.findDeliverableOrderInChannel.mockResolvedValue(null);
  orderService.deliverOrder.mockImplementation(() => Promise.resolve(makeOrder()));
  orderNotify.refreshOrderNotice.mockResolvedValue(true);
  orders.findOrderAwaitingConfirmation.mockResolvedValue(null);
  orderService.completeOrder.mockImplementation(() =>
    Promise.resolve(makeOrder({ status: OrderStatus.COMPLETED })),
  );
  ticketRepo.findTicketById.mockResolvedValue(makeTicket());
  ticketRepo.findTicketByChannelId.mockResolvedValue(null);
  ticketRepo.markTicketDelivered.mockImplementation((id: string, staffId: string) =>
    Promise.resolve(makeTicket({ id, deliveredById: staffId, deliveredAt: new Date() })),
  );
  ticketDone.announceTicketDelivered.mockResolvedValue({ carded: true, archived: true });
  ticketClose.closeTicket.mockResolvedValue({ dmSent: true });
  locator.grantDeliveredLocatorAccess.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

describe('formulario da entrega', () => {
  const modal = () =>
    json(
      buildDeliveryModal({ ticketLabel: '#0042', ownerHint: 'Enrick', maxBytes: SERVER_20MB }),
    );

  it('pede cliente e arquivo, e so isso e obrigatorio', () => {
    const labels = (modal().components ?? []) as Json[];
    expect(labels).toHaveLength(3);

    const inner = labels.map((label) => label.component as Json);
    expect(inner[0]?.type).toBe(ComponentType.UserSelect);
    expect(inner[1]?.type).toBe(ComponentType.FileUpload);
    expect(inner[1]?.required).toBe(true);
    expect(inner[2]?.required).toBe(false);
  });

  /**
   * O modal do Discord tem teto DURO de 5 componentes e recusa o `showModal`
   * inteiro com 400 quando passa — erro que so aparece em producao.
   */
  it('cabe no teto de campos do Discord', () => {
    expect(((modal().components ?? []) as Json[]).length).toBeLessThanOrEqual(5);
  });

  it('o cliente e um select de USUARIO, nao texto digitado', () => {
    // O cartao menciona a pessoa e a DM precisa de um id de verdade: um nome
    // digitado nao aponta para ninguem.
    const select = ((modal().components ?? []) as Json[])[0]?.component as Json;
    expect(select.type).toBe(ComponentType.UserSelect);
    expect(select.custom_id).toBe(DELIVERY_FIELD.CUSTOMER);
    expect(select.min_values).toBe(1);
    expect(select.max_values).toBe(1);
  });

  it('o dono do ticket aparece como dica, nao como valor marcado', () => {
    // `default_values` dentro de modal nao e documentado; um 400 aqui nao
    // mostraria formulario nenhum.
    const label = ((modal().components ?? []) as Json[])[0];
    expect(String(label?.description)).toContain('Enrick');
    expect((label.component as Json).default_values).toBeUndefined();
  });

  it('o titulo do modal cabe no limite do Discord', () => {
    expect(String(modal().title).length).toBeLessThanOrEqual(DISCORD_LIMITS.MODAL_TITLE);
  });

  it('o teto mostrado e o teto que sera aceito', () => {
    const rotulo = String(((modal().components ?? []) as Json[])[1]?.description);
    expect(rotulo).toContain(describeProductMaxSize(SERVER_20MB));
  });
});

describe('observacao da equipe', () => {
  it('vazia vira nulo', () => {
    expect(readDeliveryNote('   \n  ')).toBeNull();
  });

  it('neutraliza mencao em massa', () => {
    const limpo = readDeliveryNote('senha: @everyone') ?? '';
    expect(limpo).not.toContain('@everyone');
  });

  it('corta no numero de linhas e no tamanho', () => {
    const muitas = Array.from({ length: 40 }, (_, index) => `linha ${index}`).join('\n');
    const limpo = readDeliveryNote(muitas) ?? '';
    expect(limpo.split('\n')).toHaveLength(BUSINESS_LIMITS.DELIVERY_NOTE_MAX_LINES);
    expect(limpo.length).toBeLessThanOrEqual(BUSINESS_LIMITS.DELIVERY_NOTE_MAX);
  });
});

// ---------------------------------------------------------------------------
// Formato e tamanho
// ---------------------------------------------------------------------------

describe('formato lido dos bytes', () => {
  it.each([
    ['zip', ZIP],
    ['zip', ZIP_VAZIO],
    ['rar', RAR],
    ['7z', SETE_ZIP],
  ])('reconhece %s', (ext, bytes) => {
    expect(detectProductFormat(bytes)?.ext).toBe(ext);
  });

  it('imagem renomeada para .zip nao passa', () => {
    expect(detectProductFormat(PNG)).toBeNull();
  });

  it('arquivo curto demais para ter assinatura nao passa', () => {
    expect(detectProductFormat(Buffer.from([0x50]))).toBeNull();
  });
});

describe('teto do arquivo', () => {
  it('o teto do anexo e do SERVIDOR, nao de quem clicou', () => {
    // Quem preenche o formulario pode ter Nitro e subir 500 MB; o bot continua
    // limitado pelo nivel de impulsos. A assinatura nao aceita usuario.
    expect(discordProductLimit.length).toBe(1);
    expect(effectiveProductLimit.length).toBe(2);
  });

  it.each([
    [GuildPremiumTier.None, SERVER_20MB],
    [GuildPremiumTier.Tier1, SERVER_20MB],
    [GuildPremiumTier.Tier2, SERVER_50MB],
    [GuildPremiumTier.Tier3, BUSINESS_LIMITS.DELIVERY_MAX_BYTES],
  ])('nivel %s aceita %s como anexo', (tier, esperado) => {
    expect(discordProductLimit({ premiumTier: tier })).toBe(esperado);
  });

  it('com hospedagem, o teto deixa de depender do impulso do servidor', () => {
    const semImpulso = { premiumTier: GuildPremiumTier.None };
    expect(effectiveProductLimit(semImpulso, false)).toBe(SERVER_20MB);
    expect(effectiveProductLimit(semImpulso, true)).toBe(
      BUSINESS_LIMITS.DELIVERY_HOSTED_MAX_BYTES,
    );
  });

  it('a recusa por tamanho so manda impulsionar quando o impulso resolveria', () => {
    const grande = upload({ size: 30 * MIB });

    const semHospedagem = (() => {
      try {
        assertProductDeclaration(grande, SERVER_20MB, false);
        return null;
      } catch (error) {
        return error as ValidationError;
      }
    })();
    expect(semHospedagem?.userMessage).toContain('impulsos');

    const comHospedagem = (() => {
      try {
        assertProductDeclaration(grande, 20 * MIB, true);
        return null;
      } catch (error) {
        return error as ValidationError;
      }
    })();
    expect(comHospedagem?.userMessage).not.toContain('impulsos');
  });

  it('video declarado e recusado sem baixar 100 MB antes', () => {
    expect(() =>
      assertProductDeclaration(upload({ contentType: 'video/mp4' }), SERVER_20MB, true),
    ).toThrow(ValidationError);
  });

  it('content-type generico do Discord nao reprova o pacote', () => {
    // O Discord declara ZIP ora como application/zip, ora x-zip-compressed,
    // ora octet-stream. Quem decide sao os bytes.
    for (const tipo of ['application/octet-stream', 'application/x-zip-compressed', null]) {
      expect(() =>
        assertProductDeclaration(upload({ contentType: tipo }), SERVER_20MB, true),
      ).not.toThrow();
    }
  });

  it('o prazo de transferencia cresce com o arquivo e tem teto', () => {
    expect(productTransferTimeoutMs(MIB)).toBeLessThan(productTransferTimeoutMs(50 * MIB));
    // O maior pacote possivel ainda fica abaixo do teto: 20 s + 2 s por MB.
    expect(productTransferTimeoutMs(BUSINESS_LIMITS.DELIVERY_MAX_BYTES)).toBe(220_000);
    // E o teto existe para uma transferencia travada nao segurar a fila.
    expect(productTransferTimeoutMs(1000 * MIB)).toBe(5 * 60_000);
  });

  it('o tamanho aparece legivel para o cliente', () => {
    expect(formatFileSize(4 * MIB)).toBe('4,0 MB');
    expect(formatFileSize(2048)).toBe('2 KB');
  });
});

// ---------------------------------------------------------------------------
// Envio no ticket
// ---------------------------------------------------------------------------

describe('o arquivo sai do bot, nunca da URL do formulario', () => {
  it('baixa o anexo e reenvia com os bytes', async () => {
    await deliver();

    expect(downloader.downloadDiscordAttachment).toHaveBeenCalledWith(
      CDN_URL,
      expect.any(Number),
      expect.any(Number),
    );

    const [, , file] = ticketSends()[0] as [unknown, unknown, { name: string; data: Buffer }];
    expect(file.data.subarray(0, 4)).toEqual(ZIP.subarray(0, 4));
  });

  it('o cartao aponta para o anexo, nunca para o CDN do Discord', async () => {
    await deliver();

    const [, root] = ticketSends()[0] as [unknown, { toJSON: () => unknown }];
    const texto = JSON.stringify(json(root));
    expect(texto).toContain('attachment://');
    expect(texto).not.toContain('cdn.discordapp.com');
  });

  it('a extensao entregue e a do formato REAL, nao a do nome', async () => {
    // Um RAR renomeado para .zip chegaria ao cliente como arquivo que o
    // computador dele nao abre.
    downloader.downloadDiscordAttachment.mockResolvedValueOnce({
      bytes: RAR,
      contentType: 'application/zip',
    });

    const resultado = await deliver({ upload: upload({ name: 'pack.zip' }) });

    expect(resultado.fileName).toBe('pack.rar');
  });

  it('arquivo que nao e pacote nenhum e recusado antes de qualquer envio', async () => {
    downloader.downloadDiscordAttachment.mockResolvedValueOnce({
      bytes: PNG,
      contentType: 'application/zip',
    });

    await expect(deliver()).rejects.toBeInstanceOf(ValidationError);
    expect(ticketSends()).toHaveLength(0);
  });

  it('menciona o cliente: a entrega e o aviso dele', async () => {
    await deliver();

    const [, , , options] = ticketSends()[0] as [
      unknown,
      unknown,
      unknown,
      { allowedMentions?: { users?: string[] } },
    ];
    expect(options.allowedMentions?.users).toEqual([CUSTOMER_ID]);
  });
});

describe('quando o arquivo nao cabe como anexo', () => {
  /** 30 MB num servidor sem impulso: passa dos 20 MB do Discord. */
  const grande = (): Record<string, unknown> => {
    const guild = makeGuild(makeThread(), GuildPremiumTier.None);
    downloader.downloadDiscordAttachment.mockResolvedValueOnce({
      bytes: zipOf(30 * MIB),
      contentType: 'application/zip',
    });
    return { guild, upload: upload({ size: 30 * MIB }), maxBytes: effectiveProductLimit(guild, true) };
  };

  it('sobe para o Worker e o cartao ganha botao de download', async () => {
    const resultado = await deliver(grande());

    expect(hosting.hostAsset).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/zip', ext: 'zip' }),
    );
    expect(resultado.hosted).toBe(true);

    const [, root] = ticketSends()[0] as [unknown, { toJSON: () => unknown }];
    const download = buttonsOf(root).find((botao) => botao.url === HOSTED_URL);
    expect(download).toBeDefined();
    expect(download?.style).toBe(ButtonStyle.Link);
  });

  /**
   * O componente de arquivo do Discord SO aceita `attachment://`. Apontar a URL
   * do Worker nele faz a API recusar a mensagem inteira.
   */
  it('o link vira botao, nunca componente de arquivo', async () => {
    await deliver(grande());

    const [, root] = ticketSends()[0] as [unknown, { toJSON: () => unknown }];
    expect(childrenOf(root).some((filho) => filho.type === ComponentType.File)).toBe(false);
  });

  it('hospedagem fora do ar NAO entrega cartao com botao morto', async () => {
    hosting.hostAsset.mockResolvedValueOnce(null);

    await expect(deliver(grande())).rejects.toBeInstanceOf(ValidationError);
    expect(ticketSends()).toHaveLength(0);
    expect(dmSends()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DM
// ---------------------------------------------------------------------------

describe('copia na DM do cliente', () => {
  it('sai com o arquivo quando ele cabe', async () => {
    const resultado = await deliver();

    expect(resultado.dmSent).toBe(true);
    expect(resultado.dmHadFile).toBe(true);
    expect(dmSends()).toHaveLength(1);
  });

  /**
   * O defeito que este teste trava: a DM nao tem nivel de impulsos. Um pacote
   * de 50 MB cabe no ticket de um servidor nivel 2 e NAO cabe na DM — mandar do
   * mesmo jeito daria erro, e omitir sem avisar daria uma DM dizendo "seu
   * produto esta anexado" sem anexo nenhum.
   */
  it('acima de 20 MiB a DM sai SEM o arquivo, dizendo onde ele esta', async () => {
    const guild = makeGuild(makeThread(), GuildPremiumTier.Tier2);
    downloader.downloadDiscordAttachment.mockResolvedValueOnce({
      bytes: zipOf(30 * MIB),
      contentType: 'application/zip',
    });

    const resultado = await deliver({
      guild,
      upload: upload({ size: 30 * MIB }),
      maxBytes: effectiveProductLimit(guild, true),
    });

    expect(resultado.hosted).toBe(false);
    expect(resultado.dmSent).toBe(true);
    expect(resultado.dmHadFile).toBe(false);

    const [, root] = dmSends()[0] as [unknown, { toJSON: () => unknown }];
    expect(allText(root)).toContain('ficou no seu atendimento');
    expect(childrenOf(root).some((filho) => filho.type === ComponentType.File)).toBe(false);
  });

  /**
   * Sem anexo na DM nao quer dizer "esta no ticket". Com o arquivo hospedado
   * ele nao e anexo em lugar nenhum — esta no botao de download da propria DM,
   * e mandar o cliente ao ticket o faria procurar o que nao esta la.
   */
  it('com arquivo hospedado, a DM aponta para o download e nao para o ticket', async () => {
    const guild = makeGuild(makeThread(), GuildPremiumTier.None);
    downloader.downloadDiscordAttachment.mockResolvedValueOnce({
      bytes: zipOf(30 * MIB),
      contentType: 'application/zip',
    });

    await deliver({
      guild,
      upload: upload({ size: 30 * MIB }),
      maxBytes: effectiveProductLimit(guild, true),
    });

    const [, root] = dmSends()[0] as [unknown, { toJSON: () => unknown }];
    const texto = allText(root);
    expect(texto).toContain('Baixe o seu produto pelo botão abaixo');
    expect(texto).not.toContain('ficou no seu atendimento');
    expect(buttonsOf(root).some((botao) => botao.url === HOSTED_URL)).toBe(true);
  });

  /**
   * O defeito que quase passou: o `catch` da DM so absorvia "DM fechada" e
   * "recurso sumido", e RELANCAVA o resto. Um 500 do Discord, a rede caindo ou
   * o upload estourando o prazo transformava uma entrega JA FEITA em "erro
   * inesperado" na tela da equipe — com alerta, pedido sem marcar, e a equipe
   * refazendo o formulario para mandar o mesmo pacote de novo.
   */
  it.each([
    [
      '500 do Discord',
      (): Error =>
        new DiscordAPIError(
          { code: 0, message: 'Internal Server Error' },
          0,
          500,
          'POST',
          '/channels/1/messages',
          {},
        ),
    ],
    ['rede caindo', (): Error => new TypeError('fetch failed')],
    [
      'upload estourando o prazo',
      (): Error => {
        const abortado = new Error('The operation was aborted');
        abortado.name = 'AbortError';
        return abortado;
      },
    ],
  ])('falha tecnica na DM (%s) NAO derruba a entrega ja feita', async (_nome, build) => {
    orders.findDeliverableOrderByChannel.mockResolvedValueOnce(makeOrder());
    discord.sendV2WithLargeFile.mockImplementation((channel: { id: string }) =>
      channel.id === DM_CHANNEL_ID
        ? Promise.reject(build())
        : Promise.resolve({ id: MESSAGE_ID, channelId: TICKET_CHANNEL_ID }),
    );

    const resultado = await deliver();

    // A entrega vale, o pedido e marcado, e a equipe recebe o motivo certo.
    expect(resultado.message.id).toBe(MESSAGE_ID);
    expect(resultado.dmSent).toBe(false);
    expect(resultado.dmFailure).toBe('erro');
    expect(orderService.deliverOrder).toHaveBeenCalled();
  });

  it('DM fechada nao derruba a entrega', async () => {
    const bloqueio = new DiscordAPIError(
      { code: 50007, message: 'Cannot send messages to this user' },
      50007,
      403,
      'POST',
      '/channels/1/messages',
      {},
    );
    discord.sendV2WithLargeFile.mockImplementation((channel: { id: string }) =>
      channel.id === DM_CHANNEL_ID
        ? Promise.reject(bloqueio)
        : Promise.resolve({ id: MESSAGE_ID, channelId: TICKET_CHANNEL_ID }),
    );

    const resultado = await deliver();

    expect(resultado.dmSent).toBe(false);
    expect(resultado.dmFailure).toBe('fechada');
    expect(resultado.message.id).toBe(MESSAGE_ID);
  });

  it('a DM leva o caminho de volta ao atendimento', async () => {
    await deliver();

    const [, root] = dmSends()[0] as [unknown, { toJSON: () => unknown }];
    const botoes = buttonsOf(root);
    expect(botoes.some((botao) => String(botao.url).includes(TICKET_CHANNEL_ID))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

describe('pedido ligado ao atendimento', () => {
  it('o pedido pago do canal vira ENTREGUE', async () => {
    orders.findDeliverableOrderByChannel.mockResolvedValueOnce(makeOrder());

    const resultado = await deliver();

    expect(orders.findDeliverableOrderByChannel).toHaveBeenCalledWith(
      GUILD_ID,
      TICKET_CHANNEL_ID,
      CUSTOMER_ID,
    );
    expect(orderService.deliverOrder).toHaveBeenCalledWith(
      GUILD_ID,
      expect.objectContaining({ id: STAFF_ID }),
      'ckorder00000000000000001',
    );
    expect(orderNotify.refreshOrderNotice).toHaveBeenCalled();
    expect(resultado.orderLabel).toBe('VK-000184');
    expect(resultado.orderMarked).toBe(true);
  });

  /**
   * A ORDEM E O TESTE. Marcar o pedido antes de enviar deixaria no historico
   * uma entrega que nunca aconteceu.
   */
  it('envio que falha NAO marca o pedido', async () => {
    orders.findDeliverableOrderByChannel.mockResolvedValueOnce(makeOrder());
    discord.sendV2WithLargeFile.mockRejectedValueOnce(new Error('sem rede'));

    await expect(deliver()).rejects.toThrow('sem rede');
    expect(orderService.deliverOrder).not.toHaveBeenCalled();
  });

  it('pedido que recusa a transicao vira aviso, nao erro da entrega', async () => {
    orders.findDeliverableOrderByChannel.mockResolvedValueOnce(makeOrder());
    orderService.deliverOrder.mockRejectedValueOnce(
      new ValidationError('transicao invalida', {
        userMessage: 'Somente um pedido pago pode ser marcado como entregue.',
      }),
    );

    const resultado = await deliver();

    expect(resultado.message.id).toBe(MESSAGE_ID);
    expect(resultado.orderMarked).toBe(false);
    expect(resultado.orderWarning).toContain('pedido pago');
  });

  it('sem pedido no canal, entrega normal e nada a marcar', async () => {
    const resultado = await deliver();

    expect(resultado.orderLabel).toBeNull();
    expect(resultado.orderMarked).toBe(false);
    expect(resultado.foreignOrder).toBeNull();
    expect(orderService.deliverOrder).not.toHaveBeenCalled();
  });

  /**
   * "Nenhum pedido pago neste atendimento" e "voce entregou para a pessoa
   * errada" sao coisas muito diferentes. Sem esta consulta as duas sairiam com
   * a MESMA frase — a segunda escondendo o erro de quem poderia corrigi-lo.
   */
  it('pedido do atendimento que e de outra pessoa nao some como "nada a marcar"', async () => {
    orders.findDeliverableOrderByChannel.mockResolvedValueOnce(null);
    orders.findDeliverableOrderInChannel.mockResolvedValueOnce({
      orderNumber: 184,
      customerId: OUTRO_ID,
    });

    const resultado = await deliver({ customer: makeCustomer({ id: OUTRO_CLIENTE_ID }) });

    expect(resultado.orderLabel).toBeNull();
    expect(resultado.foreignOrder).toEqual({ label: 'VK-000184', customerId: OUTRO_ID });
    expect(orderService.deliverOrder).not.toHaveBeenCalled();
  });

  it('achando o pedido do cliente, nao gasta a segunda consulta', async () => {
    orders.findDeliverableOrderByChannel.mockResolvedValueOnce(makeOrder());

    await deliver();

    expect(orders.findDeliverableOrderInChannel).not.toHaveBeenCalled();
  });

  it('o numero do pedido aparece no cartao que o cliente le', async () => {
    orders.findDeliverableOrderByChannel.mockResolvedValueOnce(makeOrder());

    await deliver();

    const [, root] = ticketSends()[0] as [unknown, { toJSON: () => unknown }];
    expect(allText(root)).toContain('VK-000184');
  });
});

// ---------------------------------------------------------------------------
// Canal e estado do ticket
// ---------------------------------------------------------------------------

describe('canal do ticket', () => {
  it('sem AttachFiles o bot recusa antes de baixar', async () => {
    const guild = makeGuild(
      makeThread([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads]),
    );

    const erro = (await deliver({ guild }).catch((error: unknown) => error)) as ConfigurationError;

    expect(erro).toBeInstanceOf(ConfigurationError);
    expect(erro.userMessage).toContain('Anexar arquivos');
    expect(downloader.downloadDiscordAttachment).not.toHaveBeenCalled();
  });

  /**
   * Ticket e TOPICO privado: a permissao de escrever chama-se
   * `SendMessagesInThreads`. Conferir `SendMessages` reprovaria toda entrega.
   */
  it('em topico, confere a permissao de topico', async () => {
    const guild = makeGuild(
      makeThread([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
      ]),
    );

    const erro = (await deliver({ guild }).catch((error: unknown) => error)) as ConfigurationError;

    expect(erro).toBeInstanceOf(ConfigurationError);
    expect(erro.userMessage).toContain('tópicos');
  });

  it('canal sumido vira mensagem de atendimento indisponivel', async () => {
    const erro = (await deliver({ guild: makeGuild(null) }).catch(
      (error: unknown) => error,
    )) as TicketStateError;

    expect(erro).toBeInstanceOf(TicketStateError);
    expect(erro.userMessage).toContain('não existe mais');
  });

  /**
   * Ticket parado 7 dias e arquivado pelo Discord sem deixar de estar aberto —
   * e producao de pack leva dias. Sem reabrir, a entrega falharia no fim.
   */
  it('topico arquivado volta a ficar aberto antes do envio', async () => {
    const thread = makeThread(THREAD_PERMISSIONS, { archived: true });

    await deliver({ guild: makeGuild(thread) });

    expect(thread.setArchived).toHaveBeenCalledWith(false, expect.any(String));
    expect(ticketSends()).toHaveLength(1);
  });

  it('topico trancado nao e reaberto pela entrega', async () => {
    const thread = makeThread(THREAD_PERMISSIONS, { archived: true, locked: true });

    await expect(deliver({ guild: makeGuild(thread) })).rejects.toBeInstanceOf(TicketStateError);
    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it.each([TicketStatus.CLOSED, TicketStatus.CLOSING, TicketStatus.ORPHANED])(
    'ticket %s recusa a entrega',
    async (status) => {
      await expect(deliver({ ticket: makeTicket({ status }) })).rejects.toBeInstanceOf(
        TicketStateError,
      );
      expect(downloader.downloadDiscordAttachment).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// Erros de envio
// ---------------------------------------------------------------------------

describe('o Discord recusa ou cancela o envio', () => {
  it('cancelamento por tempo manda CONFERIR antes de repetir', async () => {
    // `retries: 0` impede a repeticao automatica; esta frase impede a humana,
    // que entregaria o mesmo arquivo duas vezes.
    const abortado = new Error('The operation was aborted');
    abortado.name = 'AbortError';
    discord.sendV2WithLargeFile.mockRejectedValueOnce(abortado);

    const erro = (await deliver().catch((error: unknown) => error)) as ValidationError;

    expect(erro).toBeInstanceOf(ValidationError);
    expect(erro.userMessage).toContain('Confira o ticket antes de entregar de novo');
  });

  it.each([
    [
      '40005 em JSON',
      (): DiscordAPIError =>
        new DiscordAPIError(
          { code: 40005, message: 'Request entity too large' },
          40005,
          400,
          'POST',
          '/channels/1/messages',
          {},
        ),
    ],
    [
      '413 da borda, sem codigo',
      (): DiscordAPIError =>
        new DiscordAPIError(
          new ArrayBuffer(0) as never,
          undefined as never,
          413,
          'POST',
          '/channels/1/messages',
          {},
        ),
    ],
  ])('recusa por tamanho (%s) vira aviso de tamanho', async (_nome, build) => {
    discord.sendV2WithLargeFile.mockRejectedValueOnce(build());

    const erro = (await deliver().catch((error: unknown) => error)) as ValidationError;

    expect(erro).toBeInstanceOf(ValidationError);
    expect(erro.userMessage).toContain('recusou o arquivo por tamanho');
  });

  it('outros erros do Discord continuam subindo como estao', async () => {
    const outro = new DiscordAPIError(
      { code: 50013, message: 'Missing Permissions' },
      50013,
      403,
      'POST',
      '/channels/1/messages',
      {},
    );
    discord.sendV2WithLargeFile.mockRejectedValueOnce(outro);

    await expect(deliver()).rejects.toBe(outro);
  });
});

// ---------------------------------------------------------------------------
// Cartao
// ---------------------------------------------------------------------------

describe('cartao da entrega', () => {
  it('cabe nos limites de um container V2', () => {
    const cheio = cardData({ note: 'senha: vook2026\nsegunda linha', hosted: false });
    for (const root of [buildDeliveryCard(cheio), buildDeliveryDm({ ...cheio, ticketChannelId: TICKET_CHANNEL_ID, fileAttached: true })]) {
      expect(childrenOf(root).length).toBeLessThanOrEqual(10);
      expect(allText(root).length).toBeLessThanOrEqual(4000);
    }
  });

  it('agradece, menciona o cliente e mostra o que foi entregue', () => {
    const texto = allText(buildDeliveryCard(cardData()));

    expect(texto).toContain(`<@${CUSTOMER_ID}>`);
    expect(texto).toContain('pack-lobo.zip');
    expect(texto).toContain('#0042');
    expect(texto).toContain('Agradecemos a confiança');
  });

  it('convida a avaliar quando ha canal', () => {
    const botoes = buttonsOf(buildDeliveryCard(cardData()));
    const avaliar = botoes.find((botao) => String(botao.url).includes(REVIEW_CHANNEL_ID));

    expect(avaliar).toBeDefined();
    expect(avaliar?.style).toBe(ButtonStyle.Link);
  });

  /**
   * Um `ButtonStyle.Link` sem URL valida e recusado pela API e derruba a
   * mensagem INTEIRA — a entrega junto.
   */
  it('sem canal de avaliacoes, nenhum botao de LINK fica sem URL', () => {
    const root = buildDeliveryCard(cardData({ reviewChannelId: null, hosted: false }));
    // So os de link: "Confirmar recebimento" e botao de acao, sem URL por natureza.
    const links = buttonsOf(root).filter((botao) => botao.style === ButtonStyle.Link);

    expect(links.every((botao) => typeof botao.url === 'string' && botao.url.length > 0)).toBe(
      true,
    );
    expect(links.some((botao) => String(botao.url).includes(REVIEW_CHANNEL_ID))).toBe(false);
  });

  it('o arquivo anexado entra como componente de arquivo', () => {
    const root = buildDeliveryCard(cardData());
    const arquivo = childrenOf(root).find((filho) => filho.type === ComponentType.File);

    expect((arquivo?.file as Json | undefined)?.url).toBe('attachment://pack-lobo.zip');
  });

  it('a observacao da equipe aparece citada', () => {
    const texto = allText(buildDeliveryCard(cardData({ note: 'senha: vook2026' })));
    expect(texto).toContain('> senha: vook2026');
  });
});

// ---------------------------------------------------------------------------
// Resumo para quem entregou
// ---------------------------------------------------------------------------

describe('resumo da entrega', () => {
  function resumo(over: Partial<DeliverySummaryData> = {}): string {
    return buildDeliverySummary({
      dmSent: true,
      dmHadFile: true,
      dmFailure: null,
      hosted: false,
      orderLabel: 'VK-000184',
      orderMarked: true,
      orderWarning: null,
      foreignOrder: null,
      reviewChannelMissing: false,
      ticketMoved: true,
      ...over,
    });
  }

  /**
   * TRES resultados de DM, nao dois. "Sem o arquivo" nao quer dizer "esta no
   * ticket": com o arquivo hospedado ele nao e anexo em lugar nenhum, e a DM
   * leva o botao de download. Dizer a equipe que a DM aponta para o ticket a
   * faria explicar errado ao cliente.
   */
  it.each([
    [{ dmHadFile: true, hosted: false }, 'com o arquivo'],
    [{ dmHadFile: false, hosted: true }, 'com o botão de download'],
    [{ dmHadFile: false, hosted: false }, 'aponta para o ticket'],
  ])('a linha da DM diz o que de fato saiu (%o)', (over, esperado) => {
    expect(resumo(over)).toContain(esperado);
  });

  it('separa DM fechada de falha tecnica', () => {
    expect(resumo({ dmSent: false, dmHadFile: false, dmFailure: 'fechada' })).toContain(
      'mensagens diretas fechadas',
    );
    expect(resumo({ dmSent: false, dmHadFile: false, dmFailure: 'erro' })).toContain(
      'erro técnico',
    );
  });

  it('pedido de outra pessoa vira alerta, nao "nada a marcar"', () => {
    const texto = resumo({
      orderLabel: null,
      orderMarked: false,
      foreignOrder: { label: 'VK-000184', customerId: OUTRO_ID },
    });

    expect(texto).toContain('VK-000184');
    expect(texto).toContain(`<@${OUTRO_ID}>`);
    expect(texto).not.toContain('nada a marcar');
  });

  it('sem pedido nenhum, diz que nao ha nada a marcar', () => {
    expect(resumo({ orderLabel: null, orderMarked: false })).toContain('nada a marcar');
  });

  it('pedido recusado mostra o motivo', () => {
    expect(
      resumo({ orderMarked: false, orderWarning: 'Somente um pedido pago pode ser entregue.' }),
    ).toContain('Somente um pedido pago');
  });

  it('avisa quando o convite de avaliação ficou de fora', () => {
    expect(resumo({ reviewChannelMissing: true })).toContain('canal de avaliações');
  });
});

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

describe('fila de transferencias', () => {
  /**
   * Dois arquivos grandes em paralelo somam ~400 MB de RSS num processo que o
   * PM2 reinicia em 512 MB. A fila e a mesma do portfolio de lobos.
   */
  it('duas entregas no mesmo servidor nao transferem ao mesmo tempo', async () => {
    let emVoo = 0;
    let pico = 0;
    downloader.downloadDiscordAttachment.mockImplementation(async () => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await Promise.resolve();
      emVoo -= 1;
      return { bytes: zipOf(4 * MIB), contentType: 'application/zip' };
    });

    await Promise.all([deliver(), deliver()]);

    expect(pico).toBe(1);
    expect(ticketSends()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Ticket para os concluidos
// ---------------------------------------------------------------------------

describe('o ticket vai para os concluidos', () => {
  it('registra quem entregou e manda o ticket para os concluidos', async () => {
    const resultado = await deliver();

    expect(ticketRepo.markTicketDelivered).toHaveBeenCalledWith(
      'ckticket0000000000000001',
      STAFF_ID,
    );
    expect(ticketDone.announceTicketDelivered).toHaveBeenCalled();
    expect(resultado.ticketMoved).toBe(true);
  });

  /**
   * Arquivar tira o ticket da lista de ativos. Se isso acontecesse antes do
   * cartao, a mencao ao cliente e o arquivo sairiam num topico ja escondido.
   */
  it('acontece DEPOIS de o arquivo sair', async () => {
    await deliver();

    const envio = discord.sendV2WithLargeFile.mock.invocationCallOrder[0] ?? Infinity;
    const movido = ticketDone.announceTicketDelivered.mock.invocationCallOrder[0] ?? -1;
    expect(movido).toBeGreaterThan(envio);
  });

  /**
   * O topico acabou de sair da lista lateral: o canal de entregas, com o painel
   * de localizar, e o caminho de volta do CLIENTE.
   */
  it('o cliente ganha acesso ao canal de entregas', async () => {
    await deliver();

    expect(locator.grantDeliveredLocatorAccess).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOMER_ID,
    );
  });

  it('sem canal de concluidos, a equipe e avisada que o ticket ficou nos ativos', async () => {
    ticketDone.announceTicketDelivered.mockResolvedValueOnce({ carded: false, archived: false });

    const resultado = await deliver();

    expect(resultado.ticketMoved).toBe(false);
  });

  /** O arquivo ja esta com o cliente: nada aqui pode virar erro da entrega. */
  it('falha ao registrar a entrega no ticket nao derruba a entrega', async () => {
    ticketRepo.markTicketDelivered.mockRejectedValueOnce(new Error('banco fora'));

    const resultado = await deliver();

    expect(resultado.message.id).toBe(MESSAGE_ID);
    expect(resultado.ticketMoved).toBe(false);
  });

  it('o cartao no ticket traz o botao de confirmar recebimento', () => {
    const botoes = buttonsOf(buildDeliveryCard(cardData()));
    const confirmar = botoes.find((botao) => botao.label === 'Confirmar recebimento');

    expect(confirmar?.style).toBe(ButtonStyle.Secondary);
    expect(confirmar?.custom_id).toBe('delivery:confirm:ckticket0000000000000001');
  });

  /** Confirmar fora do ticket esconderia da equipe que o atendimento acabou. */
  it('a DM NAO traz o botao de confirmar', () => {
    const dm = buildDeliveryDm({
      ...cardData(),
      ticketChannelId: TICKET_CHANNEL_ID,
      fileAttached: true,
    });

    expect(buttonsOf(dm).some((botao) => botao.label === 'Confirmar recebimento')).toBe(false);
    expect(allText(dm)).toContain('Confirme o recebimento no seu atendimento');
  });
});

// ---------------------------------------------------------------------------
// Confirmacao do cliente
// ---------------------------------------------------------------------------

describe('o cliente confirma o recebimento', () => {
  const membro = (id: string) => ({ id, guild: { id: GUILD_ID } }) as unknown as GuildMember;
  const guild = () => makeGuild();

  it('o dono do ticket pode confirmar', async () => {
    const ticket = await assertCanConfirmReceipt(guild(), membro(CUSTOMER_ID), 'ckticket0000000000000001');
    expect(ticket.id).toBe('ckticket0000000000000001');
  });

  /** O botao fica num cartao que a equipe tambem ve. */
  it('quem nao e o dono nao confirma', async () => {
    const erro = (await assertCanConfirmReceipt(
      guild(),
      membro(STAFF_ID),
      'ckticket0000000000000001',
    ).catch((error: unknown) => error)) as PermissionError;

    expect(erro).toBeInstanceOf(PermissionError);
    expect(erro.userMessage).toContain('Só o cliente');
  });

  /**
   * Segundo clique: o botao continua no cartao depois de confirmado. E recusa
   * de regra — nao pode virar alerta no canal de erros.
   */
  it('ticket ja fechado e recusa esperada, nao falha', async () => {
    ticketRepo.findTicketById.mockResolvedValueOnce(makeTicket({ status: TicketStatus.CLOSED }));

    const erro = (await assertCanConfirmReceipt(
      guild(),
      membro(CUSTOMER_ID),
      'ckticket0000000000000001',
    ).catch((error: unknown) => error)) as TicketStateError;

    expect(erro).toBeInstanceOf(TicketStateError);
    expect(erro.expected).toBe(true);
  });

  it('ticket de outro servidor nao existe para quem clicou', async () => {
    ticketRepo.findTicketById.mockResolvedValueOnce(makeTicket({ guildId: '999999999999999999' }));

    await expect(
      assertCanConfirmReceipt(guild(), membro(CUSTOMER_ID), 'ckticket0000000000000001'),
    ).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it('fecha o ticket e conclui o pedido entregue', async () => {
    orders.findOrderAwaitingConfirmation.mockResolvedValueOnce(
      makeOrder({ status: OrderStatus.DELIVERED }),
    );

    const resultado = await confirmReceipt(guild(), membro(CUSTOMER_ID), makeTicket());

    expect(ticketClose.closeTicket).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: CUSTOMER_ID }),
      'ckticket0000000000000001',
      expect.stringContaining('confirmado pelo cliente'),
    );
    expect(orderService.completeOrder).toHaveBeenCalled();
    expect(resultado).toEqual({ orderLabel: 'VK-000184', orderCompleted: true, dmSent: true });
  });

  /**
   * O fechamento e a unica parte que pode falhar alto, e por isso vem
   * primeiro: se ele falhar, nada mudou — nem o pedido.
   */
  it('se o fechamento falhar, o pedido nao e tocado', async () => {
    // `mockResolvedValue`, e nao `...Once`: o fechamento lanca ANTES de o pedido
    // ser buscado, e um valor "uma vez" nunca consumido escorreria para o
    // proximo teste (`clearAllMocks` nao esvazia essa fila). O `beforeEach`
    // devolve o padrao nulo.
    orders.findOrderAwaitingConfirmation.mockResolvedValue(
      makeOrder({ status: OrderStatus.DELIVERED }),
    );
    ticketClose.closeTicket.mockRejectedValueOnce(new Error('lock ocupado'));

    await expect(confirmReceipt(guild(), membro(CUSTOMER_ID), makeTicket())).rejects.toThrow(
      'lock ocupado',
    );
    expect(orderService.completeOrder).not.toHaveBeenCalled();
  });

  it('pedido que nao conclui nao desfaz o fechamento que o cliente pediu', async () => {
    orders.findOrderAwaitingConfirmation.mockResolvedValueOnce(
      makeOrder({ status: OrderStatus.DELIVERED }),
    );
    orderService.completeOrder.mockRejectedValueOnce(new Error('transicao recusada'));

    const resultado = await confirmReceipt(guild(), membro(CUSTOMER_ID), makeTicket());

    expect(ticketClose.closeTicket).toHaveBeenCalled();
    expect(resultado.orderCompleted).toBe(false);
  });

  it('entrega sem pedido so fecha o ticket', async () => {
    const resultado = await confirmReceipt(guild(), membro(CUSTOMER_ID), makeTicket());

    expect(resultado).toEqual({ orderLabel: null, orderCompleted: false, dmSent: true });
    expect(orderService.completeOrder).not.toHaveBeenCalled();
  });
});
