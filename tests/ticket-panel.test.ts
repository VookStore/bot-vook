import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import type { GuildConfig, TicketCategory } from '@prisma/client';

import {
  GO_TO_TICKET_LABEL,
  START_BUTTON_LABEL,
  buildTicketCreatedNotice,
  buildTicketPanel,
} from '../src/modules/tickets/builders/TicketPanelBuilder';
import {
  CATEGORY_SELECT_PLACEHOLDER,
  TICKET_FIELD,
  buildTicketCreateModal,
} from '../src/modules/tickets/builders/TicketModalBuilder';
import { ValidationError } from '../src/core/errors';
import { DISCORD_LIMITS } from '../src/constants/limits';

/**
 * Painel publico e formulario de abertura.
 *
 * A ORDEM dos blocos e requisito de design, nao detalhe de implementacao:
 * banner -> divisoria -> titulo + descricao -> avisos -> botao -> divisoria ->
 * assinatura. Um `addMediaGalleryComponents` movido de lugar troca o painel
 * inteiro sem quebrar nada — por isso o teste.
 *
 * O painel faz UMA pergunta ("quer abrir um ticket?"); motivo e categoria vao
 * juntos no formulario. Antes o cliente escolhia a categoria no painel e so
 * entao via o campo do motivo, e quem desistia no meio deixava a interacao
 * pendurada.
 */

const LOGO = 'https://cdn.vook.store/logo.png';
const BANNER = 'https://cdn.vook.store/banner.png';

function makeConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    id: 'cfg1',
    guildId: '1528606501248438282',
    storeName: 'Vook Store',
    ticketPanelChannelId: null,
    ticketPanelMessageId: null,
    ticketLogChannelId: null,
    welcomeChannelId: null,
    reviewChannelId: null,
    welcomeEnabled: false,
    welcomeBannerUrl: null,
    autoRoleEnabled: false,
    autoRoleId: null,
    panelTitle: '📁 ATENDIMENTO VOOK',
    panelDescription:
      'Seja bem-vindo ao sistema de atendimento **Vook**, use o botao abaixo para abrir um ticket.',
    panelThumbnailUrl: LOGO,
    panelBannerUrl: BANNER,
    panelNotice:
      '**Nao abra um ticket sem necessidade.**\n**Nao marque excessivamente a equipe.**',
    maxOpenTicketsPerUser: 2,
    maxOpenTicketsGuild: 100,
    ticketCreateCooldownSeconds: 60,
    clientNotifyCooldownSeconds: 300,
    renameCooldownSeconds: 120,
    createdAt: new Date('2026-08-23T00:00:00.000Z'),
    updatedAt: new Date('2026-08-23T00:00:00.000Z'),
    ...overrides,
  } as GuildConfig;
}

function makeCategory(id: string, name: string, emoji: string | null): TicketCategory {
  return {
    id,
    guildId: '1528606501248438282',
    name,
    identifier: name.toLowerCase(),
    description: null,
    emoji,
    position: 0,
    enabled: true,
    destinationChannelId: null,
    locatorMessageId: null,
    createdAt: new Date('2026-08-23T00:00:00.000Z'),
    updatedAt: new Date('2026-08-23T00:00:00.000Z'),
    deletedAt: null,
  } as TicketCategory;
}

const CATEGORIES = [
  makeCategory('c1', 'Compras', '🛒'),
  makeCategory('c2', 'Suporte', '🛠️'),
];

function typesOf(config: GuildConfig, categories: readonly TicketCategory[]): ComponentType[] {
  return buildTicketPanel(config, categories).toJSON().components.map((c) => c.type);
}

