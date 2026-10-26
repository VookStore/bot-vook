"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePackName = parsePackName;
exports.parsePackSku = parsePackSku;
exports.parsePackPrice = parsePackPrice;
exports.assertValidPrice = assertValidPrice;
exports.hasSellablePrice = hasSellablePrice;
exports.parseShortDescription = parseShortDescription;
exports.parseLongDescription = parseLongDescription;
exports.buildPackSlug = buildPackSlug;
exports.parseImageUrl = parseImageUrl;
exports.parseImageAlt = parseImageAlt;
exports.parsePackDetails = parsePackDetails;
exports.formatPackDetails = formatPackDetails;
exports.parseCategoryName = parseCategoryName;
exports.parseCategoryDescription = parseCategoryDescription;
exports.parseCategoryEmoji = parseCategoryEmoji;
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
/**
 * Validacao das entradas do catalogo.
 *
 * Tudo que a equipe digita passa por aqui antes de chegar ao banco: texto vai
 * sanitizado (sem mencao em massa, sem caractere de controle), preco vai como
 * inteiro em centavos e URL de imagem so passa em `https`.
 */
/** Nome do pack: obrigatorio, sem mencao, com pelo menos uma letra ou numero. */
function parsePackName(input) {
    const cleaned = (0, sanitize_1.sanitizeConfigText)((0, sanitize_1.stripUnsafeChars)(input).replace(/\n+/g, ' '), limits_1.BUSINESS_LIMITS.PACK_NAME_MAX)
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (cleaned.length < 3) {
        throw new errors_1.ValidationError(`Nome de pack muito curto: "${cleaned}"`, {
            userMessage: 'O nome do pack precisa ter pelo menos 3 caracteres.',
        });
    }
    if (!/[\p{L}\p{N}]/u.test(cleaned)) {
        throw new errors_1.ValidationError(`Nome de pack sem conteudo util: "${cleaned}"`, {
            userMessage: 'Dê ao pack um nome com palavras.',
        });
    }
    return cleaned;
}
/** SKU opcional: maiusculo, alfanumerico com hifen. Vazio vira `null`. */
function parsePackSku(input) {
    const cleaned = (0, sanitize_1.stripUnsafeChars)(input)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .trim();
    if (cleaned.length === 0)
        return null;
    if (cleaned.length > limits_1.BUSINESS_LIMITS.PACK_SKU_MAX) {
        throw new errors_1.ValidationError(`SKU muito longo: ${cleaned}`, {
            userMessage: `O SKU pode ter no maximo ${limits_1.BUSINESS_LIMITS.PACK_SKU_MAX} caracteres.`,
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
function parsePackPrice(input) {
    const cents = (0, money_1.parseAmountToCents)(input);
    assertValidPrice(cents);
    return cents;
}
/** Recusa 0, negativo, NaN, Infinity e valores acima do teto da loja. */
function assertValidPrice(cents) {
    if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
        throw new errors_1.ValidationError(`Preco invalido: ${String(cents)}`, {
            userMessage: 'Preco invalido. Use o formato 149,90.',
        });
    }
    if (cents < limits_1.BUSINESS_LIMITS.PAYMENT_MIN_CENTS) {
        throw new errors_1.ValidationError(`Preco abaixo do minimo: ${String(cents)}`, {
            userMessage: `O preco precisa ser de no minimo ${(0, money_1.formatCents)(limits_1.BUSINESS_LIMITS.PAYMENT_MIN_CENTS)}.`,
        });
    }
    if (cents > limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS) {
        throw new errors_1.ValidationError(`Preco acima do teto: ${String(cents)}`, {
            userMessage: `O preco maximo permitido e ${(0, money_1.formatCents)(limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS)}.`,
        });
    }
}
/** True quando o pack pode ser vendido pelo preco cadastrado. */
function hasSellablePrice(price) {
    return (Number.isInteger(price) &&
        price >= limits_1.BUSINESS_LIMITS.PAYMENT_MIN_CENTS &&
        price <= limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS);
}
function parseShortDescription(input) {
    const cleaned = (0, sanitize_1.sanitizeConfigText)((0, sanitize_1.stripUnsafeChars)(input).replace(/\n+/g, ' '), limits_1.BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX).trim();
    return cleaned.length > 0 ? cleaned : null;
}
function parseLongDescription(input) {
    const cleaned = (0, sanitize_1.sanitizeConfigText)(input, limits_1.BUSINESS_LIMITS.PACK_DESCRIPTION_MAX)
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
    return cleaned.length > 0 ? cleaned : null;
}
/** Slug estavel derivado do nome (usado no UNIQUE por guild). */
function buildPackSlug(name) {
    return (0, sanitize_1.sanitizeIdentifier)(name, 'pack');
}
/** URL de imagem: somente https, sem credenciais, sem `javascript:`/`data:`. */
function parseImageUrl(input) {
    const url = (0, sanitize_1.sanitizeImageUrl)(input);
    if (url === null || url.length === 0) {
        throw new errors_1.ValidationError('URL de imagem vazia.', {
            userMessage: 'Informe uma URL https:// valida para a imagem.',
        });
    }
    if (url.startsWith('attachment://')) {
        throw new errors_1.ValidationError('Imagem de pack nao aceita attachment://.', {
            userMessage: 'Use um endereco https:// publico da imagem.',
        });
    }
    return url;
}
function parseImageAlt(input) {
    const cleaned = (0, sanitize_1.sanitizeConfigText)((0, sanitize_1.stripUnsafeChars)(input).replace(/\n+/g, ' '), limits_1.BUSINESS_LIMITS.PACK_IMAGE_ALT_MAX).trim();
    return cleaned.length > 0 ? cleaned : null;
}
/**
 * Ficha tecnica digitada como texto livre: uma linha por item, no formato
 * `Rotulo: valor` (ou `Rotulo = valor`). Linhas sem separador sao ignoradas.
 */
function parsePackDetails(input) {
    const lines = (0, sanitize_1.stripUnsafeChars)(input).split('\n');
    const details = [];
    for (const line of lines) {
        if (details.length >= limits_1.BUSINESS_LIMITS.MAX_DETAILS_PER_PACK)
            break;
        const trimmed = line.trim();
        if (trimmed.length === 0)
            continue;
        const match = /^(.+?)\s*[:=]\s*(.+)$/.exec(trimmed);
        if (match === null)
            continue;
        const label = (0, sanitize_1.sanitizeConfigText)(match[1] ?? '', limits_1.BUSINESS_LIMITS.PACK_DETAIL_LABEL_MAX).trim();
        const value = (0, sanitize_1.sanitizeConfigText)(match[2] ?? '', limits_1.BUSINESS_LIMITS.PACK_DETAIL_VALUE_MAX).trim();
        if (label.length === 0 || value.length === 0)
            continue;
        details.push({ label, value });
    }
    return details;
}
/** Ficha tecnica de volta para o formulario (uma linha por item). */
function formatPackDetails(details) {
    return details.map((detail) => `${detail.label}: ${detail.value}`).join('\n');
}
/** Nome de categoria do catalogo. */
function parseCategoryName(input) {
    const cleaned = (0, sanitize_1.sanitizeConfigText)((0, sanitize_1.stripUnsafeChars)(input).replace(/\n+/g, ' '), limits_1.BUSINESS_LIMITS.CATEGORY_NAME_MAX).trim();
    if (cleaned.length < 2) {
        throw new errors_1.ValidationError(`Nome de categoria muito curto: "${cleaned}"`, {
            userMessage: 'O nome da categoria precisa ter pelo menos 2 caracteres.',
        });
    }
    return cleaned;
}
function parseCategoryDescription(input) {
    const cleaned = (0, sanitize_1.sanitizeConfigText)((0, sanitize_1.stripUnsafeChars)(input).replace(/\n+/g, ' '), limits_1.BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX).trim();
    return cleaned.length > 0 ? cleaned : null;
}
/**
 * Emoji da categoria.
 *
 * Aceita um unico caractere grafico (emoji unicode) ou um emoji customizado do
 * Discord (`<:nome:id>`). Qualquer outra coisa vira `null` em vez de derrubar o
 * cadastro — emoji e enfeite, nao pode impedir a categoria de existir.
 */
function parseCategoryEmoji(input) {
    const cleaned = (0, sanitize_1.stripUnsafeChars)(input).trim();
    if (cleaned.length === 0)
        return null;
    if (/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(cleaned))
        return cleaned;
    const graphemes = [...cleaned];
    if (graphemes.length > 4)
        return null;
    if (/^[\p{L}\p{N}\s]+$/u.test(cleaned))
        return null;
    return (0, sanitize_1.truncate)(cleaned, 16);
}
//# sourceMappingURL=packValidators.js.map