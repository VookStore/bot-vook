import { ReceiptCheckStatus } from '@prisma/client';

import { formatCents } from '../../../utils/money';
import { foldForSearch } from '../../../utils/sanitize';

/**
 * Conferencia automatica do comprovante.
 *
 * O QUE ISTO E: um auxilio para o vendedor bater o olho mais rapido.
 * O QUE ISTO NAO E: prova de pagamento.
 *
 * Comprovante PIX e uma IMAGEM, e imagem se falsifica em minutos — existem
 * geradores de comprovante falso a um clique de distancia. O OCR le o que esta
 * escrito; num comprovante forjado, o que esta escrito e justamente o valor
 * "certo". Por isso estas conferencias pegam ENGANO (valor trocado, comprovante
 * antigo reaproveitado, conta errada) e nao pegam MENTIRA.
 *
 * Quem confirma o recebimento continua sendo uma pessoa, pelo fluxo normal do
 * modulo de pagamentos.
 *
 * VIES DELIBERADO: na duvida, `unknown` — nunca `fail`. Acusar de divergencia um
 * cliente honesto cujo banco imprime o comprovante de um jeito diferente custa
 * mais caro que pedir uma conferencia manual.
 */

/** Tolerancia para o comprovante ser "do mesmo dia" da cobranca. */
const SAME_DAY_TOLERANCE_MS = 36 * 60 * 60 * 1000;

/** Quanto o comprovante pode ser mais novo que "agora" (fuso do banco). */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/** Minimo de caracteres para considerar que o OCR leu alguma coisa. */
const MIN_TEXT_LENGTH = 12;

export interface ReceiptExpectation {
  /** Valor cobrado, em centavos. */
  amountCents: number;
  /** Quando a cobranca foi emitida. */
  chargedAt: Date;
  /** Titular da conta que deveria receber. */
  receiverName: string;
  /** Chave PIX da conta que deveria receber. */
  pixKey: string;
}

export type CheckStatus = 'ok' | 'fail' | 'unknown';

