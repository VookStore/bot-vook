"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ACCOUNTS_PER_GUILD = exports.DEFAULT_EXPIRATION_MINUTES = exports.EXPIRATION_MAX_MINUTES = exports.EXPIRATION_MIN_MINUTES = exports.ACCOUNT_DESCRIPTION_MAX = exports.ACCOUNT_NAME_MAX = void 0;
exports.getAccounts = getAccounts;
exports.invalidateAccounts = invalidateAccounts;
exports.getEnabledAccounts = getEnabledAccounts;
exports.getAccountById = getAccountById;
exports.getDefaultAccount = getDefaultAccount;
exports.normalizeAccountInput = normalizeAccountInput;
exports.createAccountFromInput = createAccountFromInput;
exports.updateAccountFromInput = updateAccountFromInput;
exports.toggleAccount = toggleAccount;
exports.deleteAccount = deleteAccount;
const limits_1 = require("../../../constants/limits");
const CacheService_1 = require("../../../core/cache/CacheService");
const prisma_1 = require("../../../core/database/prisma");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const sanitize_1 = require("../../../utils/sanitize");
const PaymentAccountRepository_1 = require("../repositories/PaymentAccountRepository");
const PixKeyValidator_1 = require("../validators/PixKeyValidator");
const PixPayloadService_1 = require("./PixPayloadService");
/**
 * Regras de negocio das contas PIX da loja.
 *
 * Leitura e cacheada (CACHE_NAMESPACE.PAYMENT_ACCOUNTS por guildId); TODA
 * escrita invalida o cache logo apos o commit no banco.
 *
 * PRIVACIDADE: a chave PIX completa nunca e registrada em log — apenas o tipo
 * e o identificador da conta aparecem na trilha de auditoria.
 */
const logger = (0, Logger_1.createLogger)('payment-accounts');
/** Nome de exibicao da conta (rotulo interno, nao vai para o BR Code). */
exports.ACCOUNT_NAME_MAX = 60;
/** Observacao interna opcional sobre a conta. */
exports.ACCOUNT_DESCRIPTION_MAX = 120;
exports.EXPIRATION_MIN_MINUTES = 5;
exports.EXPIRATION_MAX_MINUTES = 1440;
exports.DEFAULT_EXPIRATION_MINUTES = 30;
/**
 * Teto de contas por guild. Amarrado ao limite de opcoes de um select para que
 * toda conta cadastrada continue selecionavel nos paineis.
 */
exports.MAX_ACCOUNTS_PER_GUILD = limits_1.DISCORD_LIMITS.SELECT_OPTIONS;
/** Folga usada para medir o texto normalizado antes de aplicar o corte do PIX. */
const PIX_TEXT_SCAN_LIMIT = 200;
/** Tamanho minimo do nome de exibicao (evita conta chamada "a"). */
const ACCOUNT_NAME_MIN = 2;
// ---------------------------------------------------------------------------
// Leitura cacheada
// ---------------------------------------------------------------------------
/** Todas as contas vivas da guild (habilitadas e desabilitadas). */
async function getAccounts(guildId) {
    return CacheService_1.cache.getOrLoad(CacheService_1.CACHE_NAMESPACE.PAYMENT_ACCOUNTS, guildId, () => (0, PaymentAccountRepository_1.listAccounts)(guildId, { includeDisabled: true }), limits_1.CACHE_TTL.PAYMENT_ACCOUNTS_MS);
}
function invalidateAccounts(guildId) {
    CacheService_1.cache.delete(CacheService_1.CACHE_NAMESPACE.PAYMENT_ACCOUNTS, guildId);
}
/** Somente as contas que podem receber cobranca agora. */
async function getEnabledAccounts(guildId) {
    const accounts = await getAccounts(guildId);
    return accounts.filter((account) => account.enabled && account.deletedAt === null);
}
async function getAccountById(guildId, accountId) {
    const cached = (await getAccounts(guildId)).find((account) => account.id === accountId);
    if (cached !== undefined)
        return cached;
    // A conta pode ter sido criada em outro processo: confirma no banco.
    const account = await (0, PaymentAccountRepository_1.findAccountById)(accountId);
    if (account === null || account.guildId !== guildId || account.deletedAt !== null)
        return null;
    invalidateAccounts(guildId);
    return account;
}
/** Conta usada quando o vendedor nao escolhe outra: a mais antiga habilitada. */
async function getDefaultAccount(guildId) {
    const enabled = await getEnabledAccounts(guildId);
    return enabled[0] ?? null;
}
/**
 * Prepara um campo textual do BR Code: sem acento, MAIUSCULO e dentro do limite
 * do padrao EMV. O corte e registrado como aviso — nunca silencioso, porque o
 * nome cortado e o que o cliente vera no aplicativo do banco.
 */
