"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZERO_WIDTH_SPACE = void 0;
exports.stripUnsafeChars = stripUnsafeChars;
exports.sanitizeMentions = sanitizeMentions;
exports.collapseRepeats = collapseRepeats;
exports.sanitizeTicketSubject = sanitizeTicketSubject;
exports.sanitizeChannelName = sanitizeChannelName;
exports.sanitizeReason = sanitizeReason;
exports.sanitizeConfigText = sanitizeConfigText;
exports.escapeMarkdownLayout = escapeMarkdownLayout;
exports.sanitizeReviewComment = sanitizeReviewComment;
exports.sanitizeFilename = sanitizeFilename;
exports.sanitizeCouponCode = sanitizeCouponCode;
exports.sanitizeIdentifier = sanitizeIdentifier;
exports.sanitizeImageUrl = sanitizeImageUrl;
exports.isSafeImageUrl = isSafeImageUrl;
exports.foldForSearch = foldForSearch;
exports.truncate = truncate;
const errors_1 = require("../core/errors");
const limits_1 = require("../constants/limits");
/**
 * Sanitizacao de entrada.
 *
 * Nenhum texto vindo de usuario pode ser usado cru como nome de canal, nome de
 * arquivo, HTML, log ou customId. Toda funcao aqui e pura e testavel.
 */
const CODE_POINT = {
    BACKSPACE: 0x08,
    VERTICAL_TAB: 0x0b,
    FORM_FEED: 0x0c,
    CARRIAGE_RETURN: 0x0d,
    UNIT_SEPARATOR: 0x1f,
    DELETE: 0x7f,
    COMBINING_START: 0x0300,
    COMBINING_END: 0x036f,
    ZERO_WIDTH_SPACE: 0x200b,
    ZERO_WIDTH_END: 0x200f,
    LINE_SEPARATOR: 0x2028,
    BIDI_END: 0x202e,
    INVISIBLE_START: 0x2060,
    INVISIBLE_END: 0x2064,
    BYTE_ORDER_MARK: 0xfeff,
};
/** Espaco de largura zero usado para quebrar mencoes em massa. */
exports.ZERO_WIDTH_SPACE = String.fromCodePoint(CODE_POINT.ZERO_WIDTH_SPACE);
/**
 * True para caracteres que nunca podem passar: controles (exceto TAB e quebra
 * de linha), espacos de largura zero e marcas de direcao usadas para burlar
 * filtros de texto.
 */
function isUnsafeCodePoint(code) {
    if (code <= CODE_POINT.BACKSPACE)
        return true;
    if (code === CODE_POINT.VERTICAL_TAB || code === CODE_POINT.FORM_FEED)
        return true;
    if (code > CODE_POINT.CARRIAGE_RETURN && code <= CODE_POINT.UNIT_SEPARATOR)
        return true;
    if (code === CODE_POINT.DELETE)
        return true;
    if (code >= CODE_POINT.ZERO_WIDTH_SPACE && code <= CODE_POINT.ZERO_WIDTH_END)
        return true;
    if (code >= CODE_POINT.LINE_SEPARATOR && code <= CODE_POINT.BIDI_END)
        return true;
    if (code >= CODE_POINT.INVISIBLE_START && code <= CODE_POINT.INVISIBLE_END)
        return true;
    if (code === CODE_POINT.BYTE_ORDER_MARK)
        return true;
    return false;
}
/** Remove controles e invisiveis, normaliza quebras de linha. */
function stripUnsafeChars(input) {
    const normalized = String(input ?? '')
        .normalize('NFC')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
    let output = '';
    for (const char of normalized) {
        const code = char.codePointAt(0);
        if (code === undefined || isUnsafeCodePoint(code))
            continue;
        output += char;
    }
    return output;
}
/** Remove marcas diacriticas combinantes (acentos) apos normalizacao NFD. */
function removeDiacritics(input) {
    let output = '';
    for (const char of input.normalize('NFD')) {
        const code = char.codePointAt(0);
        if (code === undefined)
            continue;
        if (code >= CODE_POINT.COMBINING_START && code <= CODE_POINT.COMBINING_END)
            continue;
        output += char;
    }
    return output;
}
/**
 * Neutraliza mencoes em massa e pings.
 * Usado em TODO texto configuravel ou enviado por usuario.
 * A defesa principal continua sendo `allowedMentions`; isto e a segunda camada.
 */