describe('painel publico — estrutura visual', () => {
  it('monta os blocos na ordem de design', () => {
    expect(typesOf(makeConfig(), CATEGORIES)).toEqual([
      ComponentType.MediaGallery, // banner abrindo o painel
      ComponentType.Separator,
      ComponentType.Section, // titulo + descricao, logo a direita
      ComponentType.TextDisplay, // avisos em citacao
      ComponentType.ActionRow, // botao "Iniciar atendimento"
      ComponentType.Separator,
      ComponentType.TextDisplay, // assinatura da equipe
    ]);
  });

  it('o banner ABRE o painel', () => {
    // A arte da loja e o cabecalho: ela identifica o servidor antes de qualquer
    // texto, e o painel passa a ser lido como um cartaz.
    expect(typesOf(makeConfig(), CATEGORIES)[0]).toBe(ComponentType.MediaGallery);
  });

  it('agrupa titulo e descricao na mesma Section da logo', () => {
    const componentes = buildTicketPanel(makeConfig(), CATEGORIES).toJSON().components;
    const section = componentes.find((c) => c.type === ComponentType.Section);

    if (section?.type !== ComponentType.Section) throw new Error('esperava Section');
    const textos = section.components.map((c) => c.content);

    // `###` e nao `##`: abaixo do banner o titulo e uma chamada, e um H2
    // competia em peso com a propria arte.
    expect(textos[0]).toBe('### 📁 ATENDIMENTO VOOK');
    expect(textos[1]).toContain('Seja bem-vindo');
    expect(section.accessory.type).toBe(ComponentType.Thumbnail);
  });

  it('renderiza cada aviso como citacao', () => {
    const json = buildTicketPanel(makeConfig(), CATEGORIES).toJSON();
    const bloco = json.components.find(
      (c) => c.type === ComponentType.TextDisplay && c.content.startsWith('>'),
    );

    if (bloco?.type !== ComponentType.TextDisplay) throw new Error('esperava TextDisplay');
    for (const linha of bloco.content.split('\n')) {
      expect(linha.startsWith('>')).toBe(true);
    }
  });

  it('o painel oferece UM botao, nunca o seletor de categorias', () => {
    const json = buildTicketPanel(makeConfig(), CATEGORIES).toJSON();
    const row = json.components.find((c) => c.type === ComponentType.ActionRow);

    if (row?.type !== ComponentType.ActionRow) throw new Error('esperava ActionRow');
    const botao = row.components[0];
    if (botao?.type !== ComponentType.Button) throw new Error('esperava Button');

    expect('label' in botao ? botao.label : '').toBe(START_BUTTON_LABEL);
    // Politica visual da loja: todo botao do bot e cinza.
    expect(botao.style).toBe(ButtonStyle.Secondary);
    expect('custom_id' in botao ? botao.custom_id : '').toBe('ticket:create');
  });

  it('assina com o nome da loja no rodape', () => {
    const json = buildTicketPanel(makeConfig(), CATEGORIES).toJSON();
    const ultimo = json.components.at(-1);

    if (ultimo?.type !== ComponentType.TextDisplay) throw new Error('esperava TextDisplay');
    expect(ultimo.content).toContain('Equipe Vook Store');
  });

  it('sem logo, titulo e descricao viram um TextDisplay so', () => {
    const tipos = typesOf(makeConfig({ panelThumbnailUrl: null }), CATEGORIES);
    expect(tipos.slice(0, 3)).toEqual([
      ComponentType.MediaGallery,
      ComponentType.Separator,
      ComponentType.TextDisplay, // titulo + descricao juntos
    ]);
  });

  it('sem banner, nao sobra divisoria orfa', () => {
    const tipos = typesOf(makeConfig({ panelBannerUrl: null }), CATEGORIES);
    expect(tipos.filter((t) => t === ComponentType.MediaGallery)).toHaveLength(0);
    expect(tipos.filter((t) => t === ComponentType.Separator)).toHaveLength(1);
  });

  it('sem categoria ativa, troca o botao por aviso', () => {
    // Botao que so sabe responder "nao da para abrir ticket" e pior que botao
    // nenhum — e o formulario recusaria um select vazio com 400.
    const tipos = typesOf(makeConfig(), []);
    expect(tipos).not.toContain(ComponentType.ActionRow);
    expect(tipos.at(-1)).toBe(ComponentType.TextDisplay);
  });

  it('avisa a equipe quando ha mais categorias do que o formulario mostra', () => {
    const muitas = Array.from({ length: 40 }, (_, i) =>
      makeCategory(`c${i}`, `Categoria ${i}`, '🛒'),
    );
    const json = buildTicketPanel(makeConfig(), muitas).toJSON();

    expect(json.components.length).toBeLessThanOrEqual(10);

    const ultimo = json.components.at(-1);
    if (ultimo?.type !== ComponentType.TextDisplay) throw new Error('esperava TextDisplay');
    expect(ultimo.content).toContain(`primeiras ${DISCORD_LIMITS.SELECT_OPTIONS} de 40`);
  });
});

/**
 * Formulario de abertura.
 *
 * Motivo e categoria no MESMO envio. O modal e todo em `Label` por imposicao do
 * Discord: um modal e todo em `ActionRow` (so texto) ou todo em `Label` (aceita
 * select), e a categoria virou select.
 */
