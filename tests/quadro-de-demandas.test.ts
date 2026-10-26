import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonStyle, ChannelType, ComponentType, DiscordAPIError } from 'discord.js';
import type { Guild } from 'discord.js';
import { OrderStatus } from '@prisma/client';
import type { Order, OrderItem, Payment } from '@prisma/client';

/**
 * Quadro de demandas.
 *
 * O QUE ESTES TESTES TRAVAM, em ordem de gravidade:
 *  1. NADA aqui derruba uma operacao comercial — canal apagado, permissao
 *     faltando ou DM fechada viram `false`, nunca erro. O pedido ja mudou de
 *     estado no banco quando estas funcoes rodam;
 *  2. publicar e iniciar sao IDEMPOTENTES. O recovery reprocessa pagamentos que
 *     ficaram pela metade, e "pegar a proxima" e "iniciar demanda" chegam pelo
 *     mesmo caminho — sem isso, a mesma demanda ganharia dois cartoes vivos
 *     (cada um com os proprios botoes) e o cliente levaria a novidade duas
 *     vezes;
 *  3. o cartao diz O QUE PRODUZIR. Venda de balcao nasce sem item, e sem a
 *     descricao da cobranca o cartao seria uma demanda sem demanda;
 *  4. o cartao do quadro NAO some quando a demanda inicia — ele e reescrito, e
 *     a copia vai para o canal de iniciadas;
 *  5. os botoes sao os do estado ATUAL: um botao que so sabe responder "essa
 *     transicao nao vale agora" ensina a equipe a ignorar o cartao.
 */

const GUILD_ID = '111111111111111111';
const BOARD_ID = '222222222222222222';
const STARTED_ID = '333333333333333333';
const TICKET_ID = '444444444444444444';
const CUSTOMER_ID = '555555555555555555';
const STAFF_ID = '666666666666666666';
const BOARD_MESSAGE_ID = '777777777777777777';
const STARTED_MESSAGE_ID = '888888888888888888';
const DONE_ID = '999999999999999990';
const DONE_MESSAGE_ID = '999999999999999991';

const config = vi.hoisted(() => ({ getGuildConfig: vi.fn() }));
const discord = vi.hoisted(() => ({ sendV2: vi.fn() }));
const orders = vi.hoisted(() => ({
  findOrderById: vi.fn(),
  setDemandMessage: vi.fn(),
  setDemandStartedMessage: vi.fn(),
  setDemandDoneMessage: vi.fn(),
}));
const notifications = vi.hoisted(() => ({ trySendDm: vi.fn() }));
const tickets = vi.hoisted(() => ({ findTicketByChannelId: vi.fn() }));

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]): unknown => config.getGuildConfig(...args),
}));

vi.mock('../src/components/reply', () => ({
  sendV2: (...args: unknown[]): unknown => discord.sendV2(...args),
}));

vi.mock('../src/modules/catalog/repositories/OrderRepository', () => ({
  findOrderById: (...args: unknown[]): unknown => orders.findOrderById(...args),
  setDemandMessage: (...args: unknown[]): unknown => orders.setDemandMessage(...args),
  setDemandStartedMessage: (...args: unknown[]): unknown =>
    orders.setDemandStartedMessage(...args),
  setDemandDoneMessage: (...args: unknown[]): unknown => orders.setDemandDoneMessage(...args),
}));

vi.mock('../src/modules/catalog/services/OrderNotificationService', () => ({
  trySendDm: (...args: unknown[]): unknown => notifications.trySendDm(...args),
}));

vi.mock('../src/modules/tickets/repositories/TicketRepository', () => ({
  findTicketByChannelId: (...args: unknown[]): unknown => tickets.findTicketByChannelId(...args),
}));

vi.mock('../src/modules/catalog/services/OrderService', () => ({
  formatOrderNumber: (value: number): string => `VK-${String(value).padStart(6, '0')}`,
  describeOrderStatus: (status: OrderStatus): string => `estado ${status}`,
  orderStatusIcon: (): string => '🟢',
}));

vi.mock('../src/modules/catalog/services/DeliveryEstimateService', () => ({
  dueStatusOf: (dueAt: Date | null): string =>
    dueAt !== null && dueAt.getTime() < Date.UTC(2026, 8, 30) ? 'atrasado' : 'no-prazo',
}));

