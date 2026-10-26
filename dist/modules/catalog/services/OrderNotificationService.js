"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trySendDm = trySendDm;
exports.announceNewOrder = announceNewOrder;
exports.refreshOrderNotice = refreshOrderNotice;
exports.notifyOrderCharge = notifyOrderCharge;
exports.notifyOrderChargeClosed = notifyOrderChargeClosed;
exports.notifyOrderPaid = notifyOrderPaid;
exports.notifyOrderDelivered = notifyOrderDelivered;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../../components/reply");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const client_1 = require("@prisma/client");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const PaymentCardService_1 = require("../../payments/services/PaymentCardService");
const OrderBuilders_1 = require("../builders/OrderBuilders");
const OrderRepository_1 = require("../repositories/OrderRepository");
const OrderService_1 = require("./OrderService");
/**
 * Avisos de pedido.
 *
 * REGRA: nenhuma falha de notificacao derruba a operacao comercial. DM fechada,
 * canal apagado ou permissao faltando viram WARN — o pedido continua valido e a
 * equipe continua conseguindo trabalhar.
 *
 * PRIVACIDADE: chave PIX, payload e dados do cliente nunca vao para o canal
 * publico do catalogo. O aviso de novo pedido vai para o canal de pedidos
 * (interno) e traz apenas numero, cliente, quantidade e total.
 */
const logger = (0, Logger_1.createLogger)('order:notify');
/**
 * Envia uma DM Components V2. Retorna false quando o cliente nao aceita DMs.
 *
 * Exportada porque o quadro de demandas avisa o MESMO cliente sobre o MESMO
 * pedido: uma terceira copia desta funcao no repositorio so garantiria que uma
 * delas ficasse para tras na proxima mudanca de regra de DM.
 */
async function trySendDm(guild, userId, root, context, files = []) {
    const member = await (0, discord_1.fetchMemberSafe)(guild, userId).catch(() => null);
    if (member === null)
        return false;
    try {
        await member.user.send({
            components: [root],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            allowedMentions: discord_1.NO_MENTIONS,
            ...(files.length > 0 ? { files: [...files] } : {}),
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isDmBlockedError)(error) || (0, discord_1.isUnknownResourceError)(error)) {
            logger.warn('Nao foi possivel enviar DM ao cliente do pedido.', { ...context, userId });
            return false;
        }
        throw error;
    }
}
/**
 * Publica o novo pedido no canal da equipe, quando configurado.
 * Falha aqui NAO cancela o pedido: registra warning e segue.
 */
