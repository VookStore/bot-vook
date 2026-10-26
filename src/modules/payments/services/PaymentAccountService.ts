import type { PaymentAccount, PixKeyType } from '@prisma/client';

import { BUSINESS_LIMITS, CACHE_TTL, DISCORD_LIMITS } from '../../../constants/limits';
import { CACHE_NAMESPACE, cache } from '../../../core/cache/CacheService';
import { isUniqueConstraintError } from '../../../core/database/prisma';
import { PaymentAccountError, ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { sanitizeConfigText, sanitizeIdentifier } from '../../../utils/sanitize';
import {
  countAccounts,
  createAccount,
  findAccountById,
  findAccountByIdentifier,
  listAccounts,
  reviveAccount,
  setAccountEnabled,
  softDeleteAccount,
  updateAccount,
} from '../repositories/PaymentAccountRepository';
import { validatePixKey } from '../validators/PixKeyValidator';
import { normalizePixText } from './PixPayloadService';

/**
 * Regras de negocio das contas PIX da loja.
 *
 * Leitura e cacheada (CACHE_NAMESPACE.PAYMENT_ACCOUNTS por guildId); TODA
 * escrita invalida o cache logo apos o commit no banco.
 *
 * PRIVACIDADE: a chave PIX completa nunca e registrada em log — apenas o tipo
 * e o identificador da conta aparecem na trilha de auditoria.
 */

const logger = createLogger('payment-accounts');

/** Nome de exibicao da conta (rotulo interno, nao vai para o BR Code). */
export const ACCOUNT_NAME_MAX = 60;

/** Observacao interna opcional sobre a conta. */
export const ACCOUNT_DESCRIPTION_MAX = 120;

export const EXPIRATION_MIN_MINUTES = 5;
export const EXPIRATION_MAX_MINUTES = 1440;
export const DEFAULT_EXPIRATION_MINUTES = 30;

/**
 * Teto de contas por guild. Amarrado ao limite de opcoes de um select para que
 * toda conta cadastrada continue selecionavel nos paineis.
 */
export const MAX_ACCOUNTS_PER_GUILD = DISCORD_LIMITS.SELECT_OPTIONS;

/** Folga usada para medir o texto normalizado antes de aplicar o corte do PIX. */
const PIX_TEXT_SCAN_LIMIT = 200;

/** Tamanho minimo do nome de exibicao (evita conta chamada "a"). */
const ACCOUNT_NAME_MIN = 2;

// ---------------------------------------------------------------------------
// Leitura cacheada
// ---------------------------------------------------------------------------

/** Todas as contas vivas da guild (habilitadas e desabilitadas). */
export async function getAccounts(guildId: string): Promise<PaymentAccount[]> {
  return cache.getOrLoad(
    CACHE_NAMESPACE.PAYMENT_ACCOUNTS,
    guildId,
    () => listAccounts(guildId, { includeDisabled: true }),
    CACHE_TTL.PAYMENT_ACCOUNTS_MS,
  );
}

export function invalidateAccounts(guildId: string): void {
  cache.delete(CACHE_NAMESPACE.PAYMENT_ACCOUNTS, guildId);
}

/** Somente as contas que podem receber cobranca agora. */
export async function getEnabledAccounts(guildId: string): Promise<PaymentAccount[]> {
  const accounts = await getAccounts(guildId);
  return accounts.filter((account) => account.enabled && account.deletedAt === null);
}

export async function getAccountById(
  guildId: string,
  accountId: string,
): Promise<PaymentAccount | null> {
  const cached = (await getAccounts(guildId)).find((account) => account.id === accountId);
  if (cached !== undefined) return cached;

  // A conta pode ter sido criada em outro processo: confirma no banco.
  const account = await findAccountById(accountId);
  if (account === null || account.guildId !== guildId || account.deletedAt !== null) return null;
  invalidateAccounts(guildId);
  return account;
}

/** Conta usada quando o vendedor nao escolhe outra: a mais antiga habilitada. */
export async function getDefaultAccount(guildId: string): Promise<PaymentAccount | null> {
  const enabled = await getEnabledAccounts(guildId);
  return enabled[0] ?? null;
}

// ---------------------------------------------------------------------------
// Normalizacao de entrada
// ---------------------------------------------------------------------------

/** Dados digitados pelo administrador no modal. */
export interface PaymentAccountInput {
  name: string;
  receiverName: string;
  pixKey: string;
  pixKeyType: PixKeyType;
  city: string;
  defaultExpirationMinutes: number;
  /** Quando `undefined` em uma edicao, a descricao atual e preservada. */
  description?: string | null;
}

/** Dados prontos para gravacao (ja validados e cortados). */
export interface NormalizedAccountInput {
  name: string;
  identifier: string;
  description: string | null;
  receiverName: string;
  pixKey: string;
  pixKeyType: PixKeyType;
  city: string;
  defaultExpirationMinutes: number;
}

export interface AccountNormalization {
  readonly values: NormalizedAccountInput;
  /** Avisos sobre cortes aplicados por causa dos limites rigidos do BR Code. */
  readonly warnings: string[];
}

/**
 * Prepara um campo textual do BR Code: sem acento, MAIUSCULO e dentro do limite
 * do padrao EMV. O corte e registrado como aviso — nunca silencioso, porque o
 * nome cortado e o que o cliente vera no aplicativo do banco.
 */
function normalizePixField(
  raw: string,
  max: number,
  label: string,
  emptyMessage: string,
  warnings: string[],
): string {
  const full = normalizePixText(raw, PIX_TEXT_SCAN_LIMIT).toUpperCase();

  if (full.length === 0) {
    throw new ValidationError(`${label} invalido apos normalizacao: "${raw}"`, {
      userMessage: emptyMessage,
    });
  }

  if (full.length <= max) return full;

  const cut = full.slice(0, max).trim();
  if (cut.length === 0) {
    throw new ValidationError(`${label} vazio apos o corte de ${max} caracteres.`, {
      userMessage: emptyMessage,
    });
  }

  warnings.push(
    `${label} foi cortado para ${max} caracteres (limite do padrao PIX): \`${cut}\`.`,
  );
  return cut;
}

function normalizeExpiration(value: number): number {
  const minutes = Math.trunc(Number(value));

  if (!Number.isFinite(minutes)) {
    throw new ValidationError(`Expiracao invalida: ${String(value)}`, {
      userMessage: `Informe a expiracao em minutos (entre ${EXPIRATION_MIN_MINUTES} e ${EXPIRATION_MAX_MINUTES}).`,
    });
  }
  if (minutes < EXPIRATION_MIN_MINUTES || minutes > EXPIRATION_MAX_MINUTES) {
    throw new ValidationError(`Expiracao fora do intervalo permitido: ${minutes}`, {
      userMessage: `A expiracao deve ficar entre ${EXPIRATION_MIN_MINUTES} e ${EXPIRATION_MAX_MINUTES} minutos.`,
    });
  }
  return minutes;
}

/**
 * Valida e normaliza tudo o que o administrador digitou.
 * Funcao pura: nao toca no banco, portanto pode ser chamada pelo handler apenas
 * para montar os avisos exibidos ao usuario.
 */
export function normalizeAccountInput(input: PaymentAccountInput): AccountNormalization {
  const warnings: string[] = [];

  const name = sanitizeConfigText(input.name, ACCOUNT_NAME_MAX).replace(/\s+/g, ' ').trim();
  if (name.length < ACCOUNT_NAME_MIN) {
    throw new ValidationError(`Nome de exibicao muito curto: "${name}"`, {
      userMessage: `O nome de exibicao precisa ter pelo menos ${ACCOUNT_NAME_MIN} caracteres.`,
    });
  }

  const identifier = sanitizeIdentifier(name, '');
  if (identifier.length < ACCOUNT_NAME_MIN) {
    throw new ValidationError(`Identificador vazio a partir do nome "${name}"`, {
      userMessage: 'Use um nome com letras ou numeros, por exemplo: Conta principal.',
    });
  }

  const receiverName = normalizePixField(
    input.receiverName,
    BUSINESS_LIMITS.PIX_RECEIVER_NAME_MAX,
    'O nome do recebedor',
    'Informe o nome do recebedor da conta PIX (apenas letras e numeros).',
    warnings,
  );

  const city = normalizePixField(
    input.city,
    BUSINESS_LIMITS.PIX_CITY_MAX,
    'A cidade do recebedor',
    'Informe a cidade do recebedor da conta PIX (apenas letras e numeros).',
    warnings,
  );

  const pixKey = validatePixKey(input.pixKey, input.pixKeyType);
  const defaultExpirationMinutes = normalizeExpiration(input.defaultExpirationMinutes);

  const description =
    input.description === undefined || input.description === null
      ? null
      : sanitizeConfigText(input.description, ACCOUNT_DESCRIPTION_MAX).trim() || null;

  return {
    values: {
      name,
      identifier,
      description,
      receiverName,
      pixKey,
      pixKeyType: input.pixKeyType,
      city,
      defaultExpirationMinutes,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export interface CreateAccountParams {
  guildId: string;
  actorId: string;
  input: PaymentAccountInput;
}

export interface UpdateAccountParams {
  guildId: string;
  accountId: string;
  actorId: string;
  input: PaymentAccountInput;
}

export interface AccountActionParams {
  guildId: string;
  accountId: string;
  actorId: string;
}

export interface ToggleAccountParams extends AccountActionParams {
  /** Quando omitido, o estado atual e invertido. */
  enabled?: boolean;
}

/**
 * Recarrega a conta direto do banco e confere que ela pertence a guild.
 * O customId nunca e autorizacao: toda acao passa por aqui antes de escrever.
 */
async function requireAccount(guildId: string, accountId: string): Promise<PaymentAccount> {
  const account = await findAccountById(accountId);
  if (account === null || account.guildId !== guildId || account.deletedAt !== null) {
    throw new PaymentAccountError(`Conta PIX inexistente ou de outra guild: ${accountId}`, {
      userMessage: 'Esta conta PIX nao existe mais. Atualize o painel e tente novamente.',
      context: { guildId, entityType: 'payment_account', entityId: accountId },
    });
  }
  return account;
}

export async function createAccountFromInput(params: CreateAccountParams): Promise<PaymentAccount> {
  const { values } = normalizeAccountInput(params.input);

  const existing = await findAccountByIdentifier(params.guildId, values.identifier);
  if (existing !== null && existing.deletedAt === null) {
    throw new PaymentAccountError(`Identificador de conta ja em uso: ${values.identifier}`, {
      userMessage: `Ja existe uma conta chamada "${existing.name}". Escolha outro nome.`,
      context: { guildId: params.guildId, entityType: 'payment_account', entityId: existing.id },
    });
  }

  const total = await countAccounts(params.guildId);
  if (total >= MAX_ACCOUNTS_PER_GUILD) {
    throw new PaymentAccountError(`Limite de contas PIX atingido: ${total}`, {
      userMessage: `Este servidor ja possui ${MAX_ACCOUNTS_PER_GUILD} contas PIX. Exclua uma antes de cadastrar outra.`,
      context: { guildId: params.guildId },
    });
  }

  const conflictMessage = 'Uma conta com esse nome acabou de ser criada. Atualize o painel.';

  let account: PaymentAccount;
  if (existing === null) {
    try {
      account = await createAccount({ guildId: params.guildId, ...values });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new PaymentAccountError('Conflito de identifier ao criar conta PIX.', {
          userMessage: conflictMessage,
          context: { guildId: params.guildId, entityType: 'payment_account' },
          cause: error,
        });
      }
      throw error;
    }
  } else {
    // Identifier existente e excluido: revive o registro sem perder o historico.
    // Devolve null se a conta voltou a existir durante a operacao.
    const revived = await reviveAccount(existing.id, { guildId: params.guildId, ...values });
    if (revived === null) {
      throw new PaymentAccountError(
        `Conta PIX recriada por outro processo durante o cadastro: ${values.identifier}`,
        {
          userMessage: conflictMessage,
          context: {
            guildId: params.guildId,
            entityType: 'payment_account',
            entityId: existing.id,
          },
        },
      );
    }
    account = revived;
  }

  invalidateAccounts(params.guildId);

  logger.audit(existing === null ? 'Conta PIX cadastrada.' : 'Conta PIX recadastrada.', {
    guildId: params.guildId,
    userId: params.actorId,
    entityType: 'payment_account',
    entityId: account.id,
    identifier: account.identifier,
    pixKeyType: account.pixKeyType,
  });

  return account;
}

export async function updateAccountFromInput(params: UpdateAccountParams): Promise<PaymentAccount> {
  const current = await requireAccount(params.guildId, params.accountId);
  const { values } = normalizeAccountInput(params.input);

  // O identifier e a chave estavel do historico de cobrancas: nunca muda.
  const account = await updateAccount(current.id, {
    name: values.name,
    receiverName: values.receiverName,
    pixKey: values.pixKey,
    pixKeyType: values.pixKeyType,
    city: values.city,
    defaultExpirationMinutes: values.defaultExpirationMinutes,
    ...(params.input.description !== undefined ? { description: values.description } : {}),
  });

  invalidateAccounts(params.guildId);

  logger.audit('Conta PIX atualizada.', {
    guildId: params.guildId,
    userId: params.actorId,
    entityType: 'payment_account',
    entityId: account.id,
    identifier: account.identifier,
    pixKeyType: account.pixKeyType,
    pixKeyChanged: current.pixKey !== account.pixKey,
  });

  return account;
}

export async function toggleAccount(params: ToggleAccountParams): Promise<PaymentAccount> {
  const current = await requireAccount(params.guildId, params.accountId);
  const enabled = params.enabled ?? !current.enabled;

  if (enabled === current.enabled) return current;

  const account = await setAccountEnabled(current.id, enabled);
  invalidateAccounts(params.guildId);

  logger.audit(enabled ? 'Conta PIX ativada.' : 'Conta PIX desativada.', {
    guildId: params.guildId,
    userId: params.actorId,
    entityType: 'payment_account',
    entityId: account.id,
    identifier: account.identifier,
  });

  return account;
}

export async function deleteAccount(params: AccountActionParams): Promise<PaymentAccount> {
  const current = await requireAccount(params.guildId, params.accountId);

  const account = await softDeleteAccount(current.id);
  invalidateAccounts(params.guildId);

  logger.audit('Conta PIX excluida.', {
    guildId: params.guildId,
    userId: params.actorId,
    entityType: 'payment_account',
    entityId: account.id,
    identifier: account.identifier,
  });

  return account;
}
