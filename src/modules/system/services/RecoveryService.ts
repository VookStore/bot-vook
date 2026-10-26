import { TicketAuditAction, TicketStatus, type Ticket } from '@prisma/client';
import type { Client } from 'discord.js';

import { createLogger } from '../../../core/logger/Logger';
import { getPrisma } from '../../../core/database/prisma';
import { handleBackgroundError } from '../../../core/errors/interactionErrorHandler';
import { recordTicketAudit } from '../../audit/repositories/AuditRepository';
import { listOrdersPaidButNotSynced } from '../../catalog/repositories/OrderRepository';
import { notifyOrderPaid } from '../../catalog/services/OrderNotificationService';
import { publishDemandById } from '../../demands/services/DemandBoardService';
import { syncOrderPaid } from '../../catalog/services/OrderService';
import { ensureCatalogPanelHealthy } from '../../catalog/services/CatalogPanelService';
import {
  listExpiredPending,
  listRecentlyExpiredWithCard,
} from '../../payments/repositories/PaymentRepository';
import { refreshPaymentCard } from '../../payments/services/PaymentCardService';
import { expirePayment } from '../../payments/services/PaymentService';
import {
  listStuckTickets,
  listTicketsByStatus,
  markOrphaned,
} from '../../tickets/repositories/TicketRepository';
import { resolveTicketChannel } from '../../tickets/services/TicketChannelService';
import { ensurePanelHealthy } from '../../tickets/services/TicketPanelService';

/**
 * Recuperacao de estado apos reinicializacao.
 *
 * Um bot 24/7 pode cair no meio de qualquer operacao. No startup verificamos:
 *  - tickets presos em CREATING (canal nunca criado) ou CLOSING (fechamento
 *    interrompido);
 *  - tickets ativos cujo canal nao existe mais -> ORPHANED;
 *  - cobrancas PENDING ja vencidas -> EXPIRED (com o cartao atualizado);
 *  - painel publico apagado enquanto o bot estava offline.
 */

const logger = createLogger('recovery');

/** Tempo minimo em CREATING/CLOSING para o ticket ser considerado preso. */
const STUCK_THRESHOLD_MS = 5 * 60_000;
const EXPIRED_PAYMENT_BATCH = 200;

/**
 * Janela de reparo do cartao de cobrancas ja expiradas. O job roda a cada
 * minuto, entao 15 minutos dao ~15 tentativas antes de a cobranca sair do
 * intervalo — folga suficiente para uma indisponibilidade curta do Discord.
 */
const EXPIRED_CARD_REPAIR_WINDOW_MS = 15 * 60_000;
const EXPIRED_CARD_REPAIR_BATCH = 50;

/** Quantos pedidos com cobranca aprovada sao reconciliados por rodada. */
const PAID_ORDER_SYNC_BATCH = 100;

export interface RecoveryReport {
  stuckCreating: number;
  stuckClosing: number;
  orphanedTickets: number;
  expiredPayments: number;
  panelsChecked: number;
  syncedOrders: number;
}

/** Tickets em CREATING que nunca ganharam canal sao descartados. */
async function recoverStuckTickets(client: Client): Promise<{ creating: number; closing: number }> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuck = await listStuckTickets(cutoff);

  let creating = 0;
  let closing = 0;

  for (const ticket of stuck) {
    try {
      const applied = await recoverStuckTicket(client, ticket);
      if (applied === TicketStatus.CREATING) creating += 1;
      if (applied === TicketStatus.CLOSING) closing += 1;
    } catch (error) {
      // Um ticket problematico NAO pode derrubar o recovery inteiro: no
      // startup isso abortava o boot e, com o PM2 reiniciando em loop, uma
      // indisponibilidade curta do Discord deixava o bot `errored` de vez.
      await handleBackgroundError('recovery:stuck', error, {
        guildId: ticket.guildId,
        entityType: 'ticket',
        entityId: ticket.id,
      });
    }
  }

  return { creating, closing };
}

/**
 * Recupera UM ticket preso. Devolve o status de origem tratado.
 *
 * Isolado do laco para que a falha de um ticket nao interrompa os demais.
 */
