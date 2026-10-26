import { describe, expect, it, beforeEach } from 'vitest';

import { CacheService, CACHE_NAMESPACE } from '../src/core/cache/CacheService';
import {
  CooldownService,
  COOLDOWN_NAMESPACE,
  LockService,
  LOCK_NAMESPACE,
} from '../src/core/locks/LockService';
import { LockBusyError, ValidationError } from '../src/core/errors';
import {
  MAX_CUSTOM_ID_LENGTH,
  NAMESPACE,
  TICKET_ACTION,
  buildCustomId,
  parseCustomId,
  requireArg,
} from '../src/constants/customIds';
import {
  formatCents,
  formatDuration,
  formatPercent,
  parseAmountToCents,
  parsePaymentAmount,
  parsePercent,
} from '../src/utils/money';
import { redactContext, redactString } from '../src/core/logger/redact';
import {
  PRIORITY_ORDER,
  higherPriorities,
} from '../src/modules/tickets/repositories/TicketRepository';
import { formatTicketNumber } from '../src/modules/tickets/builders/TicketInternalPanelBuilder';

describe('dinheiro em centavos', () => {
  it('formata valores no padrao brasileiro', () => {
    expect(formatCents(25000)).toBe('R$ 250,00');
    expect(formatCents(0)).toBe('R$ 0,00');
    expect(formatCents(1)).toBe('R$ 0,01');
    expect(formatCents(99)).toBe('R$ 0,99');
    expect(formatCents(100000)).toBe('R$ 1.000,00');
    expect(formatCents(123456789)).toBe('R$ 1.234.567,89');
    expect(formatCents(-5000)).toBe('-R$ 50,00');
  });

  it('interpreta os formatos que o vendedor realmente digita', () => {
    expect(parseAmountToCents('250')).toBe(25000);
    expect(parseAmountToCents('250,00')).toBe(25000);
    expect(parseAmountToCents('250.00')).toBe(25000);
    expect(parseAmountToCents('R$ 250,00')).toBe(25000);
    expect(parseAmountToCents('  250,5 ')).toBe(25050);
    expect(parseAmountToCents('0,01')).toBe(1);
  });

  it('distingue separador de milhar de separador decimal', () => {
    expect(parseAmountToCents('1.250,50')).toBe(125050);
    expect(parseAmountToCents('1,250.50')).toBe(125050);
    // Tres casas apos a virgula sao milhar, nao decimal.
    expect(parseAmountToCents('1,250')).toBe(125000);
    expect(parseAmountToCents('1.250')).toBe(125000);
  });

  it('recusa entradas invalidas', () => {
    expect(() => parseAmountToCents('')).toThrow(ValidationError);
    expect(() => parseAmountToCents('abc')).toThrow(ValidationError);
    expect(() => parseAmountToCents('R$')).toThrow(ValidationError);
    expect(() => parseAmountToCents('1.2.3,45')).toThrow(ValidationError);
    // Mais de duas casas decimais reais (o separador aqui e ponto).
    expect(() => parseAmountToCents('10.5555')).toThrow(ValidationError);
  });

  it('segue a convencao pt-BR quando a virgula tem exatamente 3 digitos', () => {
    // "10,555" e ambiguo. No padrao brasileiro, virgula seguida de exatamente
    // tres digitos e separador de MILHAR — e assim que interpretamos.
    // O vendedor ainda confere o total no painel de confirmacao antes de gerar
    // a cobranca, entao uma digitacao ambigua nunca vira cobranca sem revisao.
    expect(parseAmountToCents('10,555')).toBe(1055500);
    expect(parseAmountToCents('10,55')).toBe(1055);
  });

  it('aplica os limites de negocio da cobranca', () => {
    expect(() => parsePaymentAmount('0')).toThrow(ValidationError);
    expect(() => parsePaymentAmount('2.000.000,00')).toThrow(ValidationError);
    expect(parsePaymentAmount('0,01')).toBe(1);
  });

  it('trabalha com percentual em base 100', () => {
    expect(parsePercent('20')).toBe(2000);
    expect(parsePercent('20%')).toBe(2000);
    expect(parsePercent('12,5')).toBe(1250);
    expect(parsePercent('100')).toBe(10000);
    expect(() => parsePercent('0')).toThrow(ValidationError);
    expect(() => parsePercent('101')).toThrow(ValidationError);
    expect(() => parsePercent('abc')).toThrow(ValidationError);

    expect(formatPercent(2000)).toBe('20%');
    expect(formatPercent(1250)).toBe('12,5%');
  });

  it('formata duracao de atendimento', () => {
    expect(formatDuration(0)).toBe('00s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(3_600_000)).toBe('1h 00m 00s');
    expect(formatDuration(90_061_000)).toBe('1d 1h 01m 01s');
  });
});

describe('customIds', () => {
  it('monta e interpreta o formato namespace:action:args', () => {
    const id = buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CLAIM, 'abc123');
    expect(id).toBe('ticket:claim:abc123');

    const parsed = parseCustomId(id);
    expect(parsed).not.toBeNull();
    expect(parsed?.namespace).toBe('ticket');
    expect(parsed?.action).toBe('claim');
    expect(parsed?.args).toEqual(['abc123']);
  });

  it('recusa ids acima do limite real do Discord', () => {
    const gigante = 'x'.repeat(MAX_CUSTOM_ID_LENGTH);
    expect(() => buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CLAIM, gigante)).toThrow(
      ValidationError,
    );
  });

  it('recusa segmentos que quebrariam o parser', () => {
    expect(() => buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CLAIM, 'a:b')).toThrow(
      ValidationError,
    );
  });

  it('devolve null para entradas malformadas', () => {
    expect(parseCustomId('')).toBeNull();
    expect(parseCustomId('semdoispontos')).toBeNull();
    expect(parseCustomId(':vazio')).toBeNull();
  });

  it('exige argumentos obrigatorios com mensagem segura', () => {
    const parsed = parseCustomId('ticket:claim');
    expect(parsed).not.toBeNull();
    expect(() => requireArg(parsed!, 0, 'ticketId')).toThrow(ValidationError);
  });

  it('mantem ids de rota dentro do limite mesmo com id de 32 caracteres', () => {
    const id = buildCustomId(
      NAMESPACE.PAYMENT,
      'coupon-select',
      'payment',
      'a'.repeat(32),
    );
    expect(id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
  });
});

