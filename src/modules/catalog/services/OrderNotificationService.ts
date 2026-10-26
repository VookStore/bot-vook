import { MessageFlags } from 'discord.js';
import type { AttachmentBuilder, ContainerBuilder, Guild } from 'discord.js';

import { sendV2 } from '../../../components/reply';
import { createLogger } from '../../../core/logger/Logger';
import {
  NO_MENTIONS,
  fetchChannelSafe,
  fetchMemberSafe,
  isDmBlockedError,
  isSendableTextChannel,
  isUnknownResourceError,
} from '../../../utils/discord';
import { PaymentStatus, type Payment } from '@prisma/client';

import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { buildPaymentQr, resolvePixReceiver } from '../../payments/services/PaymentCardService';
import {
  buildNewOrderNotice,
  buildOrderChargeClosedDm,
  buildOrderChargeDm,
  buildOrderDeliveredDm,
  buildOrderPaidDm,
} from '../builders/OrderBuilders';
import {
  clearOrderPanelMessage,
  setOrderPanelMessage,
  type OrderWithItems,
} from '../repositories/OrderRepository';
import { formatOrderNumber } from './OrderService';

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

const logger = createLogger('order:notify');

/**
 * Envia uma DM Components V2. Retorna false quando o cliente nao aceita DMs.
 *
 * Exportada porque o quadro de demandas avisa o MESMO cliente sobre o MESMO
 * pedido: uma terceira copia desta funcao no repositorio so garantiria que uma
 * delas ficasse para tras na proxima mudanca de regra de DM.
 */
export async function trySendDm(
  guild: Guild,
  userId: string,
  root: ContainerBuilder,
  context: Record<string, unknown>,
  files: readonly AttachmentBuilder[] = [],
): Promise<boolean> {
  const member = await fetchMemberSafe(guild, userId).catch(() => null);
  if (member === null) return false;

  try {
    await member.user.send({
      components: [root],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS,
      ...(files.length > 0 ? { files: [...files] } : {}),
    });
    return true;
  } catch (error) {
    if (isDmBlockedError(error) || isUnknownResourceError(error)) {
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
export async function announceNewOrder(guild: Guild, order: OrderWithItems): Promise<boolean> {
  const config = await getGuildConfig(guild.id);
  if (config.orderChannelId === null) return false;

  const channel = await fetchChannelSafe(guild, config.orderChannelId);
  if (!isSendableTextChannel(channel)) {
    logger.warn('Canal de pedidos configurado nao esta acessivel.', {
      guildId: guild.id,
      channelId: config.orderChannelId,
      entityType: 'order',
      entityId: order.id,
    });
    return false;
  }

  try {
    const message = await sendV2(channel, buildNewOrderNotice(order));
    await setOrderPanelMessage(order.id, channel.id, message.id);
    return true;
  } catch (error) {
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
export async function refreshOrderNotice(
  guild: Guild,
  order: OrderWithItems,
  chargeState?: string,
): Promise<boolean> {
  if (order.panelChannelId === null || order.panelMessageId === null) return false;

  const channel = await fetchChannelSafe(guild, order.panelChannelId);
  if (!isSendableTextChannel(channel)) return false;

  try {
    const message = await channel.messages.fetch(order.panelMessageId);
    await message.edit({
      components: [
        buildNewOrderNotice(order, chargeState === undefined ? {} : { chargeState }),
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS,
    });
    return true;
  } catch (error) {
    if (isUnknownResourceError(error)) {
      await clearOrderPanelMessage(order.id).catch(() => undefined);
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
export async function notifyOrderCharge(
  guild: Guild,
  order: OrderWithItems,
  payment: Payment,
): Promise<boolean> {
  const config = await getGuildConfig(guild.id);

  let files: AttachmentBuilder[] = [];
  let qrFilename: string | undefined;

  try {
    const qr = await buildPaymentQr(payment);
    files = [qr.attachment];
    qrFilename = qr.filename;
  } catch (error) {
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
  const receiver = await resolvePixReceiver(payment);

  return trySendDm(
    guild,
    order.customerId,
    buildOrderChargeDm({
      order,
      payment,
      storeName: config.storeName,
      ...(qrFilename !== undefined ? { qrFilename } : {}),
      ...(receiver !== undefined ? { receiver } : {}),
    }),
    {
      guildId: guild.id,
      entityType: 'order',
      entityId: order.id,
      orderNumber: formatOrderNumber(order.orderNumber),
    },
    files,
  );
}

/**
 * Cobranca expirada ou cancelada: avisa o cliente e marca o card da equipe.
 *
 * O pedido NAO e cancelado — ele volta a aguardar uma nova cobranca. Os dois
 * lados precisam saber: o cliente, para nao ficar tentando pagar um QR morto; a
 * equipe, para emitir outro (o botao ja esta no painel do pedido).
 */
export async function notifyOrderChargeClosed(
  guild: Guild,
  order: OrderWithItems,
  payment: Payment,
): Promise<boolean> {
  const config = await getGuildConfig(guild.id);
  const expired = payment.status === PaymentStatus.EXPIRED;

  const sent = await trySendDm(
    guild,
    order.customerId,
    buildOrderChargeClosedDm({ order, expired, storeName: config.storeName }),
    {
      guildId: guild.id,
      entityType: 'order',
      entityId: order.id,
      orderNumber: formatOrderNumber(order.orderNumber),
      paymentStatus: payment.status,
    },
  );

  await refreshOrderNotice(
    guild,
    order,
    expired
      ? '⌛ **Cobranca expirada** — gere uma nova para o cliente.'
      : '❌ **Cobranca cancelada** — gere uma nova se a compra continua de pe.',
  );

  logger.info('Cobranca do pedido encerrada sem pagamento.', {
    guildId: guild.id,
    entityType: 'order',
    entityId: order.id,
    paymentStatus: payment.status,
    dmSent: sent,
  });

  return sent;
}

export async function notifyOrderPaid(guild: Guild, order: OrderWithItems): Promise<boolean> {
  const config = await getGuildConfig(guild.id);
  const sent = await trySendDm(guild, order.customerId, buildOrderPaidDm(order, config.storeName), {
    guildId: guild.id,
    entityType: 'order',
    entityId: order.id,
    orderNumber: formatOrderNumber(order.orderNumber),
  });

  await refreshOrderNotice(guild, order);
  return sent;
}

export async function notifyOrderDelivered(
  guild: Guild,
  order: OrderWithItems,
): Promise<boolean> {
  const config = await getGuildConfig(guild.id);
  const sent = await trySendDm(
    guild,
    order.customerId,
    buildOrderDeliveredDm(order, config.storeName),
    {
      guildId: guild.id,
      entityType: 'order',
      entityId: order.id,
      orderNumber: formatOrderNumber(order.orderNumber),
    },
  );

  await refreshOrderNotice(guild, order);
  return sent;
}