function sanitizeMentions(input) {
    return String(input ?? '')
        .replace(/@(everyone|here)/gi, `@${exports.ZERO_WIDTH_SPACE}$1`)
        .replace(/<@&(\d+)>/g, '[cargo]')
        .replace(/<@!?(\d+)>/g, '[usuario]');
}
/** Colapsa repeticoes absurdas (spam de caracteres). */
function collapseRepeats(input, maxRepeat = 5) {
    return String(input ?? '').replace(new RegExp(`(.)\\1{${maxRepeat},}`, 'gu'), (_match, char) => char.repeat(maxRepeat));
}
function trimToLength(input, max) {
    return input.length > max ? `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…` : input;
}
/** Assunto do ticket: obrigatorio, sem mencoes, sem spam, tamanho controlado. */
function sanitizeTicketSubject(input) {
    const cleaned = collapseRepeats(sanitizeMentions(stripUnsafeChars(input).replace(/\n+/g, ' ')))
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (cleaned.length < limits_1.BUSINESS_LIMITS.TICKET_SUBJECT_MIN) {
        throw new errors_1.ValidationError(`Assunto muito curto: "${cleaned}"`, {
            userMessage: `Descreva o assunto com pelo menos ${limits_1.BUSINESS_LIMITS.TICKET_SUBJECT_MIN} caracteres.`,
        });
    }
    // Rejeita assunto sem nenhuma letra ou numero (ex.: "!!!!!").
    if (!/[\p{L}\p{N}]/u.test(cleaned)) {
        throw new errors_1.ValidationError(`Assunto sem conteudo util: "${cleaned}"`, {
            userMessage: 'Descreva o assunto do seu atendimento com palavras.',
        });
    }
    return trimToLength(cleaned, limits_1.BUSINESS_LIMITS.TICKET_SUBJECT_MAX);
}
/**
 * Nome de canal do Discord: minusculo, sem acento, apenas [a-z0-9-].
 * Sempre retorna algo valido (nunca string vazia).
 */
