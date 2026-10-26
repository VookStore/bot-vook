"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPayment = createPayment;
exports.findPaymentById = findPaymentById;
exports.findPaymentWithAccount = findPaymentWithAccount;
exports.setPaymentMessage = setPaymentMessage;
exports.updatePendingPayment = updatePendingPayment;
exports.approvePaymentAtomic = approvePaymentAtomic;
exports.cancelPaymentAtomic = cancelPaymentAtomic;
exports.expirePaymentAtomic = expirePaymentAtomic;
exports.listExpiredPending = listExpiredPending;
exports.listRecentlyExpiredWithCard = listRecentlyExpiredWithCard;
exports.countPendingPayments = countPendingPayments;
exports.listPaymentsByCustomer = listPaymentsByCustomer;
exports.countPaymentsByStatus = countPaymentsByStatus;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../../core/database/prisma");
async function createPayment(input, db = (0, prisma_1.getPrisma)()) {
    return db.payment.create({ data: { ...input, status: client_1.PaymentStatus.PENDING } });
}
async function findPaymentById(id, db = (0, prisma_1.getPrisma)()) {
    return db.payment.findUnique({ where: { id } });
}
async function findPaymentWithAccount(id, db = (0, prisma_1.getPrisma)()) {
    return db.payment.findUnique({ where: { id }, include: { account: true } });
}
async function setPaymentMessage(id, channelId, messageId, db = (0, prisma_1.getPrisma)()) {
    return db.payment.update({ where: { id }, data: { channelId, messageId } });
}
/**
 * Atualiza valores/cupom de uma cobranca que AINDA esta pendente.
 * Retorna null se o pagamento saiu de PENDING no meio do caminho.
 */
async function updatePendingPayment(id, data, db = (0, prisma_1.getPrisma)()) {
    const result = await db.payment.updateMany({
        where: { id, status: client_1.PaymentStatus.PENDING },
        data,
    });
    if (result.count !== 1)
        return null;
    return db.payment.findUnique({ where: { id } });
}
/** PENDING -> APPROVED. Retorna false quando outra acao chegou antes. */
async function approvePaymentAtomic(id, approvedById, db = (0, prisma_1.getPrisma)()) {
    const result = await db.payment.updateMany({
        where: { id, status: client_1.PaymentStatus.PENDING },
        data: { status: client_1.PaymentStatus.APPROVED, approvedById, approvedAt: new Date() },
    });
    return result.count === 1;
}
/** PENDING -> CANCELLED. */
async function cancelPaymentAtomic(id, cancelledById, cancelReason, db = (0, prisma_1.getPrisma)()) {
    const result = await db.payment.updateMany({
        where: { id, status: client_1.PaymentStatus.PENDING },
        data: {
            status: client_1.PaymentStatus.CANCELLED,
            cancelledById,
            cancelledAt: new Date(),
            cancelReason,
        },
    });
    return result.count === 1;
}
/** PENDING vencido -> EXPIRED. */
async function expirePaymentAtomic(id, db = (0, prisma_1.getPrisma)()) {
    const result = await db.payment.updateMany({
        where: { id, status: client_1.PaymentStatus.PENDING, expiresAt: { lte: new Date() } },
        data: { status: client_1.PaymentStatus.EXPIRED },
    });
    return result.count === 1;
}
/** Cobrancas pendentes ja vencidas (job de expiracao e recovery). */
async function listExpiredPending(now, limit, db = (0, prisma_1.getPrisma)()) {
    return db.payment.findMany({
        where: { status: client_1.PaymentStatus.PENDING, expiresAt: { lte: now } },
        orderBy: { expiresAt: 'asc' },
        take: limit,
    });
}
/**
 * Cobrancas expiradas HA POUCO que ainda tem cartao publicado.
 *
 * Serve para reparar o cartao numa rodada seguinte quando a atualizacao falhou
 * na rodada em que a cobranca expirou (guild fora do cache, erro do Discord,
 * shutdown no meio do laco). Sem isso o cliente continuava vendo "PENDENTE"
 * com um QR PIX valido de uma cobranca que o sistema ja considera vencida —
 * para sempre, porque nenhum job reprocessa pagamento ja EXPIRED.
 */
async function listRecentlyExpiredWithCard(since, limit, db = (0, prisma_1.getPrisma)()) {
    return db.payment.findMany({
        where: {
            status: client_1.PaymentStatus.EXPIRED,
            messageId: { not: null },
            updatedAt: { gte: since },
        },
        orderBy: { updatedAt: 'asc' },
        take: limit,
    });
}
async function countPendingPayments(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.payment.count({ where: { guildId, status: client_1.PaymentStatus.PENDING } });
}
async function listPaymentsByCustomer(guildId, customerId, limit, db = (0, prisma_1.getPrisma)()) {
    return db.payment.findMany({
        where: { guildId, customerId },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
}
async function countPaymentsByStatus(guildId, status, db = (0, prisma_1.getPrisma)()) {
    return db.payment.count({ where: { guildId, status } });
}
//# sourceMappingURL=PaymentRepository.js.map