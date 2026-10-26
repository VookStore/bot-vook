import { describe, expect, it, vi } from 'vitest';
import { ButtonStyle, ChannelType, ComponentType } from 'discord.js';
import type { ContainerBuilder } from 'discord.js';
import type { GuildConfig, Ticket, TicketCategory } from '@prisma/client';

import {
  LOCATOR_BUTTON_LABEL,
  buildLocatorResult,
  buildTicketLocatorPanel,
  type LocatedTicket,
} from '../src/modules/tickets/builders/TicketLocatorBuilder';
import {
  applyDestinationPermissions,
  buildTicketChannelName,
  createTicketChannel,
  deleteTicketChannel,
  grantChannelAccess,
  grantDestinationAccess,
  revokeChannelAccess,
  revokeDestinationAccess,
  type TicketConversation,
} from '../src/modules/tickets/services/TicketChannelService';
import { buildTranscriptSlug } from '../src/modules/tickets/services/TranscriptHostingService';
import { isSendableConversation, isSendableTextChannel } from '../src/utils/discord';
import { DISCORD_LIMITS } from '../src/constants/limits';

/**
 * Ticket como TOPICO PRIVADO.
 *
 * O QUE ESTES TESTES TRAVAM: as duas naturezas convivem. Topico e canal legado
 * respondem as mesmas operacoes por caminhos diferentes — membro do topico
 * versus overwrite de canal, arquivar versus apagar — e e essa distincao que
 * mantem os tickets abertos antes da mudanca funcionando.
 */

const GUILD_ID = '111111111111111111';
const OWNER_ID = '222222222222222222';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ckticket1',
    guildId: GUILD_ID,
    ticketNumber: 42,
    categoryId: 'c1',
    ownerId: OWNER_ID,
    subject: 'Nao consigo acessar minha conta',
    channelId: '999999999999999999',
    channelName: 'ticket-0042',
    status: 'OPEN',
    priority: 'NORMAL',
    claimedById: null,
    claimedAt: null,
    closedById: null,
    closedAt: null,
    closeReason: null,
    panelMessageId: null,
    lastClientNotifyAt: null,
    lastRenamedAt: null,
    createdAt: new Date('2026-08-29T00:00:00.000Z'),
    updatedAt: new Date('2026-08-29T00:00:00.000Z'),
    ...overrides,
  } as Ticket;
}

function makeEntry(overrides: Partial<LocatedTicket> = {}): LocatedTicket {
  return {
    ticket: makeTicket(),
    queuePosition: 1,
    reachable: true,
    rejoined: false,
    ...overrides,
  };
}

interface Node {
  type: ComponentType;
  content?: string;
  components?: Array<{ label?: string; style?: number; custom_id?: string; url?: string }>;
}

function nodes(root: ContainerBuilder): Node[] {
  return (root.toJSON() as unknown as { components: Node[] }).components;
}

function allText(root: ContainerBuilder): string {
  return nodes(root)
    .filter((node) => node.type === ComponentType.TextDisplay)
    .map((node) => node.content ?? '')
    .join('\n');
}

function buttons(root: ContainerBuilder): NonNullable<Node['components']> {
  return nodes(root)
    .filter((node) => node.type === ComponentType.ActionRow)
    .flatMap((row) => row.components ?? []);
}

// ---------------------------------------------------------------------------
// Encerramento da conversa
// ---------------------------------------------------------------------------

