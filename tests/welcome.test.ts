import { ChannelType, type GuildMember, type Message } from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: vi.fn(),
}));
vi.mock('../src/components/reply', () => ({
  sendV2: vi.fn(),
}));

import {
  buildWelcomeCard,
  type WelcomeCardData,
} from '../src/modules/welcome/builders/WelcomeBuilder';
import { handleMemberJoin, sendWelcomeCard } from '../src/modules/welcome/services/WelcomeService';
import { sendV2 } from '../src/components/reply';
import { getGuildConfig } from '../src/modules/configuration/services/GuildConfigService';
import { TITLES } from '../src/constants/branding';
import { Logger } from '../src/core/logger/Logger';

/**
 * Testes do cartao de boas-vindas.
 *
 * `buildWelcomeCard` e puro: nao toca em Discord, banco nem cache. Validamos o
 * JSON final (o que realmente vai para a API) em vez do builder em memoria.
 * O servico e testado com Discord e configuracao simulados: o que importa e
 * quem recebe ping, o que e enviado e o que nunca lanca.
 */

Logger.setLevel('error');

const USER_ID = '123456789012345678';
const ACCOUNT_CREATED_AT = new Date('2020-03-15T10:30:00.000Z');
const JOINED_AT = new Date('2026-08-22T18:45:00.000Z');

/** Estrutura minima do JSON de Components V2 usada nas asercoes. */
interface JsonComponent {
  type: number;
  content?: string;
  components?: JsonComponent[];
  accessory?: JsonComponent;
  items?: Array<{ media?: { url?: string } }>;
}

const COMPONENT_TYPE = {
  TEXT_DISPLAY: 10,
  MEDIA_GALLERY: 12,
} as const;

function makeData(overrides: Partial<WelcomeCardData> = {}): WelcomeCardData {
  return {
    storeName: 'Vook Store',
    userId: USER_ID,
    memberCount: 1234,
    accountCreatedAt: ACCOUNT_CREATED_AT,
    joinedAt: JOINED_AT,
    bannerUrl: 'https://cdn.discordapp.com/banners/1/banner.png',
    guildIconUrl: 'https://cdn.discordapp.com/icons/1/logo.png',
    isPreview: false,
    ...overrides,
  };
}

/** Percorre o container recursivamente (section tem componentes aninhados). */
function flatten(components: readonly JsonComponent[]): JsonComponent[] {
  const output: JsonComponent[] = [];
  for (const component of components) {
    output.push(component);
    if (component.components !== undefined) output.push(...flatten(component.components));
    if (component.accessory !== undefined) output.push(component.accessory);
  }
  return output;
}

function renderCard(overrides: Partial<WelcomeCardData> = {}): {
  nodes: JsonComponent[];
  fullText: string;
} {
  const json = buildWelcomeCard(makeData(overrides)).toJSON() as unknown as JsonComponent;
  const nodes = flatten(json.components as unknown as JsonComponent[]);
  const fullText = nodes
    .filter((node) => node.type === COMPONENT_TYPE.TEXT_DISPLAY)
    .map((node) => node.content ?? '')
    .join('\n');
  return { nodes, fullText };
}