describe('formulario de abertura', () => {
  interface FieldJson {
    type: ComponentType;
    custom_id: string;
    required?: boolean;
    placeholder?: string;
    options?: Array<{
      label: string;
      value: string;
      description?: string;
      emoji?: { name?: string };
    }>;
  }
  interface ModalJson {
    custom_id: string;
    title: string;
    components: Array<{ component: FieldJson }>;
  }

  const modalOf = (categories: readonly TicketCategory[]): ModalJson =>
    buildTicketCreateModal(categories).toJSON() as unknown as ModalJson;

  it('cai no handler de abertura e nao carrega categoria no customId', () => {
    // A categoria vem do select do proprio formulario: guardada no customId,
    // uma desativada entre publicar o painel e clicar continuaria valendo.
    const modal = modalOf(CATEGORIES);

    expect(modal.custom_id).toBe('ticket:create-modal');
    expect(modal.title).toBe('Abrir um ticket');
  });

  it('pede motivo e categoria, os dois obrigatorios', () => {
    const campos = modalOf(CATEGORIES).components.map((row) => row.component);

    expect(campos).toHaveLength(2);
    expect(campos[0]?.custom_id).toBe(TICKET_FIELD.SUBJECT);
    expect(campos[0]?.type).toBe(ComponentType.TextInput);
    expect(campos[0]?.required).toBe(true);
    expect(campos[1]?.custom_id).toBe(TICKET_FIELD.CATEGORY);
    expect(campos[1]?.type).toBe(ComponentType.StringSelect);
    expect(campos[1]?.placeholder).toBe(CATEGORY_SELECT_PLACEHOLDER);
  });

  it('leva nome, descricao e emoji de cada categoria', () => {
    const comDescricao = [
      { ...makeCategory('c1', 'Suporte', '📋'), description: 'Tire suas duvidas com a equipe.' },
    ] as TicketCategory[];
    const opcoes = modalOf(comDescricao).components[1]?.component.options ?? [];

    expect(opcoes[0]?.label).toBe('Suporte');
    expect(opcoes[0]?.description).toBe('Tire suas duvidas com a equipe.');
    expect(opcoes[0]?.emoji?.name).toBe('📋');
  });

  it('corta em 25 opcoes, o teto do select', () => {
    const muitas = Array.from({ length: 40 }, (_, i) =>
      makeCategory(`c${i}`, `Categoria ${i}`, '🛒'),
    );
    const opcoes = modalOf(muitas).components[1]?.component.options ?? [];

    expect(opcoes).toHaveLength(DISCORD_LIMITS.SELECT_OPTIONS);
  });

  it('sem categoria, recusa montar em vez de gerar um select vazio', () => {
    // Select sem opcao e recusado com 400 e o cliente veria "algo deu errado".
    expect(() => buildTicketCreateModal([])).toThrow(ValidationError);
  });
});

/**
 * Confirmacao efemera logo apos abrir o ticket.
 *
 * O ticket virou TOPICO PRIVADO: a mencao de canal solta no rodape nem sempre e
 * clicavel para quem ainda nao carregou a lista de topicos. Esta tela existe
 * para uma coisa so — dizer que deu certo e levar ate la.
 */
describe('confirmacao de ticket aberto', () => {
  const GUILD = '1528606501248438282';
  const CANAL = '999999999999999999';

  const aviso = (ahead: number) =>
    buildTicketCreatedNotice({
      guildId: GUILD,
      ticketNumber: 1,
      categoryName: 'Cabelos (Perucas)',
      channelId: CANAL,
      queuePosition: ahead + 1,
      aheadCount: ahead,
    }).toJSON();

  it('cabe em um texto e um botao', () => {
    expect(aviso(0).components.map((c) => c.type)).toEqual([
      ComponentType.TextDisplay,
      ComponentType.ActionRow,
    ]);
  });

  it('leva numero, categoria e posicao na fila', () => {
    const bloco = aviso(2).components[0];
    if (bloco?.type !== ComponentType.TextDisplay) throw new Error('esperava TextDisplay');

    expect(bloco.content).toContain('#0001');
    expect(bloco.content).toContain('Cabelos (Perucas)');
    expect(bloco.content).toContain('2 atendimentos na frente');
  });

  it('quem e o primeiro nao ve numero de fila', () => {
    const bloco = aviso(0).components[0];
    if (bloco?.type !== ComponentType.TextDisplay) throw new Error('esperava TextDisplay');

    expect(bloco.content).toContain('Voce e o proximo');
    expect(bloco.content).not.toContain('na frente');
  });

  it('o botao e um LINK direto para a conversa', () => {
    // `Link` nao gera interacao: continua funcionando com o bot fora do ar e
    // nao consome o tempo de resposta de nada.
    const row = aviso(0).components[1];
    if (row?.type !== ComponentType.ActionRow) throw new Error('esperava ActionRow');
    const botao = row.components[0];
    if (botao?.type !== ComponentType.Button) throw new Error('esperava Button');

    expect(botao.style).toBe(ButtonStyle.Link);
    expect('url' in botao ? botao.url : '').toBe(
      `https://discord.com/channels/${GUILD}/${CANAL}`,
    );
    expect('label' in botao ? botao.label : '').toBe(GO_TO_TICKET_LABEL);
  });
});
