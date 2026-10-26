import { AttachmentBuilder, type Guild } from 'discord.js';
import { OrderStatus, ReceiptCheckStatus, type OrderReceipt } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { BUSINESS_LIMITS } from '../../../constants/limits';
import { COOLDOWN_NAMESPACE, LOCK_NAMESPACE, cooldowns, locks } from '../../../core/locks/LockService';
import { RateLimitError, ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import {
  fetchChannelSafe,
  isSendableConversation,
  messageUrl,
  type SendableConversation,
} from '../../../utils/discord';
import { downloadDiscordAttachment } from '../../../utils/download';
import { sanitizeFilename } from '../../../utils/sanitize';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { getAccountById } from '../../payments/services/PaymentAccountService';
import { buildReceiptStaffNotice } from '../builders/ReceiptBuilders';
import {
  countOrderReceipts,
  createOrderReceipt,
  findLatestReceipt,
} from '../repositories/OrderReceiptRepository';
import { canReadWithOcr, readReceiptText } from './ReceiptOcrService';
import { requireCustomerOrder } from './OrderService';
import {
  analyzeReceiptText,
  skippedAnalysis,
  type ReceiptAnalysis,
} from '../validators/receiptParser';
import type { OrderWithItemsAndPayment } from '../repositories/OrderRepository';

/**
 * Recepcao do comprovante enviado pelo cliente.
 *
 * REGRA CENTRAL: comprovante NAO aprova pagamento.
 *
 * A imagem e evidencia e nada mais — comprovante PIX se falsifica em minutos, e
 * geradores de comprovante falso sao um clique no Google. Este servico recebe o
 * arquivo, confere o que da para conferir por OCR e entrega tudo mastigado ao
 * vendedor. Quem confirma o recebimento continua sendo uma pessoa, pelo mesmo
 * `approvePayment` de sempre.
 *
 * Sem esse limite, um comprovante forjado viraria produto entregue
 * automaticamente, 24 horas por dia, sem ninguem olhar.
 */

const logger = createLogger('order:receipt');

/** Tipos aceitos. PDF entra, mas nao passa por OCR. */
const ACCEPTED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
]);

export interface ReceiptAttachment {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
}

export interface SubmitReceiptParams {
  guild: Guild;
  customerId: string;
  orderId: string;
  attachment: ReceiptAttachment;
}

export interface SubmitReceiptResult {
  order: OrderWithItemsAndPayment;
  receipt: OrderReceipt;
  analysis: ReceiptAnalysis;
  /** False quando nao havia canal da equipe para publicar o comprovante. */
  deliveredToStaff: boolean;
}

/**
 * Registra o comprovante e entrega para a equipe conferir.
 *
 * Sequencia: dono do pedido -> estado do pedido -> arquivo -> anti-abuso ->
 * download -> OCR -> conferencia -> republicacao para a equipe -> persistencia.
 */
export async function submitReceipt(params: SubmitReceiptParams): Promise<SubmitReceiptResult> {
  const guildId = params.guild.id;

  // O id do pedido vem do comando; `requireCustomerOrder` confere que ele e de
  // quem esta enviando. Ninguem anexa comprovante no pedido alheio.
  const order = await requireCustomerOrder(guildId, params.customerId, params.orderId);

  assertOrderAcceptsReceipt(order);
  const contentType = normalizeContentType(params.attachment);
  assertAcceptedFile(params.attachment, contentType);

  return locks.withLock(
    LOCK_NAMESPACE.ORDER_ACTION,
    `receipt:${order.id}`,
    async () => {
      await assertNotFlooding(guildId, params.customerId, order.id);

      const download = await downloadDiscordAttachment(
        params.attachment.url,
        BUSINESS_LIMITS.RECEIPT_MAX_BYTES,
      );

      const analysis = await analyzeReceipt(guildId, order, download.bytes, contentType);

      const fileName = sanitizeFilename(params.attachment.name, 'comprovante');
      const delivery = await deliverToStaff({
        guild: params.guild,
        order,
        analysis,
        uploadedById: params.customerId,
        bytes: download.bytes,
        fileName,
        contentType,
      });

      const receipt = await createOrderReceipt({
        guildId,
        orderId: order.id,
        paymentId: order.paymentId,
        uploadedById: params.customerId,
        fileName,
        contentType,
        // URL da mensagem do BOT: o anexo original do cliente tem link assinado
        // que expira, e um comprovante que some nao serve de evidencia.
        fileUrl: delivery.url ?? params.attachment.url,
        checkStatus: analysis.status,
        detectedAmount: analysis.amountCents,
        detectedDate: analysis.paidAt,
        checkNotes: summarizeChecks(analysis),
      });

      cooldowns.mark(COOLDOWN_NAMESPACE.RECEIPT_UPLOAD, `${guildId}:${params.customerId}`);

      logger.info('Comprovante recebido.', {
        guildId,
        userId: params.customerId,
        entityType: 'order',
        entityId: order.id,
        orderNumber: order.orderNumber,
        checkStatus: analysis.status,
        deliveredToStaff: delivery.url !== null,
      });

      return { order, receipt, analysis, deliveredToStaff: delivery.url !== null };
    },
    { userMessage: 'Seu comprovante ja esta sendo processado. Aguarde alguns segundos.' },
  );
}

