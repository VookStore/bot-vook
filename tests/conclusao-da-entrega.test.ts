import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonStyle, ChannelType, ComponentType, DiscordAPIError } from 'discord.js';
import type { Guild } from 'discord.js';
import { OrderStatus, TicketPriority, TicketStatus } from '@prisma/client';
import type { Ticket } from '@prisma/client';

/**
 * Ticket entregue: cartao no canal de concluidos, topico arquivado.
 *
 * O pedido era MOVER o topico para o canal de concluidos, e o Discord nao move
 * topico. Entao o topico e arquivado (sai da lista de ativos, sem fechar) e um
 * cartao no canal de concluidos aponta para ele.
 *
 * O QUE ESTES TESTES TRAVAM, em ordem de gravidade:
 *  1. SEM CARTAO, NAO ARQUIVA. Arquivar sem o cartao faria um atendimento
 *     ABERTO sumir da lista de ativos sem nada apontando para ele — o pior
 *     resultado possivel;
 *  2. nada aqui lanca: o produto ja foi entregue quando isto roda;
 *  3. o cartao diz QUEM fechou — o cliente confirmando ou a equipe sem a
 *     confirmacao dele, que e informacao e nao detalhe;
 *  4. entregar duas vezes reescreve o cartao em vez de empilhar outro.
 */

const GUILD_ID = '111111111111111111';
const TICKET_CHANNEL_ID = '222222222222222222';
const DONE_ID = '333333333333333333';
const DONE_MESSAGE_ID = '444444444444444444';
const OWNER_ID = '555555555555555555';
const STAFF_ID = '666666666666666666';
const TRANSCRIPT_URL = 'https://transcripts.vook.example/t/ticket-0042-abcdef';

const config = vi.hoisted(() => ({ getGuildConfig: vi.fn() }));
const discord = vi.hoisted(() => ({ sendV2: vi.fn() }));
const orders = vi.hoisted(() => ({ listOrdersByChannel: vi.fn() }));
const tickets = vi.hoisted(() => ({ setTicketDoneCard: vi.fn() }));
const categories = vi.hoisted(() => ({ getCategoryById: vi.fn() }));
const conversation = vi.hoisted(() => ({ resolveTicketChannel: vi.fn() }));

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]): unknown => config.getGuildConfig(...args),
}));

vi.mock('../src/components/reply', () => ({
  sendV2: (...args: unknown[]): unknown => discord.sendV2(...args),
}));

vi.mock('../src/modules/catalog/repositories/OrderRepository', () => ({
  listOrdersByChannel: (...args: unknown[]): unknown => orders.listOrdersByChannel(...args),
}));

vi.mock('../src/modules/catalog/services/OrderService', () => ({
  formatOrderNumber: (value: number): string => `VK-${String(value).padStart(6, '0')}`,
}));

vi.mock('../src/modules/tickets/repositories/TicketRepository', () => ({
  setTicketDoneCard: (...args: unknown[]): unknown => tickets.setTicketDoneCard(...args),
}));

vi.mock('../src/modules/tickets/services/TicketConfigService', () => ({
  getCategoryById: (...args: unknown[]): unknown => categories.getCategoryById(...args),
}));

vi.mock('../src/modules/tickets/services/TicketChannelService', () => ({
  resolveTicketChannel: (...args: unknown[]): unknown => conversation.resolveTicketChannel(...args),
  isTicketThread: (channel: { isThread: () => boolean }): boolean => channel.isThread(),
}));

