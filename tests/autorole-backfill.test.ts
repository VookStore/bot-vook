import { Collection } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Aplicacao retroativa do cargo de boas-vindas.
 *
 * Este e um comando que escreve em CENTENAS de membros de uma vez e nao tem
 * desfazer. Os testes abaixo defendem as quatro decisoes que decidem se ele e
 * seguro:
 *
 *  - o filtro e "sem NENHUM cargo", nunca "sem o cargo de boas-vindas";
 *  - bot nunca recebe cargo;
 *  - hierarquia e permissao sao conferidas UMA vez, antes de tocar em alguem;
 *  - perder a permissao no meio interrompe a varredura em vez de produzir
 *    centenas de falhas identicas.
 */

const getGuildConfig = vi.fn();
const canBotAssignRole = vi.fn();

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]) => getGuildConfig(...args),
}));

vi.mock('../src/core/permissions/PermissionService', () => ({
  canBotAssignRole: (...args: unknown[]) => canBotAssignRole(...args),
}));

// O espacamento entre escritas deixaria cada teste segundos mais lento.
vi.mock('../src/utils/time', () => ({
  delay: () => Promise.resolve(),
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { GatewayRateLimitError } from '@discordjs/util';

import { AUTO_ROLE_BACKFILL } from '../src/constants/limits';
import { ConfigurationError, RateLimitError } from '../src/core/errors';
import {
  previewAutoRoleBackfill,
  runAutoRoleBackfill,
} from '../src/modules/welcome/services/AutoRoleBackfillService';

const EVERYONE = '1042089361279287366';
const ROLE_ID = '1400000000000000001';
const OUTRO_CARGO = '1400000000000000002';

interface FakeMember {
  id: string;
  user: { bot: boolean };
  joinedTimestamp: number;
  roles: { cache: Collection<string, { id: string }>; add: ReturnType<typeof vi.fn> };
  guild: unknown;
}

let guild: {
  id: string;
  memberCount: number;
  roles: { everyone: { id: string }; cache: Collection<string, { id: string; name: string }> };
  members: {
    me: unknown;
    fetch: ReturnType<typeof vi.fn>;
    cache: Collection<string, FakeMember>;
  };
};

/**
 * Cria um membro.
 *
 * `roleIds` sao os cargos ALEM de @everyone — que a discord.js sempre inclui
 * em `roles.cache`, e por isso e sempre adicionado aqui tambem. Um fixture que
 * omitisse @everyone faria o teste passar por um motivo errado.
 */
function member(id: string, roleIds: string[] = [], bot = false): FakeMember {
  const cache = new Collection<string, { id: string }>();
  cache.set(EVERYONE, { id: EVERYONE });
  for (const roleId of roleIds) cache.set(roleId, { id: roleId });

  const fake: FakeMember = {
    id,
    user: { bot },
    joinedTimestamp: Number(id),
    roles: { cache, add: vi.fn().mockResolvedValue(undefined) },
    guild: null,
  };
  fake.guild = guild;
  return fake;
}

/**
 * Prepara a guild com estes membros.
 *
 * O cache comeca VAZIO de proposito: um servidor acima do `large_threshold` nao
 * vem completo no GUILD_CREATE, e e o `fetch()` que o preenche. Comecar com o
 * cache cheio faria os testes pularem justamente o caminho do gateway.
 */
function popular(membros: FakeMember[]): void {
  const collection = new Collection<string, FakeMember>();
  for (const m of membros) {
    m.guild = guild;
    collection.set(m.id, m);
  }
  guild.memberCount = membros.length;
  guild.members.cache = new Collection();
  guild.members.fetch.mockImplementation(() => {
    guild.members.cache = collection;
    return Promise.resolve(collection);
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  const roles = new Collection<string, { id: string; name: string }>();
  roles.set(ROLE_ID, { id: ROLE_ID, name: 'Membro' });

  guild = {
    id: EVERYONE,
    memberCount: 0,
    roles: { everyone: { id: EVERYONE }, cache: roles },
    members: { me: { id: 'bot' }, fetch: vi.fn(), cache: new Collection() },
  };

  getGuildConfig.mockResolvedValue({ autoRoleId: ROLE_ID, autoRoleEnabled: true });
  canBotAssignRole.mockReturnValue({ ok: true });
  popular([]);
});

describe('previewAutoRoleBackfill', () => {
  it('exige um cargo configurado antes de qualquer varredura', async () => {
    getGuildConfig.mockResolvedValue({ autoRoleId: null, autoRoleEnabled: false });

    await expect(previewAutoRoleBackfill(guild as never)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(guild.members.fetch).not.toHaveBeenCalled();
  });

  /*
   * O FILTRO CENTRAL. "Sem nenhum cargo" nao e "sem o cargo de boas-vindas":
   * quem ja tem qualquer outro cargo foi classificado por uma pessoa, e
   * sobrescrever isso em massa e o erro que nao da para desfazer.
   */
  it('conta so quem nao tem cargo nenhum alem de @everyone', async () => {
    popular([
      member('1'),
      member('2'),
      member('3', [OUTRO_CARGO]),
      member('4', [ROLE_ID]),
    ]);

    const preview = await previewAutoRoleBackfill(guild as never);

    expect(preview.humans).toBe(4);
    expect(preview.targets).toBe(2);
  });

  it('nao conta bots', async () => {
    popular([member('1'), member('2', [], true)]);

    const preview = await previewAutoRoleBackfill(guild as never);

    expect(preview.humans).toBe(1);
    expect(preview.targets).toBe(1);
  });

  it('reporta o impedimento de hierarquia sem tentar aplicar', async () => {
    canBotAssignRole.mockReturnValue({
      ok: false,
      reason: 'O cargo esta acima do cargo do bot na hierarquia do servidor.',
    });
    popular([member('1')]);

    const preview = await previewAutoRoleBackfill(guild as never);

    expect(preview.blocker).toContain('hierarquia');
  });

  it('avisa que o lote e menor que o total quando passa do teto', async () => {
    const muitos = Array.from({ length: AUTO_ROLE_BACKFILL.MAX_PER_RUN + 20 }, (_, index) =>
      member(String(index + 1)),
    );
    popular(muitos);

    const preview = await previewAutoRoleBackfill(guild as never);

    expect(preview.targets).toBe(AUTO_ROLE_BACKFILL.MAX_PER_RUN + 20);
    expect(preview.batch).toBe(AUTO_ROLE_BACKFILL.MAX_PER_RUN);
  });
});

/*
 * O opcode 8 do gateway (listar todos os membros) e limitado com folga bem
 * menor que o resto da API, e o fluxo normal do comando o usa DUAS vezes em
 * poucos segundos: uma na previa, outra no clique do botao. Foi exatamente
 * isso que derrubou a primeira versao com um erro generico na cara do
 * operador.
 */
describe('limite do gateway ao listar membros', () => {
  /** Erro que a discord.js lanca quando o gateway recusa a listagem. */
  function rateLimited(retryAfter: number): Error {
    return new GatewayRateLimitError(
      { opcode: 8, retry_after: retryAfter, meta: {} } as never,
      {},
    );
  }

  /*
   * O CASO QUE QUEBROU EM PRODUCAO. O clique do botao vinha minutos depois da
   * previa e pedia a lista inteira de novo, sem precisar: a primeira listagem
   * ja tinha deixado o cache completo, e o gateway recusou a segunda.
   */
  it('nao pede a lista de novo depois que o cache ficou completo', async () => {
    popular([member('1')]);

    await previewAutoRoleBackfill(guild as never);
    await runAutoRoleBackfill(guild as never);

    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });

  it('nao confunde contagem desconhecida com cache completo', async () => {
    // memberCount 0 so acontece antes de o cliente saber o tamanho da guild.
    guild.memberCount = 0;
    guild.members.cache = new Collection();
    guild.members.fetch.mockResolvedValue(new Collection());

    await previewAutoRoleBackfill(guild as never);

    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });

  it('nem toca no gateway quando o cache ja esta completo', async () => {
    const membros = [member('1')];
    popular(membros);
    guild.members.cache = new Collection(membros.map((m) => [m.id, m]));

    const preview = await previewAutoRoleBackfill(guild as never);

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(preview.targets).toBe(1);
  });

  /*
   * A protecao contra o cache mentir. Se um dia alguem puser teto no
   * `GuildMemberManager`, o cache fica menor que a contagem do servidor e a
   * listagem completa precisa voltar a acontecer — senao o backfill ignoraria
   * em silencio quem nao coubesse.
   */
  it('volta a listar quando o cache esta menor que o servidor', async () => {
    popular([member('1'), member('2')]);
    guild.memberCount = 500;

    await previewAutoRoleBackfill(guild as never);

    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });

  it('espera o retry_after do Discord e tenta de novo', async () => {
    const membros = new Collection<string, FakeMember>([['1', member('1')]]);
    guild.memberCount = 1;
    guild.members.fetch
      .mockRejectedValueOnce(rateLimited(1))
      .mockResolvedValue(membros);

    const preview = await previewAutoRoleBackfill(guild as never);

    expect(guild.members.fetch).toHaveBeenCalledTimes(2);
    expect(preview.targets).toBe(1);
  });

  /*
   * Insistir para sempre prenderia a interacao ate o token expirar. Depois das
   * tentativas, o operador recebe um numero em vez de "erro inesperado".
   */
  it('desiste com uma mensagem util quando o limite persiste', async () => {
    guild.memberCount = 1;
    guild.members.fetch.mockRejectedValue(rateLimited(9.9));

    const erro = await previewAutoRoleBackfill(guild as never).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(RateLimitError);
    expect((erro as RateLimitError).userMessage).toContain('10 segundo');
  });

  /*
   * O limite do opcode 8 escala a cada recusa. Esperar minutos dentro de uma
   * interacao gastaria o token de 15 minutos sem garantia nenhuma.
   */
  it('nem espera quando o Discord pede uma pausa longa demais', async () => {
    guild.memberCount = 1;
    guild.members.fetch.mockRejectedValue(rateLimited(300));

    await expect(previewAutoRoleBackfill(guild as never)).rejects.toBeInstanceOf(RateLimitError);
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('runAutoRoleBackfill', () => {
  it('aplica o cargo so em quem esta sem nenhum', async () => {
    const semCargo = member('1');
    const comCargo = member('2', [OUTRO_CARGO]);
    const bot = member('3', [], true);
    popular([semCargo, comCargo, bot]);

    const resultado = await runAutoRoleBackfill(guild as never);

    expect(resultado.applied).toBe(1);
    expect(semCargo.roles.add).toHaveBeenCalledWith(ROLE_ID, expect.any(String));
    expect(comCargo.roles.add).not.toHaveBeenCalled();
    expect(bot.roles.add).not.toHaveBeenCalled();
  });

  /*
   * Hierarquia e permissao nao variam de membro para membro. Descobrir isso no
   * primeiro `roles.add` significaria falhar centenas de vezes seguidas.
   */
  it('recusa a operacao inteira quando o bot nao pode atribuir o cargo', async () => {
    canBotAssignRole.mockReturnValue({ ok: false, reason: 'O bot nao possui Gerenciar Cargos.' });
    const alvo = member('1');
    popular([alvo]);

    await expect(runAutoRoleBackfill(guild as never)).rejects.toBeInstanceOf(ConfigurationError);
    expect(alvo.roles.add).not.toHaveBeenCalled();
  });

  it('registra o motivo no log de auditoria do Discord', async () => {
    const alvo = member('1');
    popular([alvo]);

    await runAutoRoleBackfill(guild as never);

    const [, motivo] = alvo.roles.add.mock.calls[0] as [string, string];
    expect(motivo).toContain('retroativamente');
  });

  /*
   * Se a permissao cair no meio da varredura, ela cai para todo mundo dali
   * para frente. Continuar so queimaria a cota de rate limit compartilhada com
   * cobranca, ticket e catalogo.
   */
  it('interrompe a varredura quando a permissao some no meio', async () => {
    const { DiscordAPIError } = await import('discord.js');
    const semAcesso = Object.assign(Object.create(DiscordAPIError.prototype) as object, {
      code: 50013,
    });

    const membros = [member('1'), member('2'), member('3')];
    membros[0]?.roles.add.mockRejectedValue(semAcesso);
    popular(membros);

    const resultado = await runAutoRoleBackfill(guild as never);

    expect(resultado.failed).toBe(1);
    expect(resultado.applied).toBe(0);
    expect(membros[1]?.roles.add).not.toHaveBeenCalled();
    expect(membros[2]?.roles.add).not.toHaveBeenCalled();
  });

  it('uma falha isolada nao interrompe os outros', async () => {
    const membros = [member('1'), member('2'), member('3')];
    membros[0]?.roles.add.mockRejectedValue(new Error('rede'));
    popular(membros);

    const resultado = await runAutoRoleBackfill(guild as never);

    expect(resultado.applied).toBe(2);
    expect(resultado.failed).toBe(1);
    expect(resultado.firstError).toContain('rede');
  });

  it('para no teto por rodada e diz quantos faltaram', async () => {
    const total = AUTO_ROLE_BACKFILL.MAX_PER_RUN + 7;
    popular(Array.from({ length: total }, (_, index) => member(String(index + 1))));

    const resultado = await runAutoRoleBackfill(guild as never);

    expect(resultado.applied).toBe(AUTO_ROLE_BACKFILL.MAX_PER_RUN);
    expect(resultado.remaining).toBe(7);
  });

  it('devolve zero quando ninguem esta sem cargo', async () => {
    popular([member('1', [OUTRO_CARGO]), member('2', [ROLE_ID])]);

    const resultado = await runAutoRoleBackfill(guild as never);

    expect(resultado.applied).toBe(0);
    expect(resultado.remaining).toBe(0);
  });

  it('avisa o progresso sem esperar o fim', async () => {
    popular(
      Array.from({ length: AUTO_ROLE_BACKFILL.PROGRESS_EVERY * 2 + 1 }, (_, index) =>
        member(String(index + 1)),
      ),
    );

    const progresso = vi.fn().mockResolvedValue(undefined);
    await runAutoRoleBackfill(guild as never, progresso);

    expect(progresso).toHaveBeenCalledTimes(2);
  });
});
