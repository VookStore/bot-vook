import { MessageFlags } from 'discord.js';
import type { ContainerBuilder, Guild, Message } from 'discord.js';
import type { Ticket } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { createLogger } from '../../../core/logger/Logger';
import {
  NO_MENTIONS,
  displayNameOf,
  fetchMemberSafe,
  isUnknownResourceError,
} from '../../../utils/discord';
import { buildInternalPanel } from '../builders/TicketInternalPanelBuilder';
import type { TicketConversation } from './TicketChannelService';
import { listActiveParticipants } from '../repositories/TicketParticipantRepository';
import {
  getQueuePosition,
  setPanelMessageId,
  findTicketById,
  findTicketByChannelId,
} from '../repositories/TicketRepository';
import { listOrdersByChannel } from '../../catalog/repositories/OrderRepository';
import {
  getCustomerSummary,
  type CustomerSummary,
} from '../../catalog/repositories/CustomerRepository';
import {
  describeOrderStatus,
  formatOrderNumber,
} from '../../catalog/services/OrderService';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { getCategoryById, getTeamRoleIds } from './TicketConfigService';
import { resolveTicketChannel } from './TicketChannelService';

/**
 * Renderizacao e atualizacao do painel interno do ticket.
 *
 * A posicao na fila e sempre RECALCULADA a partir do banco no momento em que o
 * painel e montado — nao existe coluna `queuePosition` para ficar desatualizada.
 * O mesmo vale para os pedidos do atendimento.
 */

const logger = createLogger('ticket:view');

/**
 * Quantos pedidos cabem na linha do painel.
 *
 * O bloco vai dentro de `boxedField`, que corta em 200 caracteres. Cada entrada
 * gasta ~32 (`VK-000185 — Aguardando pagamento`), entao cinco entram com folga
 * e a sexta comecaria a ser cortada no meio.
 */
const PANEL_ORDER_LIMIT = 5;