import {
  buildTicketDoneCard,
  type TicketDoneCardData,
} from '../src/modules/tickets/builders/TicketDoneBuilder';
import {
  announceTicketDelivered,
  refreshTicketDoneCard,
} from '../src/modules/tickets/services/TicketDoneService';

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ckticket0000000000000001',
    guildId: GUILD_ID,
    ticketNumber: 42,
    categoryId: 'ckcat00000000000000000001',
    ownerId: OWNER_ID,
    subject: 'Quero um pack',
    channelId: TICKET_CHANNEL_ID,
    channelName: 'ticket-0042',
    status: TicketStatus.CLAIMED,
    priority: TicketPriority.NORMAL,
    claimedById: STAFF_ID,
    claimedAt: new Date('2026-10-01T10:00:00Z'),
    closedById: null,
    closedAt: null,
    closeReason: null,
    panelMessageId: null,
    transcriptUrl: null,
    transcriptAssetIds: [],
    doneCardChannelId: null,
    doneCardMessageId: null,
    deliveredAt: new Date('2026-10-08T12:00:00Z'),
    deliveredById: STAFF_ID,
    lastClientNotifyAt: null,
    lastRenamedAt: null,
    createdAt: new Date('2026-10-01T09:00:00Z'),
    updatedAt: new Date('2026-10-08T12:00:00Z'),
    ...over,
  };
}

interface FakeThread {
  id: string;
  archived: boolean;
  isThread: () => boolean;
  setArchived: ReturnType<typeof vi.fn>;
}

function makeThread(over: Partial<FakeThread> = {}): FakeThread {
  return {
    id: TICKET_CHANNEL_ID,
    archived: false,
    isThread: () => true,
    setArchived: vi.fn(() => Promise.resolve(undefined)),
    ...over,
  };
}

interface FakeMessage {
  edit: ReturnType<typeof vi.fn>;
}

function makeDoneChannel(message: FakeMessage | Error | null = null) {
  return {
    id: DONE_ID,
    type: ChannelType.GuildText,
    isTextBased: () => true,
    messages: {
      fetch: vi.fn(() =>
        message instanceof Error ? Promise.reject(message) : Promise.resolve(message),
      ),
    },
  };
}

function makeGuild(doneChannel: ReturnType<typeof makeDoneChannel> | null = makeDoneChannel()): Guild {
  return {
    id: GUILD_ID,
    channels: {
      cache: { get: (id: string) => (doneChannel !== null && id === DONE_ID ? doneChannel : undefined) },
      fetch: (id: string) =>
        Promise.resolve(doneChannel !== null && id === DONE_ID ? doneChannel : null),
    },
  } as unknown as Guild;
}

function cardData(over: Partial<TicketDoneCardData> = {}): TicketDoneCardData {
  return {
    guildId: GUILD_ID,
    ticketChannelId: TICKET_CHANNEL_ID,
    ticketLabel: '#0042',
    categoryName: 'Lobos',
    customerId: OWNER_ID,
    staffId: STAFF_ID,
    deliveredById: STAFF_ID,
    deliveredAt: new Date('2026-10-08T12:00:00Z'),
    orderLabel: 'VK-000184',
    state: 'aguardando',
    closedById: null,
    closedAt: null,
    transcriptUrl: null,
    ...over,
  };
}

type Json = Record<string, unknown>;

