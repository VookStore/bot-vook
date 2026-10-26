"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crc16ccitt = crc16ccitt;
exports.emvField = emvField;
exports.formatPixAmount = formatPixAmount;
exports.normalizePixText = normalizePixText;
exports.validatePixPayload = validatePixPayload;
exports.buildPixPayload = buildPixPayload;
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
/**
 * Geracao do BR Code (PIX "copia e cola") no padrao EMV QRCPS-MPM adotado pelo
 * Banco Central do Brasil.
 *
 * Estrutura TLV: cada campo e ID (2 digitos) + LENGTH (2 digitos com zero a
 * esquerda) + VALUE. Campos compostos (26 e 62) carregam outros TLV dentro do
 * seu VALUE.
 *
 * O CRC16 e calculado sobre o payload inteiro JA CONCATENADO com o prefixo
 * "6304" e o resultado hexadecimal e anexado ao final.
 */
const logger = (0, Logger_1.createLogger)('PixPayloadService');
/** Comprimento maximo de um VALUE TLV: o campo LENGTH tem apenas 2 digitos. */
const MAX_TLV_VALUE_LENGTH = 99;
/** Identificador global do arranjo PIX, obrigatorio no subcampo 26-00. */
const PIX_GUI = 'BR.GOV.BCB.PIX';
/** Marcador usado no subcampo 62-05 quando nao existe txid. */
const TXID_ABSENT = '***';
/** Maior chave PIX possivel (e-mail). */
const PIX_KEY_MAX_LENGTH = 77;
/** Polinomio do CRC-16/CCITT-FALSE. */
const CRC16_POLYNOMIAL = 0x1021;
/** Valor inicial do CRC-16/CCITT-FALSE. */
const CRC16_INITIAL = 0xffff;
/** Caracteres aceitos nos campos textuais do BR Code (nome, cidade, descricao). */
const PIX_TEXT_FORBIDDEN = /[^A-Za-z0-9 .-]/g;
/** Marcas diacriticas combinantes removidas apos normalizacao NFD. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;
/**
 * Conjunto de caracteres do BR Code: ASCII imprimivel (0x20 a 0x7E).
 *
 * O campo LENGTH do TLV conta CARACTERES, mas o payload trafega no QR Code (e
 * tem o CRC calculado) em BYTES UTF-8. Para ASCII os dois numeros coincidem;
 * qualquer caractere fora dessa faixa faz o tamanho declarado divergir do
 * tamanho real e corrompe todos os campos seguintes para qualquer leitor que
 * percorra o payload por bytes, sem que o CRC acuse nada: ele e calculado
 * sobre o mesmo conteudo errado.
 */
const NON_ASCII_PRINTABLE = /[^\x20-\x7e]/;
/** Exige ao menos uma letra ou digito (nome/cidade so com "." ou "-" nao servem). */
const HAS_ALPHANUMERIC = /[A-Za-z0-9]/;
/**
 * CRC-16/CCITT-FALSE: polinomio 0x1021, valor inicial 0xFFFF, sem reflexao de
 * entrada/saida e sem XOR final. Retorna 4 digitos hexadecimais MAIUSCULOS.
 * Vetor de teste oficial: "123456789" => "29B1".
 */
