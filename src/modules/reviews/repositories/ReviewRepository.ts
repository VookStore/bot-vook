import type { TicketReview } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Avaliacoes pos-atendimento.
 *
 * Uma unica avaliacao por ticket — a garantia real e a constraint UNIQUE em
 * `ticketId` (ver prisma/schema.prisma). Locks e cooldowns apenas evitam o
 * trabalho repetido; quem decide e o banco.
 *
 * Este repositorio NAO guarda nenhum conteudo privado da conversa: somente
 * nota, comentario ja sanitizado, cliente, atendente e a referencia da
 * publicacao no canal publico.
 */

export interface CreateReviewInput {
  guildId: string;
  ticketId: string;
  customerId: string;
  staffId: string | null;
  rating: number;
  comment: string | null;
}

export async function findReviewByTicketId(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketReview | null> {
  return db.ticketReview.findUnique({ where: { ticketId } });
}

export async function findReviewById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketReview | null> {
  return db.ticketReview.findUnique({ where: { id } });
}

/**
 * Cria a avaliacao.
 * Pode lancar violacao de UNIQUE (`ticketId`) em corrida — quem chama trata
 * com `isUniqueConstraintError` e converte em `ReviewAlreadySubmittedError`.
 */
export async function createReview(
  input: CreateReviewInput,
  db: DatabaseClient = getPrisma(),
): Promise<TicketReview> {
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
export async function attachPublication(
  reviewId: string,
  channelId: string,
  messageId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketReview> {
  return db.ticketReview.update({
    where: { id: reviewId },
    data: { reviewChannelId: channelId, reviewMessageId: messageId },
  });
}

export async function countReviews(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.ticketReview.count({ where: { guildId } });
}

/** Media das notas da guild. `null` quando ainda nao ha avaliacao. */
export async function averageRating(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number | null> {
  const result = await db.ticketReview.aggregate({
    where: { guildId },
    _avg: { rating: true },
  });
  return result._avg.rating ?? null;
}

/** Avaliacoes mais recentes (usado em paineis de resumo). */
export async function listRecentReviews(
  guildId: string,
  limit: number,
  db: DatabaseClient = getPrisma(),
): Promise<TicketReview[]> {
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
export async function countReviewsByRating(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<Record<number, number>> {
  const grouped = await db.ticketReview.groupBy({
    by: ['rating'],
    where: { guildId },
    _count: { _all: true },
  });

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of grouped) {
    distribution[row.rating] = row._count._all;
  }
  return distribution;
}