/** Topico minimo: so o que `deleteTicketChannel` e `grantChannelAccess` tocam. */
function fakeThread() {
  const calls = {
    setLocked: vi.fn().mockResolvedValue(undefined),
    setArchived: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const thread = {
    isThread: () => true,
    setLocked: calls.setLocked,
    setArchived: calls.setArchived,
    members: { add: calls.add, remove: calls.remove },
  };
  return { thread: thread as unknown as TicketConversation, calls };
}

/** Canal legado: ticket aberto antes da mudanca, com canal proprio. */
function fakeLegacyChannel() {
  const calls = {
    delete: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const channel = {
    isThread: () => false,
    delete: calls.delete,
    permissionOverwrites: { edit: calls.edit, delete: calls.remove },
  };
  return { channel: channel as unknown as TicketConversation, calls };
}

describe('encerramento da conversa', () => {
  it('topico e TRANCADO e depois arquivado, nunca apagado', () => {
    // A ordem importa: arquivar primeiro faria a chamada seguinte reabrir o
    // topico so para poder edita-lo.
    const { thread, calls } = fakeThread();

    return deleteTicketChannel(thread, 'teste').then((result) => {
      expect(result.outcome).toBe('archived');
      expect(calls.setLocked).toHaveBeenCalledWith(true, 'teste');
      expect(calls.setArchived).toHaveBeenCalledWith(true, 'teste');
      expect(calls.setLocked.mock.invocationCallOrder[0]).toBeLessThan(
        calls.setArchived.mock.invocationCallOrder[0] ?? 0,
      );
    });
  });

  /**
   * Topico JA ARQUIVADO — entregue (a entrega arquiva de proposito) ou parado
   * 7 dias — so aceita edicao se ela o desarquivar. Trancar direto era
   * recusado, a recusa virava WARN, e o ticket fechava no banco com o topico
   * DESTRANCADO: qualquer mensagem do cliente reabria um atendimento encerrado.
   */
  it('topico ja arquivado e reaberto antes de ser trancado', async () => {
    const { thread, calls } = fakeThread();
    (thread as unknown as { archived: boolean }).archived = true;

    await deleteTicketChannel(thread, 'teste');

    expect(calls.setArchived.mock.calls[0]).toEqual([false, 'teste']);
    expect(calls.setArchived.mock.invocationCallOrder[0]).toBeLessThan(
      calls.setLocked.mock.invocationCallOrder[0] ?? 0,
    );
    expect(calls.setLocked).toHaveBeenCalledWith(true, 'teste');
    expect(calls.setArchived).toHaveBeenLastCalledWith(true, 'teste');
  });

  it('topico ativo nao e reaberto a toa', async () => {
    const { thread, calls } = fakeThread();

    await deleteTicketChannel(thread, 'teste');

    expect(calls.setArchived).not.toHaveBeenCalledWith(false, expect.anything());
  });

  it('canal legado continua sendo apagado', async () => {
    // E o comportamento com que ele foi criado — e um canal vazio a mais na
    // lista e justamente o que a mudanca para topico quis evitar.
    const { channel, calls } = fakeLegacyChannel();
    const result = await deleteTicketChannel(channel, 'teste');

    expect(result.outcome).toBe('deleted');
    expect(calls.delete).toHaveBeenCalledOnce();
  });
});

describe('acesso de participante', () => {
  it('topico ganha MEMBRO; canal legado ganha overwrite', async () => {
    const { thread, calls: threadCalls } = fakeThread();
    const { channel, calls: channelCalls } = fakeLegacyChannel();
    const member = { id: '444444444444444444' } as never;

    await grantChannelAccess(thread, member, 'teste');
    await grantChannelAccess(channel, member, 'teste');

    // Sem `reason`: o Discord nao registra motivo em entrada de topico, e a
    // discord.js marca o parametro como deprecado.
    expect(threadCalls.add).toHaveBeenCalledWith('444444444444444444');
    expect(channelCalls.edit).toHaveBeenCalledOnce();
  });

  it('remover acesso segue os mesmos dois caminhos', async () => {
    const { thread, calls: threadCalls } = fakeThread();
    const { channel, calls: channelCalls } = fakeLegacyChannel();

    await revokeChannelAccess(thread, '444444444444444444', 'teste');
    await revokeChannelAccess(channel, '444444444444444444', 'teste');

    expect(threadCalls.remove).toHaveBeenCalledOnce();
    expect(channelCalls.remove).toHaveBeenCalledOnce();
  });
});

describe('nome do ticket', () => {
  it('mantem o formato numerado', () => {
    expect(buildTicketChannelName(42)).toBe('ticket-0042');
  });
});

// ---------------------------------------------------------------------------
// Visibilidade do canal de atendimento
// ---------------------------------------------------------------------------

/**
 * O canal de destino (ex.: #duvidas) e OCULTO por padrao.
 *
 * Quem nao tem atendimento aberto nao o ve na lista de canais. O acesso e dado
 * pessoa a pessoa na abertura e retirado quando o ultimo ticket dela na
 * categoria fecha — e ver o canal-pai e pre-requisito para ver o topico, entao
 * essa concessao nao e cosmetica.
 */
function fakeDestination(canManageRoles = true) {
  const edits: Array<{ id: unknown; options: Record<string, boolean> }> = [];
  const removed: string[] = [];
  const channel = {
    id: '1543146361120235521',
    guild: {
      id: GUILD_ID,
      members: { me: {} },
      roles: { everyone: { id: GUILD_ID }, cache: new Map([['role1', {}]]) },
      client: { user: { id: 'bot1' } },
    },
    permissionsFor: () => ({ has: () => canManageRoles }),
    permissionOverwrites: {
      edit: (id: unknown, options: Record<string, boolean>) => {
        edits.push({ id, options });
        return Promise.resolve(undefined);
      },
      delete: (id: string) => {
        removed.push(id);
        return Promise.resolve(undefined);
      },
    },
  };
  return { channel: channel as never, guild: channel.guild as never, edits, removed };
}

/**
 * Canal de destino pronto para receber `createTicketChannel`.
 *
 * Registra em UMA lista, na ordem real, tudo que a abertura faz — e essa ordem
 * e o objeto do teste, nao um detalhe do fixture.
 */
function fakeDestinationForCreate(options: { failAdd?: boolean } = {}) {
  const ordem: string[] = [];
  const deleted: string[] = [];

  const thread = {
    id: '1543146361120235599',
    members: {
      add: vi.fn(() => {
        ordem.push('thread.members.add');
        return options.failAdd === true
          ? Promise.reject(new Error('sem permissao para adicionar'))
          : Promise.resolve(undefined);
      }),
    },
    delete: vi.fn((reason: string) => {
      deleted.push(reason);
      return Promise.resolve(undefined);
    }),
  };

  const destination: Record<string, unknown> = {
    id: '1543146361120235521',
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => true }),
    permissionOverwrites: {
      edit: vi.fn(() => {
        ordem.push('parent.viewChannel');
        return Promise.resolve(undefined);
      }),
    },
    threads: {
      create: vi.fn(() => {
        ordem.push('threads.create');
        return Promise.resolve(thread);
      }),
    },
  };

  const guild = {
    id: GUILD_ID,
    members: { me: {} },
    channels: { cache: new Map([[destination.id, destination]]), fetch: vi.fn() },
  };
  destination.guild = guild;

  return { guild: guild as never, destination, thread, ordem, deleted };
}

