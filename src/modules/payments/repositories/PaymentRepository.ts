import { PaymentStatus, type CouponType, type Payment, type Prisma } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Repositorio de cobrancas PIX.
 *
 * Transicoes de status usam update CONDICIONAL (`updateMany` com `where` no
 * status atual): duas aprovacoes simultaneas nunca aprovam duas vezes.
 * Valores sao sempre inteiros em centavos.
 */

export interface CreatePaymentInput {
  guildId: string;
  customerId: string;
  createdById: string;
  accountId: string;
  description: string;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  couponId: string | null;
  couponCodeSnapshot: string | null;
  couponTypeSnapshot: CouponType | null;
  couponValueSnapshot: number | null;
  pixPayload: string;
  expiresAt: Date;
  channelId: string | null;
}

export type PaymentWithAccount = Prisma.PaymentGetPayload<{ include: { account: true } }>;

export async function createPayment(
  input: CreatePaymentInput,
  db: DatabaseClient = getPrisma(),
): Promise<Payment> {
  return db.payment.create({ data: { ...input, status: PaymentStatus.PENDING } });
}

export async function findPaymentById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<Payment | null> {
  return db.payment.findUnique({ where: { id } });
}

export async function findPaymentWithAccount(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentWithAccount | null> {
  return db.payment.findUnique({ where: { id }, include: { account: true } });
}

export async function setPaymentMessage(
  id: string,
  channelId: string,
  messageId: string,
  db: DatabaseClient = getPrisma(),
): Promise<Payment> {
  return db.payment.update({ where: { id }, data: { channelId, messageId } });
}

/**
 * Atualiza valores/cupom de uma cobranca que AINDA esta pendente.
 * Retorna null se o pagamento saiu de PENDING no meio do caminho.
 */
export async function updatePendingPayment(
  id: string,
  data: {
    originalAmount?: number;
    discountAmount: number;
    finalAmount: number;
    couponId: string | null;
    couponCodeSnapshot: string | null;
    couponTypeSnapshot: CouponType | null;
    couponValueSnapshot: number | null;
    pixPayload: string;
  },
  db: DatabaseClient = getPrisma(),
): Promise<Payment | null> {
  const result = await db.payment.updateMany({
    where: { id, status: PaymentStatus.PENDING },
    data,
  });
  if (result.count !== 1) return null;
  return db.payment.findUnique({ where: { id } });
}

/** PENDING -> APPROVED. Retorna false quando outra acao chegou antes. */
export async function approvePaymentAtomic(
  id: string,
  approvedById: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.payment.updateMany({
    where: { id, status: PaymentStatus.PENDING },
    data: { status: PaymentStatus.APPROVED, approvedById, approvedAt: new Date() },
  });
  return result.count === 1;
}

/** PENDING -> CANCELLED. */
export async function cancelPaymentAtomic(
  id: string,
  cancelledById: string,
  cancelReason: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.payment.updateMany({
    where: { id, status: PaymentStatus.PENDING },
    data: {
      status: PaymentStatus.CANCELLED,
      cancelledById,
      cancelledAt: new Date(),
      cancelReason,
    },
  });
  return result.count === 1;
}

/** PENDING vencido -> EXPIRED. */
export async function expirePaymentAtomic(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.payment.updateMany({
    where: { id, status: PaymentStatus.PENDING, expiresAt: { lte: new Date() } },
    data: { status: PaymentStatus.EXPIRED },
  });
  return result.count === 1;
}

/** Cobrancas pendentes ja vencidas (job de expiracao e recovery). */
export async function listExpiredPending(
  now: Date,
  limit: number,
  db: DatabaseClient = getPrisma(),
): Promise<Payment[]> {
  return db.payment.findMany({
    where: { status: PaymentStatus.PENDING, expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  });
}

/**
 * Cobrancas expiradas HA POUCO que ainda tem cartao publicado.
 *
 * Serve para reparar o cartao numa rodada seguinte quando a atualizacao falhou
 * na rodada em que a cobranca expirou (guild fora do cache, erro do Discord,
 * shutdown no meio do laco). Sem isso o cliente continuava vendo "PENDENTE"
 * com um QR PIX valido de uma cobranca que o sistema ja considera vencida —
 * para sempre, porque nenhum job reprocessa pagamento ja EXPIRED.
 */
export async function listRecentlyExpiredWithCard(
  since: Date,
  limit: number,
  db: DatabaseClient = getPrisma(),
): Promise<Payment[]> {
  return db.payment.findMany({
    where: {
      status: PaymentStatus.EXPIRED,
      messageId: { not: null },
      updatedAt: { gte: since },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
}

export async function countPendingPayments(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.payment.count({ where: { guildId, status: PaymentStatus.PENDING } });
}

export async function listPaymentsByCustomer(
  guildId: string,
  customerId: string,
  limit: number,
  db: DatabaseClient = getPrisma(),
): Promise<Payment[]> {
  return db.payment.findMany({
    where: { guildId, customerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function countPaymentsByStatus(
  guildId: string,
  status: PaymentStatus,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.payment.count({ where: { guildId, status } });
}
