import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AppError,
  ConfigurationError,
  CouponInvalidError,
  CouponNotFoundError,
  CouponUsageLimitError,
  DiscordResourceError,
  LockBusyError,
  PaymentAccountError,
  PaymentNotFoundError,
  PaymentStateError,
  PermissionError,
  RateLimitError,
  ReviewAlreadySubmittedError,
  ReviewInvalidError,
  TicketAlreadyClaimedError,
  TicketLimitError,
  TicketNotFoundError,
  TicketStateError,
  ValidationError,
} from '../src/core/errors';

/**
 * Classificacao de erro: recusa de regra x defeito.
 *
 * O QUE ESTES TESTES TRAVAM:
 *  1. recusa de ESTADO nao e falha. Clicar em "Aprovar" numa cobranca ja
 *     aprovada disparava alerta no canal de erros e gravava linha em
 *     `system_error_logs`, embora o segundo clique seja esperado (o botao
 *     continua clicavel ate o cartao ser reescrito) e a cobranca nao sofra
 *     nada — o guard fez o que devia. Alerta que ninguem pode consertar ensina
 *     a ignorar o canal, e ai o alerta que importa passa despercebido;
 *  2. `ConfigurationError` e `DiscordResourceError` CONTINUAM sendo falha: a
 *     acao do usuario era valida e o bot nao conseguiu cumpri-la. Sao as duas
 *     que o dono da loja quer ver;
 *  3. classe de erro NOVA nasce como falha. Padrao barulhento e melhor que
 *     padrao silencioso — e a varredura abaixo obriga quem cria uma classe a
 *     decidir, em vez de herdar silencio.
 */

describe('recusa de regra nao e defeito', () => {
  it.each([
    ['validacao', new ValidationError('x')],
    ['permissao', new PermissionError()],
    ['rate limit', new RateLimitError(30)],
    ['lock ocupado', new LockBusyError('recurso')],
    ['ticket inexistente', new TicketNotFoundError('abc')],
    ['ticket em estado errado', new TicketStateError('x')],
    ['ticket ja assumido', new TicketAlreadyClaimedError('123')],
    ['limite de tickets', new TicketLimitError('x')],
    ['cobranca inexistente', new PaymentNotFoundError('abc')],
    ['cobranca em estado errado', new PaymentStateError('x')],
    ['conta PIX', new PaymentAccountError('x')],
    ['cupom inexistente', new CouponNotFoundError('abc')],
    ['cupom invalido', new CouponInvalidError('x')],
    ['limite de cupom', new CouponUsageLimitError('x')],
    ['ja avaliou', new ReviewAlreadySubmittedError()],
    ['avaliacao invalida', new ReviewInvalidError('x')],
  ])('%s e esperado', (_nome, erro) => {
    expect(erro.expected).toBe(true);
  });

  /**
   * O caso que gerou tudo isto: `PAYMENT_STATE_ERROR` com a cobranca ja
   * aprovada, vindo do botao que continuou clicavel.
   */
  it('aprovar cobranca ja aprovada nao e falha', () => {
    const erro = new PaymentStateError('Pagamento nao esta pendente: APPROVED', {
      userMessage: 'Esta cobranca esta com status "Aprovado pela equipe".',
    });

    expect(erro.code).toBe('PAYMENT_STATE_ERROR');
    expect(erro.expected).toBe(true);
  });
});

describe('defeito continua sendo defeito', () => {
  it.each([
    ['configuracao', new ConfigurationError('x')],
    ['recurso do Discord', new DiscordResourceError('x')],
    ['erro generico', new AppError('x')],
  ])('%s nao e esperado', (_nome, erro) => {
    expect(erro.expected).toBe(false);
  });

  it('quem lanca pode marcar um caso pontual como esperado', () => {
    expect(new ConfigurationError('x', { expected: true }).expected).toBe(true);
  });
});

/**
 * Varredura ESTATICA: toda classe de erro precisa ter uma decisao visivel.
 *
 * Sem isto, a proxima classe nasceria como falha por omissao — que foi
 * exatamente como as doze anteriores viraram alerta sem ninguem perceber. A
 * verificacao le o fonte porque o que se quer travar e a ESCRITA da decisao,
 * nao o valor em si (esse ja esta coberto acima).
 */
describe('toda classe de erro declara a propria natureza', () => {
  const FONTE = readFileSync(resolve(__dirname, '..', 'src', 'core', 'errors', 'index.ts'), 'utf8');

  /** Classes que sao defeito por definicao, e por isso nao marcam nada. */
  const SEM_MARCA = new Set(['AppError', 'ConfigurationError', 'DiscordResourceError']);

  it('cada subclasse marca `expected` ou esta na lista das que sao defeito', () => {
    const blocos = FONTE.split(/^export class /m).slice(1);
    const semDecisao: string[] = [];

    for (const bloco of blocos) {
      const nome = bloco.slice(0, bloco.indexOf(' '));
      if (SEM_MARCA.has(nome)) continue;
      if (!bloco.slice(0, bloco.indexOf('\n}')).includes('expected: true')) {
        semDecisao.push(nome);
      }
    }

    expect(semDecisao).toEqual([]);
  });

  it('a lista das que sao defeito nao cresceu sem revisao', () => {
    // Crescer aqui e uma decisao de produto: significa mais alerta para o dono
    // da loja. Que ela exija editar este teste e o ponto.
    expect([...SEM_MARCA].sort()).toEqual([
      'AppError',
      'ConfigurationError',
      'DiscordResourceError',
    ]);
  });
});