/**
 * Comprovante so faz sentido com cobranca emitida e ainda nao confirmada.
 * Pedido ja pago responde "ja esta confirmado" em vez de aceitar arquivo inutil.
 */
function assertOrderAcceptsReceipt(order: OrderWithItemsAndPayment): void {
  if (order.status === OrderStatus.PENDING) {
    throw new ValidationError(`Pedido sem cobranca: ${order.id}`, {
      userMessage:
        'Este pedido ainda nao tem cobranca gerada. Aguarde a equipe enviar o PIX antes de mandar o comprovante.',
    });
  }
  if (order.status !== OrderStatus.AWAITING_PAYMENT) {
    throw new ValidationError(`Pedido nao aguarda pagamento: ${order.status}`, {
      userMessage:
        order.status === OrderStatus.CANCELLED
          ? 'Este pedido foi cancelado.'
          : 'Este pedido ja teve o pagamento confirmado. Nao e preciso enviar comprovante.',
    });
  }
}

function normalizeContentType(attachment: ReceiptAttachment): string {
  const raw = (attachment.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (raw.length > 0) return raw;

  // Discord as vezes omite o content-type; cai para a extensao do nome.
  const name = attachment.name.toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return raw;
}

function assertAcceptedFile(attachment: ReceiptAttachment, contentType: string): void {
  if (!ACCEPTED_TYPES.has(contentType)) {
    throw new ValidationError(`Tipo de comprovante recusado: ${contentType || 'desconhecido'}`, {
      userMessage: 'Envie o comprovante como imagem (PNG, JPG ou WEBP) ou PDF.',
    });
  }
  if (attachment.size > BUSINESS_LIMITS.RECEIPT_MAX_BYTES) {
    throw new ValidationError(`Comprovante grande demais: ${attachment.size}`, {
      userMessage: 'Arquivo grande demais. Envie um comprovante de ate 8 MB.',
    });
  }
}

/**
 * Anti-abuso: sem isso um cliente irritado despeja dezenas de imagens no canal
 * interno da equipe, e cada uma custa um OCR.
 */
async function assertNotFlooding(
  guildId: string,
  customerId: string,
  orderId: string,
): Promise<void> {
  const remaining = cooldowns.remainingSeconds(
    COOLDOWN_NAMESPACE.RECEIPT_UPLOAD,
    `${guildId}:${customerId}`,
    BUSINESS_LIMITS.RECEIPT_COOLDOWN_SECONDS,
  );
  if (remaining > 0) {
    throw new RateLimitError(remaining, {
      userMessage: `Aguarde ${remaining} segundo(s) antes de enviar outro comprovante.`,
    });
  }

  const total = await countOrderReceipts(orderId);
  if (total >= BUSINESS_LIMITS.MAX_RECEIPTS_PER_ORDER) {
    throw new ValidationError(`Limite de comprovantes atingido: ${total}`, {
      userMessage:
        'Voce ja enviou comprovantes demais para este pedido. Fale com a equipe da loja.',
    });
  }
}

/** OCR + conferencia contra a cobranca. Nunca lanca: falha vira "ilegivel". */
async function analyzeReceipt(
  guildId: string,
  order: OrderWithItemsAndPayment,
  bytes: Buffer,
  contentType: string,
): Promise<ReceiptAnalysis> {
  if (!canReadWithOcr(contentType)) {
    return skippedAnalysis('PDF nao e lido automaticamente. Confira o arquivo manualmente.');
  }

  const payment = order.payment;
  if (payment === null) {
    return skippedAnalysis('Pedido sem cobranca vinculada para comparar.');
  }

  const account = await getAccountById(guildId, payment.accountId).catch(() => null);
  if (account === null) {
    return skippedAnalysis('Conta PIX da cobranca nao encontrada para comparar.');
  }

  const text = await readReceiptText(bytes);
  if (text === null) {
    return skippedAnalysis('O OCR falhou neste arquivo. Confira manualmente.');
  }

  return analyzeReceiptText(text, {
    amountCents: payment.finalAmount,
    chargedAt: payment.createdAt,
    receiverName: account.receiverName,
    pixKey: account.pixKey,
  });
}

/**
 * Republica o comprovante num canal da equipe.
 *
 * Preferencia: canal de pedidos; senao, o canal onde o cartao da cobranca foi
 * publicado (e la que o vendedor esta). Sem nenhum dos dois, o comprovante
 * ainda e gravado — some do radar imediato, mas nao se perde: aparece no painel
 * do pedido.
 */
async function deliverToStaff(params: {
  guild: Guild;
  order: OrderWithItemsAndPayment;
  analysis: ReceiptAnalysis;
  uploadedById: string;
  bytes: Buffer;
  fileName: string;
  contentType: string;
}): Promise<{ url: string | null }> {
  const channel = await resolveStaffChannel(params.guild, params.order);
  if (channel === null) {
    logger.warn('Comprovante sem canal da equipe para publicar.', {
      guildId: params.guild.id,
      entityType: 'order',
      entityId: params.order.id,
    });
    return { url: null };
  }

  const isImage = canReadWithOcr(params.contentType);
  const attachment = new AttachmentBuilder(params.bytes, { name: params.fileName });

  try {
    const message = await sendV2(
      channel,
      buildReceiptStaffNotice({
        order: params.order,
        payment: params.order.payment,
        analysis: params.analysis,
        uploadedById: params.uploadedById,
        fileName: params.fileName,
        ...(isImage ? { imageFilename: params.fileName } : {}),
      }),
      { files: [attachment] },
    );

    return { url: messageUrl(params.guild.id, channel.id, message.id) };
  } catch (error) {
    logger.warn('Falha ao publicar o comprovante para a equipe.', {
      guildId: params.guild.id,
      channelId: channel.id,
      entityType: 'order',
      entityId: params.order.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { url: null };
  }
}

async function resolveStaffChannel(
  guild: Guild,
  order: OrderWithItemsAndPayment,
): Promise<SendableConversation | null> {
  const config = await getGuildConfig(guild.id);

  for (const candidate of [config.orderChannelId, order.payment?.channelId ?? null]) {
    if (candidate === null) continue;
    const channel = await fetchChannelSafe(guild, candidate);
    // O segundo candidato e o proprio atendimento, que hoje e um TOPICO:
    // com o guard antigo esse fallback nunca acertava e o aviso so saia quando
    // havia canal de pedidos configurado.
    if (isSendableConversation(channel)) return channel;
  }
  return null;
}

function summarizeChecks(analysis: ReceiptAnalysis): string {
  return analysis.checks.map((check) => `${check.label}: ${check.status}`).join(' | ');
}

/** Ultimo comprovante do pedido (usado no painel do cliente). */
export async function getLatestReceipt(orderId: string): Promise<OrderReceipt | null> {
  return findLatestReceipt(orderId);
}

/** True quando ha comprovante aguardando conferencia da equipe. */
export function isAwaitingReview(receipt: OrderReceipt | null): boolean {
  return receipt !== null && receipt.checkStatus !== ReceiptCheckStatus.SKIPPED;
}
