"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordTicketAudit = recordTicketAudit;
exports.listTicketAudit = listTicketAudit;
exports.recordTicketTransfer = recordTicketTransfer;
exports.listTicketTransfers = listTicketTransfers;
exports.recordPaymentAudit = recordPaymentAudit;
exports.listPaymentAudit = listPaymentAudit;
exports.recordCouponAudit = recordCouponAudit;
exports.listCouponAudit = listCouponAudit;
const prisma_1 = require("../../../core/database/prisma");
const Logger_1 = require("../../../core/logger/Logger");
/**
 * Auditoria.
 *
 * Toda acao relevante de ticket, pagamento e cupom e registrada aqui.
 * Falha de auditoria NUNCA derruba a operacao principal: ela e registrada como
 * WARN e a operacao segue (a alternativa — perder o atendimento por causa de um
 * log — seria pior para o cliente).
 */
const logger = (0, Logger_1.createLogger)('audit');
async function recordTicketAudit(input, db = (0, prisma_1.getPrisma)()) {
    try {
        return await db.ticketAuditLog.create({
            data: {
                guildId: input.guildId,
                ticketId: input.ticketId,
                action: input.action,
                actorId: input.actorId ?? null,
                targetId: input.targetId ?? null,
                oldValue: input.oldValue ?? null,
                newValue: input.newValue ?? null,
                ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
            },
        });
    }
    catch (error) {
        logger.warn('Falha ao registrar auditoria de ticket.', {
            guildId: input.guildId,
            entityType: 'ticket',
            entityId: input.ticketId,
            action: input.action,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
async function listTicketAudit(ticketId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketAuditLog.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
}
async function recordTicketTransfer(params, db = (0, prisma_1.getPrisma)()) {
    return db.ticketTransfer.create({
        data: {
            guildId: params.guildId,
            ticketId: params.ticketId,
            fromStaffId: params.fromStaffId,
            toStaffId: params.toStaffId,
            transferredById: params.transferredById,
            reason: params.reason ?? null,
        },
    });
}
async function listTicketTransfers(ticketId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketTransfer.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
}
async function recordPaymentAudit(input, db = (0, prisma_1.getPrisma)()) {
    try {
        return await db.paymentAuditLog.create({
            data: {
                guildId: input.guildId,
                paymentId: input.paymentId,
                action: input.action,
                actorId: input.actorId ?? null,
                oldValue: input.oldValue ?? null,
                newValue: input.newValue ?? null,
                ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
            },
        });
    }
    catch (error) {
        logger.warn('Falha ao registrar auditoria de pagamento.', {
            guildId: input.guildId,
            entityType: 'payment',
            entityId: input.paymentId,
            action: input.action,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
async function listPaymentAudit(paymentId, db = (0, prisma_1.getPrisma)()) {
    return db.paymentAuditLog.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } });
}
async function recordCouponAudit(input, db = (0, prisma_1.getPrisma)()) {
    const insideTransaction = db !== (0, prisma_1.getPrisma)();
    try {
        return await db.couponAuditLog.create({
            data: {
                guildId: input.guildId,
                couponId: input.couponId,
                action: input.action,
                actorId: input.actorId ?? null,
                paymentId: input.paymentId ?? null,
                oldValue: input.oldValue ?? null,
                newValue: input.newValue ?? null,
                ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
            },
        });
    }
    catch (error) {
        /*
         * DENTRO de uma transacao o erro TEM de subir.
         *
         * `recordCouponAudit` e chamado com `tx` na transacao de aprovacao de
         * pagamento. No PostgreSQL um statement que falha aborta a transacao
         * inteira: engolir o erro faria o codigo seguir, todo statement seguinte
         * falhar com "current transaction is aborted" e o COMMIT estourar depois,
         * longe da causa. Ou seja, engolir aqui produz exatamente o oposto de
         * "auditoria nunca derruba a operacao" — derruba, so que sem diagnostico.
         */
        if (insideTransaction)
            throw error;
        logger.warn('Falha ao registrar auditoria de cupom.', {
            guildId: input.guildId,
            entityType: 'coupon',
            entityId: input.couponId,
            action: input.action,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
async function listCouponAudit(couponId, db = (0, prisma_1.getPrisma)()) {
    return db.couponAuditLog.findMany({ where: { couponId }, orderBy: { createdAt: 'desc' } });
}
//# sourceMappingURL=AuditRepository.js.map