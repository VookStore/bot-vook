import type {
  CouponAuditAction,
  CouponAuditLog,
  PaymentAuditAction,
  PaymentAuditLog,
  Prisma,
  TicketAuditAction,
  TicketAuditLog,
  TicketTransfer,
} from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';
import { createLogger } from '../../../core/logger/Logger';

/**
 * Auditoria.
 *
 * Toda acao relevante de ticket, pagamento e cupom e registrada aqui.
 * Falha de auditoria NUNCA derruba a operacao principal: ela e registrada como
 * WARN e a operacao segue (a alternativa — perder o atendimento por causa de um
 * log — seria pior para o cliente).
 */

const logger = createLogger('audit');

export interface TicketAuditInput {
  guildId: string;
  ticketId: string;
  action: TicketAuditAction;
  actorId?: string | null;
  targetId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordTicketAudit(
  input: TicketAuditInput,
  db: DatabaseClient = getPrisma(),
): Promise<TicketAuditLog | null> {
  try {
    return await db.ticketAuditLog.create({
      data: {
        guildId: input.guildId,
        ticketId: input.ticketId,
        action: input.action,
        actorId: input.actorId ?? null,
        targetId: input.targetId ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  } catch (error) {
    logger.warn('Falha ao registrar auditoria de ticket.', {
      guildId: input.guildId,
      entityType: 'ticket',
      entityId: input.ticketId,
      action: input.action,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listTicketAudit(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketAuditLog[]> {
  return db.ticketAuditLog.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
}

export async function recordTicketTransfer(
  params: {
    guildId: string;
    ticketId: string;
    fromStaffId: string | null;
    toStaffId: string;
    transferredById: string;
    reason?: string | null;
  },
  db: DatabaseClient = getPrisma(),
): Promise<TicketTransfer> {
  return db.ticketTransfer.create({
    data: {
      guildId: params.guildId,
      ticketId: params.ticketId,
      fromStaffId: params.fromStaffId,
      toStaffId: params.toStaffId,
      transferredById: params.transferredById,
      reason: params.reason ?? null,
    },
  });
}

export async function listTicketTransfers(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketTransfer[]> {
  return db.ticketTransfer.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
}

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------

export interface PaymentAuditInput {
  guildId: string;
  paymentId: string;
  action: PaymentAuditAction;
  actorId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordPaymentAudit(
  input: PaymentAuditInput,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAuditLog | null> {
  try {
    return await db.paymentAuditLog.create({
      data: {
        guildId: input.guildId,
        paymentId: input.paymentId,
        action: input.action,
        actorId: input.actorId ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  } catch (error) {
    logger.warn('Falha ao registrar auditoria de pagamento.', {
      guildId: input.guildId,
      entityType: 'payment',
      entityId: input.paymentId,
      action: input.action,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listPaymentAudit(
  paymentId: string,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAuditLog[]> {
  return db.paymentAuditLog.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } });
}

// ---------------------------------------------------------------------------
// Cupons
// ---------------------------------------------------------------------------

export interface CouponAuditInput {
  guildId: string;
  couponId: string;
  action: CouponAuditAction;
  actorId?: string | null;
  paymentId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordCouponAudit(
  input: CouponAuditInput,
  db: DatabaseClient = getPrisma(),
): Promise<CouponAuditLog | null> {
  const insideTransaction = db !== getPrisma();

  try {
    return await db.couponAuditLog.create({
      data: {
        guildId: input.guildId,
        couponId: input.couponId,
        action: input.action,
        actorId: input.actorId ?? null,
        paymentId: input.paymentId ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  } catch (error) {
    /*
     * DENTRO de uma transacao o erro TEM de subir.
     *
     * `recordCouponAudit` e chamado com `tx` na transacao de aprovacao de
     * pagamento. No PostgreSQL um statement que falha aborta a transacao
     * inteira: engolir o erro faria o codigo seguir, todo statement seguinte
     * falhar com "current transaction is aborted" e o COMMIT estourar depois,
     * longe da causa. Ou seja, engolir aqui produz exatamente o oposto de
     * "auditoria nunca derruba a operacao" — derruba, so que sem diagnostico.
     */
    if (insideTransaction) throw error;

    logger.warn('Falha ao registrar auditoria de cupom.', {
      guildId: input.guildId,
      entityType: 'coupon',
      entityId: input.couponId,
      action: input.action,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listCouponAudit(
  couponId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CouponAuditLog[]> {
  return db.couponAuditLog.findMany({ where: { couponId }, orderBy: { createdAt: 'desc' } });
}