/** Pedidos abertos no canal do ticket, prontos para virar texto no painel. */
async function orderRefsFor(ticket: Ticket): Promise<string[]> {
  if (ticket.channelId === null) return [];

  // Falha de leitura NAO derruba o painel: perder a linha dos pedidos e muito
  // menos grave que o ticket ficar sem painel nenhum.
  const orders = await listOrdersByChannel(
    ticket.guildId,
    ticket.channelId,
    PANEL_ORDER_LIMIT,
  ).catch((error: unknown) => {
    logger.warn('Nao foi possivel listar os pedidos do atendimento.', {
      guildId: ticket.guildId,
      entityType: 'ticket',
      entityId: ticket.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    return [];
  });

  return orders.map(
    (order) => `${formatOrderNumber(order.orderNumber)} — ${describeOrderStatus(order.status)}`,
  );
}

/**
 * Historico comercial do dono do ticket.
 *
 * MELHOR-ESFORCO. E informacao de apoio para a equipe: uma falha de consulta
 * devolve `null` e o bloco some, em vez de impedir o painel — que e a UNICA
 * mensagem da abertura, entao derruba-lo derruba o atendimento inteiro.
 */
async function customerSummaryFor(ticket: Ticket): Promise<CustomerSummary | null> {
  try {
    return await getCustomerSummary(ticket.guildId, ticket.ownerId);
  } catch (error) {
    logger.warn('Nao foi possivel carregar o historico do cliente.', {
      guildId: ticket.guildId,
      entityType: 'ticket',
      entityId: ticket.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Nome de quem assumiu o ticket, para o campo "Responsavel" do painel.
 *
 * Resolvido AQUI e nao no builder porque o builder e puro: recebe dados e
 * devolve componentes, sem tocar na API do Discord. Falha de rede vira
 * `null` — o painel tem um texto de fallback e nao vale derrubar a renderizacao
 * inteira por um nome.
 */
async function claimedByNameFor(guild: Guild | undefined, ticket: Ticket): Promise<string | null> {
  if (guild === undefined || ticket.claimedById === null) return null;
  const member = await fetchMemberSafe(guild, ticket.claimedById).catch(() => null);
  return member === null ? null : displayNameOf(member, ticket.claimedById);
}

/**
 * Monta o painel interno com os dados atuais do ticket.
 *
 * A `guild` e opcional so por compatibilidade com chamadas antigas; sem ela o
 * campo "Responsavel" cai no id. Todos os chamadores atuais passam uma.
 */
export async function buildPanelForTicket(
  ticket: Ticket,
  guild?: Guild,
): Promise<ContainerBuilder> {
  const [
    category,
    participants,
    queuePosition,
    config,
    teamRoleIds,
    orderRefs,
    claimedByName,
    customer,
  ] = await Promise.all([
    getCategoryById(ticket.guildId, ticket.categoryId),
    listActiveParticipants(ticket.id),
    getQueuePosition(ticket),
    getGuildConfig(ticket.guildId),
    getTeamRoleIds(ticket.categoryId),
    orderRefsFor(ticket),
    claimedByNameFor(guild, ticket),
    customerSummaryFor(ticket),
  ]);

  return buildInternalPanel({
    ticket,
    categoryName: category?.name ?? 'Categoria removida',
    queuePosition,
    participantIds: participants.map((participant) => participant.userId),
    claimedByName,
    orderRefs,
    customer,
    thumbnailUrl: config.panelThumbnailUrl,
    // Banner proprio do ticket; sem ele, reaproveita o do painel publico.
    bannerUrl: config.ticketBannerUrl ?? config.panelBannerUrl,
    storeName: config.storeName,
    teamRoleIds,
  });
}

/** Envia o painel interno no canal e guarda o id da mensagem. */
/**
 * Publica o painel no canal do ticket.
 *
 * E o UNICO envio da abertura: nao existe mais mensagem separada de
 * boas-vindas. Por isso e aqui que o ping acontece — `allowedMentions` libera o
 * cliente e os cargos da equipe, ambos ja mencionados no texto do painel.
 */
export async function sendInternalPanel(
  channel: TicketConversation,
  ticket: Ticket,
): Promise<Message> {
  const [panel, teamRoleIds] = await Promise.all([
    buildPanelForTicket(ticket, channel.guild),
    getTeamRoleIds(ticket.categoryId),
  ]);

  const message = await sendV2(channel, panel, {
    allowedMentions: { parse: [], users: [ticket.ownerId], roles: [...teamRoleIds] },
  });
  await setPanelMessageId(ticket.id, message.id);
  return message;
}

/**
 * Atualiza o painel interno ja publicado.
 * Retorna false (sem lancar) quando canal/mensagem nao existem mais.
 */
export async function refreshInternalPanel(guild: Guild, ticket: Ticket): Promise<boolean> {
  if (ticket.channelId === null || ticket.panelMessageId === null) return false;

  const channel = await resolveTicketChannel(guild, ticket.channelId);
  if (channel === null) return false;

  try {
    const message = await channel.messages.fetch(ticket.panelMessageId);
    const panel = await buildPanelForTicket(ticket, guild);
    await message.edit({
      components: [panel],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS,
    });
    return true;
  } catch (error) {
    if (isUnknownResourceError(error)) {
      logger.debug('Painel interno nao encontrado para atualizacao.', {
        guildId: guild.id,
        entityType: 'ticket',
        entityId: ticket.id,
      });
      return false;
    }
    throw error;
  }
}

/** Recarrega o ticket do banco e atualiza o painel. */
export async function refreshInternalPanelById(
  guild: Guild,
  ticketId: string,
): Promise<boolean> {
  const ticket = await findTicketById(ticketId);
  if (ticket === null) return false;
  return refreshInternalPanel(guild, ticket);
}

/**
 * Atualiza o painel do ticket dono deste canal, se houver um.
 *
 * Quem gera cobranca sabe o canal, nao o ticket — e a cobranca pode muito bem
 * ter sido criada num canal comum. Devolver false silenciosamente e o
 * comportamento certo: nao existir ticket ali nao e erro.
 */
export async function refreshInternalPanelByChannel(
  guild: Guild,
  channelId: string,
): Promise<boolean> {
  const ticket = await findTicketByChannelId(channelId);
  if (ticket === null) return false;
  return refreshInternalPanel(guild, ticket);
}
