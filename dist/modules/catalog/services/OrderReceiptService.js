"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitReceipt = submitReceipt;
exports.getLatestReceipt = getLatestReceipt;
exports.isAwaitingReview = isAwaitingReview;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const reply_1 = require("../../../components/reply");
const limits_1 = require("../../../constants/limits");
const LockService_1 = require("../../../core/locks/LockService");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const download_1 = require("../../../utils/download");
const sanitize_1 = require("../../../utils/sanitize");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const PaymentAccountService_1 = require("../../payments/services/PaymentAccountService");
const ReceiptBuilders_1 = require("../builders/ReceiptBuilders");
const OrderReceiptRepository_1 = require("../repositories/OrderReceiptRepository");
const ReceiptOcrService_1 = require("./ReceiptOcrService");
const OrderService_1 = require("./OrderService");
const receiptParser_1 = require("../validators/receiptParser");
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
const logger = (0, Logger_1.createLogger)('order:receipt');
/** Tipos aceitos. PDF entra, mas nao passa por OCR. */
const ACCEPTED_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'application/pdf',
]);
/**
 * Registra o comprovante e entrega para a equipe conferir.
 *
 * Sequencia: dono do pedido -> estado do pedido -> arquivo -> anti-abuso ->
 * download -> OCR -> conferencia -> republicacao para a equipe -> persistencia.
 */