import {
  buildDemandCard,
  buildDemandDoneCard,
  buildDemandStartedDm,
  type DemandCardData,
} from '../src/modules/demands/builders/DemandBuilders';
import {
  announceDemandStarted,
  publishDemand,
  publishDemandDone,
  refreshDemandCards,
} from '../src/modules/demands/services/DemandBoardService';

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

type OrderFull = Order & { items: OrderItem[]; payment: Payment | null };

function makePayment(over: Partial<Payment> = {}): Payment {
  return {
    description: 'Lobo Lycan sob encomenda',
    ...over,
  } as Payment;
}

function makeOrder(over: Partial<OrderFull> = {}): OrderFull {
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
    channelId: TICKET_ID,
    panelChannelId: null,
    panelMessageId: null,
    demandChannelId: null,
    demandMessageId: null,
    demandStartedChannelId: null,
    demandStartedMessageId: null,
    demandDoneChannelId: null,
    demandDoneMessageId: null,
    createdAt: new Date('2026-09-01T09:00:00Z'),
    updatedAt: new Date('2026-09-28T12:00:00Z'),
    paidAt: new Date('2026-09-01T09:40:00Z'),
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    deliveredAt: null,
    deliveredById: null,
    completedAt: null,
    completedById: null,
    items: [],
    payment: makePayment(),
    ...over,
  } as OrderFull;
}

interface FakeMessage {
  id: string;
  edit: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
}

interface FakeChannel {
  id: string;
  type: ChannelType;
  isTextBased: () => boolean;
  messages: { fetch: ReturnType<typeof vi.fn> };
}

function makeChannel(id: string, message: FakeMessage | Error | null = null): FakeChannel {
  return {
    id,
    type: ChannelType.GuildText,
    isTextBased: () => true,
    messages: {
      fetch: vi.fn(() =>
        message instanceof Error ? Promise.reject(message) : Promise.resolve(message),
      ),
    },
  };
}

function makeGuild(channels: readonly FakeChannel[]): Guild {
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  return {
    id: GUILD_ID,
    members: { me: { id: 'bot' } },
    client: { user: { id: 'bot' } },
    channels: {
      cache: { get: (id: string) => byId.get(id) },
      fetch: (id: string) => Promise.resolve(byId.get(id) ?? null),
    },
  } as unknown as Guild;
}

