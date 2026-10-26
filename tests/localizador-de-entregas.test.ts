import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';
import type { Guild } from 'discord.js';
import { TicketPriority, TicketStatus } from '@prisma/client';
import type { GuildConfig, Ticket } from '@prisma/client';

/**
 * Canal de entregas: onde o CLIENTE acha o ticket entregue.
 *
 * Na entrega o topico e arquivado (sai da lista lateral, sem fechar). Este
 * canal — aberto a cada cliente enquanto ele tiver entrega esperando
 * confirmacao — tem o painel que o leva de volta.
 *
 * O QUE ESTES TESTES TRAVAM, em ordem de gravidade:
 *  1. o canal dos clientes NUNCA e o canal dos cartoes da equipe. Os cartoes
 *     mostram cliente, pedido e atendente de cada venda; no mesmo canal, cada
 *     cliente veria as vendas dos outros. A recusa vale no momento de dar
 *     acesso, que e onde o vazamento aconteceria;
 *  2. o cliente so LE o canal — sem o "nao escrever" explicito, ele herdaria o
 *     "enviar mensagens" do servidor e um cliente leria o outro;
 *  3. o acesso sai quando a ultima entrega pendente fecha, e so ai;
 *  4. topico arquivado e reaberto antes de readmitir quem saiu.
 */

const GUILD_ID = '111111111111111111';
const LOCATOR_ID = '222222222222222222';
const STAFF_CARDS_ID = '333333333333333333';
const PANEL_ID = '444444444444444444';
const OWNER_ID = '555555555555555555';
const OTHER_OWNER_ID = '666666666666666666';
const THREAD_ID = '777777777777777777';

const config = vi.hoisted(() => ({ getGuildConfig: vi.fn(), updateGuildConfig: vi.fn() }));
const discord = vi.hoisted(() => ({ sendV2: vi.fn() }));
const tickets = vi.hoisted(() => ({
  listDeliveredOpenTickets: vi.fn(),
  listOwnersWithDeliveredOpenTickets: vi.fn(),
  listOpenTicketsByOwnerAndCategory: vi.fn(),
  listUserIdsWithOpenTickets: vi.fn(),
}));
const channels = vi.hoisted(() => ({
  resolveTicketChannel: vi.fn(),
  reopenIfArchived: vi.fn(),
  grantDestinationAccess: vi.fn(),
}));
const queue = vi.hoisted(() => ({ getQueueInfo: vi.fn() }));

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]): unknown => config.getGuildConfig(...args),
  updateGuildConfig: (...args: unknown[]): unknown => config.updateGuildConfig(...args),
}));

vi.mock('../src/components/reply', () => ({
  sendV2: (...args: unknown[]): unknown => discord.sendV2(...args),
}));

vi.mock('../src/modules/tickets/repositories/TicketRepository', () => ({
  listDeliveredOpenTickets: (...args: unknown[]): unknown => tickets.listDeliveredOpenTickets(...args),
  listOwnersWithDeliveredOpenTickets: (...args: unknown[]): unknown =>
    tickets.listOwnersWithDeliveredOpenTickets(...args),
  listOpenTicketsByOwnerAndCategory: (...args: unknown[]): unknown =>
    tickets.listOpenTicketsByOwnerAndCategory(...args),
  listUserIdsWithOpenTickets: (...args: unknown[]): unknown => tickets.listUserIdsWithOpenTickets(...args),
}));

vi.mock('../src/modules/tickets/repositories/TicketCategoryRepository', () => ({
  setCategoryLocatorMessage: (): unknown => Promise.resolve(undefined),
}));

vi.mock('../src/modules/tickets/services/TicketChannelService', () => ({
  resolveTicketChannel: (...args: unknown[]): unknown => channels.resolveTicketChannel(...args),
  reopenIfArchived: (...args: unknown[]): unknown => channels.reopenIfArchived(...args),
  grantDestinationAccess: (...args: unknown[]): unknown => channels.grantDestinationAccess(...args),
  isTicketThread: (channel: { isThread: () => boolean }): boolean => channel.isThread(),
  applyDestinationPermissions: (): unknown => Promise.resolve({ applied: true, missingRoles: [] }),
  missingDestinationPermissions: (): string[] => [],
  resolveDestinationChannel: (): unknown => Promise.resolve(null),
}));

vi.mock('../src/modules/tickets/services/TicketConfigService', () => ({
  getEnabledCategories: (): unknown => Promise.resolve([]),
  getTeamRoleIds: (): unknown => Promise.resolve([]),
  invalidateCategories: (): void => undefined,
}));

vi.mock('../src/modules/tickets/services/TicketQueueService', () => ({
  getQueueInfo: (...args: unknown[]): unknown => queue.getQueueInfo(...args),
}));

