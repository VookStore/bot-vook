"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewModals = exports.reviewButtons = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const customIds_1 = require("../../constants/customIds");
const errors_1 = require("../../core/errors");
const ReviewBuilders_1 = require("../../modules/reviews/builders/ReviewBuilders");
const ReviewRepository_1 = require("../../modules/reviews/repositories/ReviewRepository");
const ReviewService_1 = require("../../modules/reviews/services/ReviewService");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
const TicketRepository_1 = require("../../modules/tickets/repositories/TicketRepository");
const TicketConfigService_1 = require("../../modules/tickets/services/TicketConfigService");
/**
 * Handlers da avaliacao pos-atendimento.
 *
 * ATENCAO: estes componentes vivem na DM do cliente, portanto `guildOnly: false`
 * e obrigatorio — na DM nao existe `interaction.guild`.
 *
 * O customId carrega apenas o alvo. Dono do ticket, existencia e duplicidade
 * sao revalidados no banco a cada clique.
 */
/** Le a nota do customId (`review:<acao>:<ticketId>:<nota>`). */
function parseRating(parsed) {
    const raw = (0, customIds_1.requireArg)(parsed, 1, 'nota');
    const rating = Number.parseInt(raw, 10);
    if (!Number.isInteger(rating) || rating < ReviewBuilders_1.REVIEW_RATING_MIN || rating > ReviewBuilders_1.REVIEW_RATING_MAX) {
        throw new errors_1.ReviewInvalidError(`Nota invalida no customId: ${raw}`, {
            userMessage: `Escolha uma nota de ${ReviewBuilders_1.REVIEW_RATING_MIN} a ${ReviewBuilders_1.REVIEW_RATING_MAX} estrelas.`,
        });
    }
    return rating;
}
/** Carrega o ticket e confirma que quem clicou e o cliente dele. */
async function loadOwnedTicket(ticketId, userId) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null) {
        throw new errors_1.TicketNotFoundError(ticketId, { context: { ticketId, userId } });
    }
    if (ticket.ownerId !== userId) {
        throw new errors_1.PermissionError('Avaliacao tentada por quem nao e o cliente do ticket.', {
            userMessage: 'Somente o cliente deste atendimento pode avalia-lo.',
            context: { ticketId, userId },
        });
    }
    return ticket;
}
/**
 * "Ja avaliou" e um caminho NORMAL, nao uma falha: os botoes da DM continuam
 * clicaveis depois da avaliacao, entao o segundo clique e esperado.
 *
 * Este tratamento nasceu como contorno: o classificador global so conhecia
 * quatro classes de erro, e deixar o erro subir virava `logger.error` com stack
 * mais uma linha em `system_error_logs` a cada clique. Hoje a propria classe se
 * declara esperada (`AppError.expected`), entao o contorno ja nao e necessario
 * — continua aqui porque responder no proprio handler evita a ida ao tratador
 * global para um caminho que nao tem nada de excepcional.
 *
 * A mensagem continua vindo do proprio erro, para nao duplicar o texto.
 */
async function replyAlreadySubmitted(interaction) {
    await (0, reply_1.replyWarning)(interaction, new errors_1.ReviewAlreadySubmittedError().userMessage);
}
/** Comentario e opcional: campo ausente ou em branco vira `null`. */
function readOptionalComment(interaction) {
    const field = interaction.fields.fields.get(ReviewBuilders_1.REVIEW_COMMENT_INPUT_ID);
    if (field === undefined || field.type !== discord_js_1.ComponentType.TextInput)
        return null;
    const value = field.value.trim();
    return value.length > 0 ? value : null;
}
/**
 * Clique em "Avaliar este atendimento", no cartao de encerramento.
 *
 * Responde com o painel das cinco notas em vez de reescrever o cartao: o
 * cartao guarda os detalhes do atendimento (categoria, protocolo, quem
 * encerrou) que o cliente ainda pode querer reler, e reconstrui-lo aqui exigiria
 * recarregar guild, categoria e banner so para nao perder nada.
 *
 * Ticket ja avaliado nao chega a ver este botao — mas o cartao antigo continua
 * na DM e clicavel, entao a checagem e refeita aqui.
 */
const startButton = {
    namespace: customIds_1.NAMESPACE.REVIEW,
    action: customIds_1.REVIEW_ACTION.START,
    guildOnly: false,
    async handle(interaction, parsed) {
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'atendimento');
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const ticket = await loadOwnedTicket(ticketId, interaction.user.id);
        const existing = await (0, ReviewRepository_1.findReviewByTicketId)(ticket.id);
        if (existing !== null) {
            await replyAlreadySubmitted(interaction);
            return;
        }
        const [config, category] = await Promise.all([
            (0, GuildConfigService_1.getGuildConfig)(ticket.guildId),
            (0, TicketConfigService_1.getCategoryById)(ticket.guildId, ticket.categoryId),
        ]);
        await (0, reply_1.replyV2)(interaction, (0, ReviewBuilders_1.buildReviewRequest)({
            ticketId: ticket.id,
            storeName: config.storeName,
            ticketNumber: ticket.ticketNumber,
            categoryName: category?.name ?? 'Atendimento',
        }));
    },
};
/**
 * Clique em uma das estrelas.
 * `showModal` precisa ser a PRIMEIRA resposta da interacao — nada de defer aqui.
 */
const rateButton = {
    namespace: customIds_1.NAMESPACE.REVIEW,
    action: customIds_1.REVIEW_ACTION.RATE,
    guildOnly: false,
    async handle(interaction, parsed) {
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'atendimento');
        const rating = parseRating(parsed);
        const ticket = await loadOwnedTicket(ticketId, interaction.user.id);
        const existing = await (0, ReviewRepository_1.findReviewByTicketId)(ticket.id);
        if (existing !== null) {
            await replyAlreadySubmitted(interaction);
            return;
        }
        await interaction.showModal((0, ReviewBuilders_1.buildReviewCommentModal)(ticket.id, rating));
    },
};
/** Envio do modal: grava a avaliacao e agradece. */
const commentModal = {
    namespace: customIds_1.NAMESPACE.REVIEW,
    action: customIds_1.REVIEW_ACTION.COMMENT_MODAL,
    guildOnly: false,
    async handle(interaction, parsed) {
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'atendimento');
        const rating = parseRating(parsed);
        const comment = readOptionalComment(interaction);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const ticket = await loadOwnedTicket(ticketId, interaction.user.id);
        let review;
        try {
            review = await (0, ReviewService_1.submitReview)({
                guildId: ticket.guildId,
                ticketId: ticket.id,
                customerId: interaction.user.id,
                rating,
                comment,
            });
        }
        catch (error) {
            // Cooldown, leitura previa ou corrida no UNIQUE: todos significam a mesma
            // coisa para o cliente, e nenhum deles e erro de sistema.
            if (error instanceof errors_1.ReviewAlreadySubmittedError) {
                await replyAlreadySubmitted(interaction);
                return;
            }
            throw error;
        }
        await (0, reply_1.replyV2)(interaction, (0, ReviewBuilders_1.buildReviewThanks)(review.rating), { ephemeral: true });
    },
};
exports.reviewButtons = [startButton, rateButton];
exports.reviewModals = [commentModal];
//# sourceMappingURL=index.js.map