import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  DiscordAPIError,
  GuildPremiumTier,
  PermissionFlagsBits,
  TextInputStyle,
} from 'discord.js';
import type { ContainerBuilder } from 'discord.js';

import { ConfigurationError, ValidationError } from '../src/core/errors';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../src/constants/limits';

/**
 * Portfolio de lobos.
 *
 * O QUE ESTES TESTES TRAVAM, em ordem de gravidade:
 *  1. o render sai como ANEXO DO BOT — a URL do upload do formulario expira em
 *     horas, e um portfolio que perde as imagens no dia seguinte nao serve;
 *  2. o post so sai para um canal onde o bot consegue ANEXAR — sem isso ele
 *     chegaria como um cartao de texto sobre um lobo que ninguem ve;
 *  3. o formulario cabe no teto de 5 campos do Discord e pede o que o post usa;
 *  4. texto digitado nao vira mencao em massa nem layout no canal publico.
 */

const GUILD_ID = '111111111111111111';
const PORTFOLIO_ID = '222222222222222222';
const TICKET_PANEL_ID = '333333333333333333';
const STAFF_ID = '444444444444444444';
const CDN_URL = 'https://cdn.discordapp.com/ephemeral-attachments/1/2/render.png';

/** Servidor nivel 3: o teto efetivo e o da loja. */
const MAX = BUSINESS_LIMITS.WOLF_RENDER_MAX_BYTES;
/** Servidor sem impulso: o Discord aceita 20 MB. */
const MIB = 1024 * 1024;
const SERVER_20MB = 20 * MIB;
/** Endereco devolvido pelo Worker, com extensao para o Discord tratar como imagem. */
const HOSTED_URL = 'https://transcripts.vook.example/a/0123456789abcdef0123456789abcdef.png';

const config = vi.hoisted(() => ({ getGuildConfig: vi.fn(), updateGuildConfig: vi.fn() }));
const downloader = vi.hoisted(() => ({ downloadDiscordAttachment: vi.fn() }));
const discord = vi.hoisted(() => ({ sendV2WithLargeFile: vi.fn(), sendV2: vi.fn() }));
const panels = vi.hoisted(() => ({ publishBoundPanel: vi.fn(), refreshBoundPanel: vi.fn() }));
const hosting = vi.hoisted(() => ({ hostAsset: vi.fn(), isAssetHostingEnabled: vi.fn() }));

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]): unknown => config.getGuildConfig(...args),
  updateGuildConfig: (...args: unknown[]): unknown => config.updateGuildConfig(...args),
}));

vi.mock('../src/utils/download', () => ({
  downloadDiscordAttachment: (...args: unknown[]): unknown =>
    downloader.downloadDiscordAttachment(...args),
}));

vi.mock('../src/components/reply', () => ({
  sendV2WithLargeFile: (...args: unknown[]): unknown => discord.sendV2WithLargeFile(...args),
  sendV2: (...args: unknown[]): unknown => discord.sendV2(...args),
}));

vi.mock('../src/modules/hosting/AssetHostingService', () => ({
  hostAsset: (...args: unknown[]): unknown => hosting.hostAsset(...args),
  isAssetHostingEnabled: (): unknown => hosting.isAssetHostingEnabled(),
}));

vi.mock('../src/modules/configuration/services/PublishedPanelService', () => ({
  publishBoundPanel: (...args: unknown[]): unknown => panels.publishBoundPanel(...args),
  refreshBoundPanel: (...args: unknown[]): unknown => panels.refreshBoundPanel(...args),
}));

import {
  WOLF_FIELD,
  buildWolfModal,
  buildWolfPanel,
  buildWolfPortfolioPost,
  readWolfSubmission,
  type WolfSubmission,
} from '../src/modules/wolves/builders/WolfBuilders';
import { WOLF_EMOJI, WOLF_KINDS } from '../src/modules/wolves/data/wolves';
import {
  assertRenderDeclaration,
  describeRenderMaxSize,
  detectRenderFormat,
  effectiveRenderLimit,
  renderTransferTimeoutMs,
} from '../src/modules/wolves/validators/render';
import {
  publishWolfPost,
  setPortfolioChannel,
} from '../src/modules/wolves/services/WolfPortfolioService';
import { guildUploadLimit, isPayloadTooLargeError } from '../src/utils/discord';

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0])]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);

const ALL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
];

function makeChannel(granted: readonly bigint[] = ALL_PERMISSIONS) {
  return {
    id: PORTFOLIO_ID,
    type: ChannelType.GuildText,
    isTextBased: () => true,
    permissionsFor: () => ({ has: (flag: bigint) => granted.includes(flag) }),
  };
}

function makeGuild(
  channel: ReturnType<typeof makeChannel> | null = makeChannel(),
  premiumTier: GuildPremiumTier = GuildPremiumTier.Tier3,
) {
  return {
    id: GUILD_ID,
    premiumTier,
    members: { me: { id: 'bot' } },
    channels: {
      cache: { get: (id: string) => (channel !== null && id === channel.id ? channel : undefined) },
      fetch: (id: string) =>
        Promise.resolve(channel !== null && id === channel.id ? channel : null),
    },
  } as never;
}