function createParams(guild: unknown) {
  return {
    guild,
    ticketNumber: 42,
    ownerId: '444444444444444444',
    subject: 'Duvida',
    categoryName: 'Pedidos',
    destinationChannelId: '1543146361120235521',
    teamRoleIds: ['role1'],
  } as never;
}

/*
 * A ORDEM QUE FAZ O TOPICO APARECER SOZINHO.
 *
 * O Discord so entrega eventos de topico a clientes que enxergam o canal-pai.
 * Adicionar a pessoa ao topico antes de ela ter `ViewChannel` no pai a torna
 * membro de verdade, mas o `THREAD_CREATE` nao chega ao cliente dela — o topico
 * so aparece na lista depois de reiniciar o Discord. Foi exatamente esse o bug
 * relatado, e e por isso que este teste existe.
 */
describe('abertura do ticket', () => {
  it('libera o canal-pai ANTES de adicionar o cliente ao topico', async () => {
    const { guild, ordem } = fakeDestinationForCreate();

    await createTicketChannel(createParams(guild));

    expect(ordem).toEqual(['threads.create', 'parent.viewChannel', 'thread.members.add']);
  });

  it('adiciona o dono ao topico', async () => {
    const { guild, thread } = fakeDestinationForCreate();

    await createTicketChannel(createParams(guild));

    expect(thread.members.add).toHaveBeenCalledWith('444444444444444444');
  });

  /*
   * O TOPICO FANTASMA. `threads.create` e a primeira operacao: uma falha depois
   * dela deixava um topico vazio, so com o bot, sem painel e sem registro no
   * banco — porque quem chama apaga o rascunho ao receber o erro. Eram esses os
   * `ticket-000X` orfaos que apareciam na lista de canais.
   */
  it('remove o topico quando a abertura falha no meio', async () => {
    const { guild, thread, deleted } = fakeDestinationForCreate({ failAdd: true });

    await expect(createTicketChannel(createParams(guild))).rejects.toThrow();

    expect(thread.delete).toHaveBeenCalledOnce();
    expect(deleted[0]).toContain('42');
  });
});