async function recoverStuckTicket(client: Client, ticket: Ticket): Promise<TicketStatus | null> {
  const guild = client.guilds.cache.get(ticket.guildId);

  if (ticket.status === TicketStatus.CREATING) {
    // Sem canal, o ticket nunca existiu de verdade para o cliente.
    if (ticket.channelId === null) {
      await getPrisma()
        .ticket.delete({ where: { id: ticket.id } })
        .catch(() => undefined);
      logger.warn('Ticket preso em CREATING removido.', {
        guildId: ticket.guildId,
        entityType: 'ticket',
        entityId: ticket.id,
        ticketNumber: ticket.ticketNumber,
      });
      return TicketStatus.CREATING;
    }

    // O canal foi criado antes da queda: promove para OPEN.
    await getPrisma().ticket.updateMany({
      where: { id: ticket.id, status: TicketStatus.CREATING },
      data: { status: TicketStatus.OPEN },
    });
    await recordTicketAudit({
      guildId: ticket.guildId,
      ticketId: ticket.id,
      action: TicketAuditAction.RECOVERED,
      oldValue: TicketStatus.CREATING,
      newValue: TicketStatus.OPEN,
    });
    return TicketStatus.CREATING;
  }

  if (ticket.status === TicketStatus.CLOSING) {
    /*
     * Guild fora do cache NAO significa "canal apagado": significa "nao
     * consegui olhar". Encerrar o ticket nesse caso descarta um atendimento
     * vivo, e `listStuckTickets` e global (sem filtro de guild). Sem
     * visibilidade o ticket fica como esta e a proxima rodada tenta de novo.
     */
    if (guild === undefined) {
      logger.warn('Ticket em CLOSING de guild fora do cache: adiado para a proxima rodada.', {
        guildId: ticket.guildId,
        entityType: 'ticket',
        entityId: ticket.id,
      });
      return null;
    }

    const channel = await resolveTicketChannel(guild, ticket.channelId);

    if (channel === null) {
      // Canal ja foi apagado: o fechamento chegou ao fim.
      await getPrisma().ticket.updateMany({
        where: { id: ticket.id, status: TicketStatus.CLOSING },
        data: { status: TicketStatus.CLOSED, closedAt: ticket.closedAt ?? new Date() },
      });
    } else {
      // Canal ainda existe: devolve para atendimento em vez de perder o ticket.
      await getPrisma().ticket.updateMany({
        where: { id: ticket.id, status: TicketStatus.CLOSING },
        data: {
          status: ticket.claimedById !== null ? TicketStatus.CLAIMED : TicketStatus.OPEN,
        },
      });
    }

    await recordTicketAudit({
      guildId: ticket.guildId,
      ticketId: ticket.id,
      action: TicketAuditAction.RECOVERED,
      oldValue: TicketStatus.CLOSING,
      newValue: channel === null ? TicketStatus.CLOSED : 'REABERTO',
    });
    return TicketStatus.CLOSING;
  }

  return null;
}

/** Tickets ativos cujo canal sumiu enquanto o bot estava offline. */
async function recoverOrphanedTickets(client: Client): Promise<number> {
  let orphaned = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      const active = [
        ...(await listTicketsByStatus(guild.id, TicketStatus.OPEN)),
        ...(await listTicketsByStatus(guild.id, TicketStatus.CLAIMED)),
      ];

      for (const ticket of active) {
        if (ticket.channelId === null) continue;

        try {
          const channel = await resolveTicketChannel(guild, ticket.channelId);
          if (channel !== null) continue;

          if (await markOrphaned(ticket.id)) {
            orphaned += 1;
            await recordTicketAudit({
              guildId: ticket.guildId,
              ticketId: ticket.id,
              action: TicketAuditAction.ORPHANED,
              oldValue: ticket.status,
              newValue: 'ORPHANED',
              metadata: { reason: 'canal ausente no startup' },
            });
            logger.warn('Ticket sem canal marcado como orfao.', {
              guildId: ticket.guildId,
              entityType: 'ticket',
              entityId: ticket.id,
              ticketNumber: ticket.ticketNumber,
            });
          }
        } catch (error) {
          // Marcar ORPHANED e IRREVERSIVEL. Um erro transitorio do Discord
          // (HTTP 5xx apos os retries do REST) nao pode ser lido como "o canal
          // sumiu", nem derrubar o recovery dos outros tickets.
          await handleBackgroundError('recovery:orphan', error, {
            guildId: ticket.guildId,
            entityType: 'ticket',
            entityId: ticket.id,
          });
        }
      }
    } catch (error) {
      await handleBackgroundError('recovery:orphan:guild', error, { guildId: guild.id });
    }
  }

  return orphaned;
}