function submission(over: Partial<WolfSubmission> = {}): WolfSubmission {
  return {
    customer: 'Enrick',
    kind: 'lycan',
    personalization: null,
    additional: null,
    ...over,
  };
}

function upload(over: Partial<{ contentType: string | null; size: number; name: string }> = {}) {
  return {
    url: CDN_URL,
    name: over.name ?? 'render.png',
    contentType: over.contentType === undefined ? 'image/png' : over.contentType,
    size: over.size ?? 2_000_000,
  };
}

interface JsonNode {
  type: ComponentType;
  content?: string;
  custom_id?: string;
  style?: number;
  disabled?: boolean;
  emoji?: { id?: string; name?: string };
  items?: Array<{ media: { url: string } }>;
  components?: JsonNode[];
  accessory?: JsonNode;
}

function json(root: ContainerBuilder): JsonNode {
  return root.toJSON() as unknown as JsonNode;
}

function allText(root: ContainerBuilder): string {
  const parts: string[] = [];
  const walk = (node: JsonNode): void => {
    if (node.type === ComponentType.TextDisplay && typeof node.content === 'string') {
      parts.push(node.content);
    }
    for (const child of node.components ?? []) walk(child);
    if (node.accessory !== undefined) walk(node.accessory);
  };
  for (const child of json(root).components ?? []) walk(child);
  return parts.join('\n');
}

function expectWithinDiscordLimits(root: ContainerBuilder): void {
  expect(json(root).components?.length ?? 0).toBeLessThanOrEqual(10);
  expect(allText(root).length).toBeLessThanOrEqual(4000);
}

function buttonsOf(root: ContainerBuilder): JsonNode[] {
  return (json(root).components ?? [])
    .filter((node) => node.type === ComponentType.ActionRow)
    .flatMap((row) => row.components ?? [])
    .filter((node) => node.type === ComponentType.Button);
}

function galleryUrls(root: ContainerBuilder): string[] {
  return (json(root).components ?? [])
    .filter((node) => node.type === ComponentType.MediaGallery)
    .flatMap((node) => (node.items ?? []).map((item) => item.media.url));
}

beforeEach(() => {
  vi.resetAllMocks();
  config.getGuildConfig.mockResolvedValue({
    storeName: 'Vook Store',
    wolfPortfolioChannelId: PORTFOLIO_ID,
    wolfPanelChannelId: null,
    wolfPanelMessageId: null,
    ticketPanelChannelId: TICKET_PANEL_ID,
  });
  config.updateGuildConfig.mockResolvedValue({});
  downloader.downloadDiscordAttachment.mockResolvedValue({ bytes: PNG, contentType: 'image/png' });
  discord.sendV2WithLargeFile.mockResolvedValue({ id: 'msg1', channelId: PORTFOLIO_ID });
  panels.refreshBoundPanel.mockResolvedValue({ updated: true });
  // Por padrao os testes rodam SEM hospedagem: o caminho do anexo e o preferido.
  hosting.isAssetHostingEnabled.mockReturnValue(false);
  hosting.hostAsset.mockResolvedValue(HOSTED_URL);
  discord.sendV2.mockResolvedValue({ id: 'msg1', channelId: PORTFOLIO_ID });
});

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

interface ModalJson {
  custom_id: string;
  title: string;
  components: Array<{
    type: number;
    label: string;
    description?: string;
    component: {
      type: number;
      custom_id: string;
      style?: number;
      required?: boolean;
      min_values?: number;
      max_values?: number;
      max_length?: number;
      options?: Array<{ value: string; label: string; emoji?: unknown }>;
    };
  }>;
}