describe('visibilidade do canal de atendimento', () => {
  it('@everyone NAO ve o canal', async () => {
    const { channel, guild, edits } = fakeDestination();
    await applyDestinationPermissions(guild, channel, ['role1']);

    const everyone = edits.find((e) => e.id === GUILD_ID || (e.id as { id?: string })?.id === GUILD_ID);
    expect(everyone?.options.ViewChannel).toBe(false);
    // Criar topico segue negado: ticket nasce pelo formulario, com numero.
    expect(everyone?.options.CreatePrivateThreads).toBe(false);
  });

  it('a equipe recebe Gerenciar Topicos — e o que revela o topico privado', async () => {
    const { channel, guild, edits } = fakeDestination();
    await applyDestinationPermissions(guild, channel, ['role1']);

    const team = edits.find((e) => e.id === 'role1');
    expect(team?.options.ManageThreads).toBe(true);
    expect(team?.options.ViewChannel).toBe(true);
  });

  it('sem Gerenciar Cargos o bot avisa em vez de gravar pela metade', async () => {
    const { channel, guild, edits } = fakeDestination(false);
    const result = await applyDestinationPermissions(guild, channel, ['role1']);

    expect(result.applied).toBe(false);
    expect(edits).toHaveLength(0);
  });

  it('o cliente ganha ViewChannel no canal-pai, nao so o topico', async () => {
    // Ser membro do topico privado nao basta: sem ViewChannel no pai o Discord
    // nao mostra a conversa nem para quem foi adicionado a ela.
    const { channel, edits } = fakeDestination();
    const ok = await grantDestinationAccess(channel, OWNER_ID, 'teste');

    expect(ok).toBe(true);
    expect(edits[0]?.id).toBe(OWNER_ID);
    expect(edits[0]?.options.ViewChannel).toBe(true);
    expect(edits[0]?.options.SendMessagesInThreads).toBe(true);
    // Escrever no canal em si continua fora: ele e mural, nao chat paralelo.
    expect(edits[0]?.options.SendMessages).toBeUndefined();
  });

  it('retirar acesso apaga o overwrite da pessoa', async () => {
    const { channel, removed } = fakeDestination();
    await revokeDestinationAccess(channel, OWNER_ID, 'teste');

    expect(removed).toEqual([OWNER_ID]);
  });
});

// ---------------------------------------------------------------------------
// Painel de localizar
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    storeName: 'Vook Store',
    panelBannerUrl: 'https://cdn.vook.store/banner.png',
    ...overrides,
  } as GuildConfig;
}

