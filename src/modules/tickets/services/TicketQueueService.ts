import type { Guild } from 'discord.js';
import type { Ticket } from '@prisma/client';

import { BUSINESS_LIMITS } from '../../../constants/limits';
import { createLogger } from '../../../core/logger/Logger';
import {
  countQueue,
  countQueueByGuild,
  getQueuePosition,
  listQueue,
} from '../repositories/TicketRepository';
import { getCategories } from './TicketConfigService';
import { refreshInternalPanel } from './TicketViewService';

/**
 * Fila de atendimento.
 *
 * A fila e SEMPRE derivada dos tickets reais: status OPEN, sem responsavel,
 * agrupados por (guild, categoria) e ordenados por prioridade e numero.
 * Nao existe coluna de posicao para dessincronizar.
 *
 * Desempenho: a mudanca da fila NAO reescreve dezenas de mensagens. Apenas os
 * primeiros tickets (QUEUE_PANEL_REFRESH_BATCH) tem o painel atualizado, e o
 * cliente sempre pode usar o botao "Atualizar" para ver a posicao exata.
 */

const logger = createLogger('ticket:queue');

export interface QueueInfo {
  /** Posicao 1-based; 0 quando o ticket nao esta na fila. */
  position: number;
  /** Quantos estao a frente. */
  ahead: number;
  /** Total aguardando na categoria. */
  total: number;
}

export async function getQueueInfo(ticket: Ticket): Promise<QueueInfo> {
  const [position, total] = await Promise.all([
    getQueuePosition(ticket),
    countQueue(ticket.guildId, ticket.categoryId),
  ]);
  return { position, ahead: position > 0 ? position - 1 : 0, total };
}

export interface QueueOverviewEntry {
  categoryId: string;
  categoryName: string;
  waiting: number;
  tickets: number[];
}

/** Panorama da fila por categoria (status e diagnostico). */
export async function getQueueOverview(guildId: string): Promise<QueueOverviewEntry[]> {
  const categories = await getCategories(guildId);
  const entries: QueueOverviewEntry[] = [];

  for (const category of categories) {
    if (category.deletedAt !== null) continue;
    const waiting = await countQueue(guildId, category.id);
    const tickets =
      waiting > 0
        ? (await listQueue(guildId, category.id, BUSINESS_LIMITS.QUEUE_PREVIEW_SIZE)).map(
            (ticket) => ticket.ticketNumber,
          )
        : [];
    entries.push({
      categoryId: category.id,
      categoryName: category.name,
      waiting,
      tickets,
    });
  }

  return entries;
}

export async function getGuildQueueSize(guildId: string): Promise<number> {
  return countQueueByGuild(guildId);
}

/**
 * Atualiza o painel dos primeiros tickets da fila apos uma mudanca relevante
 * (criacao ou claim). Limitado a um lote pequeno para nao gerar rajada de
 * chamadas a API do Discord.
 */
export async function refreshQueueHead(
  guild: Guild,
  categoryId: string,
  options: { skipTicketId?: string; limit?: number } = {},
): Promise<number> {
  const limit = options.limit ?? BUSINESS_LIMITS.QUEUE_PANEL_REFRESH_BATCH;
  if (limit <= 0) return 0;

  const head = await listQueue(guild.id, categoryId, limit);
  let updated = 0;

  for (const ticket of head) {
    if (ticket.id === options.skipTicketId) continue;
    try {
      if (await refreshInternalPanel(guild, ticket)) updated += 1;
    } catch (error) {
      // Atualizar painel e melhoria de UX: nunca deve derrubar o fluxo principal.
      logger.warn('Falha ao atualizar painel da fila.', {
        guildId: guild.id,
        entityType: 'ticket',
        entityId: ticket.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return updated;
}
