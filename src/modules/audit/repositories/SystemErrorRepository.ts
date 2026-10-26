import { SystemLogLevel, type SystemErrorLog } from '@prisma/client';

import { getPrisma, isDatabaseConnected, type DatabaseClient } from '../../../core/database/prisma';
import { redactContext, redactString } from '../../../core/logger/redact';

/**
 * Persistencia de erros do sistema.
 *
 * Tudo passa por sanitizacao antes de ser gravado: token, DATABASE_URL, senhas e
 * headers de autorizacao nunca chegam ao banco.
 * Falhar ao gravar um log jamais pode derrubar a operacao em andamento.
 */

export interface RecordSystemErrorInput {
  guildId?: string | null;
  level?: SystemLogLevel;
  module: string;
  message: string;
  stack?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordSystemError(
  input: RecordSystemErrorInput,
  db: DatabaseClient = getPrisma(),
): Promise<SystemErrorLog | null> {
  if (!isDatabaseConnected()) return null;
  try {
    return await db.systemErrorLog.create({
      data: {
        guildId: input.guildId ?? null,
        level: input.level ?? SystemLogLevel.ERROR,
        module: input.module,
        message: redactString(input.message).slice(0, 2000),
        stack: input.stack !== null && input.stack !== undefined
          ? redactString(input.stack).slice(0, 8000)
          : null,
        ...(input.metadata !== undefined
          ? { metadata: redactContext(input.metadata) as never }
          : {}),
      },
    });
  } catch {
    // Log de erro nunca propaga erro.
    return null;
  }
}

export async function countRecentErrors(
  since: Date,
  guildId?: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.systemErrorLog.count({
    where: {
      level: SystemLogLevel.ERROR,
      createdAt: { gte: since },
      resolvedAt: null,
      ...(guildId !== undefined && guildId !== null ? { guildId } : {}),
    },
  });
}

export async function listRecentErrors(
  limit: number,
  guildId?: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<SystemErrorLog[]> {
  return db.systemErrorLog.findMany({
    where: {
      ...(guildId !== undefined && guildId !== null ? { guildId } : {}),
      resolvedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function resolveErrorsOlderThan(
  cutoff: Date,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  const result = await db.systemErrorLog.updateMany({
    where: { createdAt: { lt: cutoff }, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  return result.count;
}