/** Reescreve o cartao publicado de uma cobranca. Nunca lanca. */
async function tryRefreshCard(client: Client, paymentId: string, guildId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (guild === undefined) return;

  try {
    const updated = await getPrisma().payment.findUnique({ where: { id: paymentId } });
    if (updated !== null) await refreshPaymentCard(guild, updated);
  } catch (error) {
    logger.warn('Falha ao atualizar cartao de cobranca expirada.', {
      guildId,
      entityType: 'payment',
      entityId: paymentId,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Cobrancas vencidas enquanto o bot estava offline. */
export async function recoverExpiredPayments(client: Client): Promise<number> {
  const pending = await listExpiredPending(new Date(), EXPIRED_PAYMENT_BATCH);
  let expired = 0;

  for (const payment of pending) {
    if (!(await expirePayment(payment))) continue;
    expired += 1;
    await tryRefreshCard(client, payment.id, payment.guildId);
  }

  /*
   * Segunda passada: cartoes de cobrancas expiradas ha pouco.
   *
   * O status e commitado ANTES de o cartao ser reescrito, e ha tres caminhos em
   * que a reescrita nao acontece — guild fora do cache, erro do Discord engolido
   * e shutdown cortando o laco no meio. Como nenhum job reprocessa pagamento ja
   * EXPIRED, o cliente ficava vendo um QR PIX pagavel de uma cobranca vencida
   * para sempre. Reprocessar a janela recente e idempotente e da varias chances
   * de reparo antes de a cobranca sair do intervalo.
   */
  const since = new Date(Date.now() - EXPIRED_CARD_REPAIR_WINDOW_MS);
  const stale = await listRecentlyExpiredWithCard(since, EXPIRED_CARD_REPAIR_BATCH);
  for (const payment of stale) {
    await tryRefreshCard(client, payment.id, payment.guildId);
  }

  return expired;
}

/**
 * Pedidos que ficaram para tras.
 *
 * A cobranca foi aprovada mas o pedido continuou em AWAITING_PAYMENT — sinal de
 * que o bot caiu entre o commit da aprovacao e a sincronizacao. Sem isto o
 * cliente ficaria com um pedido eternamente "aguardando pagamento" mesmo tendo
 * pago. `syncOrderPaid` e idempotente, entao reprocessar e seguro.
 */
async function recoverPaidOrders(client: Client): Promise<number> {
  const pending = await listOrdersPaidButNotSynced(PAID_ORDER_SYNC_BATCH);
  let synced = 0;

  for (const order of pending) {
    try {
      const payment = await getPrisma().payment.findUnique({
        where: { id: order.paymentId ?? '' },
      });
      if (payment === null) continue;

      const updated = await syncOrderPaid(payment);
      if (updated === null) continue;

      synced += 1;

      const guild = client.guilds.cache.get(order.guildId);
      if (guild !== undefined) {
        // Aviso ao cliente e best-effort: DM fechada nao invalida o pedido.
        await notifyOrderPaid(guild, updated).catch(() => undefined);
        // O quadro tambem: o pagamento que ficou pela metade quando o bot caiu
        // precisa aparecer como demanda, senao ninguem sabe que ha o que fazer.
        await publishDemandById(guild, updated.id).catch(() => undefined);
      }
    } catch (error) {
      await handleBackgroundError('recovery:order', error, {
        guildId: order.guildId,
        entityType: 'order',
        entityId: order.id,
      });
    }
  }

  if (synced > 0) {
    logger.info('Pedidos reconciliados com cobrancas ja aprovadas.', { synced });
  }
  return synced;
}

/** Reconfere os paineis publicos de todas as guilds. */
async function recoverPanels(client: Client): Promise<number> {
  let checked = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const result = await ensurePanelHealthy(guild);
      // O painel do catalogo segue a mesma politica: reconstruir sem duplicar.
      await ensureCatalogPanelHealthy(guild).catch(() => undefined);
      checked += 1;
      if (!result.updated && result.reason !== undefined) {
        logger.debug('Painel publico nao atualizado no startup.', {
          guildId: guild.id,
          detail: result.reason,
        });
      }
    } catch (error) {
      await handleBackgroundError('recovery:panel', error, { guildId: guild.id });
    }
  }
  return checked;
}

export async function runStartupRecovery(client: Client): Promise<RecoveryReport> {
  const stuck = await recoverStuckTickets(client);
  const orphanedTickets = await recoverOrphanedTickets(client);
  const expiredPayments = await recoverExpiredPayments(client);
  const syncedOrders = await recoverPaidOrders(client);
  const panelsChecked = await recoverPanels(client);

  const report: RecoveryReport = {
    stuckCreating: stuck.creating,
    stuckClosing: stuck.closing,
    orphanedTickets,
    expiredPayments,
    panelsChecked,
    syncedOrders,
  };

  logger.info('Recovery concluido.', { ...report });
  return report;
}

/** Recovery periodico (mais leve: nao mexe em paineis). */
export async function runPeriodicRecovery(client: Client): Promise<void> {
  const stuck = await recoverStuckTickets(client);
  const orphaned = await recoverOrphanedTickets(client);
  const syncedOrders = await recoverPaidOrders(client);
  if (stuck.creating > 0 || stuck.closing > 0 || orphaned > 0 || syncedOrders > 0) {
    logger.info('Recovery periodico aplicou correcoes.', {
      creating: stuck.creating,
      closing: stuck.closing,
      orphaned,
      syncedOrders,
    });
  }
}