describe('formulario do lobo', () => {
  const modal = buildWolfModal(MAX).toJSON() as unknown as ModalJson;
  const field = (customId: string) =>
    modal.components.find((label) => label.component.custom_id === customId);

  it('cai no handler do portfolio', () => {
    expect(modal.custom_id).toBe('wolf:create-modal');
    expect(modal.title.length).toBeLessThanOrEqual(DISCORD_LIMITS.MODAL_TITLE);
  });

  it('usa os CINCO campos que o Discord permite, e so eles', () => {
    expect(modal.components).toHaveLength(5);
    expect(modal.components.map((label) => label.component.custom_id)).toEqual([
      WOLF_FIELD.CUSTOMER,
      WOLF_FIELD.KIND,
      WOLF_FIELD.RENDER,
      WOLF_FIELD.PERSONALIZATION,
      WOLF_FIELD.ADDITIONAL,
    ]);
    for (const label of modal.components) {
      expect(label.type).toBe(ComponentType.Label);
      expect(label.label.length).toBeLessThanOrEqual(45);
      expect((label.description ?? '').length).toBeLessThanOrEqual(100);
    }
  });

  it('o tipo e um select com exatamente Lycan e Lobisomem', () => {
    const kind = field(WOLF_FIELD.KIND)?.component;

    expect(kind?.type).toBe(ComponentType.StringSelect);
    expect(kind?.min_values).toBe(1);
    expect(kind?.max_values).toBe(1);
    expect(kind?.options?.map((option) => option.label)).toEqual(['Lycan', 'Lobisomem']);
    // Emoji personalizado em componente derruba o formulario inteiro com 400
    // quando o bot nao o alcanca; em opcao de select ele nao entra.
    expect(kind?.options?.every((option) => option.emoji === undefined)).toBe(true);
  });

  it('pede UM render, obrigatorio', () => {
    const render = field(WOLF_FIELD.RENDER)?.component;

    expect(render?.type).toBe(ComponentType.FileUpload);
    expect(render?.min_values).toBe(1);
    expect(render?.max_values).toBe(1);
    expect(render?.required).toBe(true);
  });

  it('cliente e obrigatorio; personalizacao e adicional sao opcionais', () => {
    expect(field(WOLF_FIELD.CUSTOMER)?.component.required).toBe(true);
    expect(field(WOLF_FIELD.CUSTOMER)?.component.style).toBe(TextInputStyle.Short);

    for (const id of [WOLF_FIELD.PERSONALIZATION, WOLF_FIELD.ADDITIONAL]) {
      expect(field(id)?.component.required).toBe(false);
      expect(field(id)?.component.style).toBe(TextInputStyle.Paragraph);
      expect(field(id)?.component.max_length).toBe(BUSINESS_LIMITS.WOLF_DETAIL_MAX);
    }
  });
});

// ---------------------------------------------------------------------------
// Leitura do formulario
// ---------------------------------------------------------------------------

describe('leitura do formulario', () => {
  const read = (over: Partial<Parameters<typeof readWolfSubmission>[0]> = {}) =>
    readWolfSubmission({
      customer: 'Enrick',
      kind: 'lycan',
      personalization: '',
      additional: '',
      ...over,
    });

  it('aceita o preenchimento minimo e deixa os detalhes vazios como nulos', () => {
    expect(read()).toEqual({
      customer: 'Enrick',
      kind: 'lycan',
      personalization: null,
      additional: null,
    });
  });

  it('nome sem letra nem numero nao vira cliente', () => {
    expect(() => read({ customer: '   ' })).toThrow(ValidationError);
    expect(() => read({ customer: '!!!' })).toThrow(ValidationError);
  });

  it('mantem acento e junta espacos do nome', () => {
    expect(read({ customer: '  João   da   Silva ' }).customer).toBe('João da Silva');
  });

  it('tipo fora da lista e recusado', () => {
    expect(() => read({ kind: 'dragao' })).toThrow(ValidationError);
    expect(() => read({ kind: undefined })).toThrow(ValidationError);
  });

  it('mencao em massa digitada nao sai como ping no canal publico', () => {
    const lido = read({ customer: '@everyone', personalization: 'para <@123456789012345678>' });

    expect(lido.customer).not.toBe('@everyone');
    expect(lido.personalization).toContain('[usuario]');
  });

  it('detalhe descarta linhas vazias e respeita o teto de linhas', () => {
    const muitas = Array.from({ length: 12 }, (_, i) => `item ${i + 1}`).join('\n\n');
    const lido = read({ personalization: muitas });

    expect(lido.personalization?.split('\n')).toHaveLength(BUSINESS_LIMITS.WOLF_DETAIL_MAX_LINES);
  });
});

// ---------------------------------------------------------------------------
// Painel da equipe
// ---------------------------------------------------------------------------

describe('painel da equipe', () => {
  it('com destino, o botao abre o formulario e o painel diz onde o post sai', () => {
    const panel = buildWolfPanel({ portfolioChannelId: PORTFOLIO_ID, maxRenderBytes: MAX });
    const [button] = buttonsOf(panel);

    expect(button?.custom_id).toBe('wolf:create');
    expect(button?.disabled).not.toBe(true);
    expect(allText(panel)).toContain(`<#${PORTFOLIO_ID}>`);
  });

  it('sem destino, o botao sai desligado e o painel explica o que falta', () => {
    const panel = buildWolfPanel({ portfolioChannelId: null, maxRenderBytes: MAX });

    expect(buttonsOf(panel)[0]?.disabled).toBe(true);
    expect(allText(panel)).toContain('/lobos portfolio');
  });

  it('botao cinza e com emoji unicode — nunca o personalizado', () => {
    const [button] = buttonsOf(buildWolfPanel({ portfolioChannelId: PORTFOLIO_ID, maxRenderBytes: MAX }));

    expect(button?.style).toBe(ButtonStyle.Secondary);
    expect(button?.emoji?.id).toBeUndefined();
  });

  it('antecipa o que o formulario pede, com os emojis da loja', () => {
    const texto = allText(buildWolfPanel({ portfolioChannelId: PORTFOLIO_ID, maxRenderBytes: MAX }));

    expect(texto).toContain(WOLF_EMOJI.LOBO);
    expect(texto).toContain(WOLF_EMOJI.PERSONALIZACAO);
    expect(texto).toContain(WOLF_EMOJI.ADICIONAL);
    expect(texto).toContain('Lycan ou Lobisomem');
    expect(texto).toContain('100 MB');
  });

  it.each([PORTFOLIO_ID, null])('cabe nos limites do Discord (destino %s)', (portfolio) => {
    expectWithinDiscordLimits(buildWolfPanel({ portfolioChannelId: portfolio, maxRenderBytes: MAX }));
  });
});

