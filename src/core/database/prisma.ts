import { Prisma, PrismaClient } from '@prisma/client';

import { getEnv } from '../../config/env';
import { createLogger } from '../logger/Logger';

const logger = createLogger('database');

/**
 * Cliente dentro de uma transacao. Repositories aceitam este tipo para poderem
 * participar de transacoes maiores (ex.: aprovar pagamento + registrar uso de cupom).
 */
export type TransactionClient = Prisma.TransactionClient;

/** Aceita tanto o client raiz quanto um client transacional. */
export type DatabaseClient = AppPrismaClient | TransactionClient;

/**
 * O segundo parametro generico declara quais eventos de log sao emitidos.
 * Sem ele o Prisma infere `never` e `$on('warn' | 'error')` nao compila.
 */
export type AppPrismaClient = PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>;

let client: AppPrismaClient | null = null;
let connected = false;

export function getPrisma(): AppPrismaClient {
  if (client === null) {
    client = new PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>({
      datasources: { db: { url: getEnv().DATABASE_URL } },
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });

    client.$on('warn', (event) => {
      logger.warn('Prisma warning', { target: event.target, detail: event.message });
    });
    client.$on('error', (event) => {
      logger.error('Prisma error', undefined, { target: event.target, detail: event.message });
    });
  }
  return client;
}

/** Permite injetar um client (testes). */
export function setPrisma(instance: AppPrismaClient | null): void {
  client = instance;
  connected = instance !== null;
}

export async function connectDatabase(): Promise<void> {
  const prisma = getPrisma();
  await prisma.$connect();
  // Consulta trivial garante que a conexao realmente funciona.
  await prisma.$queryRaw`SELECT 1`;
  connected = true;
  logger.info('PostgreSQL conectado.');
}

export async function disconnectDatabase(): Promise<void> {
  if (client === null) return;
  await client.$disconnect();
  connected = false;
  logger.info('PostgreSQL desconectado.');
}

export function isDatabaseConnected(): boolean {
  return connected;
}

export interface DatabaseHealth {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const start = process.hrtime.bigint();
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { ok: true, latencyMs: Math.round(latencyMs) };
  } catch (error) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return {
      ok: false,
      latencyMs: Math.round(latencyMs),
      error: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}

/** Codigos de erro do Prisma usados em tratamento de concorrencia. */
export const PRISMA_ERROR = {
  UNIQUE_CONSTRAINT: 'P2002',
  RECORD_NOT_FOUND: 'P2025',
  FOREIGN_KEY: 'P2003',
} as const;

export function isPrismaKnownError(
  error: unknown,
  code?: string,
): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return code === undefined || error.code === code;
}

/** True quando o erro e violacao de UNIQUE (ex.: numero de ticket duplicado). */
export function isUniqueConstraintError(error: unknown): boolean {
  return isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_CONSTRAINT);
}
