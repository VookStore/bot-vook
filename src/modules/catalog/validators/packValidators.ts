import { BUSINESS_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { formatCents, parseAmountToCents } from '../../../utils/money';
import {
  sanitizeConfigText,
  sanitizeIdentifier,
  sanitizeImageUrl,
  stripUnsafeChars,
  truncate,
} from '../../../utils/sanitize';

/**
 * Validacao das entradas do catalogo.
 *
 * Tudo que a equipe digita passa por aqui antes de chegar ao banco: texto vai
 * sanitizado (sem mencao em massa, sem caractere de controle), preco vai como
 * inteiro em centavos e URL de imagem so passa em `https`.
 */

/** Nome do pack: obrigatorio, sem mencao, com pelo menos uma letra ou numero. */
export function parsePackName(input: string): string {
  const cleaned = sanitizeConfigText(
    stripUnsafeChars(input).replace(/\n+/g, ' '),
    BUSINESS_LIMITS.PACK_NAME_MAX,
  )
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (cleaned.length < 3) {
    throw new ValidationError(`Nome de pack muito curto: "${cleaned}"`, {
      userMessage: 'O nome do pack precisa ter pelo menos 3 caracteres.',
    });
  }
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    throw new ValidationError(`Nome de pack sem conteudo util: "${cleaned}"`, {
      userMessage: 'Dê ao pack um nome com palavras.',
    });
  }
  return cleaned;
}

/** SKU opcional: maiusculo, alfanumerico com hifen. Vazio vira `null`. */
export function parsePackSku(input: string): string | null {
  const cleaned = stripUnsafeChars(input)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .trim();

  if (cleaned.length === 0) return null;
  if (cleaned.length > BUSINESS_LIMITS.PACK_SKU_MAX) {
    throw new ValidationError(`SKU muito longo: ${cleaned}`, {
      userMessage: `O SKU pode ter no maximo ${BUSINESS_LIMITS.PACK_SKU_MAX} caracteres.`,
    });
  }
  return cleaned;
}

/**
 * Preco do pack em centavos.
 *
 * Reaproveita o parser do modulo financeiro (aceita "149,90", "R$ 149,90",
 * "1.499,90") e aplica os MESMOS limites de valor de uma cobranca — um produto
 * que nao pode ser cobrado nao pode ser vendido.
 */
export function parsePackPrice(input: string): number {
  const cents = parseAmountToCents(input);
  assertValidPrice(cents);
  return cents;
}

/** Recusa 0, negativo, NaN, Infinity e valores acima do teto da loja. */
export function assertValidPrice(cents: number): void {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new ValidationError(`Preco invalido: ${String(cents)}`, {
      userMessage: 'Preco invalido. Use o formato 149,90.',
    });
  }
  if (cents < BUSINESS_LIMITS.PAYMENT_MIN_CENTS) {
    throw new ValidationError(`Preco abaixo do minimo: ${String(cents)}`, {
      userMessage: `O preco precisa ser de no minimo ${formatCents(BUSINESS_LIMITS.PAYMENT_MIN_CENTS)}.`,
    });
  }
  if (cents > BUSINESS_LIMITS.PAYMENT_MAX_CENTS) {
    throw new ValidationError(`Preco acima do teto: ${String(cents)}`, {
      userMessage: `O preco maximo permitido e ${formatCents(BUSINESS_LIMITS.PAYMENT_MAX_CENTS)}.`,
    });
  }
}

/** True quando o pack pode ser vendido pelo preco cadastrado. */
export function hasSellablePrice(price: number): boolean {
  return (
    Number.isInteger(price) &&
    price >= BUSINESS_LIMITS.PAYMENT_MIN_CENTS &&
    price <= BUSINESS_LIMITS.PAYMENT_MAX_CENTS
  );
}