const CATEGORY = { id: 'c1', name: 'Duvidas' } as TicketCategory;

/**
 * O painel existe porque topico privado NAO aparece na barra lateral como um
 * canal aparecia. Sem ele, sair do topico e um caminho sem volta.
 */
describe('painel de localizar', () => {
  it('leva banner, chamada e o botao da categoria', () => {
    const panel = buildTicketLocatorPanel(makeConfig(), CATEGORY);

    expect(nodes(panel)[0]?.type).toBe(ComponentType.MediaGallery);
    expect(allText(panel)).toContain('Localizar Ticket');
    expect(allText(panel)).toContain('**Duvidas**');

    const [botao] = buttons(panel);
    expect(botao?.label).toBe(LOCATOR_BUTTON_LABEL);
    expect(botao?.custom_id).toBe('ticket:locate:c1');
    // Politica visual da loja: todo botao do bot e cinza.
    expect(botao?.style).toBe(ButtonStyle.Secondary);
  });

  it('sem banner configurado o painel comeca no titulo', () => {
    const panel = buildTicketLocatorPanel(makeConfig({ panelBannerUrl: null }), CATEGORY);
    expect(nodes(panel)[0]?.type).toBe(ComponentType.TextDisplay);
  });
});

describe('resultado da busca', () => {
  it('sem ticket aberto, explica o que fazer em vez de dar lista vazia', () => {
    const texto = allText(buildLocatorResult(GUILD_ID, 'Duvidas', []));

    expect(texto).toContain('Nenhum ticket aberto em Duvidas');
    expect(texto).toContain('painel de atendimento');
  });

  it('mostra numero, situacao e assunto de cada atendimento', () => {
    const texto = allText(
      buildLocatorResult(GUILD_ID, 'Duvidas', [makeEntry({ queuePosition: 3 })]),
    );

    expect(texto).toContain('**#0042**');
    expect(texto).toContain('posicao #3');
    expect(texto).toContain('Nao consigo acessar minha conta');
  });

  it('ticket assumido aparece como em atendimento, sem posicao de fila', () => {
    const texto = allText(
      buildLocatorResult(GUILD_ID, 'Duvidas', [
        makeEntry({ ticket: makeTicket({ claimedById: '555555555555555555' }) }),
      ]),
    );

    expect(texto).toContain('em atendimento');
    expect(texto).not.toContain('posicao');
  });

  it('avisa quando o cliente foi readicionado ao topico', () => {
    // E o valor real do painel: link de topico privado nao readmite ninguem, e
    // "sai do topico e nao consigo voltar" e o modo de falha que ele resolve.
    const texto = allText(
      buildLocatorResult(GUILD_ID, 'Duvidas', [makeEntry({ rejoined: true })]),
    );

    expect(texto).toContain('readicionado');
  });

  it('um botao de LINK por ticket alcancavel', () => {
    const [botao] = buttons(buildLocatorResult(GUILD_ID, 'Duvidas', [makeEntry()]));

    expect(botao?.style).toBe(ButtonStyle.Link);
    expect(botao?.url).toBe(
      `https://discord.com/channels/${GUILD_ID}/999999999999999999`,
    );
  });

  it('topico sumido vira aviso, nao botao quebrado', () => {
    const resultado = buildLocatorResult(GUILD_ID, 'Duvidas', [
      makeEntry({ reachable: false }),
    ]);

    expect(allText(resultado)).toContain('conversa indisponivel');
    expect(buttons(resultado)).toHaveLength(0);
  });

  it('corta na linha de cinco botoes e diz quantos ficaram de fora', () => {
    const muitos = Array.from({ length: 8 }, (_, index) =>
      makeEntry({ ticket: makeTicket({ ticketNumber: index + 1 }) }),
    );
    const resultado = buildLocatorResult(GUILD_ID, 'Duvidas', muitos);

    expect(buttons(resultado)).toHaveLength(DISCORD_LIMITS.BUTTONS_PER_ROW);
    expect(allText(resultado)).toContain('Exibindo 5 de 8');
  });
});