export interface ReceiptCheck {
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ReceiptAnalysis {
  status: ReceiptCheckStatus;
  amountCents: number | null;
  paidAt: Date | null;
  checks: ReceiptCheck[];
  /** Resumo curto exibido ao vendedor. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Extracao
// ---------------------------------------------------------------------------

/**
 * Valores monetarios do texto, em centavos.
 *
 * Nao tenta adivinhar QUAL numero e o total: comprovante tem varios (saldo,
 * tarifa, valor). A conferencia pergunta apenas se o valor cobrado aparece em
 * algum lugar — o que e verificavel, ao contrario de "achar o campo certo".
 *
 * `R$` e ignorado de proposito na busca: o OCR troca `R$` por `RS`, `R5` e `AS`
 * o tempo todo, entao ancorar nele perderia leitura boa.
 */
export function extractAmounts(text: string): number[] {
  const found: number[] = [];
  // 1.234,56 | 234,56 | 1234,56
  const pattern = /(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?!\d)/g;

  for (const match of text.matchAll(pattern)) {
    const inteiro = (match[1] ?? '').replace(/\./g, '');
    const centavos = match[2] ?? '00';
    if (inteiro.length === 0 || inteiro.length > 9) continue;

    const cents = Number(inteiro) * 100 + Number(centavos);
    if (Number.isFinite(cents) && cents > 0) found.push(cents);
  }

  return [...new Set(found)];
}

/**
 * Datas do texto. Aceita `dd/mm/aaaa`, `dd/mm/aa` e `aaaa-mm-dd`.
 * Datas impossiveis (32/13) sao descartadas em vez de viradas por `Date`.
 */
export function extractDates(text: string): Date[] {
  const found: Date[] = [];

  for (const match of text.matchAll(/(\d{2})\/(\d{2})\/(\d{4}|\d{2})(?!\d)/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const rawYear = match[3] ?? '';
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const date = buildDate(year, month, day);
    if (date !== null) found.push(date);
  }

  for (const match of text.matchAll(/(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    const date = buildDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date !== null) found.push(date);
  }

  return found;
}

function buildDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Rejeita 31/02 e afins, que o Date silenciosamente empurraria para marco.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Ultimos caracteres uteis da chave PIX (o resto costuma vir mascarado). */
export function pixKeyTail(pixKey: string, size = 4): string {
  const digits = foldForSearch(pixKey).replace(/[^a-z0-9]/g, '');
  return digits.slice(-size);
}

// ---------------------------------------------------------------------------
// Conferencia
// ---------------------------------------------------------------------------

/**
 * Compara o texto lido do comprovante com o que a cobranca esperava.
 *
 * Marca `fail` SOMENTE em sinal forte:
 *  - o valor cobrado nao aparece em lugar nenhum do comprovante;
 *  - a data do comprovante e ANTERIOR a emissao da cobranca (comprovante velho
 *    reaproveitado — o unico golpe que o OCR realmente ajuda a pegar).
 * Todo o resto que nao deu para ler vira `unknown`.
 */
export function analyzeReceiptText(
  text: string,
  expectation: ReceiptExpectation,
  now: Date = new Date(),
): ReceiptAnalysis {
  const clean = text.trim();

  if (clean.length < MIN_TEXT_LENGTH) {
    return {
      status: ReceiptCheckStatus.UNREADABLE,
      amountCents: null,
      paidAt: null,
      checks: [
        {
          label: 'Leitura',
          status: 'unknown',
          detail: 'Nao foi possivel ler texto na imagem.',
        },
      ],
      // Mesmo resumo de qualquer UNREADABLE: dois textos para o mesmo estado
      // deixariam o vendedor achando que sao situacoes diferentes.
      summary: buildSummary(ReceiptCheckStatus.UNREADABLE),
    };
  }

  const folded = foldForSearch(clean);
  const amounts = extractAmounts(clean);
  const dates = extractDates(clean);

  const checks: ReceiptCheck[] = [
    checkAmount(amounts, expectation.amountCents),
    checkDate(dates, expectation.chargedAt, now),
    checkReceiver(folded, expectation.receiverName),
    checkPixKey(folded, expectation.pixKey),
  ];

  const amountCheck = checks[0];
  const matchedAmount = amounts.includes(expectation.amountCents)
    ? expectation.amountCents
    : (amounts[0] ?? null);

  const status = deriveStatus(checks, amountCheck?.status ?? 'unknown');

  return {
    status,
    amountCents: matchedAmount,
    paidAt: pickClosestDate(dates, expectation.chargedAt),
    checks,
    summary: buildSummary(status),
  };
}

function checkAmount(amounts: readonly number[], expected: number): ReceiptCheck {
  if (amounts.length === 0) {
    return {
      label: 'Valor',
      status: 'unknown',
      detail: 'Nenhum valor legivel no comprovante.',
    };
  }
  if (amounts.includes(expected)) {
    return {
      label: 'Valor',
      status: 'ok',
      detail: `${formatCents(expected)} encontrado no comprovante.`,
    };
  }
  return {
    label: 'Valor',
    status: 'fail',
    detail:
      `${formatCents(expected)} NAO aparece no comprovante. ` +
      `Valores lidos: ${amounts.slice(0, 4).map(formatCents).join(', ')}.`,
  };
}

function checkDate(dates: readonly Date[], chargedAt: Date, now: Date): ReceiptCheck {
  if (dates.length === 0) {
    return { label: 'Data', status: 'unknown', detail: 'Nenhuma data legivel no comprovante.' };
  }

  const closest = pickClosestDate(dates, chargedAt);
  if (closest === null) {
    return { label: 'Data', status: 'unknown', detail: 'Nenhuma data legivel no comprovante.' };
  }

  const formatted = closest.toLocaleDateString('pt-BR');

  if (closest.getTime() < chargedAt.getTime() - SAME_DAY_TOLERANCE_MS) {
    return {
      label: 'Data',
      status: 'fail',
      detail: `Comprovante de ${formatted}, ANTERIOR a esta cobranca. Possivel comprovante reaproveitado.`,
    };
  }
  if (closest.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { label: 'Data', status: 'fail', detail: `Comprovante datado no futuro (${formatted}).` };
  }
  return { label: 'Data', status: 'ok', detail: `${formatted}, compativel com a cobranca.` };
}

/**
 * Titular da conta. Casa pelas duas primeiras palavras significativas: bancos
 * truncam e abreviam nome ("VOOK STORE LTDA" vira "VOOK STORE L..."), entao
 * exigir o nome inteiro geraria divergencia falsa.
 */
function checkReceiver(foldedText: string, receiverName: string): ReceiptCheck {
  const words = foldForSearch(receiverName)
    .split(' ')
    .filter((word) => word.length >= 3);

  if (words.length === 0) {
    return { label: 'Recebedor', status: 'unknown', detail: 'Conta sem titular cadastrado.' };
  }

  const hits = words.filter((word) => foldedText.includes(word));
  if (hits.length >= Math.min(2, words.length)) {
    return { label: 'Recebedor', status: 'ok', detail: `${receiverName} aparece no comprovante.` };
  }
  return {
    label: 'Recebedor',
    status: 'unknown',
    detail: `Nao consegui confirmar "${receiverName}" no comprovante. Confira na imagem.`,
  };
}

/**
 * Chave PIX. So confere o final, porque comprovante quase sempre mascara a
 * chave (`***.456.789-**`). Ausencia vira `unknown`, jamais `fail`.
 */
function checkPixKey(foldedText: string, pixKey: string): ReceiptCheck {
  const tail = pixKeyTail(pixKey);
  if (tail.length < 3) {
    return { label: 'Chave PIX', status: 'unknown', detail: 'Chave curta demais para conferir.' };
  }

  const foldedDigits = foldedText.replace(/[^a-z0-9]/g, '');
  if (foldedDigits.includes(tail)) {
    return { label: 'Chave PIX', status: 'ok', detail: `Final "${tail}" confere.` };
  }
  return {
    label: 'Chave PIX',
    status: 'unknown',
    detail: `Final "${tail}" nao localizado (comprovante costuma mascarar a chave).`,
  };
}

function pickClosestDate(dates: readonly Date[], reference: Date): Date | null {
  if (dates.length === 0) return null;
  return [...dates].sort(
    (a, b) =>
      Math.abs(a.getTime() - reference.getTime()) - Math.abs(b.getTime() - reference.getTime()),
  )[0] ?? null;
}

function deriveStatus(checks: readonly ReceiptCheck[], amountStatus: CheckStatus): ReceiptCheckStatus {
  if (checks.some((check) => check.status === 'fail')) return ReceiptCheckStatus.MISMATCH;
  // Sem o valor confirmado nao da para dizer que "bateu": o vendedor precisa ver.
  if (amountStatus !== 'ok') return ReceiptCheckStatus.UNREADABLE;
  return ReceiptCheckStatus.MATCH;
}

function buildSummary(status: ReceiptCheckStatus): string {
  switch (status) {
    case ReceiptCheckStatus.MATCH:
      return 'Valor e data batem com a cobranca. Confira a imagem antes de aprovar.';
    case ReceiptCheckStatus.MISMATCH:
      return 'DIVERGENCIA encontrada. Verifique com atencao antes de aprovar.';
    case ReceiptCheckStatus.SKIPPED:
      return 'Arquivo nao analisavel automaticamente. Conferencia manual.';
    default:
      return 'Nao foi possivel conferir automaticamente. Conferencia manual.';
  }
}

/** Comprovante que o OCR nao consegue processar (PDF, por exemplo). */
export function skippedAnalysis(reason: string): ReceiptAnalysis {
  return {
    status: ReceiptCheckStatus.SKIPPED,
    amountCents: null,
    paidAt: null,
    checks: [{ label: 'Leitura', status: 'unknown', detail: reason }],
    summary: buildSummary(ReceiptCheckStatus.SKIPPED),
  };
}

/** Icone da conferencia, usado no painel do vendedor. */
export function checkIcon(status: CheckStatus): string {
  if (status === 'ok') return '🟢';
  if (status === 'fail') return '🔴';
  return '🟡';
}
