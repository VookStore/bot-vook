"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateQrCodePngBuffer = generateQrCodePngBuffer;
exports.buildQrCodeAttachment = buildQrCodeAttachment;
const discord_js_1 = require("discord.js");
const qrcode_1 = require("qrcode");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const sanitize_1 = require("../../../utils/sanitize");
const QrTemplateService_1 = require("./QrTemplateService");
/**
 * Geracao do QR Code do PIX.
 *
 * O QR Code SEMPRE codifica exatamente o payload BR Code recebido — nenhum
 * texto derivado, encurtado ou reescrito. Todo o trabalho acontece em memoria
 * (Buffer); nenhum arquivo temporario e gravado em disco.
 */
const logger = (0, Logger_1.createLogger)('QrCodeService');
/** Lado da imagem PNG gerada, em pixels. */
const QR_WIDTH_PX = 512;
/** Zona silenciosa (quiet zone) em modulos. */
const QR_MARGIN = 2;
/** Nivel de correcao de erro: 'M' equilibra tamanho e tolerancia a sujeira. */
const QR_ERROR_CORRECTION = 'M';
/** Nome usado quando o solicitado fica vazio apos a sanitizacao. */
const QR_FALLBACK_FILENAME = 'qrcode-pix';
/** Reserva espaco para o sufixo ".png" dentro do limite de nome de arquivo. */
const QR_FILENAME_BASE_MAX = 116;
/** Garante que o nome termine em .png sem duplicar a extensao. */
function ensurePngExtension(filename) {
    const sanitized = (0, sanitize_1.sanitizeFilename)(filename, QR_FALLBACK_FILENAME);
    const base = sanitized
        .replace(/\.png$/i, '')
        .slice(0, QR_FILENAME_BASE_MAX)
        .replace(/[.-]+$/, '');
    return `${base.length > 0 ? base : QR_FALLBACK_FILENAME}.png`;
}
/**
 * Gera o PNG do QR Code em memoria a partir do payload BR Code.
 */
async function generateQrCodePngBuffer(payload) {
    const content = String(payload ?? '');
    if (content.length === 0) {
        throw new errors_1.ValidationError('Payload PIX vazio para geracao de QR Code.', {
            userMessage: 'Nao foi possivel gerar o QR Code desta cobranca.',
        });
    }
    try {
        const buffer = await (0, qrcode_1.toBuffer)(content, {
            type: 'png',
            width: QR_WIDTH_PX,
            margin: QR_MARGIN,
            errorCorrectionLevel: QR_ERROR_CORRECTION,
        });
        logger.debug('QR Code PIX gerado', {
            payloadLength: content.length,
            bytes: buffer.length,
        });
        return buffer;
    }
    catch (error) {
        logger.error('Falha ao gerar QR Code PIX', error, { payloadLength: content.length });
        throw new errors_1.AppError('Falha ao gerar o PNG do QR Code PIX.', {
            code: 'QRCODE_GENERATION_FAILED',
            userMessage: 'Nao foi possivel gerar o QR Code desta cobranca. Tente novamente.',
            cause: error,
        });
    }
}
/**
 * Gera o QR Code e devolve um anexo pronto para o Discord.
 * O nome do arquivo e sanitizado (sem path traversal) e sempre termina em .png,
 * permitindo referencia-lo via `attachment://<nome>` em embeds/componentes.
 *
 * Quando a conta tem arte cadastrada (`assets/pix/<guildId>/<identificador>.png`),
 * o QR e desenhado dentro dela. A arte e ESTETICA: se ela nao existir, nao for
 * legivel ou nao couber, o retorno e o QR simples — a cobranca nunca depende do
 * enfeite para ser entregue.
 */
async function buildQrCodeAttachment(payload, filename, template) {
    const name = ensurePngExtension(filename);
    if (template !== undefined) {
        const composed = await (0, QrTemplateService_1.buildTemplatedQrPng)({
            guildId: template.guildId,
            accountIdentifier: template.accountIdentifier,
            payload,
        });
        if (composed !== null)
            return new discord_js_1.AttachmentBuilder(composed, { name });
    }
    const buffer = await generateQrCodePngBuffer(payload);
    return new discord_js_1.AttachmentBuilder(buffer, { name });
}
//# sourceMappingURL=QrCodeService.js.map