// ---------------------------------------------------------------------------
// Post do portfolio
// ---------------------------------------------------------------------------

describe('post do portfolio', () => {
  const post = (over: Partial<WolfSubmission> = {}, ticketChannelId: string | null = TICKET_PANEL_ID) =>
    buildWolfPortfolioPost({
      submission: submission(over),
      imageUrl: 'attachment://lobo-lycan.png',
      ticketChannelId,
      storeName: 'Vook Store',
    });

  it('o render vem do anexo do bot, nunca de uma URL externa', () => {
    expect(galleryUrls(post())).toEqual(['attachment://lobo-lycan.png']);
  });

  it('mostra tipo e cliente com o emoji do lobo', () => {
    const texto = allText(post({ kind: 'lobisomem', customer: 'Enrick' }));

    expect(texto).toContain(`${WOLF_EMOJI.LOBO} **Lobo:** Lobisomem`);
    expect(texto).toContain('**Cliente:** Enrick');
  });

  it('personalizacao e adicional aparecem com os emojis proprios quando preenchidos', () => {
    const texto = allText(post({ personalization: 'Com runas', additional: '2 acessórios' }));

    expect(texto).toContain(`${WOLF_EMOJI.PERSONALIZACAO} **Personalização:** Com runas`);
    expect(texto).toContain(`${WOLF_EMOJI.ADICIONAL} **Adicional:** 2 acessórios`);
  });

  it('detalhe vazio some — nada de "Personalizacao: nenhuma"', () => {
    const texto = allText(post());

    expect(texto).not.toContain(WOLF_EMOJI.PERSONALIZACAO);
    expect(texto).not.toContain(WOLF_EMOJI.ADICIONAL);
  });

  it('varias linhas de detalhe viram lista em citacao', () => {
    const texto = allText(post({ personalization: 'Com runas\nOlhos claros' }));

    expect(texto).toContain('**Personalização:**\n> Com runas\n> Olhos claros');
  });

  it('convida a abrir ticket apontando para o painel de atendimento', () => {
    const texto = allText(post());

    expect(texto).toContain(WOLF_EMOJI.TICKET);
    expect(texto).toContain(`<#${TICKET_PANEL_ID}>`);
  });

  it('sem painel de atendimento configurado, o convite continua — sem link quebrado', () => {
    const texto = allText(post({}, null));

    expect(texto).toContain(WOLF_EMOJI.TICKET);
    expect(texto).not.toContain('<#');
  });

  it('NAO leva preco: o post nunca e reescrito e envelheceria a cada reajuste', () => {
    expect(allText(post({ personalization: 'Com runas', additional: 'Acessórios' }))).not.toContain(
      'R$',
    );
  });

  it('texto digitado nao vira link mascarado nem cabecalho no canal publico', () => {
    const texto = allText(
      post({ customer: '[clique](https://phishing.example)', personalization: '# GRATIS' }),
    );

    expect(texto).not.toContain('[clique](https://');
    expect(texto).toContain('\\[clique\\]');
    expect(texto).toContain('\\# GRATIS');
  });

  it('cabe nos limites do Discord no pior caso', () => {
    const cheio = 'x'.repeat(BUSINESS_LIMITS.WOLF_DETAIL_MAX);
    expectWithinDiscordLimits(
      post({
        customer: 'C'.repeat(BUSINESS_LIMITS.WOLF_CUSTOMER_MAX),
        personalization: cheio,
        additional: cheio,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Formato do render
// ---------------------------------------------------------------------------

describe('formato do render', () => {
  it.each([
    ['png', PNG],
    ['jpg', JPG],
    ['gif', GIF],
    ['webp', WEBP],
  ] as const)('reconhece %s pela assinatura dos bytes', (ext, bytes) => {
    expect(detectRenderFormat(bytes)?.ext).toBe(ext);
  });

  it('PDF, texto e arquivo vazio nao sao render', () => {
    expect(detectRenderFormat(Buffer.from('%PDF-1.7', 'latin1'))).toBeNull();
    expect(detectRenderFormat(Buffer.from('ola', 'utf8'))).toBeNull();
    expect(detectRenderFormat(Buffer.alloc(0))).toBeNull();
  });

  it('arquivo acima do teto e recusado antes de qualquer download', () => {
    expect(() =>
      assertRenderDeclaration(upload({ size: MAX + 1 }), MAX, false),
    ).toThrow(ValidationError);
  });

  it('tipo declarado que nao e imagem e recusado; tipo ausente fica para os bytes', () => {
    expect(() => assertRenderDeclaration(upload({ contentType: 'application/pdf' }), MAX, false)).toThrow(
      ValidationError,
    );
    expect(() => assertRenderDeclaration(upload({ contentType: null }), MAX, false)).not.toThrow();
    expect(() => assertRenderDeclaration(upload({ contentType: 'image/jpg' }), MAX, false)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Publicacao
// ---------------------------------------------------------------------------

describe('publicacao no portfolio', () => {
  const publish = (over: Partial<Parameters<typeof publishWolfPost>[0]> = {}) =>
    publishWolfPost({
      guild: makeGuild(),
      actorId: STAFF_ID,
      submission: submission(),
      render: upload(),
      maxRenderBytes: MAX,
      ...over,
    });

  it('reenvia os BYTES baixados como anexo do bot — a URL do upload nao entra no post', async () => {
    await publish();

    // Prazo do download proporcional ao tamanho: 15 s nao baixam 100 MB.
    expect(downloader.downloadDiscordAttachment).toHaveBeenCalledWith(
      CDN_URL,
      MAX,
      renderTransferTimeoutMs(upload().size),
    );

    const [channel, root, file] = discord.sendV2WithLargeFile.mock.calls[0] as [
      { id: string },
      ContainerBuilder,
      { name: string; data: Buffer; contentType?: string },
    ];

    expect(channel.id).toBe(PORTFOLIO_ID);
    expect(file.data).toBe(PNG);
    expect(file.name).toBe('lobo-lycan.png');
    expect(file.contentType).toBe('image/png');
    expect(galleryUrls(root)).toEqual(['attachment://lobo-lycan.png']);
    expect(JSON.stringify(root.toJSON())).not.toContain('cdn.discordapp.com');
  });

  it('a extensao do anexo vem dos bytes, nao do nome que o arquivo trouxe', async () => {
    // "render.png" que na verdade e WEBP: reenviado como .png, o Discord
    // mostraria um quadrado quebrado no post publico.
    downloader.downloadDiscordAttachment.mockResolvedValue({ bytes: WEBP, contentType: 'image/png' });

    await publish({ submission: submission({ kind: 'lobisomem' }) });

    const file = discord.sendV2WithLargeFile.mock.calls[0]?.[2] as { name: string };
    expect(file.name).toBe('lobo-lobisomem.webp');
  });

  it('arquivo que nao e imagem nao e publicado', async () => {
    downloader.downloadDiscordAttachment.mockResolvedValue({
      bytes: Buffer.from('%PDF-1.7', 'latin1'),
      contentType: '',
    });

    await expect(publish({ render: upload({ contentType: null }) })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(discord.sendV2WithLargeFile).not.toHaveBeenCalled();
  });

  it('render grande demais e recusado sem gastar o download', async () => {
    await expect(
      publish({ render: upload({ size: MAX + 1 }) }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(downloader.downloadDiscordAttachment).not.toHaveBeenCalled();
  });

  it('sem canal de portfolio definido, avisa como resolver e nao baixa nada', async () => {
    config.getGuildConfig.mockResolvedValue({
      storeName: 'Vook Store',
      wolfPortfolioChannelId: null,
      ticketPanelChannelId: null,
    });

    await expect(publish()).rejects.toBeInstanceOf(ConfigurationError);
    expect(downloader.downloadDiscordAttachment).not.toHaveBeenCalled();
    expect(discord.sendV2WithLargeFile).not.toHaveBeenCalled();
  });

  it('canal apagado vira erro de configuracao, nao um 403 cru', async () => {
    await expect(publish({ guild: makeGuild(null) })).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('bot sem "Anexar arquivos" e barrado ANTES de publicar um post sem imagem', async () => {
    const semAnexo = makeChannel([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);

    const erro = await publish({ guild: makeGuild(semAnexo) }).catch((error: unknown) => error);

    expect(erro).toBeInstanceOf(ConfigurationError);
    expect((erro as ConfigurationError).userMessage).toContain('Anexar arquivos');
    expect(downloader.downloadDiscordAttachment).not.toHaveBeenCalled();
    expect(discord.sendV2WithLargeFile).not.toHaveBeenCalled();
  });

  it('o convite do post aponta para o painel de atendimento configurado', async () => {
    await publish();

    const root = discord.sendV2WithLargeFile.mock.calls[0]?.[1] as ContainerBuilder;
    expect(allText(root)).toContain(`<#${TICKET_PANEL_ID}>`);
  });
});

// ---------------------------------------------------------------------------
// Configuracao do destino
// ---------------------------------------------------------------------------

describe('definir o canal do portfolio', () => {
  it('grava o canal e atualiza o painel, que liga o botao', async () => {
    const channel = makeChannel();

    const result = await setPortfolioChannel(makeGuild(channel), channel as never, MAX);

    expect(config.updateGuildConfig).toHaveBeenCalledWith(GUILD_ID, {
      wolfPortfolioChannelId: PORTFOLIO_ID,
    });
    expect(panels.refreshBoundPanel).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(true);
  });

  it('canal onde o bot nao anexa NAO e gravado', async () => {
    const semAnexo = makeChannel([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);

    await expect(
      setPortfolioChannel(makeGuild(semAnexo), semAnexo as never, MAX),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(config.updateGuildConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fonte de verdade
// ---------------------------------------------------------------------------

describe('dados do portfolio', () => {
  it('os emojis estao no formato que o Discord renderiza em texto', () => {
    for (const emoji of Object.values(WOLF_EMOJI)) {
      expect(emoji).toMatch(/^<:[A-Za-z0-9_]{2,32}:\d{17,20}>$/);
    }
  });

  it('os tipos tem valores unicos e curtos o bastante para o select', () => {
    const values = WOLF_KINDS.map((kind) => kind.value);
    expect(new Set(values).size).toBe(values.length);
    for (const kind of WOLF_KINDS) {
      expect(kind.label.length).toBeLessThanOrEqual(DISCORD_LIMITS.SELECT_LABEL);
    }
  });
});

// ---------------------------------------------------------------------------
// Renders de ate 100 MB
// ---------------------------------------------------------------------------

/**
 * 100 MB e o teto DA LOJA. O teto que vale e o menor entre ele e o que o BOT
 * pode reenviar no servidor — e isso depende so do nivel de impulsos (20 MB sem
 * impulso ou no nivel 1, 50 no nivel 2, 100 no nivel 3). Bot nao tem Nitro.
 *
 * REGRESSAO DE PRODUCAO: a primeira versao usava o `attachmentSizeLimit` da
 * interacao, que o Discord calcula como o MAXIMO entre o Nitro de quem clicou e
 * o nivel do servidor. Com Nitro na conta, ela prometeu 100 MB num servidor que
 * aceita 20 — e o reenvio tomou DiscordAPIError[40005].
 */
describe('teto efetivo do render', () => {
  it('servidor nivel 3: vale o teto da loja', () => {
    expect(effectiveRenderLimit({ premiumTier: GuildPremiumTier.Tier3 }, false)).toBe(MAX);
  });

  it('servidor nivel 2: 50 MB', () => {
    expect(effectiveRenderLimit({ premiumTier: GuildPremiumTier.Tier2 }, false)).toBe(50 * MIB);
  });

  it.each([GuildPremiumTier.None, GuildPremiumTier.Tier1])(
    'servidor sem impulso suficiente (nivel %s): 20 MB — nivel 1 nao sobe o teto',
    (tier) => {
      expect(effectiveRenderLimit({ premiumTier: tier }, false)).toBe(SERVER_20MB);
    },
  );

  it('o teto do bot nao depende de quem clica: e funcao so do servidor', () => {
    // Nao existe parametro para o Nitro de quem usa o painel. O tipo impede
    // que alguem volte a passar `interaction.attachmentSizeLimit` aqui.
    expect(effectiveRenderLimit.length).toBe(2);
    expect(guildUploadLimit({ premiumTier: GuildPremiumTier.None })).toBe(
      DISCORD_LIMITS.ATTACHMENT_BYTES_DEFAULT,
    );
  });

  it('o painel e o formulario mostram o teto REAL do servidor', () => {
    const painel = allText(
      buildWolfPanel({ portfolioChannelId: PORTFOLIO_ID, maxRenderBytes: SERVER_20MB }),
    );
    const modal = buildWolfModal(SERVER_20MB).toJSON() as unknown as ModalJson;
    const render = modal.components.find((label) => label.component.custom_id === WOLF_FIELD.RENDER);

    expect(painel).toContain('até 20 MB');
    expect(painel).not.toContain('100 MB');
    expect(render?.description).toContain('até 20 MB');
  });

  it('nunca passa do teto da loja, que existe por MEMORIA', () => {
    // O PM2 reinicia o bot em 512 MB; 100 MiB de render custam +208 MB medidos.
    expect(guildUploadLimit({ premiumTier: GuildPremiumTier.Tier3 })).toBeLessThanOrEqual(MAX);
    expect(effectiveRenderLimit({ premiumTier: GuildPremiumTier.Tier3 }, false)).toBeLessThanOrEqual(MAX);
  });

  it('com hospedagem ligada, o teto deixa de depender do nivel de impulsos', () => {
    // Render grande num servidor sem impulso passa a caber — pelo Worker.
    expect(effectiveRenderLimit({ premiumTier: GuildPremiumTier.None }, true)).toBe(
      BUSINESS_LIMITS.WOLF_HOSTED_MAX_BYTES,
    );
    // E o conselho de impulsionar some da recusa, porque nao resolveria nada.
    const erro = declarationError(BUSINESS_LIMITS.WOLF_HOSTED_MAX_BYTES + 1, BUSINESS_LIMITS.WOLF_HOSTED_MAX_BYTES, true);
    expect(erro?.userMessage).not.toContain('impulsos');
  });

  it('descreve o tamanho em MB inteiros', () => {
    expect(describeRenderMaxSize(MAX)).toBe('100 MB');
    expect(describeRenderMaxSize(50 * MIB)).toBe('50 MB');
  });
});

function declarationError(
  size: number,
  maxBytes: number,
  hostingEnabled = false,
): ValidationError | null {
  try {
    assertRenderDeclaration(upload({ size }), maxBytes, hostingEnabled);
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  return null;
}

describe('arquivo maior que o servidor aceita', () => {
  it('recusa e diz que e o nivel de impulsos que limita', () => {
    const erro = declarationError(30 * MIB, SERVER_20MB);

    expect(erro).toBeInstanceOf(ValidationError);
    expect(erro?.userMessage).toContain('20 MB');
    expect(erro?.userMessage).toContain('impulsos');
  });

  it('acima do teto da loja, a orientacao e exportar menor — impulso nao resolve', () => {
    const erro = declarationError(150 * MIB, MAX);

    expect(erro?.userMessage).toContain('100 MB');
    expect(erro?.userMessage).not.toContain('impulsos');
  });

  it('90 MB num servidor nivel 3 passa', () => {
    expect(declarationError(90 * MIB, MAX)).toBeNull();
  });

  it('a publicacao respeita o teto do servidor, sem gastar o download', async () => {
    await expect(
      publishWolfPost({
        guild: makeGuild(),
        actorId: STAFF_ID,
        submission: submission(),
        render: upload({ size: 30 * MIB }),
        maxRenderBytes: SERVER_20MB,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(downloader.downloadDiscordAttachment).not.toHaveBeenCalled();
  });
});

describe('Discord recusa o render por tamanho mesmo assim', () => {
  /** Recusa da API, em JSON, com o codigo 40005. */
  const tooLarge = () =>
    new DiscordAPIError(
      { code: 40005, message: 'Request entity too large' },
      40005,
      400,
      'POST',
      '/channels/1/messages',
      {},
    );

  /**
   * Recusa da BORDA: corpo nao e JSON, entao o @discordjs/rest preenche so o
   * status. Continua chegando como DiscordAPIError — nao como HTTPError.
   */
  const edgeTooLarge = () =>
    new DiscordAPIError(
      new ArrayBuffer(0) as never,
      undefined as never,
      413,
      'POST',
      '/channels/1/messages',
      {},
    );

  it('40005 vira aviso de tamanho para a equipe — nao "erro inesperado"', async () => {
    discord.sendV2WithLargeFile.mockRejectedValueOnce(tooLarge());

    const erro = await publishWolfPost({
      guild: makeGuild(),
      actorId: STAFF_ID,
      submission: submission(),
      render: upload(),
      maxRenderBytes: MAX,
    }).catch((error: unknown) => error);

    expect(erro).toBeInstanceOf(ValidationError);
    expect((erro as ValidationError).userMessage).toContain('recusou o render por tamanho');
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

    await expect(
      publishWolfPost({
        guild: makeGuild(),
        actorId: STAFF_ID,
        submission: submission(),
        render: upload(),
        maxRenderBytes: MAX,
      }),
    ).rejects.toBe(outro);
  });

  it('reconhece as duas recusas reais: 40005 pelo codigo e 413 pelo status', () => {
    expect(isPayloadTooLargeError(tooLarge())).toBe(true);
    expect(isPayloadTooLargeError(edgeTooLarge())).toBe(true);
    expect(isPayloadTooLargeError(new Error('Request entity too large'))).toBe(false);
  });

  it('a recusa da borda (413 sem codigo) tambem vira aviso de tamanho', async () => {
    discord.sendV2WithLargeFile.mockRejectedValueOnce(edgeTooLarge());

    const erro = await publishWolfPost({
      guild: makeGuild(),
      actorId: STAFF_ID,
      submission: submission(),
      render: upload(),
      maxRenderBytes: MAX,
    }).catch((error: unknown) => error);

    expect(erro).toBeInstanceOf(ValidationError);
  });

  /**
   * Cancelamento por tempo. `retries: 0` impede a repeticao automatica; esta
   * mensagem impede a HUMANA de virar post duplicado no canal publico.
   */
  it('envio cancelado por tempo manda CONFERIR o canal antes de repetir', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    discord.sendV2WithLargeFile.mockRejectedValueOnce(abort);

    const erro = await publishWolfPost({
      guild: makeGuild(),
      actorId: STAFF_ID,
      submission: submission(),
      render: upload(),
      maxRenderBytes: MAX,
    }).catch((error: unknown) => error);

    expect(erro).toBeInstanceOf(ValidationError);
    expect((erro as ValidationError).userMessage).toContain('Confira o canal');
  });
});

describe('prazo de transferencia', () => {
  it('cresce com o tamanho: 100 MB tem bem mais que os 15 s do cliente padrao', () => {
    expect(renderTransferTimeoutMs(100 * MIB)).toBe(220_000);
    expect(renderTransferTimeoutMs(1)).toBeGreaterThan(15_000);
  });

  it('tem teto: transferencia travada nao segura o portfolio para sempre', () => {
    expect(renderTransferTimeoutMs(10_000 * MIB)).toBe(5 * 60_000);
  });
});

/**
 * Um post por vez. Cada render grande ocupa ~200 MB no pico (download + copia
 * do envio) e o PM2 reinicia o bot em 512 MB. O segundo post ESPERA — nao e
 * recusado: o modal do Discord nao guarda nada, e recusar custaria digitar e
 * anexar tudo de novo.
 */
describe('fila de publicacao', () => {
  const publishFor = (customer: string, kind: 'lycan' | 'lobisomem') =>
    publishWolfPost({
      guild: makeGuild(),
      actorId: STAFF_ID,
      submission: submission({ customer, kind }),
      render: upload(),
      maxRenderBytes: MAX,
    });

  it('dois posts ao mesmo tempo saem um depois do outro — e o segundo nao se perde', async () => {
    let liberarPrimeiro: () => void = () => undefined;
    downloader.downloadDiscordAttachment
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            liberarPrimeiro = () => resolve({ bytes: PNG, contentType: 'image/png' });
          }),
      )
      .mockResolvedValueOnce({ bytes: JPG, contentType: 'image/jpeg' });

    const primeiro = publishFor('Primeiro', 'lycan');
    const segundo = publishFor('Segundo', 'lobisomem');

    await vi.waitFor(() => {
      expect(downloader.downloadDiscordAttachment).toHaveBeenCalledTimes(1);
    });
    // Com o primeiro ainda baixando, o segundo NAO comeca: seriam dois renders
    // grandes na memoria ao mesmo tempo.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(downloader.downloadDiscordAttachment).toHaveBeenCalledTimes(1);

    liberarPrimeiro();
    await Promise.all([primeiro, segundo]);

    const enviados = discord.sendV2WithLargeFile.mock.calls.map(
      (call) => (call[2] as { name: string }).name,
    );
    expect(enviados).toEqual(['lobo-lycan.png', 'lobo-lobisomem.jpg']);
  });

  it('um post que falha nao trava os seguintes', async () => {
    downloader.downloadDiscordAttachment
      .mockRejectedValueOnce(new ValidationError('download falhou', { userMessage: 'falhou' }))
      .mockResolvedValueOnce({ bytes: PNG, contentType: 'image/png' });

    const primeiro = publishFor('Primeiro', 'lycan').catch((error: unknown) => error);
    const segundo = publishFor('Segundo', 'lycan');

    expect(await primeiro).toBeInstanceOf(ValidationError);
    await expect(segundo).resolves.toEqual({ id: 'msg1', channelId: PORTFOLIO_ID });
  });
});

// ---------------------------------------------------------------------------
// Anexo x hospedagem
// ---------------------------------------------------------------------------

/**
 * Acima do limite de anexo do servidor, o render sobe para o Worker e entra no
 * post como link. E o que permite publicar um render grande num servidor sem
 * impulso — em troca, a imagem daquele post passa a depender do Worker.
 */
describe('render acima do limite de anexo', () => {
  const BIG = Buffer.concat([PNG, Buffer.alloc(40 * MIB)]);

  function publishBig(over = {}) {
    downloader.downloadDiscordAttachment.mockResolvedValue({
      bytes: BIG,
      contentType: 'image/png',
    });
    hosting.isAssetHostingEnabled.mockReturnValue(true);
    return publishWolfPost({
      // Servidor SEM impulso: 40 MB nao cabem como anexo.
      guild: makeGuild(makeChannel(), GuildPremiumTier.None),
      actorId: STAFF_ID,
      submission: submission(),
      render: upload({ size: BIG.length }),
      maxRenderBytes: BUSINESS_LIMITS.WOLF_HOSTED_MAX_BYTES,
      ...over,
    });
  }

  it('sobe para o Worker e o post aponta para a URL, sem anexo', async () => {
    await publishBig();

    const hosted = hosting.hostAsset.mock.calls[0]?.[0] as {
      bytes: Buffer;
      contentType: string;
      ext: string;
    };
    expect(hosted.bytes).toBe(BIG);
    expect(hosted.contentType).toBe('image/png');
    // A extensao e o que faz o Discord tratar o link como imagem.
    expect(hosted.ext).toBe('png');

    // Sem anexo: a mensagem e pequena e vai pelo caminho normal.
    expect(discord.sendV2WithLargeFile).not.toHaveBeenCalled();
    const root = discord.sendV2.mock.calls[0]?.[1] as ContainerBuilder;
    expect(galleryUrls(root)).toEqual([HOSTED_URL]);
  });

  it('render pequeno continua indo como ANEXO, sem depender do Worker', async () => {
    hosting.isAssetHostingEnabled.mockReturnValue(true);

    await publishWolfPost({
      guild: makeGuild(),
      actorId: STAFF_ID,
      submission: submission(),
      render: upload(),
      maxRenderBytes: MAX,
    });

    expect(hosting.hostAsset).not.toHaveBeenCalled();
    expect(discord.sendV2WithLargeFile).toHaveBeenCalledTimes(1);
  });

  it('hospedagem fora do ar NAO publica post com imagem quebrada', async () => {
    // Post de portfolio fica no canal para sempre e ninguem o reescreve.
    hosting.hostAsset.mockResolvedValue(null);

    await expect(publishBig()).rejects.toBeInstanceOf(ValidationError);
    expect(discord.sendV2).not.toHaveBeenCalled();
    expect(discord.sendV2WithLargeFile).not.toHaveBeenCalled();
  });
});