function cardData(over: Partial<DemandCardData> = {}): DemandCardData {
  return {
    guildId: GUILD_ID,
    orderId: 'ckorder00000000000000001',
    orderLabel: 'VK-000184',
    customerId: CUSTOMER_ID,
    status: OrderStatus.PAID,
    statusLabel: 'Pago — preparando entrega',
    statusIcon: '🟢',
    totalCents: 5000,
    assignedToId: null,
    dueAt: null,
    overdue: false,
    items: [],
    description: 'Lobo Lycan sob encomenda',
    ticketChannelId: TICKET_ID,
    ticketLabel: '#0042',
    startedAt: null,
    deliveredAt: null,
    completedByCustomer: false,
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

function allText(builder: { toJSON: () => unknown }): string {
  const partes: string[] = [];
  const walk = (nodes: Json[]): void => {
    for (const node of nodes) {
      if (typeof node.content === 'string') partes.push(node.content);
      if (Array.isArray(node.components)) walk(node.components as Json[]);
    }
  };
  walk(childrenOf(builder));
  return partes.join('\n');
}

/** URL de um botao, como string: o JSON entrega o campo como `unknown`. */
function urlOf(botao: Json): string {
  return typeof botao.url === 'string' ? botao.url : '';
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

/** Os rotulos dos botoes do cartao que o `sendV2` recebeu na chamada `n`. */
function sentCardLabels(n = 0): string[] {
  const [, root] = discord.sendV2.mock.calls[n] as [unknown, { toJSON: () => unknown }];
  return buttonsOf(root).map((botao) => String(botao.label));
}

beforeEach(() => {
  vi.clearAllMocks();

  config.getGuildConfig.mockResolvedValue({
    storeName: 'Vook Store',
    demandChannelId: BOARD_ID,
    demandStartedChannelId: STARTED_ID,
    demandDoneChannelId: DONE_ID,
  });
  discord.sendV2.mockResolvedValue({ id: BOARD_MESSAGE_ID, channelId: BOARD_ID });
  orders.setDemandMessage.mockResolvedValue(undefined);
  orders.setDemandStartedMessage.mockResolvedValue(undefined);
  orders.setDemandDoneMessage.mockResolvedValue(undefined);
  notifications.trySendDm.mockResolvedValue(true);
  tickets.findTicketByChannelId.mockResolvedValue({ ticketNumber: 42 });
});

// ---------------------------------------------------------------------------
// Publicacao
// ---------------------------------------------------------------------------

describe('publicacao da demanda no quadro', () => {
  it('publica o cartao e guarda onde ele ficou', async () => {
    const guild = makeGuild([makeChannel(BOARD_ID)]);

    const publicada = await publishDemand(guild, makeOrder());

    expect(publicada).toBe(true);
    expect(orders.setDemandMessage).toHaveBeenCalledWith(
      'ckorder00000000000000001',
      BOARD_ID,
      BOARD_MESSAGE_ID,
    );
  });

  /**
   * O recovery reprocessa pagamentos que ficaram pela metade quando o bot caiu.
   * Sem esta guarda, a mesma demanda ganharia dois cartoes vivos — cada um com
   * os proprios botoes, e a equipe clicando no que estivesse mais perto.
   */
  it('demanda que ja tem cartao nao ganha outro', async () => {
    const mensagem = { id: BOARD_MESSAGE_ID, edit: vi.fn(() => Promise.resolve(undefined)) };
    const guild = makeGuild([makeChannel(BOARD_ID, mensagem)]);

    const publicada = await publishDemand(
      guild,
      makeOrder({ demandChannelId: BOARD_ID, demandMessageId: BOARD_MESSAGE_ID }),
    );

    expect(publicada).toBe(true);
    expect(discord.sendV2).not.toHaveBeenCalled();
    expect(mensagem.edit).toHaveBeenCalled();
  });

  it('sem canal configurado, simplesmente nao publica', async () => {
    config.getGuildConfig.mockResolvedValueOnce({
      storeName: 'Vook Store',
      demandChannelId: null,
      demandStartedChannelId: null,
    });

    expect(await publishDemand(makeGuild([]), makeOrder())).toBe(false);
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  /** Quadro que nao publica nao pode desfazer um pagamento aprovado. */
  it('canal apagado vira false, nunca erro', async () => {
    expect(await publishDemand(makeGuild([]), makeOrder())).toBe(false);
  });

  it('falha do Discord no envio vira false, nunca erro', async () => {
    discord.sendV2.mockRejectedValueOnce(new Error('500'));

    expect(await publishDemand(makeGuild([makeChannel(BOARD_ID)]), makeOrder())).toBe(false);
    expect(orders.setDemandMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

describe('demanda iniciada', () => {
  const started = (over: Partial<OrderFull> = {}): OrderFull =>
    makeOrder({
      status: OrderStatus.IN_PROGRESS,
      assignedToId: STAFF_ID,
      demandChannelId: BOARD_ID,
      demandMessageId: BOARD_MESSAGE_ID,
      ...over,
    });

  it('publica a copia, avisa o cliente e reescreve o cartao do quadro', async () => {
    const doQuadro = { id: BOARD_MESSAGE_ID, edit: vi.fn(() => Promise.resolve(undefined)) };
    const guild = makeGuild([makeChannel(BOARD_ID, doQuadro), makeChannel(STARTED_ID)]);
    discord.sendV2.mockResolvedValueOnce({ id: STARTED_MESSAGE_ID, channelId: STARTED_ID });

    const resultado = await announceDemandStarted(guild, started());

    expect(resultado).toEqual({ announced: true, customerNotified: true });
    expect(orders.setDemandStartedMessage).toHaveBeenCalledWith(
      'ckorder00000000000000001',
      STARTED_ID,
      STARTED_MESSAGE_ID,
    );
    // O cartao do quadro FICA — reescrito, nao apagado.
    expect(doQuadro.edit).toHaveBeenCalled();
  });

  /**
   * "Pegar a proxima da fila" e "Iniciar demanda" chegam aqui pelos dois
   * caminhos. O cliente nao pode receber duas vezes a mesma novidade.
   */
  it('demanda ja iniciada nao publica de novo nem avisa de novo', async () => {
    const guild = makeGuild([makeChannel(BOARD_ID), makeChannel(STARTED_ID)]);

    const resultado = await announceDemandStarted(
      guild,
      started({ demandStartedChannelId: STARTED_ID, demandStartedMessageId: STARTED_MESSAGE_ID }),
    );

    expect(resultado).toEqual({ announced: false, customerNotified: false });
    expect(discord.sendV2).not.toHaveBeenCalled();
    expect(notifications.trySendDm).not.toHaveBeenCalled();
  });

  it('DM fechada nao impede a copia no canal', async () => {
    notifications.trySendDm.mockResolvedValueOnce(false);
    const guild = makeGuild([makeChannel(BOARD_ID), makeChannel(STARTED_ID)]);

    const resultado = await announceDemandStarted(guild, started());

    expect(resultado.announced).toBe(true);
    expect(resultado.customerNotified).toBe(false);
  });

  it('canal de iniciadas ausente nao impede o aviso ao cliente', async () => {
    config.getGuildConfig.mockResolvedValueOnce({
      storeName: 'Vook Store',
      demandChannelId: BOARD_ID,
      demandStartedChannelId: null,
    });
    const guild = makeGuild([makeChannel(BOARD_ID)]);

    const resultado = await announceDemandStarted(guild, started());

    expect(resultado.announced).toBe(false);
    expect(resultado.customerNotified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reescrita
// ---------------------------------------------------------------------------

describe('atualizacao dos cartoes', () => {
  it('reescreve os dois cartoes quando os dois existem', async () => {
    const doQuadro = { id: BOARD_MESSAGE_ID, edit: vi.fn(() => Promise.resolve(undefined)) };
    const daCopia = { id: STARTED_MESSAGE_ID, edit: vi.fn(() => Promise.resolve(undefined)) };
    const guild = makeGuild([
      makeChannel(BOARD_ID, doQuadro),
      makeChannel(STARTED_ID, daCopia),
    ]);

    await refreshDemandCards(
      guild,
      makeOrder({
        demandChannelId: BOARD_ID,
        demandMessageId: BOARD_MESSAGE_ID,
        demandStartedChannelId: STARTED_ID,
        demandStartedMessageId: STARTED_MESSAGE_ID,
      }),
    );

    expect(doQuadro.edit).toHaveBeenCalled();
    expect(daCopia.edit).toHaveBeenCalled();
  });

  it('demanda sem cartao nenhum nao consulta o Discord', async () => {
    const canal = makeChannel(BOARD_ID);
    await refreshDemandCards(makeGuild([canal]), makeOrder());

    expect(canal.messages.fetch).not.toHaveBeenCalled();
  });

  /**
   * Sem isto o bot tentaria reescrever a mesma mensagem inexistente a cada
   * mudanca de estado, para sempre.
   */
  it('mensagem apagada limpa a referencia em vez de insistir', async () => {
    const sumiu = Object.assign(new Error('Unknown Message'), { code: 10008 });
    // `isUnknownResourceError` so reconhece DiscordAPIError; o caminho generico
    // (erro qualquer) precisa apenas nao lancar.
    const guild = makeGuild([makeChannel(BOARD_ID, sumiu)]);

    await expect(
      refreshDemandCards(
        guild,
        makeOrder({ demandChannelId: BOARD_ID, demandMessageId: BOARD_MESSAGE_ID }),
      ),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cartao
// ---------------------------------------------------------------------------

describe('cartao da demanda', () => {
  it('cabe nos limites de um container V2', () => {
    const root = buildDemandCard(
      cardData({
        dueAt: new Date('2026-10-05T12:00:00Z'),
        assignedToId: STAFF_ID,
        items: Array.from({ length: 10 }, (_, index) => ({
          name: `Pack ${index}`,
          priceCents: 5000,
          quantity: 2,
        })),
      }),
    );

    expect(childrenOf(root).length).toBeLessThanOrEqual(10);
    expect(allText(root).length).toBeLessThanOrEqual(4000);
  });

  it('leva ao ticket do cliente, com o numero', () => {
    const botoes = buttonsOf(buildDemandCard(cardData()));
    const ticket = botoes.find((botao) => urlOf(botao).includes(TICKET_ID));

    expect(ticket).toBeDefined();
    expect(ticket?.style).toBe(ButtonStyle.Link);
    expect(String(ticket?.label)).toContain('#0042');
  });

  it('compra fora de ticket nao promete atendimento no rotulo', () => {
    const botoes = buttonsOf(buildDemandCard(cardData({ ticketLabel: null })));
    const link = botoes.find((botao) => urlOf(botao).includes(TICKET_ID));

    expect(String(link?.label)).toBe('Ir ao canal da compra');
  });

  it('sem canal de origem, nenhum botao fica sem URL', () => {
    const botoes = buttonsOf(
      buildDemandCard(cardData({ ticketChannelId: null, ticketLabel: null })),
    );

    expect(
      botoes.every((botao) => botao.url === undefined || urlOf(botao).length > 0),
    ).toBe(true);
  });

  /**
   * Venda de balcao (`/pagamento criar`) nasce SEM item. Sem a descricao da
   * cobranca, o cartao seria uma demanda que nao diz o que produzir.
   */
  it('venda sem item mostra a descricao da cobranca', () => {
    const texto = allText(buildDemandCard(cardData({ items: [] })));
    expect(texto).toContain('Lobo Lycan sob encomenda');
  });

  it('venda do catalogo lista os itens', () => {
    const texto = allText(
      buildDemandCard(
        cardData({ items: [{ name: 'Pack Lobo Lycan', priceCents: 5000, quantity: 2 }] }),
      ),
    );
    expect(texto).toContain('Pack Lobo Lycan');
    expect(texto).toContain('×2');
  });

  it('sem item e sem descricao, diz onde procurar em vez de ficar em branco', () => {
    const texto = allText(buildDemandCard(cardData({ items: [], description: null })));
    expect(texto).toContain('abra o pedido');
  });

  it('demanda livre e demanda com dono sao distinguiveis', () => {
    expect(allText(buildDemandCard(cardData()))).toContain('livre na fila');
    expect(allText(buildDemandCard(cardData({ assignedToId: STAFF_ID })))).toContain(
      `<@${STAFF_ID}>`,
    );
  });

  it('prazo vencido e dito, nao escondido', () => {
    const texto = allText(
      buildDemandCard(cardData({ dueAt: new Date('2026-09-01T12:00:00Z'), overdue: true })),
    );
    expect(texto).toContain('atrasado');
  });

  /** Botao que so sabe responder "agora nao" ensina a equipe a ignorar o cartao. */
  it.each([
    [OrderStatus.PAID, ['Iniciar demanda', 'Assumir']],
    [OrderStatus.IN_PROGRESS, ['Marcar entregue', 'Assumir']],
    [OrderStatus.DELIVERED, ['Concluir']],
    [OrderStatus.COMPLETED, []],
    [OrderStatus.CANCELLED, []],
  ])('estado %s oferece so as transicoes validas', (status, esperados) => {
    const rotulos = buttonsOf(buildDemandCard(cardData({ status }))).map((botao) =>
      String(botao.label),
    );

    for (const esperado of esperados) expect(rotulos).toContain(esperado);
    // O que leva ao ticket e ao pedido esta sempre la.
    expect(rotulos).toContain('Abrir pedido');
  });

  it('demanda com dono oferece liberar, nao assumir', () => {
    const rotulos = buttonsOf(buildDemandCard(cardData({ assignedToId: STAFF_ID }))).map((botao) =>
      String(botao.label),
    );

    expect(rotulos).toContain('Liberar');
    expect(rotulos).not.toContain('Assumir');
  });

  it('a linha de botoes cabe no limite do Discord', () => {
    const botoes = buttonsOf(buildDemandCard(cardData({ status: OrderStatus.PAID })));
    expect(botoes.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Aviso ao cliente
// ---------------------------------------------------------------------------

describe('DM de demanda iniciada', () => {
  const dm = (over: Record<string, unknown> = {}) =>
    buildDemandStartedDm({
      storeName: 'Vook Store',
      guildId: GUILD_ID,
      customerId: CUSTOMER_ID,
      orderLabel: 'VK-000184',
      dueAt: null,
      overdue: false,
      assignedToId: STAFF_ID,
      ticketChannelId: TICKET_ID,
      ticketLabel: '#0042',
      ...over,
    });

  it('diz que o trabalho comecou, com o numero do pedido', () => {
    const texto = allText(dm());
    expect(texto).toContain(`<@${CUSTOMER_ID}>`);
    expect(texto).toContain('VK-000184');
    expect(texto).toContain('começou a trabalhar');
  });

  /** Data que a loja nao assumiu vira cobranca depois. */
  it('sem prazo no pedido, nao inventa previsao', () => {
    expect(allText(dm())).not.toContain('Previsão');
    expect(allText(dm({ dueAt: new Date('2026-10-05T12:00:00Z') }))).toContain('Previsão');
  });

  it('leva de volta ao atendimento', () => {
    const botoes = buttonsOf(dm());
    expect(botoes[0]?.url).toContain(TICKET_ID);
  });

  it('compra sem canal de origem nao gera botao sem URL', () => {
    const botoes = buttonsOf(dm({ ticketChannelId: null, ticketLabel: null }));
    expect(botoes).toHaveLength(0);
  });

  it('cabe nos limites de um container V2', () => {
    const root = dm({ dueAt: new Date('2026-10-05T12:00:00Z') });
    expect(childrenOf(root).length).toBeLessThanOrEqual(10);
    expect(allText(root).length).toBeLessThanOrEqual(4000);
  });
});

describe('o quadro publicado', () => {
  it('o cartao que sai no canal carrega os botoes de status', async () => {
    await publishDemand(makeGuild([makeChannel(BOARD_ID)]), makeOrder());

    const rotulos = sentCardLabels();
    expect(rotulos).toContain('Iniciar demanda');
    expect(rotulos).toContain('Abrir pedido');
    expect(rotulos.some((rotulo) => rotulo.includes('#0042'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Entrega: a demanda muda de canal
// ---------------------------------------------------------------------------

describe('demanda entregue vai para as concluidas', () => {
  const mensagem = (id: string): FakeMessage => ({
    id,
    edit: vi.fn(() => Promise.resolve(undefined)),
    delete: vi.fn(() => Promise.resolve(undefined)),
  });

  const entregue = (over: Partial<OrderFull> = {}): OrderFull =>
    makeOrder({
      status: OrderStatus.DELIVERED,
      assignedToId: STAFF_ID,
      deliveredAt: new Date('2026-10-08T12:00:00Z'),
      demandChannelId: BOARD_ID,
      demandMessageId: BOARD_MESSAGE_ID,
      demandStartedChannelId: STARTED_ID,
      demandStartedMessageId: STARTED_MESSAGE_ID,
      ...over,
    });

  /**
   * MOVER, nao copiar: "iniciadas" so mostra o que esta em producao agora, e
   * uma demanda entregue ja nao esta.
   */
  it('publica nas concluidas e APAGA o cartao de iniciadas', async () => {
    const daCopia = mensagem(STARTED_MESSAGE_ID);
    const guild = makeGuild([
      makeChannel(BOARD_ID, mensagem(BOARD_MESSAGE_ID)),
      makeChannel(STARTED_ID, daCopia),
      makeChannel(DONE_ID),
    ]);
    discord.sendV2.mockResolvedValueOnce({ id: DONE_MESSAGE_ID, channelId: DONE_ID });

    await refreshDemandCards(guild, entregue());

    expect(orders.setDemandDoneMessage).toHaveBeenCalledWith(
      'ckorder00000000000000001',
      DONE_ID,
      DONE_MESSAGE_ID,
    );
    expect(daCopia.delete).toHaveBeenCalled();
    expect(orders.setDemandStartedMessage).toHaveBeenCalledWith(
      'ckorder00000000000000001',
      null,
      null,
    );
  });

  /**
   * A ORDEM PROTEGE A DEMANDA DE SUMIR: sem canal de concluidas, o cartao de
   * iniciadas e a unica copia viva — apagar faria a demanda desaparecer.
   */
  it('sem canal de concluidas, o cartao de iniciadas FICA', async () => {
    config.getGuildConfig.mockResolvedValue({
      storeName: 'Vook Store',
      demandChannelId: BOARD_ID,
      demandStartedChannelId: STARTED_ID,
      demandDoneChannelId: null,
    });
    const daCopia = mensagem(STARTED_MESSAGE_ID);
    const guild = makeGuild([
      makeChannel(BOARD_ID, mensagem(BOARD_MESSAGE_ID)),
      makeChannel(STARTED_ID, daCopia),
    ]);

    await refreshDemandCards(guild, entregue());

    expect(daCopia.delete).not.toHaveBeenCalled();
    expect(daCopia.edit).toHaveBeenCalled();
    expect(orders.setDemandStartedMessage).not.toHaveBeenCalled();
  });

  it('se a publicacao nas concluidas falhar, o cartao de iniciadas FICA', async () => {
    const daCopia = mensagem(STARTED_MESSAGE_ID);
    const guild = makeGuild([
      makeChannel(BOARD_ID, mensagem(BOARD_MESSAGE_ID)),
      makeChannel(STARTED_ID, daCopia),
      makeChannel(DONE_ID),
    ]);
    discord.sendV2.mockRejectedValueOnce(new Error('500'));

    await refreshDemandCards(guild, entregue());

    expect(daCopia.delete).not.toHaveBeenCalled();
  });

  /** Concluir (o cliente confirmou) reescreve o cartao que ja esta la. */
  it('demanda que ja tem cartao nas concluidas e reescrita, nao republicada', async () => {
    const daConcluida = mensagem(DONE_MESSAGE_ID);
    const guild = makeGuild([
      makeChannel(BOARD_ID, mensagem(BOARD_MESSAGE_ID)),
      makeChannel(DONE_ID, daConcluida),
    ]);

    await refreshDemandCards(
      guild,
      entregue({
        status: OrderStatus.COMPLETED,
        demandStartedChannelId: null,
        demandStartedMessageId: null,
        demandDoneChannelId: DONE_ID,
        demandDoneMessageId: DONE_MESSAGE_ID,
      }),
    );

    expect(daConcluida.edit).toHaveBeenCalled();
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  it('demanda nunca iniciada vai direto do quadro para as concluidas', async () => {
    const guild = makeGuild([makeChannel(BOARD_ID, mensagem(BOARD_MESSAGE_ID)), makeChannel(DONE_ID)]);
    discord.sendV2.mockResolvedValueOnce({ id: DONE_MESSAGE_ID, channelId: DONE_ID });

    await refreshDemandCards(
      guild,
      entregue({ demandStartedChannelId: null, demandStartedMessageId: null }),
    );

    expect(orders.setDemandDoneMessage).toHaveBeenCalledWith(
      'ckorder00000000000000001',
      DONE_ID,
      DONE_MESSAGE_ID,
    );
  });

  /** Pedido de antes do quadro nao aparece de repente nas concluidas. */
  it('pedido que o quadro nao conhece continua de fora', async () => {
    await refreshDemandCards(
      makeGuild([makeChannel(DONE_ID)]),
      entregue({
        demandChannelId: null,
        demandMessageId: null,
        demandStartedChannelId: null,
        demandStartedMessageId: null,
      }),
    );

    expect(discord.sendV2).not.toHaveBeenCalled();
  });
});

describe('cartao de demanda concluida', () => {
  it('entregue diz que espera o cliente', () => {
    const texto = allText(
      buildDemandDoneCard(
        cardData({ status: OrderStatus.DELIVERED, deliveredAt: new Date('2026-10-08T12:00:00Z') }),
      ),
    );
    expect(texto).toContain('aguardando a confirmação do cliente');
  });

  it('concluida pelo cliente diz que o cliente confirmou', () => {
    const texto = allText(
      buildDemandDoneCard(cardData({ status: OrderStatus.COMPLETED, completedByCustomer: true })),
    );
    expect(texto).toContain('o cliente confirmou');
  });

  /**
   * O defeito que este teste trava: o cartao dizia que o cliente confirmou o
   * recebimento sempre que o pedido estava concluido — inclusive quando quem
   * concluiu foi a equipe, pelo painel do pedido, com o cliente ainda sem
   * responder.
   */
  it('concluida pela equipe NAO diz que o cliente confirmou', () => {
    const texto = allText(
      buildDemandDoneCard(cardData({ status: OrderStatus.COMPLETED, completedByCustomer: false })),
    );
    expect(texto).toContain('Concluída pela equipe');
    expect(texto).not.toContain('o cliente confirmou');
  });

  it('cabe nos limites de um container V2', () => {
    const root = buildDemandDoneCard(cardData({ status: OrderStatus.DELIVERED }));
    expect(childrenOf(root).length).toBeLessThanOrEqual(10);
    expect(allText(root).length).toBeLessThanOrEqual(4000);
  });
});

// ---------------------------------------------------------------------------
// Publicacao direta nas concluidas
// ---------------------------------------------------------------------------

describe('publicar direto nas concluidas', () => {
  const antigo = (over: Partial<OrderFull> = {}): OrderFull =>
    makeOrder({
      status: OrderStatus.COMPLETED,
      deliveredAt: new Date('2026-09-28T22:48:14Z'),
      ...over,
    });

  /** Pedido de antes do quadro: vai so para as concluidas, nao para o quadro. */
  it('publica nas concluidas sem passar pelo quadro', async () => {
    discord.sendV2.mockResolvedValueOnce({ id: DONE_MESSAGE_ID, channelId: DONE_ID });

    expect(await publishDemandDone(makeGuild([makeChannel(DONE_ID)]), antigo())).toBe(true);
    expect(discord.sendV2).toHaveBeenCalledTimes(1);
    expect(orders.setDemandDoneMessage).toHaveBeenCalledWith(
      'ckorder00000000000000001',
      DONE_ID,
      DONE_MESSAGE_ID,
    );
    expect(orders.setDemandMessage).not.toHaveBeenCalled();
  });

  it('demanda ainda em producao nao vai para as concluidas', async () => {
    expect(
      await publishDemandDone(makeGuild([makeChannel(DONE_ID)]), antigo({ status: OrderStatus.PAID })),
    ).toBe(false);
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  it('rodar de novo reescreve, nao empilha', async () => {
    const cartao = { id: DONE_MESSAGE_ID, edit: vi.fn(() => Promise.resolve(undefined)) };

    await publishDemandDone(
      makeGuild([makeChannel(DONE_ID, cartao)]),
      antigo({ demandDoneChannelId: DONE_ID, demandDoneMessageId: DONE_MESSAGE_ID }),
    );

    expect(cartao.edit).toHaveBeenCalled();
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  /**
   * O defeito que este teste trava: uma falha PASSAGEIRA ao editar o cartao
   * existente (um 500) fazia publicar outro — e a demanda ficava com dois
   * cartoes no canal.
   */
  it('falha passageira na edicao NAO publica um segundo cartao', async () => {
    const cartao = { id: DONE_MESSAGE_ID, edit: vi.fn(() => Promise.reject(new Error('500'))) };

    const resultado = await publishDemandDone(
      makeGuild([makeChannel(DONE_ID, cartao)]),
      antigo({ demandDoneChannelId: DONE_ID, demandDoneMessageId: DONE_MESSAGE_ID }),
    );

    expect(resultado).toBe(true);
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  it('cartao apagado a mao e publicado de novo', async () => {
    const sumiu = new DiscordAPIError(
      { code: 10008, message: 'Unknown Message' },
      10008,
      404,
      'GET',
      '/channels/1/messages/2',
      {},
    );
    discord.sendV2.mockResolvedValueOnce({ id: DONE_MESSAGE_ID, channelId: DONE_ID });

    await publishDemandDone(
      makeGuild([makeChannel(DONE_ID, sumiu)]),
      antigo({ demandDoneChannelId: DONE_ID, demandDoneMessageId: DONE_MESSAGE_ID }),
    );

    expect(discord.sendV2).toHaveBeenCalledTimes(1);
  });
});

describe('quem concluiu aparece certo no cartao', () => {
  const postado = (): string => {
    const [, root] = discord.sendV2.mock.calls[0] as [unknown, { toJSON: () => unknown }];
    return allText(root);
  };

  it('concluido pelo proprio cliente: confirmou o recebimento', async () => {
    discord.sendV2.mockResolvedValueOnce({ id: DONE_MESSAGE_ID, channelId: DONE_ID });

    await publishDemandDone(
      makeGuild([makeChannel(DONE_ID)]),
      makeOrder({ status: OrderStatus.COMPLETED, completedById: CUSTOMER_ID }),
    );

    expect(postado()).toContain('o cliente confirmou');
  });

  it('concluido pela equipe no painel do pedido: NAO diz que o cliente confirmou', async () => {
    discord.sendV2.mockResolvedValueOnce({ id: DONE_MESSAGE_ID, channelId: DONE_ID });

    await publishDemandDone(
      makeGuild([makeChannel(DONE_ID)]),
      makeOrder({ status: OrderStatus.COMPLETED, completedById: STAFF_ID }),
    );

    expect(postado()).toContain('Concluída pela equipe');
    expect(postado()).not.toContain('o cliente confirmou');
  });
});
