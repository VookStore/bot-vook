"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listActiveParticipants = listActiveParticipants;
exports.listAllParticipants = listAllParticipants;
exports.isActiveParticipant = isActiveParticipant;
exports.countActiveParticipants = countActiveParticipants;
exports.addParticipant = addParticipant;
exports.removeParticipant = removeParticipant;
const prisma_1 = require("../../../core/database/prisma");
/**
 * Participantes adicionais do ticket (alem do dono e da equipe).
 * A remocao preserva o historico: marca `removedAt`/`removedById` em vez de apagar.
 */
async function listActiveParticipants(ticketId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketParticipant.findMany({
        where: { ticketId, removedAt: null },
        orderBy: { addedAt: 'asc' },
    });
}
async function listAllParticipants(ticketId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketParticipant.findMany({ where: { ticketId }, orderBy: { addedAt: 'asc' } });
}
async function isActiveParticipant(ticketId, userId, db = (0, prisma_1.getPrisma)()) {
    const found = await db.ticketParticipant.findUnique({
        where: { ticketId_userId: { ticketId, userId } },
        select: { removedAt: true },
    });
    return found !== null && found.removedAt === null;
}
async function countActiveParticipants(ticketId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketParticipant.count({ where: { ticketId, removedAt: null } });
}
/**
 * Adiciona (ou readiciona) um participante.
 * O UNIQUE (ticketId, userId) impede duplicidade; readicionar limpa a remocao.
 */
async function addParticipant(params, db = (0, prisma_1.getPrisma)()) {
    return db.ticketParticipant.upsert({
        where: { ticketId_userId: { ticketId: params.ticketId, userId: params.userId } },
        create: {
            guildId: params.guildId,
            ticketId: params.ticketId,
            userId: params.userId,
            addedById: params.addedById,
        },
        update: {
            addedById: params.addedById,
            addedAt: new Date(),
            removedAt: null,
            removedById: null,
        },
    });
}
/** Retorna false quando o usuario nao era um participante ativo. */
async function removeParticipant(params, db = (0, prisma_1.getPrisma)()) {
    const result = await db.ticketParticipant.updateMany({
        where: { ticketId: params.ticketId, userId: params.userId, removedAt: null },
        data: { removedAt: new Date(), removedById: params.removedById },
    });
    return result.count === 1;
}
//# sourceMappingURL=TicketParticipantRepository.js.map