async function announceNewOrder(guild, order) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    if (config.orderChannelId === null)
        return false;
    const channel = await (0, discord_1.fetchChannelSafe)(guild, config.orderChannelId);
    if (!(0, discord_1.isSendableTextChannel)(channel)) {
        logger.warn('Canal de pedidos configurado nao esta acessivel.', {
            guildId: guild.id,
            channelId: config.orderChannelId,
            entityType: 'order',
            entityId: order.id,
        });
        return false;
    }
    try {
        const message = await (0, reply_1.sendV2)(channel, (0, OrderBuilders_1.buildNewOrderNotice)(order));
        await (0, OrderRepository_1.setOrderPanelMessage)(order.id, channel.id, message.id);
        return true;
    }
    catch (error) {
        logger.warn('Falha ao publicar o pedido no canal da equipe.', {
            guildId: guild.id,
            channelId: channel.id,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/**
 * Reescreve o aviso publicado no canal de pedidos.
 * Mensagem apagada limpa a referencia em vez de derrubar a operacao.
 */
async function refreshOrderNotice(guild, order, chargeState) {
    if (order.panelChannelId === null || order.panelMessageId === null)
        return false;
    const channel = await (0, discord_1.fetchChannelSafe)(guild, order.panelChannelId);
    if (!(0, discord_1.isSendableTextChannel)(channel))
        return false;
    try {
        const message = await channel.messages.fetch(order.panelMessageId);
        await message.edit({
            components: [
                (0, OrderBuilders_1.buildNewOrderNotice)(order, chargeState === undefined ? {} : { chargeState }),
            ],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            allowedMentions: discord_1.NO_MENTIONS,
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error)) {
            await (0, OrderRepository_1.clearOrderPanelMessage)(order.id).catch(() => undefined);
            return false;
        }
        logger.warn('Falha ao atualizar o aviso do pedido.', {
            guildId: guild.id,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/**
 * Avisa o cliente, por DM, que a cobranca dele esta pronta — com QR e copia e
 * cola. Sem isso o cliente so descobriria a cobranca abrindo `/meus-pedidos`,
 * ou veria o cartao publicado num canal que talvez ele nem enxergue.
 *
 * Falha de DM nao invalida a cobranca: o pedido continua pagavel pelo painel
 * `/meus-pedidos`, que mostra o mesmo QR e o mesmo copia e cola.
 */
async function notifyOrderCharge(guild, order, payment) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    let files = [];
    let qrFilename;
    try {
        const qr = await (0, PaymentCardService_1.buildPaymentQr)(payment);
        files = [qr.attachment];
        qrFilename = qr.filename;
    }
    catch (error) {
        // Sem QR a DM ainda vale: o copia e cola sozinho ja permite pagar.
        logger.warn('Falha ao gerar o QR para a DM de cobranca.', {
            guildId: guild.id,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
    }
    // A DM e justamente onde o QR mais falha (imagem em DM depende do cliente
    // aceitar anexo), entao a chave em texto vale ainda mais aqui.
    const receiver = await (0, PaymentCardService_1.resolvePixReceiver)(payment);
    return trySendDm(guild, order.customerId, (0, OrderBuilders_1.buildOrderChargeDm)({
        order,
        payment,
        storeName: config.storeName,
        ...(qrFilename !== undefined ? { qrFilename } : {}),
        ...(receiver !== undefined ? { receiver } : {}),
    }), {
        guildId: guild.id,
        entityType: 'order',
        entityId: order.id,
        orderNumber: (0, OrderService_1.formatOrderNumber)(order.orderNumber),
    }, files);
}
/**
 * Cobranca expirada ou cancelada: avisa o cliente e marca o card da equipe.
 *
 * O pedido NAO e cancelado — ele volta a aguardar uma nova cobranca. Os dois
 * lados precisam saber: o cliente, para nao ficar tentando pagar um QR morto; a
 * equipe, para emitir outro (o botao ja esta no painel do pedido).
 */
async function notifyOrderChargeClosed(guild, order, payment) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const expired = payment.status === client_1.PaymentStatus.EXPIRED;
    const sent = await trySendDm(guild, order.customerId, (0, OrderBuilders_1.buildOrderChargeClosedDm)({ order, expired, storeName: config.storeName }), {
        guildId: guild.id,
        entityType: 'order',
        entityId: order.id,
        orderNumber: (0, OrderService_1.formatOrderNumber)(order.orderNumber),
        paymentStatus: payment.status,
    });
    await refreshOrderNotice(guild, order, expired
        ? '⌛ **Cobranca expirada** — gere uma nova para o cliente.'
        : '❌ **Cobranca cancelada** — gere uma nova se a compra continua de pe.');
    logger.info('Cobranca do pedido encerrada sem pagamento.', {
        guildId: guild.id,
        entityType: 'order',
        entityId: order.id,
        paymentStatus: payment.status,
        dmSent: sent,
    });
    return sent;
}
async function notifyOrderPaid(guild, order) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const sent = await trySendDm(guild, order.customerId, (0, OrderBuilders_1.buildOrderPaidDm)(order, config.storeName), {
        guildId: guild.id,
        entityType: 'order',
        entityId: order.id,
        orderNumber: (0, OrderService_1.formatOrderNumber)(order.orderNumber),
    });
    await refreshOrderNotice(guild, order);
    return sent;
}
async function notifyOrderDelivered(guild, order) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const sent = await trySendDm(guild, order.customerId, (0, OrderBuilders_1.buildOrderDeliveredDm)(order, config.storeName), {
        guildId: guild.id,
        entityType: 'order',
        entityId: order.id,
        orderNumber: (0, OrderService_1.formatOrderNumber)(order.orderNumber),
    });
    await refreshOrderNotice(guild, order);
    return sent;
}
//# sourceMappingURL=OrderNotificationService.js.map