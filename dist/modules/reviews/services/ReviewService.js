"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canRequestReview = canRequestReview;
exports.submitReview = submitReview;
exports.publishReview = publishReview;
exports.getReviewStats = getReviewStats;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../../components/reply");
const clientHolder_1 = require("../../../core/client/clientHolder");
const prisma_1 = require("../../../core/database/prisma");
const errors_1 = require("../../../core/errors");
const LockService_1 = require("../../../core/locks/LockService");
const Logger_1 = require("../../../core/logger/Logger");
const sanitize_1 = require("../../../utils/sanitize");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const TicketRepository_1 = require("../../tickets/repositories/TicketRepository");
const ReviewBuilders_1 = require("../builders/ReviewBuilders");
const ReviewRepository_1 = require("../repositories/ReviewRepository");
const logger = (0, Logger_1.createLogger)('reviews');
/**
 * Avaliacao pos-atendimento.
 *
 * Fluxo: ticket encerrado -> DM com 5 botoes -> modal de comentario opcional ->
 * gravacao -> publicacao no canal publico.
 *
 * PRIVACIDADE: nada da conversa sai daqui. A publicacao recebe apenas nota,
 * cliente, numero do ticket, categoria, atendente, comentario sanitizado e data.
 *
 * DURABILIDADE: uma falha de publicacao (canal apagado, permissao removida)
 * NUNCA pode descartar a avaliacao ja gravada — publicar e sempre best-effort.
 */
/**
 * Janela curta que absorve o duplo clique nos botoes da DM.
 * A marca so e gravada APOS a avaliacao existir no banco, entao acertar o
 * cooldown significa, de fato, "voce acabou de avaliar".
 */
const REVIEW_SUBMIT_COOLDOWN_SECONDS = 60;
/** Lock um pouco maior que a soma das idas ao banco + envio no canal. */
const REVIEW_SUBMIT_LOCK_TTL_MS = 15_000;
/**
 * O ticket ainda pode receber avaliacao?
 *
 * Antes daqui saia uma SEGUNDA DM, logo atras da de encerramento, com o convite
 * de avaliacao. Duas mensagens quase iguais chegavam em sequencia e o cliente
 * respondia a segunda achando que era repeticao. Agora o convite e um botao
 * dentro do proprio cartao de encerramento, e o que sobra desta funcao e a
 * unica pergunta que o cartao precisa fazer: ha o que avaliar?
 *
 * Retorna `false` — sem lancar — em qualquer falha de leitura. Encerrar um
 * ticket jamais pode falhar por causa do convite: no pior caso o cliente recebe
 * o cartao sem o botao.
 */