function crc16ccitt(input) {
    const bytes = Buffer.from(String(input ?? ''), 'utf8');
    let crc = CRC16_INITIAL;
    for (const byte of bytes) {
        crc ^= byte << 8;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ CRC16_POLYNOMIAL : crc << 1;
            crc &= 0xffff;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}
/**
 * Monta um campo TLV: ID + LENGTH (2 digitos) + VALUE.
 * Valores acima de 99 caracteres nao sao representaveis no padrao e sao
 * recusados — jamais truncados silenciosamente, o que corromperia o payload.
 */
function emvField(id, value) {
    if (!/^\d{2}$/.test(id)) {
        throw new errors_1.ValidationError(`ID de campo EMV invalido: "${id}"`, {
            userMessage: 'Nao foi possivel gerar o codigo PIX. Avise um administrador.',
        });
    }
    const content = String(value ?? '');
    if (NON_ASCII_PRINTABLE.test(content)) {
        throw new errors_1.ValidationError(`Campo EMV ${id} contem caractere fora do ASCII imprimivel exigido pelo BR Code`, {
            userMessage: 'Nao foi possivel gerar o codigo PIX: um dos dados informados usa caracteres nao aceitos pelo padrao.',
        });
    }
    if (content.length > MAX_TLV_VALUE_LENGTH) {
        throw new errors_1.ValidationError(`Campo EMV ${id} excede ${MAX_TLV_VALUE_LENGTH} caracteres (recebido: ${content.length})`, {
            userMessage: 'Nao foi possivel gerar o codigo PIX: um dos dados informados e muito longo.',
        });
    }
    return `${id}${String(content.length).padStart(2, '0')}${content}`;
}
/**
 * Formata centavos no padrao do campo 54: ponto como separador decimal, sempre
 * 2 casas e sem separador de milhar. 25000 => "250.00".
 * Calculo 100% inteiro (nunca float).
 */
function formatPixAmount(cents) {
    if (!Number.isInteger(cents) || cents < 0) {
        throw new errors_1.ValidationError(`Valor invalido para o campo 54: ${cents}`, {
            userMessage: 'Valor da cobranca invalido.',
        });
    }
    const reais = Math.trunc(cents / 100);
    const remainder = cents % 100;
    return `${reais}.${String(remainder).padStart(2, '0')}`;
}
/**
 * Prepara texto para os campos do BR Code: remove controles/invisiveis,
 * remove acentos, elimina caracteres fora do conjunto aceito, colapsa espacos
 * e corta no limite informado.
 */
function normalizePixText(value, maxLength) {
    const limit = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 0;
    if (limit === 0)
        return '';
    const cleaned = (0, sanitize_1.stripUnsafeChars)(value)
        .normalize('NFD')
        .replace(COMBINING_MARKS, '')
        .replace(/[\n\t]+/g, ' ')
        .replace(PIX_TEXT_FORBIDDEN, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return cleaned.slice(0, limit).trim();
}
/**
 * Recalcula o CRC dos ultimos 4 caracteres do payload e confere com o valor
 * anexado. Usado para garantir que nada corrompeu o codigo antes de exibi-lo.
 */
function validatePixPayload(payload) {
    const value = String(payload ?? '');
    // Menor payload plausivel ainda precisa conter "6304" + 4 digitos.
    if (value.length < 8)
        return false;
    const body = value.slice(0, -4);
    const provided = value.slice(-4);
    if (!body.endsWith('6304'))
        return false;
    if (!/^[0-9A-Fa-f]{4}$/.test(provided))
        return false;
    return crc16ccitt(body) === provided.toUpperCase();
}
/** Valida a chave PIX bruta que sera gravada no subcampo 26-01. */
function normalizePixKey(pixKey) {
    const cleaned = (0, sanitize_1.stripUnsafeChars)(pixKey).trim();
    if (cleaned.length === 0) {
        throw new errors_1.ValidationError('Chave PIX vazia.', {
            userMessage: 'A chave PIX da conta de recebimento nao foi configurada.',
        });
    }
    if (/\s/.test(cleaned)) {
        // A chave nunca entra na mensagem tecnica: ela pode ser um CPF/CNPJ e o
        // handler central de erros grava `message` no log e na tabela de erros.
        throw new errors_1.ValidationError('Chave PIX contem espacos.', {
            userMessage: 'A chave PIX configurada e invalida (contem espacos).',
        });
    }
    if (NON_ASCII_PRINTABLE.test(cleaned)) {
        throw new errors_1.ValidationError('Chave PIX com caractere fora do ASCII imprimivel.', {
            userMessage: 'A chave PIX configurada usa caracteres (acentos, emojis) que o padrao PIX nao aceita.',
        });
    }
    if (cleaned.length > PIX_KEY_MAX_LENGTH) {
        throw new errors_1.ValidationError(`Chave PIX muito longa: ${cleaned.length} caracteres`, {
            userMessage: `A chave PIX pode ter no maximo ${PIX_KEY_MAX_LENGTH} caracteres.`,
        });
    }
    return cleaned;
}
/** Normaliza o txid do subcampo 62-05. Sem txid o padrao exige "***". */
function normalizeTxid(txid) {
    if (txid === undefined)
        return TXID_ABSENT;
    const cleaned = (0, sanitize_1.stripUnsafeChars)(txid).trim();
    if (cleaned.length === 0)
        return TXID_ABSENT;
    if (!/^[A-Za-z0-9]+$/.test(cleaned)) {
        throw new errors_1.ValidationError(`txid com caracteres invalidos: "${cleaned}"`, {
            userMessage: 'O identificador da cobranca deve conter apenas letras e numeros.',
        });
    }
    if (cleaned.length > limits_1.BUSINESS_LIMITS.PIX_TXID_MAX) {
        throw new errors_1.ValidationError(`txid muito longo: ${cleaned.length} caracteres`, {
            userMessage: `O identificador da cobranca pode ter no maximo ${limits_1.BUSINESS_LIMITS.PIX_TXID_MAX} caracteres.`,
        });
    }
    return cleaned;
}
/**
 * Monta o campo 26 (Merchant Account Information).
 * A descricao (26-02) so entra se couber no limite de 99 caracteres do campo.
 */
function buildMerchantAccountInfo(pixKey, description) {
    let info = emvField('00', PIX_GUI) + emvField('01', pixKey);
    if (description !== undefined) {
        // Sobra do campo 26 descontando o cabecalho TLV (4 chars) do subcampo 02.
        const budget = MAX_TLV_VALUE_LENGTH - info.length - 4;
        if (budget > 0) {
            const limit = Math.min(budget, limits_1.BUSINESS_LIMITS.PAYMENT_DESCRIPTION_MAX);
            const text = normalizePixText(description, limit);
            if (text.length > 0) {
                info += emvField('02', text);
            }
        }
    }
    return info;
}
/**
 * Monta o BR Code completo e valido, pronto para copia e cola ou QR Code.
 */
function buildPixPayload(input) {
    const { amountCents } = input;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new errors_1.ValidationError(`Valor invalido para cobranca PIX: ${amountCents}`, {
            userMessage: 'O valor da cobranca precisa ser maior que zero.',
        });
    }
    if (amountCents > limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS) {
        throw new errors_1.ValidationError(`Valor acima do teto permitido: ${amountCents}`, {
            userMessage: `O valor maximo permitido e ${(0, money_1.formatCents)(limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS)}.`,
        });
    }
    const pixKey = normalizePixKey(input.pixKey);
    // Exigir alfanumerico (e nao apenas "nao vazio"): "..." e "---" sobrevivem
    // ao conjunto branco de normalizePixText e virariam nome/cidade sem sentido.
    const receiverName = normalizePixText(input.receiverName, limits_1.BUSINESS_LIMITS.PIX_RECEIVER_NAME_MAX);
    if (!HAS_ALPHANUMERIC.test(receiverName)) {
        throw new errors_1.ValidationError(`Nome do recebedor invalido: "${input.receiverName}"`, {
            userMessage: 'O nome do recebedor da conta PIX e invalido ou esta vazio.',
        });
    }
    const city = normalizePixText(input.city, limits_1.BUSINESS_LIMITS.PIX_CITY_MAX);
    if (!HAS_ALPHANUMERIC.test(city)) {
        throw new errors_1.ValidationError(`Cidade do recebedor invalida: "${input.city}"`, {
            userMessage: 'A cidade do recebedor da conta PIX e invalida ou esta vazia.',
        });
    }
    const txid = normalizeTxid(input.txid);
    const body = emvField('00', '01') +
        emvField('01', '12') +
        emvField('26', buildMerchantAccountInfo(pixKey, input.description)) +
        emvField('52', '0000') +
        emvField('53', '986') +
        emvField('54', formatPixAmount(amountCents)) +
        emvField('58', 'BR') +
        emvField('59', receiverName) +
        emvField('60', city) +
        emvField('62', emvField('05', txid));
    // O CRC cobre o payload inteiro INCLUINDO o prefixo "6304".
    const withCrcPrefix = `${body}6304`;
    const payload = `${withCrcPrefix}${crc16ccitt(withCrcPrefix)}`;
    logger.debug('Payload PIX gerado', {
        amountCents,
        txid,
        payloadLength: payload.length,
    });
    return payload;
}
//# sourceMappingURL=PixPayloadService.js.map