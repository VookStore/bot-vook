"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoverExpiredPayments = recoverExpiredPayments;
exports.runStartupRecovery = runStartupRecovery;
exports.runPeriodicRecovery = runPeriodicRecovery;
const client_1 = require("@prisma/client");
const Logger_1 = require("../../../core/logger/Logger");
const prisma_1 = require("../../../core/database/prisma");
const interactionErrorHandler_1 = require("../../../core/errors/interactionErrorHandler");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const OrderRepository_1 = require("../../catalog/repositories/OrderRepository");
const OrderNotificationService_1 = require("../../catalog/services/OrderNotificationService");
const DemandBoardService_1 = require("../../demands/services/DemandBoardService");
const OrderService_1 = require("../../catalog/services/OrderService");
const CatalogPanelService_1 = require("../../catalog/services/CatalogPanelService");
const PaymentRepository_1 = require("../../payments/repositories/PaymentRepository");
const PaymentCardService_1 = require("../../payments/services/PaymentCardService");
const PaymentService_1 = require("../../payments/services/PaymentService");
const TicketRepository_1 = require("../../tickets/repositories/TicketRepository");
const TicketChannelService_1 = require("../../tickets/services/TicketChannelService");
const TicketPanelService_1 = require("../../tickets/services/TicketPanelService");
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
const logger = (0, Logger_1.createLogger)('recovery');
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
/** Tickets em CREATING que nunca ganharam canal sao descartados. */
async function recoverStuckTickets(client) {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuck = await (0, TicketRepository_1.listStuckTickets)(cutoff);
    let creating = 0;
    let closing = 0;
    for (const ticket of stuck) {
        try {
            const applied = await recoverStuckTicket(client, ticket);
            if (applied === client_1.TicketStatus.CREATING)
                creating += 1;
            if (applied === client_1.TicketStatus.CLOSING)
                closing += 1;
        }
        catch (error) {
            // Um ticket problematico NAO pode derrubar o recovery inteiro: no
            // startup isso abortava o boot e, com o PM2 reiniciando em loop, uma
            // indisponibilidade curta do Discord deixava o bot `errored` de vez.
            await (0, interactionErrorHandler_1.handleBackgroundError)('recovery:stuck', error, {
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
async function recoverStuckTicket(client, ticket) {
    const guild = client.guilds.cache.get(ticket.guildId);
    if (ticket.status === client_1.TicketStatus.CREATING) {
        // Sem canal, o ticket nunca existiu de verdade para o cliente.
        if (ticket.channelId === null) {
            await (0, prisma_1.getPrisma)()
                .ticket.delete({ where: { id: ticket.id } })
                .catch(() => undefined);
            logger.warn('Ticket preso em CREATING removido.', {
                guildId: ticket.guildId,
                entityType: 'ticket',
                entityId: ticket.id,
                ticketNumber: ticket.ticketNumber,
            });
            return client_1.TicketStatus.CREATING;
        }
        // O canal foi criado antes da queda: promove para OPEN.
        await (0, prisma_1.getPrisma)().ticket.updateMany({
            where: { id: ticket.id, status: client_1.TicketStatus.CREATING },
            data: { status: client_1.TicketStatus.OPEN },
        });
        await (0, AuditRepository_1.recordTicketAudit)({
            guildId: ticket.guildId,
            ticketId: ticket.id,
            action: client_1.TicketAuditAction.RECOVERED,
            oldValue: client_1.TicketStatus.CREATING,
            newValue: client_1.TicketStatus.OPEN,
        });
        return client_1.TicketStatus.CREATING;
    }
    if (ticket.status === client_1.TicketStatus.CLOSING) {
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
        const channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, ticket.channelId);
        if (channel === null) {
            // Canal ja foi apagado: o fechamento chegou ao fim.
            await (0, prisma_1.getPrisma)().ticket.updateMany({
                where: { id: ticket.id, status: client_1.TicketStatus.CLOSING },
                data: { status: client_1.TicketStatus.CLOSED, closedAt: ticket.closedAt ?? new Date() },
            });
        }
        else {
            // Canal ainda existe: devolve para atendimento em vez de perder o ticket.
            await (0, prisma_1.getPrisma)().ticket.updateMany({
                where: { id: ticket.id, status: client_1.TicketStatus.CLOSING },
                data: {
                    status: ticket.claimedById !== null ? client_1.TicketStatus.CLAIMED : client_1.TicketStatus.OPEN,
                },
            });
        }
        await (0, AuditRepository_1.recordTicketAudit)({
            guildId: ticket.guildId,
            ticketId: ticket.id,
            action: client_1.TicketAuditAction.RECOVERED,
            oldValue: client_1.TicketStatus.CLOSING,
            newValue: channel === null ? client_1.TicketStatus.CLOSED : 'REABERTO',
        });
        return client_1.TicketStatus.CLOSING;
    }
    return null;
}
/** Tickets ativos cujo canal sumiu enquanto o bot estava offline. */
async function recoverOrphanedTickets(client) {
    let orphaned = 0;
    for (const guild of client.guilds.cache.values()) {
        try {
            const active = [
                ...(await (0, TicketRepository_1.listTicketsByStatus)(guild.id, client_1.TicketStatus.OPEN)),
                ...(await (0, TicketRepository_1.listTicketsByStatus)(guild.id, client_1.TicketStatus.CLAIMED)),
            ];
            for (const ticket of active) {
                if (ticket.channelId === null)
                    continue;
                try {
                    const channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, ticket.channelId);
                    if (channel !== null)
                        continue;
                    if (await (0, TicketRepository_1.markOrphaned)(ticket.id)) {
                        orphaned += 1;
                        await (0, AuditRepository_1.recordTicketAudit)({
                            guildId: ticket.guildId,
                            ticketId: ticket.id,
                            action: client_1.TicketAuditAction.ORPHANED,
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
                }
                catch (error) {
                    // Marcar ORPHANED e IRREVERSIVEL. Um erro transitorio do Discord
                    // (HTTP 5xx apos os retries do REST) nao pode ser lido como "o canal
                    // sumiu", nem derrubar o recovery dos outros tickets.
                    await (0, interactionErrorHandler_1.handleBackgroundError)('recovery:orphan', error, {
                        guildId: ticket.guildId,
                        entityType: 'ticket',
                        entityId: ticket.id,
                    });
                }
            }
        }
        catch (error) {
            await (0, interactionErrorHandler_1.handleBackgroundError)('recovery:orphan:guild', error, { guildId: guild.id });
        }
    }
    return orphaned;
}
/** Reescreve o cartao publicado de uma cobranca. Nunca lanca. */
async function tryRefreshCard(client, paymentId, guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (guild === undefined)
        return;
    try {
        const updated = await (0, prisma_1.getPrisma)().payment.findUnique({ where: { id: paymentId } });
        if (updated !== null)
            await (0, PaymentCardService_1.refreshPaymentCard)(guild, updated);
    }
    catch (error) {
        logger.warn('Falha ao atualizar cartao de cobranca expirada.', {
            guildId,
            entityType: 'payment',
            entityId: paymentId,
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}
/** Cobrancas vencidas enquanto o bot estava offline. */
async function recoverExpiredPayments(client) {
    const pending = await (0, PaymentRepository_1.listExpiredPending)(new Date(), EXPIRED_PAYMENT_BATCH);
    let expired = 0;
    for (const payment of pending) {
        if (!(await (0, PaymentService_1.expirePayment)(payment)))
            continue;
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
    const stale = await (0, PaymentRepository_1.listRecentlyExpiredWithCard)(since, EXPIRED_CARD_REPAIR_BATCH);
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
async function recoverPaidOrders(client) {
    const pending = await (0, OrderRepository_1.listOrdersPaidButNotSynced)(PAID_ORDER_SYNC_BATCH);
    let synced = 0;
    for (const order of pending) {
        try {
            const payment = await (0, prisma_1.getPrisma)().payment.findUnique({
                where: { id: order.paymentId ?? '' },
            });
            if (payment === null)
                continue;
            const updated = await (0, OrderService_1.syncOrderPaid)(payment);
            if (updated === null)
                continue;
            synced += 1;
            const guild = client.guilds.cache.get(order.guildId);
            if (guild !== undefined) {
                // Aviso ao cliente e best-effort: DM fechada nao invalida o pedido.
                await (0, OrderNotificationService_1.notifyOrderPaid)(guild, updated).catch(() => undefined);
                // O quadro tambem: o pagamento que ficou pela metade quando o bot caiu
                // precisa aparecer como demanda, senao ninguem sabe que ha o que fazer.
                await (0, DemandBoardService_1.publishDemandById)(guild, updated.id).catch(() => undefined);
            }
        }
        catch (error) {
            await (0, interactionErrorHandler_1.handleBackgroundError)('recovery:order', error, {
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
async function recoverPanels(client) {
    let checked = 0;
    for (const guild of client.guilds.cache.values()) {
        try {
            const result = await (0, TicketPanelService_1.ensurePanelHealthy)(guild);
            // O painel do catalogo segue a mesma politica: reconstruir sem duplicar.
            await (0, CatalogPanelService_1.ensureCatalogPanelHealthy)(guild).catch(() => undefined);
            checked += 1;
            if (!result.updated && result.reason !== undefined) {
                logger.debug('Painel publico nao atualizado no startup.', {
                    guildId: guild.id,
                    detail: result.reason,
                });
            }
        }
        catch (error) {
            await (0, interactionErrorHandler_1.handleBackgroundError)('recovery:panel', error, { guildId: guild.id });
        }
    }
    return checked;
}
async function runStartupRecovery(client) {
    const stuck = await recoverStuckTickets(client);
    const orphanedTickets = await recoverOrphanedTickets(client);
    const expiredPayments = await recoverExpiredPayments(client);
    const syncedOrders = await recoverPaidOrders(client);
    const panelsChecked = await recoverPanels(client);
    const report = {
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
async function runPeriodicRecovery(client) {
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
//# sourceMappingURL=RecoveryService.js.map