async function canRequestReview(params) {
    try {
        return (await (0, ReviewRepository_1.findReviewByTicketId)(params.ticketId)) === null;
    }
    catch (error) {
        logger.warn('Falha ao verificar avaliacao existente: convite omitido do cartao.', {
            guildId: params.guildId,
            userId: params.customerId,
            entityType: 'ticket',
            entityId: params.ticketId,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
function assertValidRating(rating) {
    if (!Number.isInteger(rating) ||
        rating < ReviewBuilders_1.REVIEW_RATING_MIN ||
        rating > ReviewBuilders_1.REVIEW_RATING_MAX) {
        throw new errors_1.ReviewInvalidError(`Nota fora do intervalo aceito: ${String(rating)}`, {
            userMessage: `Escolha uma nota de ${ReviewBuilders_1.REVIEW_RATING_MIN} a ${ReviewBuilders_1.REVIEW_RATING_MAX} estrelas.`,
        });
    }
}
/**
 * Registra a avaliacao do cliente.
 *
 * Ordem de defesa contra duplicidade:
 *  1. cooldown em RAM (duplo clique imediato);
 *  2. lock cooperativo por ticket (corrida dentro do processo);
 *  3. leitura da avaliacao existente;
 *  4. UNIQUE de `ticketId` no banco — a unica garantia real.
 */
async function submitReview(params) {
    assertValidRating(params.rating);
    if (LockService_1.cooldowns.remainingSeconds(LockService_1.COOLDOWN_NAMESPACE.REVIEW_SUBMIT, params.ticketId, REVIEW_SUBMIT_COOLDOWN_SECONDS) > 0) {
        throw new errors_1.ReviewAlreadySubmittedError();
    }
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.REVIEW_SUBMIT, params.ticketId, async () => {
        const ticket = await (0, TicketRepository_1.findTicketWithCategory)(params.ticketId);
        if (ticket === null || ticket.guildId !== params.guildId) {
            throw new errors_1.TicketNotFoundError(params.ticketId, {
                context: { guildId: params.guildId, ticketId: params.ticketId },
            });
        }
        // O customId nao autoriza nada: so o dono do ticket pode avalia-lo.
        if (ticket.ownerId !== params.customerId) {
            throw new errors_1.PermissionError('Cliente diferente do dono do ticket.', {
                userMessage: 'Somente o cliente deste atendimento pode avalia-lo.',
                context: { ticketId: params.ticketId, userId: params.customerId },
            });
        }
        const existing = await (0, ReviewRepository_1.findReviewByTicketId)(params.ticketId);
        if (existing !== null)
            throw new errors_1.ReviewAlreadySubmittedError();
        const comment = (0, sanitize_1.sanitizeReviewComment)(params.comment);
        let review;
        try {
            review = await (0, ReviewRepository_1.createReview)({
                guildId: ticket.guildId,
                ticketId: ticket.id,
                customerId: ticket.ownerId,
                staffId: ticket.claimedById,
                rating: params.rating,
                comment,
            });
        }
        catch (error) {
            // Corrida real: outro processo gravou entre a leitura e o create.
            if ((0, prisma_1.isUniqueConstraintError)(error)) {
                throw new errors_1.ReviewAlreadySubmittedError({ cause: error });
            }
            // Erro de infraestrutura: o texto do Prisma nunca chega ao cliente.
            throw new errors_1.AppError('Falha ao gravar a avaliacao.', {
                code: 'REVIEW_PERSIST_FAILED',
                userMessage: 'Nao foi possivel registrar sua avaliacao agora. Tente novamente em instantes.',
                context: { guildId: ticket.guildId, ticketId: ticket.id },
                cause: error,
            });
        }
        LockService_1.cooldowns.mark(LockService_1.COOLDOWN_NAMESPACE.REVIEW_SUBMIT, params.ticketId);
        logger.audit('Avaliacao registrada.', {
            guildId: ticket.guildId,
            userId: ticket.ownerId,
            entityType: 'review',
            entityId: review.id,
            ticketNumber: ticket.ticketNumber,
            rating: review.rating,
            hasComment: comment !== null,
        });
        // Publicar e best-effort: a avaliacao ja esta salva e nao pode ser perdida.
        try {
            await publishReview(review);
        }
        catch (error) {
            logger.warn('Falha inesperada ao publicar a avaliacao.', {
                guildId: ticket.guildId,
                entityType: 'review',
                entityId: review.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
        return review;
    }, {
        ttlMs: REVIEW_SUBMIT_LOCK_TTL_MS,
        userMessage: 'Sua avaliacao ja esta sendo registrada. Aguarde alguns segundos.',
    });
}
/**
 * Publica a avaliacao no canal publico configurado.
 *
 * Retorna `false` (com WARN) quando o canal nao esta configurado, nao existe
 * mais ou o bot perdeu permissao. Nunca lanca: a avaliacao permanece salva.
 */
async function publishReview(review) {
    const logContext = {
        guildId: review.guildId,
        entityType: 'review',
        entityId: review.id,
    };
    try {
        const config = await (0, GuildConfigService_1.getGuildConfig)(review.guildId);
        const channelId = config.reviewChannelId;
        if (channelId === null || channelId.length === 0) {
            logger.warn('Canal de avaliacoes nao configurado: publicacao ignorada.', logContext);
            return false;
        }
        const client = (0, clientHolder_1.tryGetClient)();
        if (client === null) {
            logger.warn('Cliente do Discord indisponivel: publicacao ignorada.', logContext);
            return false;
        }
        const guild = client.guilds.cache.get(review.guildId) ?? (await client.guilds.fetch(review.guildId));
        const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
        if (!(0, discord_1.isSendableTextChannel)(channel)) {
            logger.warn('Canal de avaliacoes inexistente ou invalido.', { ...logContext, channelId });
            return false;
        }
        const botMember = guild.members.me;
        const permissions = botMember === null ? null : channel.permissionsFor(botMember);
        if (permissions === null ||
            !permissions.has([discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages])) {
            logger.warn('Sem permissao para publicar no canal de avaliacoes.', {
                ...logContext,
                channelId,
            });
            return false;
        }
        // Numero do ticket e categoria vem do ticket; nada mais dele e publicado.
        const ticket = await (0, TicketRepository_1.findTicketWithCategory)(review.ticketId);
        if (ticket === null) {
            logger.warn('Ticket da avaliacao nao encontrado: publicacao ignorada.', logContext);
            return false;
        }
        const message = await (0, reply_1.sendV2)(channel, (0, ReviewBuilders_1.buildPublishedReview)({
            storeName: config.storeName,
            rating: review.rating,
            customerId: review.customerId,
            ticketNumber: ticket.ticketNumber,
            categoryName: ticket.category.name,
            staffId: review.staffId,
            comment: review.comment,
            createdAt: review.createdAt,
        }));
        await (0, ReviewRepository_1.attachPublication)(review.id, channel.id, message.id);
        logger.info('Avaliacao publicada no canal publico.', {
            ...logContext,
            channelId: channel.id,
            messageId: message.id,
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error) || (0, discord_1.isMissingAccessError)(error)) {
            logger.warn('Canal de avaliacoes inacessivel: publicacao ignorada.', logContext);
            return false;
        }
        logger.warn('Falha ao publicar a avaliacao.', {
            ...logContext,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/** Total de avaliacoes e media das notas da guild. */
async function getReviewStats(guildId) {
    const [total, average] = await Promise.all([(0, ReviewRepository_1.countReviews)(guildId), (0, ReviewRepository_1.averageRating)(guildId)]);
    return { total, average: total === 0 ? null : average };
}
//# sourceMappingURL=ReviewService.js.map