describe('prioridade da fila', () => {
  it('ordena do menor para o maior, igual a declaracao do enum', () => {
    expect(PRIORITY_ORDER).toEqual(['NORMAL', 'HIGH', 'URGENT', 'VIP']);
  });

  it('calcula quais prioridades passam a frente', () => {
    expect(higherPriorities('NORMAL')).toEqual(['HIGH', 'URGENT', 'VIP']);
    expect(higherPriorities('URGENT')).toEqual(['VIP']);
    expect(higherPriorities('VIP')).toEqual([]);
  });
});

describe('numeracao do ticket', () => {
  it('usa quatro digitos com zeros a esquerda', () => {
    expect(formatTicketNumber(1)).toBe('#0001');
    expect(formatTicketNumber(153)).toBe('#0153');
    expect(formatTicketNumber(12345)).toBe('#12345');
  });
});

describe('LockService', () => {
  let locks: LockService;

  beforeEach(() => {
    locks = new LockService();
  });

  it('impede aquisicao concorrente do mesmo recurso', () => {
    expect(locks.tryAcquire(LOCK_NAMESPACE.TICKET_CLAIM, 'ticket-1')).toBe(true);
    expect(locks.tryAcquire(LOCK_NAMESPACE.TICKET_CLAIM, 'ticket-1')).toBe(false);
    // Recurso diferente nao e afetado.
    expect(locks.tryAcquire(LOCK_NAMESPACE.TICKET_CLAIM, 'ticket-2')).toBe(true);
  });

  it('libera o lock mesmo quando a operacao falha', async () => {
    await expect(
      locks.withLock(LOCK_NAMESPACE.TICKET_CLOSE, 'ticket-1', () => {
        throw new Error('falha simulada');
      }),
    ).rejects.toThrow('falha simulada');

    // O finally precisa ter liberado.
    expect(locks.isLocked(LOCK_NAMESPACE.TICKET_CLOSE, 'ticket-1')).toBe(false);
  });

  it('serializa duas execucoes concorrentes lancando LockBusyError', async () => {
    let liberar: () => void = () => undefined;
    const bloqueio = new Promise<void>((resolve) => {
      liberar = resolve;
    });

    const primeira = locks.withLock(LOCK_NAMESPACE.PAYMENT_ACTION, 'pay-1', async () => {
      await bloqueio;
      return 'primeira';
    });

    await expect(
      locks.withLock(LOCK_NAMESPACE.PAYMENT_ACTION, 'pay-1', () => Promise.resolve('segunda')),
    ).rejects.toBeInstanceOf(LockBusyError);

    liberar();
    await expect(primeira).resolves.toBe('primeira');
  });

  it('expira locks abandonados', () => {
    expect(locks.tryAcquire(LOCK_NAMESPACE.TICKET_CREATE, 'guild:user', 0)).toBe(true);
    expect(locks.isLocked(LOCK_NAMESPACE.TICKET_CREATE, 'guild:user')).toBe(false);
  });
});

