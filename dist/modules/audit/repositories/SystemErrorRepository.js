"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSystemError = recordSystemError;
exports.countRecentErrors = countRecentErrors;
exports.listRecentErrors = listRecentErrors;
exports.resolveErrorsOlderThan = resolveErrorsOlderThan;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../../core/database/prisma");
const redact_1 = require("../../../core/logger/redact");
async function recordSystemError(input, db = (0, prisma_1.getPrisma)()) {
    if (!(0, prisma_1.isDatabaseConnected)())
        return null;
    try {
        return await db.systemErrorLog.create({
            data: {
                guildId: input.guildId ?? null,
                level: input.level ?? client_1.SystemLogLevel.ERROR,
                module: input.module,
                message: (0, redact_1.redactString)(input.message).slice(0, 2000),
                stack: input.stack !== null && input.stack !== undefined
                    ? (0, redact_1.redactString)(input.stack).slice(0, 8000)
                    : null,
                ...(input.metadata !== undefined
                    ? { metadata: (0, redact_1.redactContext)(input.metadata) }
                    : {}),
            },
        });
    }
    catch {
        // Log de erro nunca propaga erro.
        return null;
    }
}
async function countRecentErrors(since, guildId, db = (0, prisma_1.getPrisma)()) {
    return db.systemErrorLog.count({
        where: {
            level: client_1.SystemLogLevel.ERROR,
            createdAt: { gte: since },
            resolvedAt: null,
            ...(guildId !== undefined && guildId !== null ? { guildId } : {}),
        },
    });
}
async function listRecentErrors(limit, guildId, db = (0, prisma_1.getPrisma)()) {
    return db.systemErrorLog.findMany({
        where: {
            ...(guildId !== undefined && guildId !== null ? { guildId } : {}),
            resolvedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
}
async function resolveErrorsOlderThan(cutoff, db = (0, prisma_1.getPrisma)()) {
    const result = await db.systemErrorLog.updateMany({
        where: { createdAt: { lt: cutoff }, resolvedAt: null },
        data: { resolvedAt: new Date() },
    });
    return result.count;
}
//# sourceMappingURL=SystemErrorRepository.js.map