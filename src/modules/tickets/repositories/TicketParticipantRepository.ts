import type { TicketParticipant } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Participantes adicionais do ticket (alem do dono e da equipe).
 * A remocao preserva o historico: marca `removedAt`/`removedById` em vez de apagar.
 */

export async function listActiveParticipants(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketParticipant[]> {
  return db.ticketParticipant.findMany({
    where: { ticketId, removedAt: null },
    orderBy: { addedAt: 'asc' },
  });
}

export async function listAllParticipants(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketParticipant[]> {
  return db.ticketParticipant.findMany({ where: { ticketId }, orderBy: { addedAt: 'asc' } });
}

export async function isActiveParticipant(
  ticketId: string,
  userId: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const found = await db.ticketParticipant.findUnique({
    where: { ticketId_userId: { ticketId, userId } },
    select: { removedAt: true },
  });
  return found !== null && found.removedAt === null;
}

export async function countActiveParticipants(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.ticketParticipant.count({ where: { ticketId, removedAt: null } });
}

/**
 * Adiciona (ou readiciona) um participante.
 * O UNIQUE (ticketId, userId) impede duplicidade; readicionar limpa a remocao.
 */
export async function addParticipant(
  params: { guildId: string; ticketId: string; userId: string; addedById: string },
  db: DatabaseClient = getPrisma(),
): Promise<TicketParticipant> {
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
export async function removeParticipant(
  params: { ticketId: string; userId: string; removedById: string },
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.ticketParticipant.updateMany({
    where: { ticketId: params.ticketId, userId: params.userId, removedAt: null },
    data: { removedAt: new Date(), removedById: params.removedById },
  });
  return result.count === 1;
}