function sanitizeChannelName(input, fallback = 'ticket') {
    const base = removeDiacritics(stripUnsafeChars(input))
        .toLowerCase()
        .replace(/[^a-z0-9\-\s]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    const safe = base.length > 0 ? base : fallback;
    return safe.slice(0, limits_1.DISCORD_LIMITS.CHANNEL_NAME);
}
/** Motivo de fechamento/cancelamento (multilinha permitida). */
function sanitizeReason(input, max = limits_1.BUSINESS_LIMITS.CLOSE_REASON_MAX) {
    const cleaned = collapseRepeats(sanitizeMentions(stripUnsafeChars(input)))
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
    return trimToLength(cleaned, max);
}
/** Texto configuravel (titulo, descricao, aviso do painel). */
function sanitizeConfigText(input, max = 1000) {
    const cleaned = sanitizeMentions(stripUnsafeChars(input)).trim();
    return trimToLength(cleaned, max);
}
/**
 * Neutraliza a sintaxe de markdown que muda a APARENCIA da mensagem em vez de
 * apenas enfatizar texto.
 *
 * Usado no comentario de avaliacao, o unico texto livre de usuario nao
 * privilegiado que o bot republica em canal publico assinado com o nome da
 * loja. Sem isto, `[CLIQUE AQUI](https://phishing.example)` vira um link
 * mascarado clicavel e `# TITULO` vira um cabecalho — ambos indistinguiveis de
 * um anuncio oficial.
 *
 * Escapa com barra invertida (o Discord renderiza o caractere literal):
 *  - `[` e `]`  -> impedem link mascarado;
 *  - `#`        -> impede cabecalho (e `-#` de subtexto);
 *  - crase      -> impede bloco/trecho de codigo, que quebraria o container;
 *  - `>`        -> impede citacao ocupando a largura toda.
 */
function escapeMarkdownLayout(input) {
    return String(input ?? '').replace(/[[\]#`>\\]/g, (char) => `\\${char}`);
}
/** Comentario da avaliacao publicado em canal publico. Opcional. */
function sanitizeReviewComment(input) {
    if (input === null || input === undefined)
        return null;
    const cleaned = collapseRepeats(sanitizeMentions(stripUnsafeChars(input)))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (cleaned.length === 0)
        return null;
    if (!/[\p{L}\p{N}]/u.test(cleaned))
        return null;
    // O escape de markdown NAO acontece aqui: ele e responsabilidade de quem
    // renderiza (ver `escapeMarkdownLayout` em ReviewBuilders). Guardar o texto
    // cru mantem o limite contado em caracteres do cliente e protege tambem as
    // avaliacoes ja gravadas antes desta correcao.
    return trimToLength(cleaned, limits_1.BUSINESS_LIMITS.REVIEW_COMMENT_MAX);
}
/** Nome de arquivo seguro (transcript, QR code). Sem path traversal. */
function sanitizeFilename(input, fallback = 'arquivo') {
    const base = removeDiacritics(stripUnsafeChars(input))
        .replace(/[/\\]/g, '-')
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[.-]+/, '')
        .replace(/[.-]+$/, '');
    const safe = base.length > 0 ? base : fallback;
    return safe.slice(0, 120);
}
/** Codigo de cupom: maiusculo, sem espaco, alfanumerico. */
function sanitizeCouponCode(input) {
    const cleaned = removeDiacritics(stripUnsafeChars(input))
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .trim();
    if (cleaned.length < limits_1.BUSINESS_LIMITS.COUPON_CODE_MIN) {
        throw new errors_1.ValidationError(`Codigo de cupom muito curto: "${cleaned}"`, {
            userMessage: `O codigo precisa ter pelo menos ${limits_1.BUSINESS_LIMITS.COUPON_CODE_MIN} caracteres (letras e numeros).`,
        });
    }
    if (cleaned.length > limits_1.BUSINESS_LIMITS.COUPON_CODE_MAX) {
        throw new errors_1.ValidationError(`Codigo de cupom muito longo: "${cleaned}"`, {
            userMessage: `O codigo pode ter no maximo ${limits_1.BUSINESS_LIMITS.COUPON_CODE_MAX} caracteres.`,
        });
    }
    return cleaned;
}
/** Identificador tecnico (categoria, conta PIX): minusculo com hifen. */
function sanitizeIdentifier(input, fallback = 'item') {
    const cleaned = removeDiacritics(stripUnsafeChars(input))
        .toLowerCase()
        .replace(/[^a-z0-9\-\s]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    return (cleaned.length > 0 ? cleaned : fallback).slice(0, 40);
}
/**
 * URL de imagem/banner.
 * Aceita somente https (e attachment:// usado pelo proprio bot). Recusa
 * javascript:, data:, file: e afins.
 */
function sanitizeImageUrl(input) {
    if (input === null || input === undefined)
        return null;
    const raw = stripUnsafeChars(input).trim();
    if (raw.length === 0)
        return null;
    if (raw.startsWith('attachment://')) {
        const name = raw.slice('attachment://'.length);
        return name.length > 0 ? `attachment://${sanitizeFilename(name)}` : null;
    }
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new errors_1.ValidationError(`URL invalida: ${raw.slice(0, 60)}`, {
            userMessage: 'URL invalida. Utilize um endereco https:// completo.',
        });
    }
    if (parsed.protocol !== 'https:') {
        throw new errors_1.ValidationError(`Protocolo nao permitido: ${parsed.protocol}`, {
            userMessage: 'Somente URLs https:// sao aceitas.',
        });
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
        throw new errors_1.ValidationError('URL com credenciais embutidas.', {
            userMessage: 'URL invalida. Remova usuario/senha do endereco.',
        });
    }
    if (parsed.href.length > limits_1.BUSINESS_LIMITS.IMAGE_URL_MAX) {
        throw new errors_1.ValidationError('URL muito longa.', {
            userMessage: 'A URL informada e muito longa.',
        });
    }
    return parsed.href;
}
/** True se a URL e https valida (nao lanca). */
function isSafeImageUrl(input) {
    if (input === null || input === undefined || input.length === 0)
        return false;
    try {
        return sanitizeImageUrl(input) !== null;
    }
    catch {
        return false;
    }
}
/**
 * Texto preparado para BUSCA: sem acento, minusculo, espacos colapsados.
 * Usado na busca do catalogo, onde "veiculos" precisa achar "Veículos".
 */
function foldForSearch(input) {
    if (input === null || input === undefined)
        return '';
    return removeDiacritics(stripUnsafeChars(input))
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}
/** Trunca preservando limite do Discord (labels, descricoes de select). */
function truncate(input, max) {
    const value = String(input ?? '');
    return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}
//# sourceMappingURL=sanitize.js.map