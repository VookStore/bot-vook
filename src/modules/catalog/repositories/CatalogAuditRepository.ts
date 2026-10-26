import type {
  CatalogAuditAction,
  CatalogAuditLog,
  OrderAuditAction,
  OrderAuditLog,
  Prisma,
} from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';
import { createLogger } from '../../../core/logger/Logger';

/**
 * Auditoria do catalogo e dos pedidos.
 *
 * Mesma politica do resto do sistema: falha de auditoria NUNCA derruba a
 * operacao principal fora de transacao (vira WARN). Dentro de uma transacao o
 * erro TEM de subir — no PostgreSQL um statement que falha aborta a transacao
 * inteira, e engolir aqui produziria um COMMIT quebrado longe da causa.
 */

const logger = createLogger('catalog:audit');

export interface CatalogAuditInput {
  guildId: string;
  action: CatalogAuditAction;
  packId?: string | null;
  categoryId?: string | null;
  imageId?: string | null;
  actorId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordCatalogAudit(
  input: CatalogAuditInput,
  db: DatabaseClient = getPrisma(),
): Promise<CatalogAuditLog | null> {
  const insideTransaction = db !== getPrisma();

  try {
    return await db.catalogAuditLog.create({
      data: {
        guildId: input.guildId,
        action: input.action,
        packId: input.packId ?? null,
        categoryId: input.categoryId ?? null,
        imageId: input.imageId ?? null,
        actorId: input.actorId ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  } catch (error) {
    if (insideTransaction) throw error;
    logger.warn('Falha ao registrar auditoria do catalogo.', {
      guildId: input.guildId,
      action: input.action,
      entityType: 'pack',
      entityId: input.packId ?? input.categoryId ?? null,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export interface OrderAuditInput {
  guildId: string;
  orderId: string;
  action: OrderAuditAction;
  performedById?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordOrderAudit(
  input: OrderAuditInput,
  db: DatabaseClient = getPrisma(),
): Promise<OrderAuditLog | null> {
  const insideTransaction = db !== getPrisma();

  try {
    return await db.orderAuditLog.create({
      data: {
        guildId: input.guildId,
        orderId: input.orderId,
        action: input.action,
        performedById: input.performedById ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  } catch (error) {
    if (insideTransaction) throw error;
    logger.warn('Falha ao registrar auditoria do pedido.', {
      guildId: input.guildId,
      entityType: 'order',
      entityId: input.orderId,
      action: input.action,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listOrderAudit(
  orderId: string,
  db: DatabaseClient = getPrisma(),
): Promise<OrderAuditLog[]> {
  return db.orderAuditLog.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
}