// ---------------------------------------------------------------------------
// Endereco do transcript hospedado
// ---------------------------------------------------------------------------

/**
 * O slug e a UNICA barreira de leitura do transcript.
 *
 * Ele carrega nome de cliente, print de conversa e as vezes comprovante com
 * dado bancario. Um id sequencial ou o proprio numero do ticket tornariam o
 * documento adivinhavel — e a URL secreta seria decorativa.
 */
describe('endereco do transcript', () => {
  it('leva o numero do ticket legivel e uma cauda aleatoria', () => {
    expect(buildTranscriptSlug(42)).toMatch(/^t0042-[0-9a-f]{40}$/);
  });

  it('cabe no formato que o Worker aceita', () => {
    // O Worker valida `^[a-z0-9][a-z0-9-]{7,63}$`; slug fora disso vira 400 e o
    // transcript se perderia em silencio no fechamento.
    expect(buildTranscriptSlug(9999)).toMatch(/^[a-z0-9][a-z0-9-]{7,63}$/);
  });

  it('nunca repete', () => {
    const gerados = new Set(Array.from({ length: 500 }, () => buildTranscriptSlug(1)));
    expect(gerados.size).toBe(500);
  });

  it('numero negativo ou quebrado nao gera slug torto', () => {
    expect(buildTranscriptSlug(-5)).toMatch(/^t0000-[0-9a-f]{40}$/);
    expect(buildTranscriptSlug(1.7)).toMatch(/^t0001-[0-9a-f]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// Onde o bot pode publicar
// ---------------------------------------------------------------------------

/**
 * Dois guards, dois papeis.
 *
 * `isSendableTextChannel` guarda DESTINOS DE CONFIGURACAO — canal de logs, de
 * avaliacoes, alvo de anuncio — onde topico continua sendo resposta errada.
 * `isSendableConversation` guarda o lugar onde se fala com o cliente.
 *
 * Confundir os dois foi o que quebrou a cobranca depois da migracao: o ticket
 * virou topico e publicar dentro dele passou a responder "Nao foi possivel
 * enviar a cobranca neste canal".
 */
describe('onde o bot pode publicar', () => {
  const canal = (type: ChannelType) => ({ type, isTextBased: () => true }) as never;

  it('topico serve para CONVERSA, nunca para destino de configuracao', () => {
    for (const type of [
      ChannelType.PrivateThread,
      ChannelType.PublicThread,
      ChannelType.AnnouncementThread,
    ]) {
      expect(isSendableConversation(canal(type))).toBe(true);
      expect(isSendableTextChannel(canal(type))).toBe(false);
    }
  });

  it('canal de texto serve para os dois', () => {
    for (const type of [ChannelType.GuildText, ChannelType.GuildAnnouncement]) {
      expect(isSendableConversation(canal(type))).toBe(true);
      expect(isSendableTextChannel(canal(type))).toBe(true);
    }
  });

  it('categoria e voz nao servem para nada disso', () => {
    for (const type of [ChannelType.GuildCategory, ChannelType.GuildVoice]) {
      expect(isSendableConversation(canal(type))).toBe(false);
    }
  });

  it('reconhece topico so pelo tipo, sem chamar metodo nenhum', () => {
    // Este guard roda sobre objetos vindos do cache, de um `fetch` e de
    // fixtures de teste. A primeira versao perguntava `channel.isThread()` e
    // derrubava doze testes com TypeError em vez de responder — um type guard
    // precisa responder, nunca estourar.
    expect(isSendableConversation({ type: ChannelType.PrivateThread } as never)).toBe(true);
    expect(isSendableConversation(null)).toBe(false);
    expect(isSendableConversation(undefined)).toBe(false);
  });
});
