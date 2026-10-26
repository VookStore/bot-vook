import { OrderStatus, PaymentStatus } from '@prisma/client';
import type { Guild } from 'discord.js';

import { cache } from '../../../core/cache/CacheService';
import { checkDatabaseHealth, getPrisma } from '../../../core/database/prisma';
import { cooldowns, locks } from '../../../core/locks/LockService';
import { countActiveCarts } from '../../catalog/repositories/CartRepository';
import { countOrdersByStatus } from '../../catalog/repositories/OrderRepository';
import { countPacks } from '../../catalog/repositories/CatalogPackRepository';
import { countRecentErrors } from '../../audit/repositories/SystemErrorRepository';
import { countPaymentsByStatus, countPendingPayments } from '../../payments/repositories/PaymentRepository';
import { countActiveTickets, countQueueByGuild } from '../../tickets/repositories/TicketRepository';
import { draftCount } from '../../payments/services/PaymentDraftService';

/** Coleta de metricas para `/ticket-sistema status`. */

export interface SystemStatus {
  websocketPing: number;
  databaseOk: boolean;
  databaseLatencyMs: number;
  uptimeSeconds: number;
  activeTickets: number;
  queueSize: number;
  pendingPayments: number;
  approvedPayments: number;
  activeCoupons: number;
  reviewCount: number;
  averageRating: number | null;
  cacheEntries: number;
  cacheHits: number;
  cacheMisses: number;
  activeLocks: number;
  activeCooldowns: number;
  paymentDrafts: number;
  memoryMb: number;
  recentErrors: number;
  guildCount: number;
  // --- Catalogo ---
  activePacks: number;
  activeCarts: number;
  pendingOrders: number;
  ordersAwaitingPayment: number;
  paidOrders: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function collectSystemStatus(guild: Guild): Promise<SystemStatus> {
  const prisma = getPrisma();
  const since = new Date(Date.now() - ONE_DAY_MS);

  const [
    health,
    activeTickets,
    queueSize,
    pendingPayments,
    approvedPayments,
    activeCoupons,
    reviewAggregate,
    recentErrors,
    activePacks,
    activeCarts,
    orderTotals,
  ] = await Promise.all([
    checkDatabaseHealth(),
    countActiveTickets(guild.id),
    countQueueByGuild(guild.id),
    countPendingPayments(guild.id),
    countPaymentsByStatus(guild.id, PaymentStatus.APPROVED),
    prisma.coupon.count({ where: { guildId: guild.id, enabled: true, deletedAt: null } }),
    prisma.ticketReview.aggregate({
      where: { guildId: guild.id },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    countRecentErrors(since, guild.id),
    // Uma consulta agregada por metrica do catalogo: o painel de status nao
    // pode virar um varredor de tabela a cada clique.
    countPacks(guild.id),
    countActiveCarts(guild.id),
    countOrdersByStatus(guild.id),
  ]);

  const stats = cache.stats();

  return {
    websocketPing: Math.max(0, Math.round(guild.client.ws.ping)),
    databaseOk: health.ok,
    databaseLatencyMs: health.latencyMs,
    uptimeSeconds: Math.floor(process.uptime()),
    activeTickets,
    queueSize,
    pendingPayments,
    approvedPayments,
    activeCoupons,
    reviewCount: reviewAggregate._count._all,
    averageRating: reviewAggregate._avg.rating,
    cacheEntries: stats.entries,
    cacheHits: stats.hits,
    cacheMisses: stats.misses,
    activeLocks: locks.size(),
    activeCooldowns: cooldowns.size(),
    paymentDrafts: draftCount(),
    memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    recentErrors,
    guildCount: guild.client.guilds.cache.size,
    activePacks,
    activeCarts,
    pendingOrders: orderTotals.get(OrderStatus.PENDING) ?? 0,
    ordersAwaitingPayment: orderTotals.get(OrderStatus.AWAITING_PAYMENT) ?? 0,
    paidOrders:
      (orderTotals.get(OrderStatus.PAID) ?? 0) + (orderTotals.get(OrderStatus.IN_PROGRESS) ?? 0),
  };
}
