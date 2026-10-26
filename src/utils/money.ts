import { ValidationError } from '../core/errors';
import { BUSINESS_LIMITS } from '../constants/limits';

/**
 * Dinheiro.
 *
 * REGRA ABSOLUTA: todo valor monetario trafega como INTEIRO EM CENTAVOS.
 * Nunca usar float para calcular desconto ou total.
 *
 * Percentual de cupom usa base 100 (basis points x 100):
 *   2000 => 20,00%   |   1050 => 10,50%   |   10000 => 100%
 */

export const PERCENT_SCALE = 10_000;

/** Formata centavos como moeda brasileira: 25000 -> "R$ 250,00". */
export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const negative = safe < 0;
  const absolute = Math.abs(safe);
  const reais = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  const reaisText = reais.toLocaleString('pt-BR');
  const centsText = remainder.toString().padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${reaisText},${centsText}`;
}

/** Formata percentual armazenado em base 100: 2000 -> "20%", 1050 -> "10,5%". */
export function formatPercent(value: number): string {
  const safe = Math.max(0, Math.trunc(value));
  const percent = safe / 100;
  const text = Number.isInteger(percent)
    ? percent.toString()
    : percent.toFixed(2).replace(/0$/, '').replace('.', ',');
  return `${text}%`;
}

/**
 * Converte texto digitado pelo vendedor em centavos.
 * Aceita "250", "250,00", "250.00", "R$ 250,00", "1.250,50", "1,250.50".
 */
export function parseAmountToCents(input: string): number {
  const raw = String(input ?? '').trim();
  if (raw.length === 0) {
    throw new ValidationError('Informe um valor.', { userMessage: 'Informe um valor valido.' });
  }

  const cleaned = raw.replace(/[Rr]\$/g, '').replace(/\s/g, '');
  if (!/^[\d.,]+$/.test(cleaned)) {
    throw new ValidationError(`Valor invalido: ${raw}`, {
      userMessage: 'Valor invalido. Use apenas numeros, por exemplo: 250,00',
    });
  }

  const invalid = (): never => {
    throw new ValidationError(`Valor invalido: ${raw}`, {
      userMessage: 'Valor invalido. Use o formato 250,00',
    });
  };

  const commas = (cleaned.match(/,/g) ?? []).length;
  const dots = (cleaned.match(/\./g) ?? []).length;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  /**
   * Descobre qual caractere e o separador DECIMAL.
   *  - os dois presentes: decimal e o que aparece por ultimo;
   *  - so um tipo, repetido: e separador de milhar;
   *  - so um tipo, uma vez: e milhar quando sobram exatamente 3 digitos
   *    (convencao pt-BR: "1,250" = mil duzentos e cinquenta).
   */
  let decimalSeparator: ',' | '.' | null = null;
  if (commas > 0 && dots > 0) {
    decimalSeparator = lastComma > lastDot ? ',' : '.';
  } else if (commas === 1 && cleaned.length - lastComma - 1 !== 3) {
    decimalSeparator = ',';
  } else if (dots === 1 && cleaned.length - lastDot - 1 !== 3) {
    decimalSeparator = '.';
  }

  const splitIndex =
    decimalSeparator === null ? -1 : cleaned.lastIndexOf(decimalSeparator);

  const rawInteger = splitIndex >= 0 ? cleaned.slice(0, splitIndex) : cleaned;
  const rawDecimal = splitIndex >= 0 ? cleaned.slice(splitIndex + 1) : '';

  if (rawDecimal.includes(',') || rawDecimal.includes('.')) invalid();
  if (rawDecimal.length > 2) {
    throw new ValidationError(`Valor com mais de 2 casas decimais: ${raw}`, {
      userMessage: 'Use no maximo 2 casas decimais. Exemplo: 250,00',
    });
  }

  /*
   * Separador de milhar: o oposto do decimal. Quando nao ha decimal, e o que
   * estiver presente na string (ex.: "1.250" e "1,250" sao ambos milhar).
   */
  const groupSeparator: ',' | '.' =
    decimalSeparator === ','
      ? '.'
      : decimalSeparator === '.'
        ? ','
        : dots > 0
          ? '.'
          : ',';

  /*
   * Agrupamento de milhar precisa ser real: "1.234.567" vale, "1.2.3" nao.
   * Sem esta checagem, "1.2.3,45" viraria R$ 123,45 silenciosamente — um erro
   * de digitacao virando cobranca com valor errado.
   */
  if (rawInteger.includes(groupSeparator)) {
    const groups = rawInteger.split(groupSeparator);
    const first = groups[0];
    if (first === undefined || first.length === 0 || first.length > 3) invalid();
    for (const group of groups.slice(1)) {
      if (group.length !== 3) invalid();
    }
  }

  const integerPart = rawInteger.split(groupSeparator).join('');
  const decimalPart = rawDecimal.padEnd(2, '0');

  if (integerPart.length === 0 || !/^\d+$/.test(integerPart)) invalid();
  if (decimalPart.length > 0 && !/^\d{2}$/.test(decimalPart)) invalid();

  const cents = Number(integerPart) * 100 + Number(decimalPart);
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new ValidationError(`Valor invalido: ${raw}`, {
      userMessage: 'Valor invalido. Use o formato 250,00',
    });
  }
  return cents;
}

/** Converte e valida contra os limites de negocio. */
export function parsePaymentAmount(input: string): number {
  const cents = parseAmountToCents(input);
  if (cents < BUSINESS_LIMITS.PAYMENT_MIN_CENTS) {
    throw new ValidationError(`Valor abaixo do minimo: ${cents}`, {
      userMessage: `O valor minimo e ${formatCents(BUSINESS_LIMITS.PAYMENT_MIN_CENTS)}.`,
    });
  }
  if (cents > BUSINESS_LIMITS.PAYMENT_MAX_CENTS) {
    throw new ValidationError(`Valor acima do maximo: ${cents}`, {
      userMessage: `O valor maximo permitido e ${formatCents(BUSINESS_LIMITS.PAYMENT_MAX_CENTS)}.`,
    });
  }
  return cents;
}

/**
 * Converte texto de percentual em base 100.
 * "20" -> 2000 | "20,5" -> 2050 | "20%" -> 2000
 */
export function parsePercent(input: string): number {
  const raw = String(input ?? '').replace('%', '').trim().replace(',', '.');
  if (raw.length === 0 || !/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new ValidationError(`Percentual invalido: ${input}`, {
      userMessage: 'Percentual invalido. Exemplo: 20 ou 12,5',
    });
  }
  const value = Math.round(Number(raw) * 100);
  if (value <= 0) {
    throw new ValidationError('Percentual deve ser maior que zero.', {
      userMessage: 'O percentual precisa ser maior que zero.',
    });
  }
  if (value > PERCENT_SCALE) {
    throw new ValidationError('Percentual maior que 100%.', {
      userMessage: 'O percentual nao pode ultrapassar 100%.',
    });
  }
  return value;
}

/** Formata milissegundos como "3d 12h 04m". */
export function formatDuration(totalMs: number): string {
  const ms = Math.max(0, Math.trunc(totalMs));
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${String(minutes).padStart(2, '0')}m`);
  parts.push(`${String(secs).padStart(2, '0')}s`);
  return parts.join(' ');
}