function normalizePixField(raw, max, label, emptyMessage, warnings) {
    const full = (0, PixPayloadService_1.normalizePixText)(raw, PIX_TEXT_SCAN_LIMIT).toUpperCase();
    if (full.length === 0) {
        throw new errors_1.ValidationError(`${label} invalido apos normalizacao: "${raw}"`, {
            userMessage: emptyMessage,
        });
    }
    if (full.length <= max)
        return full;
    const cut = full.slice(0, max).trim();
    if (cut.length === 0) {
        throw new errors_1.ValidationError(`${label} vazio apos o corte de ${max} caracteres.`, {
            userMessage: emptyMessage,
        });
    }
    warnings.push(`${label} foi cortado para ${max} caracteres (limite do padrao PIX): \`${cut}\`.`);
    return cut;
}
function normalizeExpiration(value) {
    const minutes = Math.trunc(Number(value));
    if (!Number.isFinite(minutes)) {
        throw new errors_1.ValidationError(`Expiracao invalida: ${String(value)}`, {
            userMessage: `Informe a expiracao em minutos (entre ${exports.EXPIRATION_MIN_MINUTES} e ${exports.EXPIRATION_MAX_MINUTES}).`,
        });
    }
    if (minutes < exports.EXPIRATION_MIN_MINUTES || minutes > exports.EXPIRATION_MAX_MINUTES) {
        throw new errors_1.ValidationError(`Expiracao fora do intervalo permitido: ${minutes}`, {
            userMessage: `A expiracao deve ficar entre ${exports.EXPIRATION_MIN_MINUTES} e ${exports.EXPIRATION_MAX_MINUTES} minutos.`,
        });
    }
    return minutes;
}
/**
 * Valida e normaliza tudo o que o administrador digitou.
 * Funcao pura: nao toca no banco, portanto pode ser chamada pelo handler apenas
 * para montar os avisos exibidos ao usuario.
 */
