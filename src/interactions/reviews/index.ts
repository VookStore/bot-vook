import {
  ComponentType,
  type ModalSubmitInteraction,
  type RepliableInteraction,
} from 'discord.js';
import type { Ticket, TicketReview } from '@prisma/client';

import { deferIfNeeded, replyV2, replyWarning } from '../../components/reply';
import {
  NAMESPACE,
  REVIEW_ACTION,
  requireArg,
  type ParsedCustomId,
} from '../../constants/customIds';
import {
  PermissionError,
  ReviewAlreadySubmittedError,
  ReviewInvalidError,
  TicketNotFoundError,
} from '../../core/errors';
import {
  REVIEW_COMMENT_INPUT_ID,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  buildReviewCommentModal,
  buildReviewRequest,
  buildReviewThanks,
} from '../../modules/reviews/builders/ReviewBuilders';
import { findReviewByTicketId } from '../../modules/reviews/repositories/ReviewRepository';
import { submitReview } from '../../modules/reviews/services/ReviewService';
import { getGuildConfig } from '../../modules/configuration/services/GuildConfigService';
import { findTicketById } from '../../modules/tickets/repositories/TicketRepository';
import { getCategoryById } from '../../modules/tickets/services/TicketConfigService';
import type { ButtonHandler, ModalHandler } from '../../types';

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
function parseRating(parsed: ParsedCustomId): number {
  const raw = requireArg(parsed, 1, 'nota');
  const rating = Number.parseInt(raw, 10);
  if (!Number.isInteger(rating) || rating < REVIEW_RATING_MIN || rating > REVIEW_RATING_MAX) {
    throw new ReviewInvalidError(`Nota invalida no customId: ${raw}`, {
      userMessage: `Escolha uma nota de ${REVIEW_RATING_MIN} a ${REVIEW_RATING_MAX} estrelas.`,
    });
  }
  return rating;
}

/** Carrega o ticket e confirma que quem clicou e o cliente dele. */
async function loadOwnedTicket(ticketId: string, userId: string): Promise<Ticket> {
  const ticket = await findTicketById(ticketId);
  if (ticket === null) {
    throw new TicketNotFoundError(ticketId, { context: { ticketId, userId } });
  }
  if (ticket.ownerId !== userId) {
    throw new PermissionError('Avaliacao tentada por quem nao e o cliente do ticket.', {
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
async function replyAlreadySubmitted(interaction: RepliableInteraction): Promise<void> {
  await replyWarning(interaction, new ReviewAlreadySubmittedError().userMessage);
}

/** Comentario e opcional: campo ausente ou em branco vira `null`. */
function readOptionalComment(interaction: ModalSubmitInteraction): string | null {
  const field = interaction.fields.fields.get(REVIEW_COMMENT_INPUT_ID);
  if (field === undefined || field.type !== ComponentType.TextInput) return null;
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
const startButton: ButtonHandler = {
  namespace: NAMESPACE.REVIEW,
  action: REVIEW_ACTION.START,
  guildOnly: false,
  async handle(interaction, parsed): Promise<void> {
    const ticketId = requireArg(parsed, 0, 'atendimento');

    await deferIfNeeded(interaction, { ephemeral: true });

    const ticket = await loadOwnedTicket(ticketId, interaction.user.id);

    const existing = await findReviewByTicketId(ticket.id);
    if (existing !== null) {
      await replyAlreadySubmitted(interaction);
      return;
    }

    const [config, category] = await Promise.all([
      getGuildConfig(ticket.guildId),
      getCategoryById(ticket.guildId, ticket.categoryId),
    ]);

    await replyV2(
      interaction,
      buildReviewRequest({
        ticketId: ticket.id,
        storeName: config.storeName,
        ticketNumber: ticket.ticketNumber,
        categoryName: category?.name ?? 'Atendimento',
      }),
    );
  },
};

/**
 * Clique em uma das estrelas.
 * `showModal` precisa ser a PRIMEIRA resposta da interacao — nada de defer aqui.
 */
const rateButton: ButtonHandler = {
  namespace: NAMESPACE.REVIEW,
  action: REVIEW_ACTION.RATE,
  guildOnly: false,
  async handle(interaction, parsed): Promise<void> {
    const ticketId = requireArg(parsed, 0, 'atendimento');
    const rating = parseRating(parsed);

    const ticket = await loadOwnedTicket(ticketId, interaction.user.id);

    const existing = await findReviewByTicketId(ticket.id);
    if (existing !== null) {
      await replyAlreadySubmitted(interaction);
      return;
    }

    await interaction.showModal(buildReviewCommentModal(ticket.id, rating));
  },
};

/** Envio do modal: grava a avaliacao e agradece. */
const commentModal: ModalHandler = {
  namespace: NAMESPACE.REVIEW,
  action: REVIEW_ACTION.COMMENT_MODAL,
  guildOnly: false,
  async handle(interaction, parsed): Promise<void> {
    const ticketId = requireArg(parsed, 0, 'atendimento');
    const rating = parseRating(parsed);
    const comment = readOptionalComment(interaction);

    await deferIfNeeded(interaction, { ephemeral: true });

    const ticket = await loadOwnedTicket(ticketId, interaction.user.id);

    let review: TicketReview;
    try {
      review = await submitReview({
        guildId: ticket.guildId,
        ticketId: ticket.id,
        customerId: interaction.user.id,
        rating,
        comment,
      });
    } catch (error) {
      // Cooldown, leitura previa ou corrida no UNIQUE: todos significam a mesma
      // coisa para o cliente, e nenhum deles e erro de sistema.
      if (error instanceof ReviewAlreadySubmittedError) {
        await replyAlreadySubmitted(interaction);
        return;
      }
      throw error;
    }

    await replyV2(interaction, buildReviewThanks(review.rating), { ephemeral: true });
  },
};

export const reviewButtons: ButtonHandler[] = [startButton, rateButton];

export const reviewModals: ModalHandler[] = [commentModal];
