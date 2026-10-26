import { describe, expect, it } from 'vitest';
import { ReceiptCheckStatus } from '@prisma/client';

import {
  analyzeReceiptText,
  extractAmounts,
  extractDates,
  pixKeyTail,
  skippedAnalysis,
} from '../src/modules/catalog/validators/receiptParser';

/**
 * Conferencia automatica do comprovante.
 *
 * REGRA QUE ESTES TESTES PROTEGEM: a conferencia e AUXILIO, nao prova. Ela
 * existe para o vendedor bater o olho mais rapido — comprovante PIX e imagem, e
 * imagem se falsifica. Por isso o vies e deliberado:
 *
 *  - `fail` SOMENTE em sinal forte (valor ausente, data anterior a cobranca);
 *  - tudo que apenas nao deu para ler vira `unknown`, nunca acusacao.
 *
 * Acusar de divergencia um cliente honesto cujo banco imprime diferente custa
 * mais caro que pedir uma conferencia manual.
 */

const COBRADO_EM = new Date(2026, 7, 24, 10, 0, 0);
const AGORA = new Date(2026, 7, 24, 15, 0, 0);

const ESPERADO = {
  amountCents: 84000,
  chargedAt: COBRADO_EM,
  receiverName: 'ENRICK DA SILVA MELLO',
  pixKey: '+5517988012002',
};

/** Texto proximo do que um app de banco imprime num comprovante PIX. */
const COMPROVANTE_OK = `
Comprovante de transferencia
Valor
R$ 840,00
Data da transacao 24/08/2026
Destino
ENRICK DA SILVA MELLO
Instituicao BANCO INTER
Chave PIX +55 17 98801-2002
ID da transacao E1234567202608241000abcdef
`;

describe('extracao de valores', () => {
  it('le os formatos que os bancos imprimem', () => {
    expect(extractAmounts('R$ 840,00')).toContain(84000);
    expect(extractAmounts('R$ 1.234,56')).toContain(123456);
    expect(extractAmounts('Valor: 1234,56')).toContain(123456);
    expect(extractAmounts('12.345.678,90')).toContain(1234567890);
  });

  it('sobrevive ao OCR trocando o simbolo da moeda', () => {
    // OCR troca "R$" por "RS", "R5", "AS" o tempo todo — por isso o padrao
    // ancora no NUMERO, nao no simbolo.
    expect(extractAmounts('RS 840,00')).toContain(84000);
    expect(extractAmounts('R5 840,00')).toContain(84000);
    expect(extractAmounts('840,00')).toContain(84000);
  });

  it('ignora numero que nao e dinheiro', () => {
    expect(extractAmounts('ID E1234567202608241000')).toEqual([]);
    expect(extractAmounts('24/08/2026')).toEqual([]);
    expect(extractAmounts('sem numero nenhum')).toEqual([]);
  });

  it('nao duplica o mesmo valor', () => {
    const valores = extractAmounts('R$ 840,00 ... total 840,00');
    expect(valores.filter((valor) => valor === 84000)).toHaveLength(1);
  });
});

describe('extracao de datas', () => {
  it('le dd/mm/aaaa, dd/mm/aa e aaaa-mm-dd', () => {
    expect(extractDates('24/08/2026')[0]?.getFullYear()).toBe(2026);
    expect(extractDates('24/08/26')[0]?.getFullYear()).toBe(2026);
    expect(extractDates('2026-08-24')[0]?.getMonth()).toBe(7);
  });

  it('descarta data impossivel em vez de virar o mes', () => {
    // `new Date(2026, 1, 31)` viraria 3 de marco em silencio.
    expect(extractDates('31/02/2026')).toEqual([]);
    expect(extractDates('32/01/2026')).toEqual([]);
    expect(extractDates('24/13/2026')).toEqual([]);
  });
});

describe('comprovante compativel', () => {
  const analise = analyzeReceiptText(COMPROVANTE_OK, ESPERADO, AGORA);

  it('reconhece valor e data', () => {
    expect(analise.status).toBe(ReceiptCheckStatus.MATCH);
    expect(analise.amountCents).toBe(84000);
    expect(analise.paidAt?.getDate()).toBe(24);
  });

  it('confirma o titular mesmo com o nome no meio do texto', () => {
    const recebedor = analise.checks.find((check) => check.label === 'Recebedor');
    expect(recebedor?.status).toBe('ok');
  });

  it('confere o final da chave PIX mesmo com espacos e hifen', () => {
    const chave = analise.checks.find((check) => check.label === 'Chave PIX');
    expect(chave?.status).toBe('ok');
  });

  it('o resumo lembra o vendedor de olhar a imagem', () => {
    expect(analise.summary.toLowerCase()).toContain('confira');
  });
});