describe('buildWelcomeCard', () => {
  it('inclui titulo, mencao, contagem de membros e ID do usuario', () => {
    const { fullText } = renderCard();

    expect(fullText).toContain(TITLES.WELCOME);
    expect(fullText).toContain(`<@${USER_ID}>`);
    expect(fullText).toContain('Seja muito bem-vindo');
    expect(fullText).toContain('**1.234** membros');
    expect(fullText).toContain(`ID: ${USER_ID}`);
  });

  it('usa timestamps dinamicos do Discord para conta e entrada', () => {
    const { fullText } = renderCard();

    const createdSeconds = Math.floor(ACCOUNT_CREATED_AT.getTime() / 1000);
    const joinedSeconds = Math.floor(JOINED_AT.getTime() / 1000);

    expect(fullText).toContain(`<t:${createdSeconds}:R>`);
    expect(fullText).toContain(`<t:${joinedSeconds}:F>`);
  });

  it('usa exclusivamente a marca Vook Store no cabecalho', () => {
    const { fullText } = renderCard({ storeName: 'Outra Loja' });

    expect(fullText).toContain('VOOK STORE');
    expect(fullText).toContain(TITLES.WELCOME);
    // O nome configurado so descreve o banner; nunca substitui o titulo da marca.
    expect(fullText).not.toContain('Outra Loja');
  });

  it('renderiza a galeria de midia quando o banner e https valido', () => {
    const { nodes } = renderCard();

    const gallery = nodes.find((node) => node.type === COMPONENT_TYPE.MEDIA_GALLERY);
    expect(gallery).toBeDefined();
    expect(gallery?.items?.[0]?.media?.url).toBe(
      'https://cdn.discordapp.com/banners/1/banner.png',
    );
  });

  it.each([
    ['javascript:alert(1)'],
    ['http://x'],
    ['data:image/png;base64,AAAA'],
    ['nao-e-uma-url'],
    [''],
  ])('nao cria galeria de midia para banner inseguro: %s', (bannerUrl) => {
    const { nodes } = renderCard({ bannerUrl });

    expect(nodes.some((node) => node.type === COMPONENT_TYPE.MEDIA_GALLERY)).toBe(false);
  });

  it('nao cria galeria de midia quando nao ha banner', () => {
    const { nodes } = renderCard({ bannerUrl: null });

    expect(nodes.some((node) => node.type === COMPONENT_TYPE.MEDIA_GALLERY)).toBe(false);
  });

  it('monta o cartao mesmo sem logo segura', () => {
    // Logo com URL insegura (ou guild sem icone) apenas cai no cabecalho sem
    // miniatura — o cartao de boas-vindas nunca deixa de sair por causa dela.
    const { fullText } = renderCard({ guildIconUrl: 'http://inseguro/logo.png' });

    expect(fullText).toContain(TITLES.WELCOME);
    expect(fullText).toContain(`<@${USER_ID}>`);
  });

  it('adiciona o aviso de pre-visualizacao quando isPreview e true', () => {
    const { fullText } = renderCard({ isPreview: true });

    expect(fullText).toContain('PRE-VISUALIZACAO');
    expect(fullText).toContain('Nenhum membro foi notificado');
  });

  it('nao exibe aviso de pre-visualizacao no envio real', () => {
    const { fullText } = renderCard({ isPreview: false });

    expect(fullText).not.toContain('PRE-VISUALIZACAO');
  });

  it('formata a contagem de membros em pt-BR e protege valores invalidos', () => {
    expect(renderCard({ memberCount: 1_000_000 }).fullText).toContain('**1.000.000** membros');
    expect(renderCard({ memberCount: -5 }).fullText).toContain('**0** membros');
    expect(renderCard({ memberCount: Number.NaN }).fullText).toContain('**0** membros');
  });
});

// ---------------------------------------------------------------------------
// Servico (Discord e configuracao simulados)
// ---------------------------------------------------------------------------

const GUILD_ID = '222222222222222222';
const CHANNEL_ID = '333333333333333333';
const ROLE_ID = '444444444444444444';

const getGuildConfigMock = vi.mocked(getGuildConfig);
const sendV2Mock = vi.mocked(sendV2);

function makeConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: GUILD_ID,
    storeName: 'Vook Store',
    welcomeEnabled: true,
    welcomeChannelId: CHANNEL_ID,
    welcomeBannerUrl: null,
    autoRoleEnabled: true,
    autoRoleId: ROLE_ID,
    ...overrides,
  } as unknown as GuildConfig;
}

interface FakeMemberOptions {
  bot?: boolean;
  alreadyHasRole?: boolean;
  roleAddError?: Error;
  channelMissing?: boolean;
  canSend?: boolean;
}

interface FakeMember {
  member: GuildMember;
  rolesAdd: ReturnType<typeof vi.fn>;
}