import {
  buildDeliveredLocatorPanel,
  buildLocatorResult,
  type LocatedTicket,
} from '../src/modules/tickets/builders/TicketLocatorBuilder';
import {
  grantDeliveredLocatorAccess,
  locateDeliveredTickets,
  publishDeliveredLocator,
  revokeDeliveredLocatorAccess,
} from '../src/modules/tickets/services/TicketLocatorService';

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

function makeConfig(over: Partial<GuildConfig> = {}): GuildConfig {
  return {
    storeName: 'Vook Store',
    panelBannerUrl: null,
    ticketDoneChannelId: STAFF_CARDS_ID,
    deliveredLocatorChannelId: LOCATOR_ID,
    deliveredLocatorMessageId: null,
    ...over,
  } as GuildConfig;
}

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ckticket0000000000000001',
    guildId: GUILD_ID,
    ticketNumber: 42,
    categoryId: 'ckcat00000000000000000001',
    ownerId: OWNER_ID,
    subject: 'Quero um pack',
    channelId: THREAD_ID,
    channelName: 'ticket-0042',
    status: TicketStatus.CLAIMED,
    priority: TicketPriority.NORMAL,
    claimedById: '888888888888888888',
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
    deliveredById: '888888888888888888',
    lastClientNotifyAt: null,
    lastRenamedAt: null,
    createdAt: new Date('2026-10-01T09:00:00Z'),
    updatedAt: new Date('2026-10-08T12:00:00Z'),
    ...over,
  };
}

const TODAS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageRoles,
];

function makeLocatorChannel(granted: readonly bigint[] = TODAS, panel: unknown = null) {
  return {
    id: LOCATOR_ID,
    type: ChannelType.GuildText,
    isTextBased: () => true,
    permissionsFor: () => ({ has: (flag: bigint) => granted.includes(flag) }),
    permissionOverwrites: {
      edit: vi.fn(() => Promise.resolve(undefined)),
      delete: vi.fn(() => Promise.resolve(undefined)),
    },
    messages: {
      fetch: vi.fn(() => (panel instanceof Error ? Promise.reject(panel) : Promise.resolve(panel))),
    },
  };
}

type LocatorChannel = ReturnType<typeof makeLocatorChannel>;

function makeGuild(channel: LocatorChannel | null = makeLocatorChannel()): Guild {
  return {
    id: GUILD_ID,
    members: { me: { id: 'bot' } },
    channels: {
      cache: { get: (id: string) => (channel !== null && id === LOCATOR_ID ? channel : undefined) },
      fetch: (id: string) => Promise.resolve(channel !== null && id === LOCATOR_ID ? channel : null),
    },
  } as unknown as Guild;
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
  // `reset`: varios testes armam valores "uma vez" para passos que podem nem
  // rodar, e `clear` deixaria esses valores escorrerem para o teste seguinte.
  vi.resetAllMocks();

  config.getGuildConfig.mockResolvedValue(makeConfig());
  config.updateGuildConfig.mockResolvedValue(undefined);
  discord.sendV2.mockResolvedValue({ id: PANEL_ID, channelId: LOCATOR_ID });
  tickets.listDeliveredOpenTickets.mockResolvedValue([]);
  tickets.listOwnersWithDeliveredOpenTickets.mockResolvedValue([]);
  channels.reopenIfArchived.mockResolvedValue(undefined);
  channels.grantDestinationAccess.mockResolvedValue(true);
  queue.getQueueInfo.mockResolvedValue({ position: 0 });
});

// ---------------------------------------------------------------------------
// Acesso
// ---------------------------------------------------------------------------