export function parseShortDescription(input: string): string | null {
  const cleaned = sanitizeConfigText(
    stripUnsafeChars(input).replace(/\n+/g, ' '),
    BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX,
  ).trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function parseLongDescription(input: string): string | null {
  const cleaned = sanitizeConfigText(input, BUSINESS_LIMITS.PACK_DESCRIPTION_MAX)
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Slug estavel derivado do nome (usado no UNIQUE por guild). */
export function buildPackSlug(name: string): string {
  return sanitizeIdentifier(name, 'pack');
}

/** URL de imagem: somente https, sem credenciais, sem `javascript:`/`data:`. */
export function parseImageUrl(input: string): string {
  const url = sanitizeImageUrl(input);
  if (url === null || url.length === 0) {
    throw new ValidationError('URL de imagem vazia.', {
      userMessage: 'Informe uma URL https:// valida para a imagem.',
    });
  }
  if (url.startsWith('attachment://')) {
    throw new ValidationError('Imagem de pack nao aceita attachment://.', {
      userMessage: 'Use um endereco https:// publico da imagem.',
    });
  }
  return url;
}

export function parseImageAlt(input: string): string | null {
  const cleaned = sanitizeConfigText(
    stripUnsafeChars(input).replace(/\n+/g, ' '),
    BUSINESS_LIMITS.PACK_IMAGE_ALT_MAX,
  ).trim();
  return cleaned.length > 0 ? cleaned : null;
}

export interface PackDetailInput {
  label: string;
  value: string;
}

/**
 * Ficha tecnica digitada como texto livre: uma linha por item, no formato
 * `Rotulo: valor` (ou `Rotulo = valor`). Linhas sem separador sao ignoradas.
 */
export function parsePackDetails(input: string): PackDetailInput[] {
  const lines = stripUnsafeChars(input).split('\n');
  const details: PackDetailInput[] = [];

  for (const line of lines) {
    if (details.length >= BUSINESS_LIMITS.MAX_DETAILS_PER_PACK) break;

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const match = /^(.+?)\s*[:=]\s*(.+)$/.exec(trimmed);
    if (match === null) continue;

    const label = sanitizeConfigText(
      match[1] ?? '',
      BUSINESS_LIMITS.PACK_DETAIL_LABEL_MAX,
    ).trim();
    const value = sanitizeConfigText(
      match[2] ?? '',
      BUSINESS_LIMITS.PACK_DETAIL_VALUE_MAX,
    ).trim();

    if (label.length === 0 || value.length === 0) continue;
    details.push({ label, value });
  }

  return details;
}

/** Ficha tecnica de volta para o formulario (uma linha por item). */
export function formatPackDetails(
  details: ReadonlyArray<{ label: string; value: string }>,
): string {
  return details.map((detail) => `${detail.label}: ${detail.value}`).join('\n');
}

/** Nome de categoria do catalogo. */
export function parseCategoryName(input: string): string {
  const cleaned = sanitizeConfigText(
    stripUnsafeChars(input).replace(/\n+/g, ' '),
    BUSINESS_LIMITS.CATEGORY_NAME_MAX,
  ).trim();

  if (cleaned.length < 2) {
    throw new ValidationError(`Nome de categoria muito curto: "${cleaned}"`, {
      userMessage: 'O nome da categoria precisa ter pelo menos 2 caracteres.',
    });
  }
  return cleaned;
}

export function parseCategoryDescription(input: string): string | null {
  const cleaned = sanitizeConfigText(
    stripUnsafeChars(input).replace(/\n+/g, ' '),
    BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX,
  ).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Emoji da categoria.
 *
 * Aceita um unico caractere grafico (emoji unicode) ou um emoji customizado do
 * Discord (`<:nome:id>`). Qualquer outra coisa vira `null` em vez de derrubar o
 * cadastro — emoji e enfeite, nao pode impedir a categoria de existir.
 */
export function parseCategoryEmoji(input: string): string | null {
  const cleaned = stripUnsafeChars(input).trim();
  if (cleaned.length === 0) return null;

  if (/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(cleaned)) return cleaned;

  const graphemes = [...cleaned];
  if (graphemes.length > 4) return null;
  if (/^[\p{L}\p{N}\s]+$/u.test(cleaned)) return null;

  return truncate(cleaned, 16);
}