/** Membro minimo com tudo que o servico realmente toca. */
function makeMember(options: FakeMemberOptions = {}): FakeMember {
  const rolesAdd = vi.fn((): Promise<void> => Promise.resolve());
  if (options.roleAddError !== undefined) rolesAdd.mockRejectedValue(options.roleAddError);

  const channel = {
    id: CHANNEL_ID,
    type: ChannelType.GuildText,
    isTextBased: (): boolean => true,
    permissionsFor: (): { has: () => boolean } => ({
      has: (): boolean => options.canSend !== false,
    }),
  };

  const guild: {
    id: string;
    memberCount: number;
    iconURL: () => string;
    channels: { cache: { get: () => unknown }; fetch: () => Promise<unknown> };
    roles: { cache: { get: () => unknown }; everyone: { id: string } };
    members: { me: unknown };
  } = {
    id: GUILD_ID,
    memberCount: 1234,
    iconURL: (): string => 'https://cdn.discordapp.com/icons/1/logo.png',
    channels: {
      cache: { get: (): unknown => (options.channelMissing === true ? undefined : channel) },
      fetch: (): Promise<unknown> => Promise.resolve(null),
    },
    roles: {
      cache: { get: (): unknown => ({ id: ROLE_ID, managed: false }) },
      everyone: { id: GUILD_ID },
    },
    members: { me: null },
  };

  guild.members.me = {
    guild,
    permissions: { has: (): boolean => true },
    roles: { highest: { comparePositionTo: (): number => 1 } },
  };

  const member = {
    id: USER_ID,
    user: { bot: options.bot === true, createdAt: ACCOUNT_CREATED_AT },
    guild,
    joinedAt: JOINED_AT,
    displayAvatarURL: (): string => 'https://cdn.discordapp.com/avatars/1/a.png',
    roles: {
      cache: { has: (): boolean => options.alreadyHasRole === true },
      add: rolesAdd,
    },
  };

  return { member: member as unknown as GuildMember, rolesAdd };
}

describe('WelcomeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGuildConfigMock.mockResolvedValue(makeConfig());
    sendV2Mock.mockResolvedValue({ id: 'mensagem' } as unknown as Message);
  });

  it('entrada real: aplica o cargo e menciona somente o novo membro', async () => {
    const { member, rolesAdd } = makeMember();

    await handleMemberJoin(member);

    expect(rolesAdd).toHaveBeenCalledTimes(1);
    expect(sendV2Mock).toHaveBeenCalledTimes(1);
    expect(sendV2Mock.mock.calls[0]?.[2]?.allowedMentions).toEqual({
      parse: [],
      users: [USER_ID],
      roles: [],
    });
  });

  it('falha no cargo automatico nao impede o cartao de boas-vindas', async () => {
    const { member } = makeMember({ roleAddError: new Error('sem permissao') });

    await handleMemberJoin(member);

    expect(sendV2Mock).toHaveBeenCalledTimes(1);
  });

  it('configuracao indisponivel: nao lanca e nao produz efeito colateral', async () => {
    getGuildConfigMock.mockRejectedValue(new Error('banco indisponivel'));
    const { member, rolesAdd } = makeMember();

    await expect(handleMemberJoin(member)).resolves.toBeUndefined();

    expect(rolesAdd).not.toHaveBeenCalled();
    expect(sendV2Mock).not.toHaveBeenCalled();
  });

  it('pre-visualizacao nao notifica ninguem e nao aplica cargo', async () => {
    const { member, rolesAdd } = makeMember();

    const sent = await sendWelcomeCard(member, { preview: true, targetChannelId: CHANNEL_ID });

    expect(sent).toBe(true);
    expect(rolesAdd).not.toHaveBeenCalled();
    expect(sendV2Mock.mock.calls[0]?.[2]?.allowedMentions).toEqual({
      parse: [],
      users: [],
      roles: [],
    });
  });

  it('boas-vindas desativadas: nada e enviado', async () => {
    getGuildConfigMock.mockResolvedValue(makeConfig({ welcomeEnabled: false }));
    const { member } = makeMember();

    expect(await sendWelcomeCard(member)).toBe(false);
    expect(sendV2Mock).not.toHaveBeenCalled();
  });

  it('sem permissao de envio no canal: nao tenta publicar', async () => {
    const { member } = makeMember({ canSend: false });

    expect(await sendWelcomeCard(member)).toBe(false);
    expect(sendV2Mock).not.toHaveBeenCalled();
  });

  it('canal removido: retorna false sem lancar', async () => {
    const { member } = makeMember({ channelMissing: true });

    expect(await sendWelcomeCard(member)).toBe(false);
    expect(sendV2Mock).not.toHaveBeenCalled();
  });

  it('entrada de bot e ignorada por completo', async () => {
    const { member, rolesAdd } = makeMember({ bot: true });

    await handleMemberJoin(member);

    expect(rolesAdd).not.toHaveBeenCalled();
    expect(sendV2Mock).not.toHaveBeenCalled();
  });
});
