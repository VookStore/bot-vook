"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordCatalogAudit = recordCatalogAudit;
exports.recordOrderAudit = recordOrderAudit;
exports.listOrderAudit = listOrderAudit;
const prisma_1 = require("../../../core/database/prisma");
const Logger_1 = require("../../../core/logger/Logger");
/**
 * Auditoria do catalogo e dos pedidos.
 *
 * Mesma politica do resto do sistema: falha de auditoria NUNCA derruba a
 * operacao principal fora de transacao (vira WARN). Dentro de uma transacao o
 * erro TEM de subir — no PostgreSQL um statement que falha aborta a transacao
 * inteira, e engolir aqui produziria um COMMIT quebrado longe da causa.
 */
const logger = (0, Logger_1.createLogger)('catalog:audit');
async function recordCatalogAudit(input, db = (0, prisma_1.getPrisma)()) {
    const insideTransaction = db !== (0, prisma_1.getPrisma)();
    try {
        return await db.catalogAuditLog.create({
            data: {
                guildId: input.guildId,
                action: input.action,
                packId: input.packId ?? null,
                categoryId: input.categoryId ?? null,
                imageId: input.imageId ?? null,
                actorId: input.actorId ?? null,
                oldValue: input.oldValue ?? null,
                newValue: input.newValue ?? null,
                ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
            },
        });
    }
    catch (error) {
        if (insideTransaction)
            throw error;
        logger.warn('Falha ao registrar auditoria do catalogo.', {
            guildId: input.guildId,
            action: input.action,
            entityType: 'pack',
            entityId: input.packId ?? input.categoryId ?? null,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
async function recordOrderAudit(input, db = (0, prisma_1.getPrisma)()) {
    const insideTransaction = db !== (0, prisma_1.getPrisma)();
    try {
        return await db.orderAuditLog.create({
            data: {
                guildId: input.guildId,
                orderId: input.orderId,
                action: input.action,
                performedById: input.performedById ?? null,
                oldValue: input.oldValue ?? null,
                newValue: input.newValue ?? null,
                ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
            },
        });
    }
    catch (error) {
        if (insideTransaction)
            throw error;
        logger.warn('Falha ao registrar auditoria do pedido.', {
            guildId: input.guildId,
            entityType: 'order',
            entityId: input.orderId,
            action: input.action,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
async function listOrderAudit(orderId, db = (0, prisma_1.getPrisma)()) {
    return db.orderAuditLog.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
}
//# sourceMappingURL=CatalogAuditRepository.js.map