describe('CooldownService', () => {
  it('conta a janela em segundos e libera depois', () => {
    const cooldowns = new CooldownService();
    expect(cooldowns.remainingSeconds(COOLDOWN_NAMESPACE.TICKET_CREATE, 'u1', 60)).toBe(0);

    cooldowns.mark(COOLDOWN_NAMESPACE.TICKET_CREATE, 'u1');
    expect(cooldowns.remainingSeconds(COOLDOWN_NAMESPACE.TICKET_CREATE, 'u1', 60)).toBeGreaterThan(
      0,
    );
    // Janela zero significa "sem cooldown".
    expect(cooldowns.remainingSeconds(COOLDOWN_NAMESPACE.TICKET_CREATE, 'u1', 0)).toBe(0);
  });
});

describe('CacheService', () => {
  it('guarda, invalida e contabiliza acertos', () => {
    const cache = new CacheService();
    cache.set(CACHE_NAMESPACE.GUILD_CONFIG, 'g1', { storeName: 'Vook Store' });

    expect(cache.get(CACHE_NAMESPACE.GUILD_CONFIG, 'g1')).toEqual({ storeName: 'Vook Store' });
    expect(cache.get(CACHE_NAMESPACE.GUILD_CONFIG, 'inexistente')).toBeUndefined();

    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('expira a entrada quando o TTL vence', async () => {
    const cache = new CacheService();
    cache.set(CACHE_NAMESPACE.COUPONS, 'g1', ['cupom'], 10);
    expect(cache.get(CACHE_NAMESPACE.COUPONS, 'g1')).toEqual(['cupom']);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cache.get(CACHE_NAMESPACE.COUPONS, 'g1')).toBeUndefined();
  });

  it('nao guarda nada quando o TTL e zero ou negativo', () => {
    // Um TTL mal calculado nunca pode virar "guardar para sempre".
    const cache = new CacheService();
    cache.set(CACHE_NAMESPACE.COUPONS, 'g1', ['cupom'], 0);
    expect(cache.get(CACHE_NAMESPACE.COUPONS, 'g1')).toBeUndefined();

    cache.set(CACHE_NAMESPACE.COUPONS, 'g2', ['cupom'], -1);
    expect(cache.get(CACHE_NAMESPACE.COUPONS, 'g2')).toBeUndefined();
  });

  it('sobrescreve entrada existente quando o TTL vira invalido', () => {
    const cache = new CacheService();
    cache.set(CACHE_NAMESPACE.COUPONS, 'g1', ['antigo']);
    cache.set(CACHE_NAMESPACE.COUPONS, 'g1', ['novo'], 0);
    expect(cache.get(CACHE_NAMESPACE.COUPONS, 'g1')).toBeUndefined();
  });

  it('invalida tudo que pertence a uma guild', () => {
    const cache = new CacheService();
    cache.set(CACHE_NAMESPACE.GUILD_CONFIG, 'g1', 'config');
    cache.set(CACHE_NAMESPACE.CATEGORIES, 'g1', ['cat']);
    cache.set(CACHE_NAMESPACE.TEAM_ROLES, 'categoria-1', ['role']);
    cache.set(CACHE_NAMESPACE.GUILD_CONFIG, 'g2', 'outra');

    cache.invalidateGuild('g1');

    expect(cache.get(CACHE_NAMESPACE.GUILD_CONFIG, 'g1')).toBeUndefined();
    expect(cache.get(CACHE_NAMESPACE.CATEGORIES, 'g1')).toBeUndefined();
    expect(cache.get(CACHE_NAMESPACE.TEAM_ROLES, 'categoria-1')).toBeUndefined();
    // Outra guild permanece intacta.
    expect(cache.get(CACHE_NAMESPACE.GUILD_CONFIG, 'g2')).toBe('outra');
  });

  it('carrega sob demanda apenas uma vez', async () => {
    const cache = new CacheService();
    let chamadas = 0;
    const loader = (): Promise<string> => {
      chamadas += 1;
      return Promise.resolve('valor');
    };

    await cache.getOrLoad(CACHE_NAMESPACE.CATEGORIES, 'g1', loader);
    await cache.getOrLoad(CACHE_NAMESPACE.CATEGORIES, 'g1', loader);

    expect(chamadas).toBe(1);
  });
});

describe('sanitizacao de segredos nos logs', () => {
  it('mascara credenciais em strings de conexao', () => {
    const saida = redactString('postgresql://usuario:senhaSecreta@localhost:5432/vook');
    expect(saida).not.toContain('senhaSecreta');
    expect(saida).toContain('***');
  });

  it('mascara tokens de bot', () => {
    // Montado em partes para o fixture nao ser confundido com um segredo real
    // pela protecao de push do GitHub.
    const token = [
      'MTIzNDU2Nzg5MDEyMzQ1Njc4',
      'GhIjKl',
      'abcdefghijklmnopqrstuvwxyz123',
    ].join('.');
    expect(redactString(`Authorization: Bot ${token}`)).not.toContain(token);
  });

  it('nao destroi frases comuns que comecam com Bot/Basic', () => {
    // Regressao: o padrao de header exigia so 8 caracteres, entao a linha
    // "Vook Store Bot operacional." virava "Vook Store Bot [REDACTED]" — o log
    // que anuncia boot bem-sucedido parecia conter um segredo.
    expect(redactString('Vook Store Bot operacional.')).toBe('Vook Store Bot operacional.');
    expect(redactString('Bot conectado ao Discord')).toBe('Bot conectado ao Discord');
    expect(redactString('Basic configuration loaded')).toBe('Basic configuration loaded');
  });

  it('ainda mascara credencial longa em header Authorization', () => {
    const credencial = 'abcdefghij0123456789abcdefghij';
    const saida = redactString(`Authorization: Bearer ${credencial}`);
    expect(saida).not.toContain(credencial);
    expect(saida).toContain('Bearer [REDACTED]');
  });

  it('remove valores de chaves sensiveis do contexto', () => {
    const saida = redactContext({
      guildId: '123',
      DISCORD_TOKEN: 'valor-secreto',
      nested: { password: 'outro-secreto', ok: 'visivel' },
    });

    expect(saida['guildId']).toBe('123');
    expect(saida['DISCORD_TOKEN']).toBe('[REDACTED]');
    expect((saida['nested'] as Record<string, unknown>)['password']).toBe('[REDACTED]');
    expect((saida['nested'] as Record<string, unknown>)['ok']).toBe('visivel');
  });

  it('nao entra em loop com referencia circular', () => {
    const objeto: Record<string, unknown> = { nome: 'vook' };
    objeto['self'] = objeto;
    expect(() => redactContext(objeto)).not.toThrow();
  });
});
