"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAccounts = listAccounts;
exports.findAccountById = findAccountById;
exports.findAccountByIdentifier = findAccountByIdentifier;
exports.createAccount = createAccount;
exports.reviveAccount = reviveAccount;
exports.updateAccount = updateAccount;
exports.setAccountEnabled = setAccountEnabled;
exports.softDeleteAccount = softDeleteAccount;
exports.countAccounts = countAccounts;
const prisma_1 = require("../../../core/database/prisma");
/** Contas vivas da guild, da mais antiga para a mais nova. */
async function listAccounts(guildId, options = {}, db = (0, prisma_1.getPrisma)()) {
    return db.paymentAccount.findMany({
        where: {
            guildId,
            deletedAt: null,
            ...(options.includeDisabled === true ? {} : { enabled: true }),
        },
        orderBy: [{ createdAt: 'asc' }],
    });
}
async function findAccountById(id, db = (0, prisma_1.getPrisma)()) {
    return db.paymentAccount.findUnique({ where: { id } });
}
/** Busca por identifier incluindo registros soft-deleted (necessario para revive). */
async function findAccountByIdentifier(guildId, identifier, db = (0, prisma_1.getPrisma)()) {
    return db.paymentAccount.findUnique({
        where: { guildId_identifier: { guildId, identifier } },
    });
}
/** Campos gravaveis compartilhados por criacao e revive. */
function accountData(input) {
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
async function createAccount(input, db = (0, prisma_1.getPrisma)()) {
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
async function reviveAccount(id, input, db = (0, prisma_1.getPrisma)()) {
    const { count } = await db.paymentAccount.updateMany({
        where: { id, deletedAt: { not: null } },
        data: { ...accountData(input), enabled: true, deletedAt: null },
    });
    if (count === 0)
        return null;
    return db.paymentAccount.findUnique({ where: { id } });
}
async function updateAccount(id, data, db = (0, prisma_1.getPrisma)()) {
    return db.paymentAccount.update({ where: { id }, data });
}
async function setAccountEnabled(id, enabled, db = (0, prisma_1.getPrisma)()) {
    return db.paymentAccount.update({ where: { id }, data: { enabled } });
}
/** Desativa e marca como excluida — o historico de cobrancas continua valido. */
async function softDeleteAccount(id, db = (0, prisma_1.getPrisma)()) {
    return db.paymentAccount.update({
        where: { id },
        data: { deletedAt: new Date(), enabled: false },
    });
}
/** Quantidade de contas vivas (habilitadas ou nao). */
async function countAccounts(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.paymentAccount.count({ where: { guildId, deletedAt: null } });
}
//# sourceMappingURL=PaymentAccountRepository.js.map