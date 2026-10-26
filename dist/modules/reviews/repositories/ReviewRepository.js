"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findReviewByTicketId = findReviewByTicketId;
exports.findReviewById = findReviewById;
exports.createReview = createReview;
exports.attachPublication = attachPublication;
exports.countReviews = countReviews;
exports.averageRating = averageRating;
exports.listRecentReviews = listRecentReviews;
exports.countReviewsByRating = countReviewsByRating;
const prisma_1 = require("../../../core/database/prisma");
async function findReviewByTicketId(ticketId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketReview.findUnique({ where: { ticketId } });
}
async function findReviewById(id, db = (0, prisma_1.getPrisma)()) {
    return db.ticketReview.findUnique({ where: { id } });
}
/**
 * Cria a avaliacao.
 * Pode lancar violacao de UNIQUE (`ticketId`) em corrida — quem chama trata
 * com `isUniqueConstraintError` e converte em `ReviewAlreadySubmittedError`.
 */
async function createReview(input, db = (0, prisma_1.getPrisma)()) {
    return db.ticketReview.create({
        data: {
            guildId: input.guildId,
            ticketId: input.ticketId,
            customerId: input.customerId,
            staffId: input.staffId,
            rating: input.rating,
            comment: input.comment,
        },
    });
}
/** Guarda onde a avaliacao foi publicada (canal publico de avaliacoes). */
async function attachPublication(reviewId, channelId, messageId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketReview.update({
        where: { id: reviewId },
        data: { reviewChannelId: channelId, reviewMessageId: messageId },
    });
}
async function countReviews(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketReview.count({ where: { guildId } });
}
/** Media das notas da guild. `null` quando ainda nao ha avaliacao. */
async function averageRating(guildId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.ticketReview.aggregate({
        where: { guildId },
        _avg: { rating: true },
    });
    return result._avg.rating ?? null;
}
/** Avaliacoes mais recentes (usado em paineis de resumo). */
async function listRecentReviews(guildId, limit, db = (0, prisma_1.getPrisma)()) {
    // `Math.trunc(NaN)` continua NaN e passaria direto para o `take` do Prisma.
    const requested = Number.isFinite(limit) ? Math.trunc(limit) : 1;
    const take = Math.max(1, Math.min(100, requested));
    return db.ticketReview.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take,
    });
}
/** Quantidade de avaliacoes por nota (1..5), usado em estatisticas. */
async function countReviewsByRating(guildId, db = (0, prisma_1.getPrisma)()) {
    const grouped = await db.ticketReview.groupBy({
        by: ['rating'],
        where: { guildId },
        _count: { _all: true },
    });
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of grouped) {
        distribution[row.rating] = row._count._all;
    }
    return distribution;
}
//# sourceMappingURL=ReviewRepository.js.map