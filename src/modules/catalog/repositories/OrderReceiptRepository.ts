import type { OrderReceipt, ReceiptCheckStatus } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Persistencia dos comprovantes enviados pelo cliente.
 *
 * O comprovante e EVIDENCIA e trilha de auditoria — nunca autorizacao. Nada
 * aqui muda o estado de um pedido ou de uma cobranca.
 */

export interface CreateOrderReceiptInput {
  guildId: string;
  orderId: string;
  paymentId: string | null;
  uploadedById: string;
  fileName: string;
  contentType: string;
  fileUrl: string;
  checkStatus: ReceiptCheckStatus;
  detectedAmount: number | null;
  detectedDate: Date | null;
  checkNotes: string | null;
}

export async function createOrderReceipt(
  input: CreateOrderReceiptInput,
  db: DatabaseClient = getPrisma(),
): Promise<OrderReceipt> {
  return db.orderReceipt.create({ data: input });
}

export async function listOrderReceipts(
  orderId: string,
  db: DatabaseClient = getPrisma(),
): Promise<OrderReceipt[]> {
  return db.orderReceipt.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
}

/** Ultimo comprovante enviado (o painel do cliente mostra o estado dele). */
export async function findLatestReceipt(
  orderId: string,
  db: DatabaseClient = getPrisma(),
): Promise<OrderReceipt | null> {
  return db.orderReceipt.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } });
}

export async function countOrderReceipts(
  orderId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.orderReceipt.count({ where: { orderId } });
}
