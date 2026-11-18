"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseStatus = licenseStatus;
exports.serial = serial;
exports.environmentLabel = environmentLabel;
exports.createLicense = createLicense;
exports.ownedLicense = ownedLicense;
exports.revealKey = revealKey;
exports.changeLicense = changeLicense;
exports.validateLicense = validateLicense;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const prisma_1 = require("../../core/database/prisma");
const errors_1 = require("../../core/errors");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
const products_1 = require("./products");
function licenseStatus(l, now = new Date()) {
    if (l.state !== 'ACTIVE')
        return 'Suspensa';
    if (l.expiresAt && l.expiresAt <= now)
        return 'Expirada';
    if (l.startsOnUse && !l.activatedAt)
        return 'Aguardando ativação';
    return 'Ativa';
}
async function serial(fn) {
    for (let attempt = 0;; attempt++)
        try {
            return await (0, prisma_1.getPrisma)().$transaction(fn, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        }
        catch (error) {
            if (attempt < 3 && error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
                continue;
            throw error;
        }
}
async function event(tx, l, kind, actorId, message, dedupe = (0, node_crypto_1.randomUUID)()) {
    return tx.scriptLicenseEvent.create({ data: { licenseId: l.id, kind, actorId, message, dedupe } });
}
function environmentLabel(environment) {
    return environment === 'TEST' ? 'Testes/Desenvolvimento' : environment === 'PRODUCTION' ? 'Produção (servidor público)' : 'Licença anterior · vínculo preservado';
}
// One grant per customer/product. Retrying creation or delivery never adds keys.
async function createLicense(ownerId, plan, actorId, startsOnUse = true, product = 'pelucias') {
    const c = (0, config_1.requireLicenses)();
    if (!/^\d{17,20}$/.test(ownerId) || !(0, crypto_1.isPlan)(plan) || !(0, products_1.isProduct)(product))
        throw new errors_1.ValidationError('Destinatário ou plano inválido.');
    const now = new Date();
    // The unique issuance also covers concurrent transactions in different bot processes.
    for (let attempt = 0;; attempt++) {
        try {
            return await serial(async (tx) => {
                const existing = await tx.scriptLicense.findMany({ where: { guildId: c.guildId, ownerId, product }, orderBy: { createdAt: 'asc' } });
                if (existing.length)
                    return { licenses: existing, created: false };
                const issuance = await tx.scriptLicenseIssuance.create({ data: { guildId: c.guildId, ownerId, product } });
                const licenses = [];
                for (const environment of ['TEST', 'PRODUCTION']) {
                    const key = (0, crypto_1.newLicenseKey)();
                    const l = await tx.scriptLicense.create({ data: { guildId: c.guildId, ownerId, product, plan,
                            issuanceId: issuance.id, environment,
                            keyHash: (0, crypto_1.digest)(key), keyCipher: (0, crypto_1.encryptKey)(key, c.secret), keySuffix: key.slice(-6), startsOnUse,
                            expiresAt: startsOnUse ? null : (0, crypto_1.expiry)(plan, now) } });
                    await event(tx, l, 'CREATED', actorId, `Sua licença de ${(0, products_1.productLabel)(product)} · ${environmentLabel(environment)} foi criada. Plano: ${plan}. ${startsOnUse ? 'A validade começa na primeira ativação deste ambiente.' : 'A validade começa agora.'} Baixe o script em /planos quando a versão estiver publicada.`);
                    licenses.push(l);
                }
                return { licenses, created: true };
            });
        }
        catch (error) {
            if (attempt < 3 && error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
                continue;
            throw error;
        }
    }
}
async function ownedLicense(id, userId) {
    const c = (0, config_1.requireLicenses)();
    const l = await (0, prisma_1.getPrisma)().scriptLicense.findFirst({ where: { id, guildId: c.guildId, ownerId: userId } });
    if (!l)
        throw new errors_1.PermissionError('Licença não pertence ao usuário.', { userMessage: 'Licença não encontrada na sua conta.' });
    return l;
}
async function revealKey(id, userId) {
    return (0, crypto_1.decryptKey)((await ownedLicense(id, userId)).keyCipher, (0, config_1.requireLicenses)().secret);
}
async function changeLicense(id, actorId, operation, plan) {
    const c = (0, config_1.requireLicenses)();
    return serial(async (tx) => {
        const l = await tx.scriptLicense.findFirst({ where: { id, guildId: c.guildId } });
        if (!l)
            throw new errors_1.ValidationError('Licença não encontrada.');
        const data = {};
        let message = '';
        if (operation === 'renovar') {
            if (!plan || !(0, crypto_1.isPlan)(plan))
                throw new errors_1.ValidationError('Escolha um plano válido.');
            data.plan = plan;
            data.expiresAt = l.startsOnUse && !l.activatedAt ? null : (0, crypto_1.expiry)(plan, new Date(Math.max(Date.now(), l.expiresAt?.getTime() || 0)));
            message = `Licença renovada para o plano ${plan}.`;
        }
        else if (operation === 'suspender') {
            data.state = 'SUSPENDED';
            message = 'Sua licença foi suspensa pela VOOK.';
        }
        else if (operation === 'reativar') {
            data.state = 'ACTIVE';
            message = 'Sua licença foi reativada. A data de vencimento permanece a mesma.';
        }
        else {
            data.installationHash = null;
            data.resource = null;
            message = 'O vínculo de servidor foi liberado. A próxima validação vinculará sua licença novamente.';
        }
        const updated = await tx.scriptLicense.update({ where: { id }, data });
        await event(tx, updated, operation.toUpperCase(), actorId, message);
        return updated;
    });
}
async function validateLicense(key, input) {
    const c = (0, config_1.requireLicenses)();
    const deny = (reason) => ({ valid: false, reason, nonce: input.nonce });
    if (!/^VOOK-[A-F\d]{64}$/.test(key) || !(0, products_1.isProduct)(input.product) || !products_1.PRODUCTS[input.product].resources.includes(input.resource)
        || !/^[a-zA-Z\d_-]{24,128}$/.test(input.installation) || !/^[a-zA-Z\d_-]{16,128}$/.test(input.nonce))
        return deny('invalid');
    return serial(async (tx) => {
        const l = await tx.scriptLicense.findUnique({ where: { keyHash: (0, crypto_1.digest)(key) } });
        const now = new Date();
        if (!l || l.guildId !== c.guildId || l.product !== input.product)
            return deny('invalid');
        if (l.state !== 'ACTIVE')
            return deny('suspended');
        if (l.expiresAt && l.expiresAt <= now)
            return deny('expired');
        const hash = (0, crypto_1.digest)(input.installation);
        if ((l.installationHash && l.installationHash !== hash) || (l.resource && l.resource !== input.resource))
            return deny('server_mismatch');
        const first = !l.activatedAt;
        if (!(0, crypto_1.isPlan)(l.plan))
            return deny('invalid');
        const updated = await tx.scriptLicense.update({ where: { id: l.id }, data: {
                installationHash: hash, resource: input.resource, lastSeenAt: now,
                ...(first ? { activatedAt: now, ...(l.startsOnUse ? { expiresAt: (0, crypto_1.expiry)(l.plan, now) } : {}) } : {})
            } });
        if (!l.installationHash)
            await event(tx, updated, first ? 'ACTIVATED' : 'BOUND', 'server', first ? 'Sua licença foi ativada no servidor.' : 'Sua licença foi vinculada a um servidor.');
        const leaseSeconds = Math.max(0, Math.min(900, updated.expiresAt ? Math.floor((updated.expiresAt.getTime() - now.getTime()) / 1000) : 900));
        return { valid: true, nonce: input.nonce, licenseId: l.id, expiresAt: updated.expiresAt ? Math.floor(updated.expiresAt.getTime() / 1000) : null, leaseSeconds };
    });
}
//# sourceMappingURL=service.js.map