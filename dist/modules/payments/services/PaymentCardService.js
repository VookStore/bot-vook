"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOrderLabelResolver = registerOrderLabelResolver;
exports.resetOrderLabelResolver = resetOrderLabelResolver;
exports.buildQrFilename = buildQrFilename;
exports.resolvePixReceiver = resolvePixReceiver;
exports.buildPaymentQr = buildPaymentQr;
exports.publishPaymentCard = publishPaymentCard;
exports.refreshPaymentCard = refreshPaymentCard;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const reply_1 = require("../../../components/reply");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const PaymentBuilders_1 = require("../builders/PaymentBuilders");
const PaymentRepository_1 = require("../repositories/PaymentRepository");
const PaymentAccountService_1 = require("./PaymentAccountService");
const QrCodeService_1 = require("./QrCodeService");
/**
 * Publicacao e atualizacao do cartao de cobranca.
 *
 * O QR Code SEMPRE e gerado a partir do `pixPayload` salvo no banco, entao
 * nunca existe QR antigo apontando para um valor diferente do total atual.
 */
const logger = (0, Logger_1.createLogger)('payment:card');
let resolveOrderLabel = null;
function registerOrderLabelResolver(resolver) {
    resolveOrderLabel = resolver;
}
/** Somente para testes. */
function resetOrderLabelResolver() {
    resolveOrderLabel = null;
}
async function orderLabelFor(payment) {
    if (resolveOrderLabel === null)
        return undefined;
    const label = await resolveOrderLabel(payment).catch((error) => {
        logger.warn('Nao foi possivel resolver o pedido da cobranca para o cartao.', {
            guildId: payment.guildId,
            entityType: 'payment',
            entityId: payment.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    });
    return label ?? undefined;
}
function buildQrFilename(paymentId) {
    return (0, sanitize_1.sanitizeFilename)(`pix-${paymentId.slice(0, 12)}.png`, 'pix.png');
}
/**
 * Conta que recebe esta cobranca.
 *
 * Falha de leitura devolve `null` em vez de propagar: tudo que depende daqui e
 * apresentacao (a arte do QR, a chave em texto), e cobranca nao pode deixar de
 * ser publicada porque um enfeite nao carregou. A consulta atravessa o cache de
 * contas do `PaymentAccountService`, entao chamar duas vezes no mesmo cartao
 * nao custa duas idas ao banco.
 */
async function accountOf(payment) {
    return (0, PaymentAccountService_1.getAccountById)(payment.guildId, payment.accountId).catch(() => null);
}
/**
 * Alvo da arte personalizada desta cobranca.
 *
 * A arte e da CONTA (traz nome, chave e banco impressos), entao ela e resolvida
 * pela conta que realmente vai receber — nunca por uma arte "da loja". Com
 * varias contas cadastradas, usar a arte errada mostraria ao cliente um titular
 * diferente de quem recebe o dinheiro.
 *
 * Conta ausente apenas desliga a arte: o QR simples continua valendo.
 */
async function resolveTemplateTarget(payment) {
    const account = await accountOf(payment);
    if (account === null)
        return undefined;
    return { guildId: payment.guildId, accountIdentifier: account.identifier };
}
/**
 * Chave e titular impressos em texto no cartao.
 *
 * Saem da MESMA conta que gerou o payload, pelo mesmo motivo da arte: com varias
 * contas cadastradas, mostrar a chave de outra mandaria o cliente pagar para
 * quem nao esta cobrando.
 *
 * Antes isso so existia se a loja tivesse desenhado a chave na arte do QR — uma
 * imagem, que nao da para copiar. Agora vem do banco de dados, entao vale
 * tambem para quem nunca cadastrou arte nenhuma.
 *
 * Conta ausente apenas omite a linha: QR e copia e cola continuam de pe.
 *
 * EXPORTADA pelo mesmo motivo de `buildPaymentQr`: o copia e cola aparece
 * tambem na DM da cobranca e em `/meus-pedidos`, e as tres telas precisam ler a
 * chave da mesma conta.
 */
async function resolvePixReceiver(payment) {
    const account = await accountOf(payment);
    if (account === null)
        return undefined;
    return {
        key: account.pixKey,
        keyType: account.pixKeyType,
        holder: account.receiverName,
    };
}
/**
 * QR desta cobranca, ja com a arte da conta quando ela existir.
 *
 * Exportado porque o QR aparece em mais de um lugar: o cartao publicado no
 * canal, a DM de cobranca e o painel do pedido do cliente. Todos precisam sair
 * do MESMO `pixPayload` salvo no banco — nunca de um payload recalculado.
 */
async function buildPaymentQr(payment) {
    const filename = buildQrFilename(payment.id);
    const attachment = await (0, QrCodeService_1.buildQrCodeAttachment)(payment.pixPayload, filename, await resolveTemplateTarget(payment));
    return { attachment, filename };
}
/** Publica o cartao no canal e memoriza a mensagem. */
async function publishPaymentCard(channel, payment) {
    const { attachment, filename } = await buildPaymentQr(payment);
    const orderLabel = await orderLabelFor(payment);
    const receiver = await resolvePixReceiver(payment);
    const message = await (0, reply_1.sendV2)(channel, (0, PaymentBuilders_1.buildPaymentCard)(payment, {
        qrFilename: filename,
        ...(orderLabel !== undefined ? { orderLabel } : {}),
        ...(receiver !== undefined ? { receiver } : {}),
    }), {
        files: [attachment],
        allowedMentions: (0, discord_1.mentionOnly)(payment.customerId),
    });
    await (0, PaymentRepository_1.setPaymentMessage)(payment.id, channel.id, message.id);
    return message;
}
/**
 * Reescreve o cartao ja publicado.
 * Retorna false (sem lancar) quando canal/mensagem nao existem mais.
 */
async function refreshPaymentCard(guild, payment) {
    if (payment.channelId === null || payment.messageId === null)
        return false;
    /*
     * Aceita TOPICO. O cartao vive dentro do atendimento, que virou topico
     * privado — com o guard antigo esta funcao devolvia `false` em silencio e o
     * cartao nunca era reescrito: aprovar ou cancelar deixava o cliente olhando
     * um PIX pendente que ja nao existia.
     */
    const channel = await (0, discord_1.fetchChannelSafe)(guild, payment.channelId);
    if (!(0, discord_1.isSendableConversation)(channel))
        return false;
    try {
        const message = await channel.messages.fetch(payment.messageId);
        const orderLabel = await orderLabelFor(payment);
        const label = orderLabel !== undefined ? { orderLabel } : {};
        // Cobranca encerrada nao precisa mais de QR: remove o anexo antigo.
        if (payment.status !== client_1.PaymentStatus.PENDING) {
            await message.edit({
                components: [(0, PaymentBuilders_1.buildPaymentCard)(payment, label)],
                flags: discord_js_1.MessageFlags.IsComponentsV2,
                attachments: [],
                allowedMentions: discord_1.NO_MENTIONS,
            });
            return true;
        }
        const { attachment, filename } = await buildPaymentQr(payment);
        // So a cobranca pendente mostra chave: no cartao resolvido nao ha bloco de
        // pagamento nenhum, e chave de cobranca ja paga so convida a pagar de novo.
        const receiver = await resolvePixReceiver(payment);
        await message.edit({
            components: [
                (0, PaymentBuilders_1.buildPaymentCard)(payment, {
                    ...label,
                    qrFilename: filename,
                    ...(receiver !== undefined ? { receiver } : {}),
                }),
            ],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            // Substitui o anexo: o QR precisa refletir o payload atual.
            attachments: [],
            files: [attachment],
            allowedMentions: discord_1.NO_MENTIONS,
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error)) {
            logger.debug('Cartao de cobranca nao encontrado para atualizacao.', {
                guildId: guild.id,
                entityType: 'payment',
                entityId: payment.id,
            });
            return false;
        }
        // Perder AttachFiles/SendMessages no canal NAO pode virar erro do handler:
        // a aprovacao/cancelamento/reprecificacao ja esta gravada, e relancar aqui
        // mostrava "Ocorreu um erro inesperado" para uma operacao bem-sucedida.
        // Devolver false deixa o chamador avisar que o cartao ficou desatualizado.
        if ((0, discord_1.isMissingAccessError)(error)) {
            logger.warn('Sem permissao para atualizar o cartao de cobranca.', {
                guildId: guild.id,
                channelId: payment.channelId,
                entityType: 'payment',
                entityId: payment.id,
            });
            return false;
        }
        throw error;
    }
}
//# sourceMappingURL=PaymentCardService.js.map