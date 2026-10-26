"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectSystemStatus = collectSystemStatus;
const client_1 = require("@prisma/client");
const CacheService_1 = require("../../../core/cache/CacheService");
const prisma_1 = require("../../../core/database/prisma");
const LockService_1 = require("../../../core/locks/LockService");
const CartRepository_1 = require("../../catalog/repositories/CartRepository");
const OrderRepository_1 = require("../../catalog/repositories/OrderRepository");
const CatalogPackRepository_1 = require("../../catalog/repositories/CatalogPackRepository");
const SystemErrorRepository_1 = require("../../audit/repositories/SystemErrorRepository");
const PaymentRepository_1 = require("../../payments/repositories/PaymentRepository");
const TicketRepository_1 = require("../../tickets/repositories/TicketRepository");
const PaymentDraftService_1 = require("../../payments/services/PaymentDraftService");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
async function collectSystemStatus(guild) {
    const prisma = (0, prisma_1.getPrisma)();
    const since = new Date(Date.now() - ONE_DAY_MS);
    const [health, activeTickets, queueSize, pendingPayments, approvedPayments, activeCoupons, reviewAggregate, recentErrors, activePacks, activeCarts, orderTotals,] = await Promise.all([
        (0, prisma_1.checkDatabaseHealth)(),
        (0, TicketRepository_1.countActiveTickets)(guild.id),
        (0, TicketRepository_1.countQueueByGuild)(guild.id),
        (0, PaymentRepository_1.countPendingPayments)(guild.id),
        (0, PaymentRepository_1.countPaymentsByStatus)(guild.id, client_1.PaymentStatus.APPROVED),
        prisma.coupon.count({ where: { guildId: guild.id, enabled: true, deletedAt: null } }),
        prisma.ticketReview.aggregate({
            where: { guildId: guild.id },
            _count: { _all: true },
            _avg: { rating: true },
        }),
        (0, SystemErrorRepository_1.countRecentErrors)(since, guild.id),
        // Uma consulta agregada por metrica do catalogo: o painel de status nao
        // pode virar um varredor de tabela a cada clique.
        (0, CatalogPackRepository_1.countPacks)(guild.id),
        (0, CartRepository_1.countActiveCarts)(guild.id),
        (0, OrderRepository_1.countOrdersByStatus)(guild.id),
    ]);
    const stats = CacheService_1.cache.stats();
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
        activeLocks: LockService_1.locks.size(),
        activeCooldowns: LockService_1.cooldowns.size(),
        paymentDrafts: (0, PaymentDraftService_1.draftCount)(),
        memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        recentErrors,
        guildCount: guild.client.guilds.cache.size,
        activePacks,
        activeCarts,
        pendingOrders: orderTotals.get(client_1.OrderStatus.PENDING) ?? 0,
        ordersAwaitingPayment: orderTotals.get(client_1.OrderStatus.AWAITING_PAYMENT) ?? 0,
        paidOrders: (orderTotals.get(client_1.OrderStatus.PAID) ?? 0) + (orderTotals.get(client_1.OrderStatus.IN_PROGRESS) ?? 0),
    };
}
//# sourceMappingURL=SystemStatusService.js.map