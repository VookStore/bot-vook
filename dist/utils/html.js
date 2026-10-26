"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeHtml = escapeHtml;
exports.escapeHtmlWithBreaks = escapeHtmlWithBreaks;
exports.safeHref = safeHref;
exports.linkifyEscaped = linkifyEscaped;
const stringify_1 = require("./stringify");
/**
 * Escape de HTML para o transcript.
 *
 * REGRA DE SEGURANCA: nenhum conteudo enviado por usuario pode ser interpretado
 * como marcacao. Tudo passa por `escapeHtml` antes de entrar no documento —
 * incluindo nomes, apelidos, assunto, motivo, nomes de arquivo e URLs.
 */
const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
    '=': '&#61;',
};
/** Escapa todos os caracteres perigosos. Sempre retorna string. */
function escapeHtml(input) {
    if (input === null || input === undefined)
        return '';
    return (0, stringify_1.toDisplayString)(input).replace(/[&<>"'`=]/g, (char) => HTML_ESCAPES[char] ?? char);
}
/**
 * Escapa e converte quebras de linha em <br>.
 * O escape acontece ANTES, entao o <br> inserido e o unico markup possivel.
 */
function escapeHtmlWithBreaks(input) {
    return escapeHtml(input).replace(/\r?\n/g, '<br>');
}
/**
 * Valida uma URL para uso em atributo href/src do transcript.
 * Somente http(s). Qualquer outro protocolo (javascript:, data:, file:)
 * retorna null e o chamador deve renderizar como texto puro.
 */
function safeHref(input) {
    if (input === null || input === undefined)
        return null;
    const raw = (0, stringify_1.toDisplayString)(input).trim();
    if (raw.length === 0)
        return null;
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
        return null;
    return escapeHtml(parsed.href);
}
const HTML_UNESCAPES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#96;': '`',
    '&#61;': '=',
};
/**
 * Inverte `escapeHtml` em UMA unica passagem — o resultado nunca e reprocessado,
 * entao "&amp;#61;" volta a ser "&#61;" (o texto original) e nao "=".
 *
 * Uso exclusivo: recuperar a URL real antes de valida-la. O valor devolvido
 * jamais entra no documento sem passar por `safeHref`/`escapeHtml` de novo.
 */
function unescapeHtml(input) {
    return input.replace(/&(?:amp|lt|gt|quot|#39|#96|#61);/g, (entity) => HTML_UNESCAPES[entity] ?? entity);
}
/**
 * Converte URLs de um texto JA ESCAPADO em links clicaveis.
 * Recebe texto escapado para nunca reintroduzir markup do usuario.
 *
 * O `href` e construido a partir da URL DESESCAPADA: `safeHref` reaplica o
 * escape uma unica vez. Passar o texto ja escapado direto para `safeHref`
 * causaria escape duplo ("&amp;" viraria "&amp;amp;") e quebraria toda URL com
 * query string. O texto visivel do link continua sendo o `match` escapado.
 */
function linkifyEscaped(escapedText) {
    return escapedText.replace(/\bhttps?:\/\/[^\s<>"']+/g, (match) => {
        const href = safeHref(unescapeHtml(match));
        if (href === null)
            return match;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${match}</a>`;
    });
}
//# sourceMappingURL=html.js.map