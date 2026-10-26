import type { PaymentAccount, PixKeyType, Prisma } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Contas PIX da loja (dados do recebedor).
 *
 * Exclusao e SEMPRE soft-delete (`deletedAt`), porque cobrancas historicas
 * referenciam a conta usada no recebimento. O par (guildId, identifier) e
 * UNIQUE incluindo registros excluidos — recadastrar um identifier existente
 * "revive" o registro, preservando o historico de pagamentos ligado a ele.
 *
 * Nada aqui valida chave PIX ou permissao: isso e responsabilidade do
 * PaymentAccountService. Este arquivo so fala com o banco.
 */

export interface CreatePaymentAccountInput {
  guildId: string;
  /** Nome de exibicao da conta ("Conta principal"). */
  name: string;
  /** Identificador tecnico unico na guild ("conta-principal"). */
  identifier: string;
  description?: string | null;
  /** Nome do recebedor ja normalizado para o campo 59 do BR Code. */
  receiverName: string;
  /** Chave PIX ja validada e normalizada. */
  pixKey: string;
  pixKeyType: PixKeyType;
  /** Cidade ja normalizada para o campo 60 do BR Code. */
  city: string;
  defaultExpirationMinutes: number;
}

export interface ListAccountsOptions {
  /** Inclui contas desativadas (painel administrativo). */
  includeDisabled?: boolean;
}

/** Contas vivas da guild, da mais antiga para a mais nova. */
export async function listAccounts(
  guildId: string,
  options: ListAccountsOptions = {},
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAccount[]> {
  return db.paymentAccount.findMany({
    where: {
      guildId,
      deletedAt: null,
      ...(options.includeDisabled === true ? {} : { enabled: true }),
    },
    orderBy: [{ createdAt: 'asc' }],
  });
}

export async function findAccountById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAccount | null> {
  return db.paymentAccount.findUnique({ where: { id } });
}

/** Busca por identifier incluindo registros soft-deleted (necessario para revive). */
export async function findAccountByIdentifier(
  guildId: string,
  identifier: string,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAccount | null> {
  return db.paymentAccount.findUnique({
    where: { guildId_identifier: { guildId, identifier } },
  });
}

/** Campos gravaveis compartilhados por criacao e revive. */
function accountData(input: CreatePaymentAccountInput): {
  name: string;
  description: string | null;
  receiverName: string;
  pixKey: string;
  pixKeyType: PixKeyType;
  city: string;
  defaultExpirationMinutes: number;
} {
  return {
    name: input.name,
    description: input.description ?? null,
    receiverName: input.receiverName,
    pixKey: input.pixKey,
    pixKeyType: input.pixKeyType,
    city: input.city,
    defaultExpirationMinutes: input.defaultExpirationMinutes,
  };
}

/**
 * Cria a conta.
 *
 * NAO usa upsert de proposito: um upsert por (guildId, identifier) sobrescreve
 * em silencio uma conta viva criada por outro administrador entre a checagem e
 * a gravacao — trocando a chave PIX de recebimento sem ninguem perceber. Aqui a
 * corrida vira violacao de unicidade, que o service converte em erro visivel.
 */
export async function createAccount(
  input: CreatePaymentAccountInput,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAccount> {
  return db.paymentAccount.create({
    data: {
      guildId: input.guildId,
      identifier: input.identifier,
      ...accountData(input),
      enabled: true,
      deletedAt: null,
    },
  });
}

/**
 * Reativa uma conta excluida com os novos dados, preservando o id (e portanto o
 * historico de cobrancas). A condicao `deletedAt: { not: null }` garante que uma
 * conta que voltou a existir no meio do caminho nunca seja sobrescrita: nesse
 * caso nada e gravado e a funcao devolve `null`.
 */
export async function reviveAccount(
  id: string,
  input: CreatePaymentAccountInput,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAccount | null> {
  const { count } = await db.paymentAccount.updateMany({
    where: { id, deletedAt: { not: null } },
    data: { ...accountData(input), enabled: true, deletedAt: null },
  });
  if (count === 0) return null;

  return db.paymentAccount.findUnique({ where: { id } });
}

export async function updateAccount(
  id: string,
  data: Prisma.PaymentAccountUncheckedUpdateInput,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAccount> {
  return db.paymentAccount.update({ where: { id }, data });
}

export async function setAccountEnabled(
  id: string,
  enabled: boolean,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAccount> {
  return db.paymentAccount.update({ where: { id }, data: { enabled } });
}

/** Desativa e marca como excluida — o historico de cobrancas continua valido. */
export async function softDeleteAccount(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<PaymentAccount> {
  return db.paymentAccount.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false },
  });
}

/** Quantidade de contas vivas (habilitadas ou nao). */
export async function countAccounts(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.paymentAccount.count({ where: { guildId, deletedAt: null } });
}
