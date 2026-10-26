import { MessageType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Cargo automatico de quem impulsiona o servidor duas vezes.
 *
 * A API do Discord NAO expoe quantos boosts um membro tem — o objeto de membro
 * so tem `premium_since`, um instante. A unica fonte da contagem e a mensagem
 * de sistema publicada a cada boost, que traz o numero no `content`. Estes
 * testes fixam essa leitura, porque ela e frageis por natureza: e um campo de
 * texto cujo formato o Discord define.
 */

const getGuildConfig = vi.fn();
const canBotAssignRole = vi.fn();

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]) => getGuildConfig(...args),
}));

vi.mock('../src/core/permissions/PermissionService', () => ({
  canBotAssignRole: (...args: unknown[]) => canBotAssignRole(...args),
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  boostCountFromMessage,
  handleBoostLost,
  handleBoostMessage,
  isBoostMessage,
  TIER_2_THRESHOLD,
} from '../src/modules/booster/services/BoosterTierService';

const TIER_2_ROLE = '1319156556541071452';

let add: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

function member(roleIds: string[] = [], premiumSince: Date | null = new Date()) {
  return {
    id: 'u1',
    premiumSince,
    guild: { id: 'g1', members: { me: { id: 'bot' } } },
    roles: {
      cache: new Map(roleIds.map((id) => [id, { id }])),
      add,
      remove,
    },
  } as never;
}

function boostMessage(content: string, type: MessageType = MessageType.GuildBoost) {
  const m = member();
  return {
    type,
    content,
    guild: { id: 'g1', members: { me: { id: 'bot' }, fetch: vi.fn().mockResolvedValue(m) } },
    guildId: 'g1',
    author: { id: 'u1' },
    member: m,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  add = vi.fn().mockResolvedValue(undefined);
  remove = vi.fn().mockResolvedValue(undefined);
  getGuildConfig.mockResolvedValue({ boosterTier2RoleId: TIER_2_ROLE });
  canBotAssignRole.mockReturnValue({ ok: true });
});

describe('leitura da contagem de boosts', () => {
  /*
   * O `content` traz o numero A PARTIR do segundo boost; no primeiro vem vazio.
   * Ler o vazio como 0 faria o primeiro boost parecer "nenhum boost".
   */
  it('conta 1 quando a mensagem nao traz numero', () => {
    expect(boostCountFromMessage(boostMessage(''))).toBe(1);
  });

  it('le o numero que o Discord escreve', () => {
    expect(boostCountFromMessage(boostMessage('2'))).toBe(2);
    expect(boostCountFromMessage(boostMessage('14'))).toBe(14);
  });

  it('cai em 1 diante de conteudo inesperado, nunca em 0 nem NaN', () => {
    for (const conteudo of ['abc', '-3', '0', '  ']) {
      expect(boostCountFromMessage(boostMessage(conteudo))).toBe(1);
    }
  });

  /*
   * `content` e tipado como string pela discord.js, mas isto roda dentro de um
   * listener de `messageCreate`: uma excecao aqui derruba o tratamento do evento
   * e ainda publica um alerta no canal de erros. O tipo nao protege de um
   * payload torto vindo do gateway.
   */
  it('nao lanca quando o conteudo nem e texto', () => {
    for (const conteudo of [null, undefined, 42, {}]) {
      expect(boostCountFromMessage({ content: conteudo } as never)).toBe(1);
    }
  });

  it('reconhece os quatro tipos de mensagem de boost', () => {
    for (const type of [
      MessageType.GuildBoost,
      MessageType.GuildBoostTier1,
      MessageType.GuildBoostTier2,
      MessageType.GuildBoostTier3,
    ]) {
      expect(isBoostMessage(boostMessage('2', type))).toBe(true);
    }
  });

  it('ignora mensagem comum', () => {
    expect(isBoostMessage(boostMessage('2', MessageType.Default))).toBe(false);
  });
});

describe('handleBoostMessage', () => {
  it('concede o cargo a partir do segundo boost', async () => {
    await expect(handleBoostMessage(boostMessage('2'))).resolves.toBe(true);
    expect(add).toHaveBeenCalledWith(TIER_2_ROLE, expect.stringContaining('2'));
  });

  it('nao concede no primeiro boost', async () => {
    await expect(handleBoostMessage(boostMessage(''))).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('concede acima do limite tambem', async () => {
    expect(TIER_2_THRESHOLD).toBe(2);
    await expect(handleBoostMessage(boostMessage('5'))).resolves.toBe(true);
  });

  it('nao faz nada quando o cargo nao esta configurado', async () => {
    getGuildConfig.mockResolvedValue({ boosterTier2RoleId: null });

    await expect(handleBoostMessage(boostMessage('2'))).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('ignora mensagem que nao e de boost', async () => {
    await expect(
      handleBoostMessage(boostMessage('2', MessageType.Default)),
    ).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  /*
   * Hierarquia e permissao sao conferidas ANTES de tentar. A concessao acontece
   * num evento que ninguem esta olhando; falhar em silencio aqui viraria
   * reclamacao do cliente semanas depois.
   */
  it('nao tenta quando o bot nao pode atribuir o cargo', async () => {
    canBotAssignRole.mockReturnValue({ ok: false, reason: 'acima na hierarquia' });

    await expect(handleBoostMessage(boostMessage('2'))).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  /*
   * Quem impulsiona e sai em seguida faz o fetch do membro falhar. E um desfecho
   * NORMAL, nao uma falha operacional: nao pode subir como excecao, senao vira
   * alerta no canal de erros a cada ocorrencia.
   */
  it('nao lanca quando quem impulsionou ja saiu do servidor', async () => {
    const message = {
      type: MessageType.GuildBoost,
      content: '2',
      guild: {
        id: 'g1',
        members: { me: { id: 'bot' }, fetch: vi.fn().mockRejectedValue(new Error('Unknown Member')) },
      },
      guildId: 'g1',
      author: { id: 'u1' },
      member: null,
    } as never;

    await expect(handleBoostMessage(message)).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('busca o membro quando a mensagem nao traz', async () => {
    const alvo = member();
    const fetch = vi.fn().mockResolvedValue(alvo);
    const message = {
      type: MessageType.GuildBoost,
      content: '2',
      guild: { id: 'g1', members: { me: { id: 'bot' }, fetch } },
      guildId: 'g1',
      author: { id: 'u1' },
      member: null,
    } as never;

    await expect(handleBoostMessage(message)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('u1');
    expect(add).toHaveBeenCalledWith(TIER_2_ROLE, expect.any(String));
  });

  it('nao repete o cargo em quem ja tem', async () => {
    const jaTem = member([TIER_2_ROLE]);
    const message = {
      type: MessageType.GuildBoost,
      content: '2',
      guild: { id: 'g1', members: { me: { id: 'bot' }, fetch: vi.fn() } },
      guildId: 'g1',
      author: { id: 'u1' },
      member: jaTem,
    } as never;

    await expect(handleBoostMessage(message)).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('handleBoostLost', () => {
  it('retira o cargo de quem parou de impulsionar', async () => {
    const before = member([TIER_2_ROLE], new Date());
    const after = member([TIER_2_ROLE], null);

    await expect(handleBoostLost(before, after)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith(TIER_2_ROLE, expect.any(String));
  });

  it('nao mexe em quem continua impulsionando', async () => {
    const before = member([TIER_2_ROLE], new Date());
    const after = member([TIER_2_ROLE], new Date());

    await expect(handleBoostLost(before, after)).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('nao mexe em quem nao tinha o cargo', async () => {
    const before = member([], new Date());
    const after = member([], null);

    await expect(handleBoostLost(before, after)).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('ignora quem acabou de comecar a impulsionar', async () => {
    const before = member([], null);
    const after = member([], new Date());

    await expect(handleBoostLost(before, after)).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