describe('sinais fortes viram divergencia', () => {
  it('valor cobrado ausente do comprovante', () => {
    const analise = analyzeReceiptText(
      'Valor R$ 120,00 Data 24/08/2026 ENRICK DA SILVA MELLO',
      ESPERADO,
      AGORA,
    );

    expect(analise.status).toBe(ReceiptCheckStatus.MISMATCH);
    const valor = analise.checks.find((check) => check.label === 'Valor');
    expect(valor?.status).toBe('fail');
    expect(valor?.detail).toContain('NAO aparece');
  });

  it('comprovante ANTERIOR a cobranca (reaproveitado) e o golpe que o OCR pega', () => {
    const analise = analyzeReceiptText(
      'Valor R$ 840,00 Data 02/07/2026 ENRICK DA SILVA MELLO',
      ESPERADO,
      AGORA,
    );

    expect(analise.status).toBe(ReceiptCheckStatus.MISMATCH);
    const data = analise.checks.find((check) => check.label === 'Data');
    expect(data?.status).toBe('fail');
    expect(data?.detail.toLowerCase()).toContain('reaproveitado');
  });

  it('comprovante datado no futuro', () => {
    const analise = analyzeReceiptText(
      'Valor R$ 840,00 Data 30/12/2026 ENRICK DA SILVA MELLO',
      ESPERADO,
      AGORA,
    );

    expect(analise.checks.find((check) => check.label === 'Data')?.status).toBe('fail');
  });

  it('comprovante do mesmo dia, algumas horas antes da cobranca, e aceito', () => {
    // O comprovante traz so a data; cobrar as 10h e pagar "no dia 24" nao pode
    // virar acusacao por causa da hora.
    const analise = analyzeReceiptText(
      'Valor R$ 840,00 Data 24/08/2026 ENRICK DA SILVA MELLO',
      ESPERADO,
      AGORA,
    );

    expect(analise.checks.find((check) => check.label === 'Data')?.status).toBe('ok');
  });
});

describe('duvida nunca vira acusacao', () => {
  it('titular que o OCR nao leu fica em unknown, nao em fail', () => {
    const analise = analyzeReceiptText('Valor R$ 840,00 Data 24/08/2026', ESPERADO, AGORA);

    expect(analise.checks.find((check) => check.label === 'Recebedor')?.status).toBe('unknown');
    expect(analise.status).not.toBe(ReceiptCheckStatus.MISMATCH);
  });

  it('chave mascarada pelo banco fica em unknown', () => {
    const analise = analyzeReceiptText(
      'Valor R$ 840,00 Data 24/08/2026 Chave ***.456.789-** ENRICK DA SILVA MELLO',
      ESPERADO,
      AGORA,
    );

    expect(analise.checks.find((check) => check.label === 'Chave PIX')?.status).toBe('unknown');
    expect(analise.status).toBe(ReceiptCheckStatus.MATCH);
  });

  it('nome abreviado pelo banco ainda casa', () => {
    const analise = analyzeReceiptText(
      'Valor R$ 840,00 Data 24/08/2026 ENRICK DA SILVA M.',
      ESPERADO,
      AGORA,
    );

    expect(analise.checks.find((check) => check.label === 'Recebedor')?.status).toBe('ok');
  });

  it('acento e caixa nao atrapalham o nome', () => {
    const analise = analyzeReceiptText(
      'valor r$ 840,00 data 24/08/2026 énrick da silva mello',
      { ...ESPERADO, receiverName: 'ÊNRICK DA SILVA MELLO' },
      AGORA,
    );

    expect(analise.checks.find((check) => check.label === 'Recebedor')?.status).toBe('ok');
  });
});

describe('imagem que o OCR nao leu', () => {
  it('texto vazio vira ilegivel, nao divergencia', () => {
    const analise = analyzeReceiptText('   ', ESPERADO, AGORA);

    expect(analise.status).toBe(ReceiptCheckStatus.UNREADABLE);
    expect(analise.amountCents).toBeNull();
    expect(analise.summary.toLowerCase()).toContain('manual');
  });

  it('ruido curto tambem vira ilegivel', () => {
    expect(analyzeReceiptText('a b c', ESPERADO, AGORA).status).toBe(
      ReceiptCheckStatus.UNREADABLE,
    );
  });

  it('sem valor legivel nao pode ser MATCH, mesmo com o resto batendo', () => {
    const analise = analyzeReceiptText(
      'Comprovante de transferencia para ENRICK DA SILVA MELLO em 24/08/2026',
      ESPERADO,
      AGORA,
    );

    expect(analise.status).toBe(ReceiptCheckStatus.UNREADABLE);
  });

  it('PDF (nao analisavel) e marcado como pulado', () => {
    const analise = skippedAnalysis('PDF nao e lido automaticamente.');

    expect(analise.status).toBe(ReceiptCheckStatus.SKIPPED);
    expect(analise.checks[0]?.status).toBe('unknown');
  });
});

describe('final da chave PIX', () => {
  it('ignora pontuacao e mascara', () => {
    expect(pixKeyTail('+5517988012002')).toBe('2002');
    expect(pixKeyTail('123.456.789-00')).toBe('8900');
    expect(pixKeyTail('loja@vook.store')).toBe('tore');
  });

  it('chave curta demais nao gera final utilizavel', () => {
    expect(pixKeyTail('ab').length).toBeLessThan(3);
  });
});