function normalizeAccountInput(input) {
    const warnings = [];
    const name = (0, sanitize_1.sanitizeConfigText)(input.name, exports.ACCOUNT_NAME_MAX).replace(/\s+/g, ' ').trim();
    if (name.length < ACCOUNT_NAME_MIN) {
        throw new errors_1.ValidationError(`Nome de exibicao muito curto: "${name}"`, {
            userMessage: `O nome de exibicao precisa ter pelo menos ${ACCOUNT_NAME_MIN} caracteres.`,
        });
    }
    const identifier = (0, sanitize_1.sanitizeIdentifier)(name, '');
    if (identifier.length < ACCOUNT_NAME_MIN) {
        throw new errors_1.ValidationError(`Identificador vazio a partir do nome "${name}"`, {
            userMessage: 'Use um nome com letras ou numeros, por exemplo: Conta principal.',
        });
    }
    const receiverName = normalizePixField(input.receiverName, limits_1.BUSINESS_LIMITS.PIX_RECEIVER_NAME_MAX, 'O nome do recebedor', 'Informe o nome do recebedor da conta PIX (apenas letras e numeros).', warnings);
    const city = normalizePixField(input.city, limits_1.BUSINESS_LIMITS.PIX_CITY_MAX, 'A cidade do recebedor', 'Informe a cidade do recebedor da conta PIX (apenas letras e numeros).', warnings);
    const pixKey = (0, PixKeyValidator_1.validatePixKey)(input.pixKey, input.pixKeyType);
    const defaultExpirationMinutes = normalizeExpiration(input.defaultExpirationMinutes);
    const description = input.description === undefined || input.description === null
        ? null
        : (0, sanitize_1.sanitizeConfigText)(input.description, exports.ACCOUNT_DESCRIPTION_MAX).trim() || null;
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
/**
 * Recarrega a conta direto do banco e confere que ela pertence a guild.
 * O customId nunca e autorizacao: toda acao passa por aqui antes de escrever.
 */
async function requireAccount(guildId, accountId) {
    const account = await (0, PaymentAccountRepository_1.findAccountById)(accountId);
    if (account === null || account.guildId !== guildId || account.deletedAt !== null) {
        throw new errors_1.PaymentAccountError(`Conta PIX inexistente ou de outra guild: ${accountId}`, {
            userMessage: 'Esta conta PIX nao existe mais. Atualize o painel e tente novamente.',
            context: { guildId, entityType: 'payment_account', entityId: accountId },
        });
    }
    return account;
}
async function createAccountFromInput(params) {
    const { values } = normalizeAccountInput(params.input);
    const existing = await (0, PaymentAccountRepository_1.findAccountByIdentifier)(params.guildId, values.identifier);
    if (existing !== null && existing.deletedAt === null) {
        throw new errors_1.PaymentAccountError(`Identificador de conta ja em uso: ${values.identifier}`, {
            userMessage: `Ja existe uma conta chamada "${existing.name}". Escolha outro nome.`,
            context: { guildId: params.guildId, entityType: 'payment_account', entityId: existing.id },
        });
    }
    const total = await (0, PaymentAccountRepository_1.countAccounts)(params.guildId);
    if (total >= exports.MAX_ACCOUNTS_PER_GUILD) {
        throw new errors_1.PaymentAccountError(`Limite de contas PIX atingido: ${total}`, {
            userMessage: `Este servidor ja possui ${exports.MAX_ACCOUNTS_PER_GUILD} contas PIX. Exclua uma antes de cadastrar outra.`,
            context: { guildId: params.guildId },
        });
    }
    const conflictMessage = 'Uma conta com esse nome acabou de ser criada. Atualize o painel.';
    let account;
    if (existing === null) {
        try {
            account = await (0, PaymentAccountRepository_1.createAccount)({ guildId: params.guildId, ...values });
        }
        catch (error) {
            if ((0, prisma_1.isUniqueConstraintError)(error)) {
                throw new errors_1.PaymentAccountError('Conflito de identifier ao criar conta PIX.', {
                    userMessage: conflictMessage,
                    context: { guildId: params.guildId, entityType: 'payment_account' },
                    cause: error,
                });
            }
            throw error;
        }
    }
    else {
        // Identifier existente e excluido: revive o registro sem perder o historico.
        // Devolve null se a conta voltou a existir durante a operacao.
        const revived = await (0, PaymentAccountRepository_1.reviveAccount)(existing.id, { guildId: params.guildId, ...values });
        if (revived === null) {
            throw new errors_1.PaymentAccountError(`Conta PIX recriada por outro processo durante o cadastro: ${values.identifier}`, {
                userMessage: conflictMessage,
                context: {
                    guildId: params.guildId,
                    entityType: 'payment_account',
                    entityId: existing.id,
                },
            });
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
async function updateAccountFromInput(params) {
    const current = await requireAccount(params.guildId, params.accountId);
    const { values } = normalizeAccountInput(params.input);
    // O identifier e a chave estavel do historico de cobrancas: nunca muda.
    const account = await (0, PaymentAccountRepository_1.updateAccount)(current.id, {
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
async function toggleAccount(params) {
    const current = await requireAccount(params.guildId, params.accountId);
    const enabled = params.enabled ?? !current.enabled;
    if (enabled === current.enabled)
        return current;
    const account = await (0, PaymentAccountRepository_1.setAccountEnabled)(current.id, enabled);
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
async function deleteAccount(params) {
    const current = await requireAccount(params.guildId, params.accountId);
    const account = await (0, PaymentAccountRepository_1.softDeleteAccount)(current.id);
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
//# sourceMappingURL=PaymentAccountService.js.map