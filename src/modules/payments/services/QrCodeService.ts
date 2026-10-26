import { AttachmentBuilder } from 'discord.js';
import { toBuffer } from 'qrcode';

import { AppError, ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { sanitizeFilename } from '../../../utils/sanitize';
import { buildTemplatedQrPng } from './QrTemplateService';

/**
 * Geracao do QR Code do PIX.
 *
 * O QR Code SEMPRE codifica exatamente o payload BR Code recebido — nenhum
 * texto derivado, encurtado ou reescrito. Todo o trabalho acontece em memoria
 * (Buffer); nenhum arquivo temporario e gravado em disco.
 */

const logger = createLogger('QrCodeService');

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
function ensurePngExtension(filename: string): string {
  const sanitized = sanitizeFilename(filename, QR_FALLBACK_FILENAME);
  const base = sanitized
    .replace(/\.png$/i, '')
    .slice(0, QR_FILENAME_BASE_MAX)
    .replace(/[.-]+$/, '');

  return `${base.length > 0 ? base : QR_FALLBACK_FILENAME}.png`;
}

/**
 * Gera o PNG do QR Code em memoria a partir do payload BR Code.
 */
export async function generateQrCodePngBuffer(payload: string): Promise<Buffer> {
  const content = String(payload ?? '');

  if (content.length === 0) {
    throw new ValidationError('Payload PIX vazio para geracao de QR Code.', {
      userMessage: 'Nao foi possivel gerar o QR Code desta cobranca.',
    });
  }

  try {
    const buffer = await toBuffer(content, {
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
  } catch (error) {
    logger.error('Falha ao gerar QR Code PIX', error, { payloadLength: content.length });
    throw new AppError('Falha ao gerar o PNG do QR Code PIX.', {
      code: 'QRCODE_GENERATION_FAILED',
      userMessage: 'Nao foi possivel gerar o QR Code desta cobranca. Tente novamente.',
      cause: error,
    });
  }
}

/** Conta cuja arte personalizada deve ser usada, quando existir. */
export interface QrTemplateTarget {
  guildId: string;
  accountIdentifier: string;
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
export async function buildQrCodeAttachment(
  payload: string,
  filename: string,
  template?: QrTemplateTarget,
): Promise<AttachmentBuilder> {
  const name = ensurePngExtension(filename);

  if (template !== undefined) {
    const composed = await buildTemplatedQrPng({
      guildId: template.guildId,
      accountIdentifier: template.accountIdentifier,
      payload,
    });
    if (composed !== null) return new AttachmentBuilder(composed, { name });
  }

  const buffer = await generateQrCodePngBuffer(payload);
  return new AttachmentBuilder(buffer, { name });
}