function childrenOf(builder: { toJSON: () => unknown }): Json[] {
  return ((builder.toJSON() as Json).components ?? []) as Json[];
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

beforeEach(() => {
  /*
   * `reset`, e nao `clear`: varios testes armam um valor "uma vez" para um
   * passo que a funcao nem chega a executar (sem cartao, ela sai antes de
   * resolver o topico). `clearAllMocks` nao esvazia essa fila, e o valor
   * escorria para o teste seguinte. Todo mock e rearmado logo abaixo.
   */
  vi.resetAllMocks();

  config.getGuildConfig.mockResolvedValue({ ticketDoneChannelId: DONE_ID });
  discord.sendV2.mockResolvedValue({ id: DONE_MESSAGE_ID, channelId: DONE_ID });
  orders.listOrdersByChannel.mockResolvedValue([]);
  tickets.setTicketDoneCard.mockResolvedValue(undefined);
  categories.getCategoryById.mockResolvedValue({ name: 'Lobos' });
  conversation.resolveTicketChannel.mockResolvedValue(makeThread());
});

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

describe('ticket entregue vai para os concluidos', () => {
  it('publica o cartao e arquiva o topico', async () => {
    const thread = makeThread();
    conversation.resolveTicketChannel.mockResolvedValueOnce(thread);

    const resultado = await announceTicketDelivered(makeGuild(), makeTicket());

    expect(resultado).toEqual({ carded: true, archived: true });
    expect(tickets.setTicketDoneCard).toHaveBeenCalledWith(
      'ckticket0000000000000001',
      DONE_ID,
      DONE_MESSAGE_ID,
    );
    expect(thread.setArchived).toHaveBeenCalledWith(true, expect.any(String));
  });

  /**
   * A REGRA MAIS IMPORTANTE DESTE ARQUIVO. Sem canal de concluidos, arquivar
   * faria um atendimento aberto sumir da lista de ativos sem nada apontando
   * para ele.
   */
  it('sem canal de concluidos, o topico NAO e arquivado', async () => {
    config.getGuildConfig.mockResolvedValueOnce({ ticketDoneChannelId: null });
    const thread = makeThread();
    conversation.resolveTicketChannel.mockResolvedValueOnce(thread);

    const resultado = await announceTicketDelivered(makeGuild(null), makeTicket());

    expect(resultado).toEqual({ carded: false, archived: false });
    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it('se o cartao nao sair, o topico NAO e arquivado', async () => {
    discord.sendV2.mockRejectedValueOnce(new Error('500'));
    const thread = makeThread();
    conversation.resolveTicketChannel.mockResolvedValueOnce(thread);

    const resultado = await announceTicketDelivered(makeGuild(), makeTicket());

    expect(resultado.carded).toBe(false);
    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it('entregar de novo reescreve o cartao em vez de empilhar outro', async () => {
    const cartao = { edit: vi.fn(() => Promise.resolve(undefined)) };

    await announceTicketDelivered(
      makeGuild(makeDoneChannel(cartao)),
      makeTicket({ doneCardChannelId: DONE_ID, doneCardMessageId: DONE_MESSAGE_ID }),
    );

    expect(cartao.edit).toHaveBeenCalled();
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  it('topico ja arquivado nao e mexido de novo', async () => {
    const thread = makeThread({ archived: true });
    conversation.resolveTicketChannel.mockResolvedValueOnce(thread);

    const resultado = await announceTicketDelivered(makeGuild(), makeTicket());

    expect(resultado).toEqual({ carded: true, archived: true });
    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it('ticket legado (canal proprio) ganha o cartao, mas nao arquiva', async () => {
    conversation.resolveTicketChannel.mockResolvedValueOnce({ id: TICKET_CHANNEL_ID, isThread: () => false });

    const resultado = await announceTicketDelivered(makeGuild(), makeTicket());

    expect(resultado).toEqual({ carded: true, archived: false });
  });

  it('erro inesperado vira resultado, nunca excecao', async () => {
    categories.getCategoryById.mockRejectedValueOnce(new Error('banco fora'));

    await expect(announceTicketDelivered(makeGuild(), makeTicket())).resolves.toEqual({
      carded: false,
      archived: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------

describe('o cartao acompanha o fechamento', () => {
  const comCartao = (over: Partial<Ticket> = {}): Ticket =>
    makeTicket({ doneCardChannelId: DONE_ID, doneCardMessageId: DONE_MESSAGE_ID, ...over });

  /** O texto que o `edit` recebeu, ja montado. */
  function editado(cartao: { edit: ReturnType<typeof vi.fn> }): string {
    const [payload] = cartao.edit.mock.calls[0] as [{ components: Array<{ toJSON: () => unknown }> }];
    const [root] = payload.components;
    return root === undefined ? '' : allText(root);
  }

  it('fechado pelo proprio cliente: concluido pelo cliente', async () => {
    const cartao = { edit: vi.fn(() => Promise.resolve(undefined)) };

    await refreshTicketDoneCard(
      makeGuild(makeDoneChannel(cartao)),
      comCartao({ status: TicketStatus.CLOSED, closedById: OWNER_ID, closedAt: new Date() }),
    );

    expect(editado(cartao)).toContain('Concluído pelo cliente');
  });

  it('fechado pela equipe: diz que o cliente nao confirmou', async () => {
    const cartao = { edit: vi.fn(() => Promise.resolve(undefined)) };

    await refreshTicketDoneCard(
      makeGuild(makeDoneChannel(cartao)),
      comCartao({ status: TicketStatus.CLOSED, closedById: STAFF_ID, closedAt: new Date() }),
    );

    const texto = editado(cartao);
    expect(texto).toContain('Encerrado pela equipe');
    expect(texto).toContain('não chegou a confirmar');
  });

  it('ticket que nunca foi entregue nao toca no Discord', async () => {
    const canal = makeDoneChannel();

    await refreshTicketDoneCard(makeGuild(canal), makeTicket());

    expect(canal.messages.fetch).not.toHaveBeenCalled();
  });

  /** Sem isto o bot tentaria reescrever a mesma mensagem apagada para sempre. */
  it('cartao apagado limpa a referencia', async () => {
    const sumiu = new DiscordAPIError(
      { code: 10008, message: 'Unknown Message' },
      10008,
      404,
      'GET',
      '/channels/1/messages/2',
      {},
    );

    await refreshTicketDoneCard(makeGuild(makeDoneChannel(sumiu)), comCartao());

    expect(tickets.setTicketDoneCard).toHaveBeenCalledWith('ckticket0000000000000001', null, null);
  });

  it('o numero do pedido entregue aparece no cartao', async () => {
    orders.listOrdersByChannel.mockResolvedValueOnce([
      { orderNumber: 90, status: OrderStatus.CANCELLED },
      { orderNumber: 184, status: OrderStatus.DELIVERED },
    ]);
    const cartao = { edit: vi.fn(() => Promise.resolve(undefined)) };

    await refreshTicketDoneCard(makeGuild(makeDoneChannel(cartao)), comCartao());

    expect(editado(cartao)).toContain('VK-000184');
    expect(editado(cartao)).not.toContain('VK-000090');
  });
});

// ---------------------------------------------------------------------------
// Cartao
// ---------------------------------------------------------------------------

describe('cartao do ticket entregue', () => {
  it('aguardando: diz que espera o cliente e que o ticket continua aberto', () => {
    const texto = allText(buildTicketDoneCard(cardData()));
    expect(texto).toContain('Aguardando o cliente confirmar');
    expect(texto).toContain('continua aberto');
  });

  it('leva ao topico do ticket', () => {
    const botoes = buttonsOf(buildTicketDoneCard(cardData()));
    expect(botoes[0]?.style).toBe(ButtonStyle.Link);
    expect(String(botoes[0]?.url)).toContain(TICKET_CHANNEL_ID);
    expect(String(botoes[0]?.label)).toContain('#0042');
  });

  it('o transcript so aparece depois de fechado', () => {
    expect(
      buttonsOf(buildTicketDoneCard(cardData({ transcriptUrl: TRANSCRIPT_URL }))).some(
        (botao) => botao.url === TRANSCRIPT_URL,
      ),
    ).toBe(false);

    expect(
      buttonsOf(
        buildTicketDoneCard(
          cardData({ state: 'cliente', closedAt: new Date(), transcriptUrl: TRANSCRIPT_URL }),
        ),
      ).some((botao) => botao.url === TRANSCRIPT_URL),
    ).toBe(true);
  });

  it('sem topico nem transcript, nenhum botao fica sem URL', () => {
    const root = buildTicketDoneCard(cardData({ ticketChannelId: null }));
    expect(buttonsOf(root)).toHaveLength(0);
  });

  it('entrega sem pedido nao inventa numero', () => {
    expect(allText(buildTicketDoneCard(cardData({ orderLabel: null })))).not.toContain('Pedido');
  });

  it.each(['aguardando', 'cliente', 'equipe'] as const)('estado %s cabe num container V2', (state) => {
    const root = buildTicketDoneCard(
      cardData({ state, closedAt: new Date(), closedById: STAFF_ID, transcriptUrl: TRANSCRIPT_URL }),
    );
    expect(childrenOf(root).length).toBeLessThanOrEqual(10);
    expect(allText(root).length).toBeLessThanOrEqual(4000);
  });
});