describe('acesso ao canal de entregas', () => {
  it('na entrega, o cliente passa a ver o canal', async () => {
    const canal = makeLocatorChannel();

    expect(await grantDeliveredLocatorAccess(makeGuild(canal), OWNER_ID)).toBe(true);
    expect(canal.permissionOverwrites.edit).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({ ViewChannel: true }),
      expect.anything(),
    );
  });

  /**
   * So temos o ID do cliente. Sem `type: Member` o discord.js procura o id no
   * cache para decidir se e membro ou cargo, e lanca quando o cliente nao esta
   * la — o acesso falhava sem ninguem saber.
   */
  it('grava o acesso como MEMBRO, sem depender do cache de usuarios', async () => {
    const canal = makeLocatorChannel();

    await grantDeliveredLocatorAccess(makeGuild(canal), OWNER_ID);

    expect(canal.permissionOverwrites.edit).toHaveBeenCalledWith(
      OWNER_ID,
      expect.anything(),
      expect.objectContaining({ type: OverwriteType.Member }),
    );
  });

  /**
   * Sem o "nao escrever" explicito o cliente herdaria o "enviar mensagens" do
   * servidor, e o canal viraria um chat onde um cliente le o outro.
   */
  it('o cliente so le: escrever, reagir e abrir topico ficam negados', async () => {
    const canal = makeLocatorChannel();

    await grantDeliveredLocatorAccess(makeGuild(canal), OWNER_ID);

    const [, permissoes] = canal.permissionOverwrites.edit.mock.calls[0] as unknown as [
      string,
      Record<string, boolean>,
    ];
    expect(permissoes).toMatchObject({
      SendMessages: false,
      AddReactions: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      SendMessagesInThreads: false,
    });
  });

  /**
   * A REGRA MAIS IMPORTANTE DESTE ARQUIVO. Se os dois canais forem o mesmo, os
   * cartoes da equipe — cliente, pedido e atendente de cada venda — ficariam
   * visiveis para cada cliente com acesso.
   */
  it('canal de clientes igual ao dos cartoes da equipe: acesso RECUSADO', async () => {
    config.getGuildConfig.mockResolvedValue(
      makeConfig({ ticketDoneChannelId: LOCATOR_ID, deliveredLocatorChannelId: LOCATOR_ID }),
    );
    const canal = makeLocatorChannel();

    expect(await grantDeliveredLocatorAccess(makeGuild(canal), OWNER_ID)).toBe(false);
    expect(canal.permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it('sem canal de entregas configurado, nada muda', async () => {
    config.getGuildConfig.mockResolvedValue(makeConfig({ deliveredLocatorChannelId: null }));
    const canal = makeLocatorChannel();

    expect(await grantDeliveredLocatorAccess(makeGuild(canal), OWNER_ID)).toBe(false);
    expect(canal.permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  /** O produto ja foi entregue quando isto roda. */
  it('falha do Discord vira false, nunca erro', async () => {
    const canal = makeLocatorChannel();
    canal.permissionOverwrites.edit.mockRejectedValueOnce(new Error('sem permissao'));

    await expect(grantDeliveredLocatorAccess(makeGuild(canal), OWNER_ID)).resolves.toBe(false);
  });

  it('ao fechar a ultima entrega, o cliente sai do canal', async () => {
    const canal = makeLocatorChannel();

    await revokeDeliveredLocatorAccess(makeGuild(canal), OWNER_ID, 'ckticket0000000000000001');

    expect(tickets.listDeliveredOpenTickets).toHaveBeenCalledWith(
      GUILD_ID,
      OWNER_ID,
      'ckticket0000000000000001',
    );
    expect(canal.permissionOverwrites.delete).toHaveBeenCalledWith(OWNER_ID, expect.any(String));
  });

  it('com outra entrega esperando, o cliente continua vendo o canal', async () => {
    tickets.listDeliveredOpenTickets.mockResolvedValueOnce([makeTicket({ id: 'outro' })]);
    const canal = makeLocatorChannel();

    await revokeDeliveredLocatorAccess(makeGuild(canal), OWNER_ID, 'ckticket0000000000000001');

    expect(canal.permissionOverwrites.delete).not.toHaveBeenCalled();
  });

  it('acesso que ja nao existia nao vira erro', async () => {
    const canal = makeLocatorChannel();
    canal.permissionOverwrites.delete.mockRejectedValueOnce(
      new DiscordAPIError({ code: 10009, message: 'Unknown Overwrite' }, 10009, 404, 'DELETE', '/x', {}),
    );

    await expect(
      revokeDeliveredLocatorAccess(makeGuild(canal), OWNER_ID, 'ckticket0000000000000001'),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

describe('publicacao do painel de entregas', () => {
  it('publica o painel e guarda a mensagem', async () => {
    const resultado = await publishDeliveredLocator(makeGuild(), makeConfig());

    expect(resultado.published).toBe(true);
    expect(config.updateGuildConfig).toHaveBeenCalledWith(GUILD_ID, {
      deliveredLocatorMessageId: PANEL_ID,
    });
  });

  it('canal igual ao dos cartoes da equipe: painel NAO e publicado', async () => {
    const resultado = await publishDeliveredLocator(
      makeGuild(),
      makeConfig({ ticketDoneChannelId: LOCATOR_ID }),
    );

    expect(resultado.published).toBe(false);
    expect(resultado.reason).toContain('cada cliente veria as vendas dos outros');
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  /** Sem "Gerenciar cargos" o bot publicaria um painel que ninguem consegue ver. */
  it('sem poder dar acesso aos clientes, o painel nao sai e diz o que falta', async () => {
    const canal = makeLocatorChannel([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ]);

    const resultado = await publishDeliveredLocator(makeGuild(canal), makeConfig());

    expect(resultado.published).toBe(false);
    expect(resultado.missingPermissions).toContain('Gerenciar cargos');
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  it('painel ja publicado e reescrito, nao empilhado', async () => {
    const painel = { edit: vi.fn(() => Promise.resolve(undefined)) };

    const resultado = await publishDeliveredLocator(
      makeGuild(makeLocatorChannel(TODAS, painel)),
      makeConfig({ deliveredLocatorMessageId: PANEL_ID }),
    );

    expect(resultado.published).toBe(true);
    expect(painel.edit).toHaveBeenCalled();
    expect(discord.sendV2).not.toHaveBeenCalled();
  });

  /**
   * Quem recebeu antes de o canal existir nunca ganhou acesso. Sem isto o
   * painel nasceria invisivel para exatamente quem tem entrega esperando.
   */
  it('quem ja tinha entrega esperando ganha acesso na publicacao', async () => {
    tickets.listOwnersWithDeliveredOpenTickets.mockResolvedValueOnce([OWNER_ID, OTHER_OWNER_ID]);
    const canal = makeLocatorChannel();

    await publishDeliveredLocator(makeGuild(canal), makeConfig());

    expect(canal.permissionOverwrites.edit).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

describe('localizar minha entrega', () => {
  /** Topico arquivado nao aceita membro novo: reabre antes de readmitir. */
  it('cliente que saiu do topico arquivado e readmitido depois de reabrir', async () => {
    tickets.listDeliveredOpenTickets.mockResolvedValueOnce([makeTicket()]);
    const add = vi.fn(() => Promise.resolve(undefined));
    channels.resolveTicketChannel.mockResolvedValueOnce({
      id: THREAD_ID,
      archived: true,
      parent: null,
      isThread: () => true,
      members: { fetch: () => Promise.reject(new Error('nao e membro')), add },
    });

    const [resultado] = await locateDeliveredTickets(makeGuild(), OWNER_ID);

    expect(resultado?.rejoined).toBe(true);
    expect(channels.reopenIfArchived).toHaveBeenCalled();
    expect(channels.reopenIfArchived.mock.invocationCallOrder[0]).toBeLessThan(
      add.mock.invocationCallOrder[0] ?? 0,
    );
  });

  /** Quem continua membro nao precisa do topico de volta na lista de ativos. */
  it('cliente que continua no topico nao faz o topico reabrir', async () => {
    tickets.listDeliveredOpenTickets.mockResolvedValueOnce([makeTicket()]);
    channels.resolveTicketChannel.mockResolvedValueOnce({
      id: THREAD_ID,
      archived: true,
      isThread: () => true,
      members: { fetch: () => Promise.resolve({ id: OWNER_ID }), add: vi.fn() },
    });

    await locateDeliveredTickets(makeGuild(), OWNER_ID);

    expect(channels.reopenIfArchived).not.toHaveBeenCalled();
  });
});

describe('telas do canal de entregas', () => {
  it('o painel tem o botao de localizar, cinza como todo botao da loja', () => {
    const [botao] = buttonsOf(buildDeliveredLocatorPanel(makeConfig()));
    expect(botao?.custom_id).toBe('ticket:locate-delivery');
    expect(botao?.style).toBe(ButtonStyle.Secondary);
  });

  it('o painel cabe num container V2', () => {
    const root = buildDeliveredLocatorPanel(makeConfig());
    expect(childrenOf(root).length).toBeLessThanOrEqual(10);
  });

  it('ticket entregue aparece pedindo a confirmacao', () => {
    const entrada: LocatedTicket = { ticket: makeTicket(), queuePosition: 0, reachable: true, rejoined: false };
    expect(allText(buildLocatorResult(GUILD_ID, 'entregas', [entrada]))).toContain(
      'confirme o recebimento',
    );
  });

  /** Ticket montado pela metade nao pode virar "entregue" por acidente. */
  it('sem data de entrega, o ticket NAO aparece como entregue', () => {
    const parcial = { ...makeTicket(), deliveredAt: undefined } as unknown as Ticket;
    const entrada: LocatedTicket = { ticket: parcial, queuePosition: 0, reachable: true, rejoined: false };
    expect(allText(buildLocatorResult(GUILD_ID, 'entregas', [entrada]))).not.toContain(
      'confirme o recebimento',
    );
  });

  it('sem entrega pendente, a frase e a do canal de entregas', () => {
    const texto = allText(
      buildLocatorResult(GUILD_ID, 'entregas', [], { emptyMessage: 'Nenhuma entrega esperando.' }),
    );
    expect(texto).toBe('Nenhuma entrega esperando.');
  });
});
