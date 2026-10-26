import { MessageFlags, type Guild } from 'discord.js';
import { OrderStatus, TicketStatus, type Ticket } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { createLogger } from '../../../core/logger/Logger';
import {
  NO_MENTIONS,
  fetchChannelSafe,
  isSendableTextChannel,
  isUnknownResourceError,
} from '../../../utils/discord';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { listOrdersByChannel } from '../../catalog/repositories/OrderRepository';
import { formatOrderNumber } from '../../catalog/services/OrderService';
import { buildTicketDoneCard, type TicketDoneCardData } from '../builders/TicketDoneBuilder';
import { formatTicketNumber } from '../builders/TicketInternalPanelBuilder';
import { setTicketDoneCard } from '../repositories/TicketRepository';
import { getCategoryById } from './TicketConfigService';
import { isTicketThread, resolveTicketChannel } from './TicketChannelService';

/**
 * Canal de concluidos: o lugar dos atendimentos ENTREGUES.
 *
 * O pedido era mover o topico para la, e o Discord nao move topico. Entao, na
 * entrega, o topico e ARQUIVADO — sai da lista de ativos sem fechar — e um
 * cartao no canal de concluidos aponta para ele. Quando o ticket fecha (pelo
 * cliente confirmando, ou pela equipe), o mesmo cartao e reescrito.
 *
 * NADA AQUI LANCA. Quando estas funcoes rodam, o produto ja foi entregue ou o
 * ticket ja fechou no banco: um cartao que nao sai nao pode desfazer isso.
 */

const logger = createLogger('ticket:done');

/** Status de pedido que contam como "entregue" para o cartao. */
const DELIVERED_STATUSES: readonly OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.COMPLETED];

/**
 * Numero do pedido entregue neste atendimento, quando houver.
 *
 * Vem de `listOrdersByChannel` porque o cartao e reconstruido do banco a cada
 * vez: o pedido mais recente ja entregue e o que esta entrega fechou.
 */
async function deliveredOrderLabel(guildId: string, channelId: string | null): Promise<string | null> {
  if (channelId === null) return null;
  const pedidos = await listOrdersByChannel(guildId, channelId);
  const entregue = [...pedidos].reverse().find((pedido) => DELIVERED_STATUSES.includes(pedido.status));
  return entregue === undefined ? null : formatOrderNumber(entregue.orderNumber);
}

async function toCardData(guild: Guild, ticket: Ticket): Promise<TicketDoneCardData> {
  const [category, orderLabel] = await Promise.all([
    getCategoryById(guild.id, ticket.categoryId),
    deliveredOrderLabel(guild.id, ticket.channelId),
  ]);

  const closed = ticket.status === TicketStatus.CLOSED;
  const state = !closed ? 'aguardando' : ticket.closedById === ticket.ownerId ? 'cliente' : 'equipe';

  return {
    guildId: guild.id,
    ticketChannelId: ticket.channelId,
    ticketLabel: formatTicketNumber(ticket.ticketNumber),
    categoryName: category?.name ?? 'Categoria removida',
    customerId: ticket.ownerId,
    staffId: ticket.claimedById,
    deliveredById: ticket.deliveredById,
    deliveredAt: ticket.deliveredAt,
    orderLabel,
    state,
    closedById: ticket.closedById,
    closedAt: ticket.closedAt,
    transcriptUrl: ticket.transcriptUrl,
  };
}

/**
 * Reescreve o cartao ja publicado. Mensagem apagada limpa a referencia em vez
 * de virar erro a cada mudanca de estado, para sempre.
 */
async function rewriteCard(guild: Guild, ticket: Ticket): Promise<boolean> {
  if (ticket.doneCardChannelId === null || ticket.doneCardMessageId === null) return false;

  const channel = await fetchChannelSafe(guild, ticket.doneCardChannelId);
  if (!isSendableTextChannel(channel)) return false;

  try {
    const message = await channel.messages.fetch(ticket.doneCardMessageId);
    await message.edit({
      components: [buildTicketDoneCard(await toCardData(guild, ticket))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS,
    });
    return true;
  } catch (error) {
    if (isUnknownResourceError(error)) {
      await setTicketDoneCard(ticket.id, null, null).catch(() => undefined);
      return false;
    }
    logger.warn('Falha ao reescrever o cartao do ticket entregue.', {
      guildId: guild.id,
      entityType: 'ticket',
      entityId: ticket.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export interface TicketDeliveredResult {
  /** Cartao no canal de concluidos publicado (ou ja existente e reescrito). */
  carded: boolean;
  /** Topico arquivado — saiu da lista de ativos. */
  archived: boolean;
}

/**
 * O produto foi entregue: cartao no canal de concluidos, topico arquivado.
 *
 * O ARQUIVAMENTO DEPENDE DO CARTAO. Sem canal de concluidos configurado — ou se
 * a publicacao falhar —, o topico fica onde esta: arquivar sem o cartao faria o
 * atendimento sumir da lista de ativos sem nada apontando para ele, e um ticket
 * aberto que ninguem acha e o pior resultado possivel.
 *
 * Arquivar NAO FECHA. O ticket continua aberto no banco, o cliente continua
 * podendo escrever (e a mensagem dele reabre o topico sozinha) e so fecha
 * quando ele confirma o recebimento ou a equipe encerra.
 *
 * Idempotente: entregar duas vezes no mesmo ticket reescreve o cartao.
 */
export async function announceTicketDelivered(
  guild: Guild,
  ticket: Ticket,
): Promise<TicketDeliveredResult> {
  try {
    let carded = await rewriteCard(guild, ticket);

    if (!carded) {
      const config = await getGuildConfig(guild.id);
      const channel = await fetchChannelSafe(guild, config.ticketDoneChannelId);
      if (isSendableTextChannel(channel)) {
        const message = await sendV2(channel, buildTicketDoneCard(await toCardData(guild, ticket)));
        await setTicketDoneCard(ticket.id, channel.id, message.id);
        carded = true;
      } else if (config.ticketDoneChannelId !== null) {
        logger.warn('Canal de concluidos indisponivel.', {
          guildId: guild.id,
          channelId: config.ticketDoneChannelId,
        });
      }
    }

    if (!carded) return { carded: false, archived: false };

    const conversation = await resolveTicketChannel(guild, ticket.channelId);
    if (conversation === null || !isTicketThread(conversation) || conversation.archived === true) {
      // Canal legado nao arquiva; topico ja arquivado nao precisa.
      return { carded, archived: conversation !== null && isTicketThread(conversation) };
    }

    await conversation.setArchived(true, `Ticket #${ticket.ticketNumber}: produto entregue`);
    return { carded, archived: true };
  } catch (error) {
    logger.warn('Falha ao mover o ticket entregue para concluidos.', {
      guildId: guild.id,
      entityType: 'ticket',
      entityId: ticket.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { carded: false, archived: false };
  }
}

/**
 * Reescreve o cartao depois de o ticket mudar (fechamento, principalmente).
 *
 * Chamado do fechamento para QUALQUER ticket: ticket que nunca foi entregue nao
 * tem cartao, e a funcao sai sem tocar no Discord.
 */
export async function refreshTicketDoneCard(guild: Guild, ticket: Ticket): Promise<void> {
  try {
    await rewriteCard(guild, ticket);
  } catch (error) {
    logger.warn('Falha ao atualizar o cartao do ticket entregue.', {
      guildId: guild.id,
      entityType: 'ticket',
      entityId: ticket.id,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