async function submitReceipt(params) {
    const guildId = params.guild.id;
    // O id do pedido vem do comando; `requireCustomerOrder` confere que ele e de
    // quem esta enviando. Ninguem anexa comprovante no pedido alheio.
    const order = await (0, OrderService_1.requireCustomerOrder)(guildId, params.customerId, params.orderId);
    assertOrderAcceptsReceipt(order);
    const contentType = normalizeContentType(params.attachment);
    assertAcceptedFile(params.attachment, contentType);
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.ORDER_ACTION, `receipt:${order.id}`, async () => {
        await assertNotFlooding(guildId, params.customerId, order.id);
        const download = await (0, download_1.downloadDiscordAttachment)(params.attachment.url, limits_1.BUSINESS_LIMITS.RECEIPT_MAX_BYTES);
        const analysis = await analyzeReceipt(guildId, order, download.bytes, contentType);
        const fileName = (0, sanitize_1.sanitizeFilename)(params.attachment.name, 'comprovante');
        const delivery = await deliverToStaff({
            guild: params.guild,
            order,
            analysis,
            uploadedById: params.customerId,
            bytes: download.bytes,
            fileName,
            contentType,
        });
        const receipt = await (0, OrderReceiptRepository_1.createOrderReceipt)({
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
        LockService_1.cooldowns.mark(LockService_1.COOLDOWN_NAMESPACE.RECEIPT_UPLOAD, `${guildId}:${params.customerId}`);
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
    }, { userMessage: 'Seu comprovante ja esta sendo processado. Aguarde alguns segundos.' });
}
/**
 * Comprovante so faz sentido com cobranca emitida e ainda nao confirmada.
 * Pedido ja pago responde "ja esta confirmado" em vez de aceitar arquivo inutil.
 */
function assertOrderAcceptsReceipt(order) {
    if (order.status === client_1.OrderStatus.PENDING) {
        throw new errors_1.ValidationError(`Pedido sem cobranca: ${order.id}`, {
            userMessage: 'Este pedido ainda nao tem cobranca gerada. Aguarde a equipe enviar o PIX antes de mandar o comprovante.',
        });
    }
    if (order.status !== client_1.OrderStatus.AWAITING_PAYMENT) {
        throw new errors_1.ValidationError(`Pedido nao aguarda pagamento: ${order.status}`, {
            userMessage: order.status === client_1.OrderStatus.CANCELLED
                ? 'Este pedido foi cancelado.'
                : 'Este pedido ja teve o pagamento confirmado. Nao e preciso enviar comprovante.',
        });
    }
}
function normalizeContentType(attachment) {
    const raw = (attachment.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (raw.length > 0)
        return raw;
    // Discord as vezes omite o content-type; cai para a extensao do nome.
    const name = attachment.name.toLowerCase();
    if (name.endsWith('.png'))
        return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg'))
        return 'image/jpeg';
    if (name.endsWith('.webp'))
        return 'image/webp';
    if (name.endsWith('.pdf'))
        return 'application/pdf';
    return raw;
}
function assertAcceptedFile(attachment, contentType) {
    if (!ACCEPTED_TYPES.has(contentType)) {
        throw new errors_1.ValidationError(`Tipo de comprovante recusado: ${contentType || 'desconhecido'}`, {
            userMessage: 'Envie o comprovante como imagem (PNG, JPG ou WEBP) ou PDF.',
        });
    }
    if (attachment.size > limits_1.BUSINESS_LIMITS.RECEIPT_MAX_BYTES) {
        throw new errors_1.ValidationError(`Comprovante grande demais: ${attachment.size}`, {
            userMessage: 'Arquivo grande demais. Envie um comprovante de ate 8 MB.',
        });
    }
}
/**
 * Anti-abuso: sem isso um cliente irritado despeja dezenas de imagens no canal
 * interno da equipe, e cada uma custa um OCR.
 */
async function assertNotFlooding(guildId, customerId, orderId) {
    const remaining = LockService_1.cooldowns.remainingSeconds(LockService_1.COOLDOWN_NAMESPACE.RECEIPT_UPLOAD, `${guildId}:${customerId}`, limits_1.BUSINESS_LIMITS.RECEIPT_COOLDOWN_SECONDS);
    if (remaining > 0) {
        throw new errors_1.RateLimitError(remaining, {
            userMessage: `Aguarde ${remaining} segundo(s) antes de enviar outro comprovante.`,
        });
    }
    const total = await (0, OrderReceiptRepository_1.countOrderReceipts)(orderId);
    if (total >= limits_1.BUSINESS_LIMITS.MAX_RECEIPTS_PER_ORDER) {
        throw new errors_1.ValidationError(`Limite de comprovantes atingido: ${total}`, {
            userMessage: 'Voce ja enviou comprovantes demais para este pedido. Fale com a equipe da loja.',
        });
    }
}
/** OCR + conferencia contra a cobranca. Nunca lanca: falha vira "ilegivel". */
async function analyzeReceipt(guildId, order, bytes, contentType) {
    if (!(0, ReceiptOcrService_1.canReadWithOcr)(contentType)) {
        return (0, receiptParser_1.skippedAnalysis)('PDF nao e lido automaticamente. Confira o arquivo manualmente.');
    }
    const payment = order.payment;
    if (payment === null) {
        return (0, receiptParser_1.skippedAnalysis)('Pedido sem cobranca vinculada para comparar.');
    }
    const account = await (0, PaymentAccountService_1.getAccountById)(guildId, payment.accountId).catch(() => null);
    if (account === null) {
        return (0, receiptParser_1.skippedAnalysis)('Conta PIX da cobranca nao encontrada para comparar.');
    }
    const text = await (0, ReceiptOcrService_1.readReceiptText)(bytes);
    if (text === null) {
        return (0, receiptParser_1.skippedAnalysis)('O OCR falhou neste arquivo. Confira manualmente.');
    }
    return (0, receiptParser_1.analyzeReceiptText)(text, {
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
async function deliverToStaff(params) {
    const channel = await resolveStaffChannel(params.guild, params.order);
    if (channel === null) {
        logger.warn('Comprovante sem canal da equipe para publicar.', {
            guildId: params.guild.id,
            entityType: 'order',
            entityId: params.order.id,
        });
        return { url: null };
    }
    const isImage = (0, ReceiptOcrService_1.canReadWithOcr)(params.contentType);
    const attachment = new discord_js_1.AttachmentBuilder(params.bytes, { name: params.fileName });
    try {
        const message = await (0, reply_1.sendV2)(channel, (0, ReceiptBuilders_1.buildReceiptStaffNotice)({
            order: params.order,
            payment: params.order.payment,
            analysis: params.analysis,
            uploadedById: params.uploadedById,
            fileName: params.fileName,
            ...(isImage ? { imageFilename: params.fileName } : {}),
        }), { files: [attachment] });
        return { url: (0, discord_1.messageUrl)(params.guild.id, channel.id, message.id) };
    }
    catch (error) {
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
async function resolveStaffChannel(guild, order) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    for (const candidate of [config.orderChannelId, order.payment?.channelId ?? null]) {
        if (candidate === null)
            continue;
        const channel = await (0, discord_1.fetchChannelSafe)(guild, candidate);
        // O segundo candidato e o proprio atendimento, que hoje e um TOPICO:
        // com o guard antigo esse fallback nunca acertava e o aviso so saia quando
        // havia canal de pedidos configurado.
        if ((0, discord_1.isSendableConversation)(channel))
            return channel;
    }
    return null;
}
function summarizeChecks(analysis) {
    return analysis.checks.map((check) => `${check.label}: ${check.status}`).join(' | ');
}
/** Ultimo comprovante do pedido (usado no painel do cliente). */
async function getLatestReceipt(orderId) {
    return (0, OrderReceiptRepository_1.findLatestReceipt)(orderId);
}
/** True quando ha comprovante aguardando conferencia da equipe. */
function isAwaitingReview(receipt) {
    return receipt !== null && receipt.checkStatus !== client_1.ReceiptCheckStatus.SKIPPED;
}
//# sourceMappingURL=OrderReceiptService.js.map