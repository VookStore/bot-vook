import { PermissionFlagsBits } from 'discord.js';
import type { TicketReview } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { tryGetClient } from '../../../core/client/clientHolder';
import { isUniqueConstraintError } from '../../../core/database/prisma';
import {
  AppError,
  PermissionError,
  ReviewAlreadySubmittedError,
  ReviewInvalidError,
  TicketNotFoundError,
} from '../../../core/errors';
import {
  COOLDOWN_NAMESPACE,
  LOCK_NAMESPACE,
  cooldowns,
  locks,
} from '../../../core/locks/LockService';
import { createLogger } from '../../../core/logger/Logger';
import { sanitizeReviewComment } from '../../../utils/sanitize';
import {
  fetchChannelSafe,
  isMissingAccessError,
  isSendableTextChannel,
  isUnknownResourceError,
} from '../../../utils/discord';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { findTicketWithCategory } from '../../tickets/repositories/TicketRepository';
import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  buildPublishedReview,
} from '../builders/ReviewBuilders';
import {
  attachPublication,
  averageRating,
  countReviews,
  createReview,
  findReviewByTicketId,
} from '../repositories/ReviewRepository';

const logger = createLogger('reviews');

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
export async function canRequestReview(params: {
  guildId: string;
  ticketId: string;
  customerId: string;
}): Promise<boolean> {
  try {
    return (await findReviewByTicketId(params.ticketId)) === null;
  } catch (error) {
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

export interface SubmitReviewParams {
  guildId: string;
  ticketId: string;
  customerId: string;
  rating: number;
  comment: string | null;
}

function assertValidRating(rating: number): void {
  if (
    !Number.isInteger(rating) ||
    rating < REVIEW_RATING_MIN ||
    rating > REVIEW_RATING_MAX
  ) {
    throw new ReviewInvalidError(`Nota fora do intervalo aceito: ${String(rating)}`, {
      userMessage: `Escolha uma nota de ${REVIEW_RATING_MIN} a ${REVIEW_RATING_MAX} estrelas.`,
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
export async function submitReview(params: SubmitReviewParams): Promise<TicketReview> {
  assertValidRating(params.rating);

  if (
    cooldowns.remainingSeconds(
      COOLDOWN_NAMESPACE.REVIEW_SUBMIT,
      params.ticketId,
      REVIEW_SUBMIT_COOLDOWN_SECONDS,
    ) > 0
  ) {
    throw new ReviewAlreadySubmittedError();
  }

  return locks.withLock(
    LOCK_NAMESPACE.REVIEW_SUBMIT,
    params.ticketId,
    async () => {
      const ticket = await findTicketWithCategory(params.ticketId);
      if (ticket === null || ticket.guildId !== params.guildId) {
        throw new TicketNotFoundError(params.ticketId, {
          context: { guildId: params.guildId, ticketId: params.ticketId },
        });
      }

      // O customId nao autoriza nada: so o dono do ticket pode avalia-lo.
      if (ticket.ownerId !== params.customerId) {
        throw new PermissionError('Cliente diferente do dono do ticket.', {
          userMessage: 'Somente o cliente deste atendimento pode avalia-lo.',
          context: { ticketId: params.ticketId, userId: params.customerId },
        });
      }

      const existing = await findReviewByTicketId(params.ticketId);
      if (existing !== null) throw new ReviewAlreadySubmittedError();

      const comment = sanitizeReviewComment(params.comment);

      let review: TicketReview;
      try {
        review = await createReview({
          guildId: ticket.guildId,
          ticketId: ticket.id,
          customerId: ticket.ownerId,
          staffId: ticket.claimedById,
          rating: params.rating,
          comment,
        });
      } catch (error) {
        // Corrida real: outro processo gravou entre a leitura e o create.
        if (isUniqueConstraintError(error)) {
          throw new ReviewAlreadySubmittedError({ cause: error });
        }
        // Erro de infraestrutura: o texto do Prisma nunca chega ao cliente.
        throw new AppError('Falha ao gravar a avaliacao.', {
          code: 'REVIEW_PERSIST_FAILED',
          userMessage:
            'Nao foi possivel registrar sua avaliacao agora. Tente novamente em instantes.',
          context: { guildId: ticket.guildId, ticketId: ticket.id },
          cause: error,
        });
      }

      cooldowns.mark(COOLDOWN_NAMESPACE.REVIEW_SUBMIT, params.ticketId);

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
      } catch (error) {
        logger.warn('Falha inesperada ao publicar a avaliacao.', {
          guildId: ticket.guildId,
          entityType: 'review',
          entityId: review.id,
          detail: error instanceof Error ? error.message : String(error),
        });
      }

      return review;
    },
    {
      ttlMs: REVIEW_SUBMIT_LOCK_TTL_MS,
      userMessage: 'Sua avaliacao ja esta sendo registrada. Aguarde alguns segundos.',
    },
  );
}

/**
 * Publica a avaliacao no canal publico configurado.
 *
 * Retorna `false` (com WARN) quando o canal nao esta configurado, nao existe
 * mais ou o bot perdeu permissao. Nunca lanca: a avaliacao permanece salva.
 */
export async function publishReview(review: TicketReview): Promise<boolean> {
  const logContext = {
    guildId: review.guildId,
    entityType: 'review',
    entityId: review.id,
  };

  try {
    const config = await getGuildConfig(review.guildId);
    const channelId = config.reviewChannelId;
    if (channelId === null || channelId.length === 0) {
      logger.warn('Canal de avaliacoes nao configurado: publicacao ignorada.', logContext);
      return false;
    }

    const client = tryGetClient();
    if (client === null) {
      logger.warn('Cliente do Discord indisponivel: publicacao ignorada.', logContext);
      return false;
    }

    const guild =
      client.guilds.cache.get(review.guildId) ?? (await client.guilds.fetch(review.guildId));

    const channel = await fetchChannelSafe(guild, channelId);
    if (!isSendableTextChannel(channel)) {
      logger.warn('Canal de avaliacoes inexistente ou invalido.', { ...logContext, channelId });
      return false;
    }

    const botMember = guild.members.me;
    const permissions = botMember === null ? null : channel.permissionsFor(botMember);
    if (
      permissions === null ||
      !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    ) {
      logger.warn('Sem permissao para publicar no canal de avaliacoes.', {
        ...logContext,
        channelId,
      });
      return false;
    }

    // Numero do ticket e categoria vem do ticket; nada mais dele e publicado.
    const ticket = await findTicketWithCategory(review.ticketId);
    if (ticket === null) {
      logger.warn('Ticket da avaliacao nao encontrado: publicacao ignorada.', logContext);
      return false;
    }

    const message = await sendV2(
      channel,
      buildPublishedReview({
        storeName: config.storeName,
        rating: review.rating,
        customerId: review.customerId,
        ticketNumber: ticket.ticketNumber,
        categoryName: ticket.category.name,
        staffId: review.staffId,
        comment: review.comment,
        createdAt: review.createdAt,
      }),
    );

    await attachPublication(review.id, channel.id, message.id);

    logger.info('Avaliacao publicada no canal publico.', {
      ...logContext,
      channelId: channel.id,
      messageId: message.id,
    });
    return true;
  } catch (error) {
    if (isUnknownResourceError(error) || isMissingAccessError(error)) {
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

export interface ReviewStats {
  total: number;
  average: number | null;
}

/** Total de avaliacoes e media das notas da guild. */
export async function getReviewStats(guildId: string): Promise<ReviewStats> {
  const [total, average] = await Promise.all([countReviews(guildId), averageRating(guildId)]);
  return { total, average: total === 0 ? null : average };
}
