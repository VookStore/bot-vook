import { randomUUID } from 'node:crypto';
import { Prisma, type ScriptLicense } from '@prisma/client';
import { getPrisma, type TransactionClient } from '../../core/database/prisma';
import { PermissionError, ValidationError } from '../../core/errors';
import { requireLicenses } from './config';
import { decryptKey, digest, encryptKey, expiry, isPlan, newLicenseKey, type LicensePlan } from './crypto';
import { PRODUCTS, isProduct, productLabel, type LicenseProduct } from './products';
export function licenseStatus(l: Pick<ScriptLicense, 'state' | 'expiresAt' | 'activatedAt' | 'startsOnUse'>, now = new Date()): string {
    if (l.state !== 'ACTIVE')
        return 'Suspensa';
    if (l.expiresAt && l.expiresAt <= now)
        return 'Expirada';
    if (l.startsOnUse && !l.activatedAt)
        return 'Aguardando ativação';
    return 'Ativa';
}
export async function serial<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0;; attempt++)
        try {
            return await getPrisma().$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        }
        catch (error) {
            if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
                continue;
            throw error;
        }
}
async function event(tx: TransactionClient, l: ScriptLicense, kind: string, actorId: string, message: string, dedupe = randomUUID()) {
    return tx.scriptLicenseEvent.create({ data: { licenseId: l.id, kind, actorId, message, dedupe } });
}
export function environmentLabel(environment: string | null): string {
    return environment === 'TEST' ? 'Testes/Desenvolvimento' : environment === 'PRODUCTION' ? 'Produção (servidor público)' : 'Licença anterior · vínculo preservado';
}
// One grant per customer/product. Retrying creation or delivery never adds keys.
export async function createLicense(ownerId: string, plan: LicensePlan, actorId: string, startsOnUse = true, product: LicenseProduct = 'pelucias') {
    const c = requireLicenses();
    if (!/^\d{17,20}$/.test(ownerId) || !isPlan(plan) || !isProduct(product))
        throw new ValidationError('Destinatário ou plano inválido.');
    const now = new Date();
    // The unique issuance also covers concurrent transactions in different bot processes.
    for (let attempt = 0;; attempt++) {
        try {
            return await serial(async (tx) => {
                const existing = await tx.scriptLicense.findMany({ where: { guildId: c.guildId, ownerId, product }, orderBy: { createdAt: 'asc' } });
                if (existing.length) return { licenses: existing, created: false };
                const issuance = await tx.scriptLicenseIssuance.create({ data: { guildId: c.guildId, ownerId, product } });
                const licenses: ScriptLicense[] = [];
                for (const environment of ['TEST', 'PRODUCTION']) {
                    const key = newLicenseKey();
                    const l = await tx.scriptLicense.create({ data: { guildId: c.guildId, ownerId, product, plan,
                        issuanceId: issuance.id, environment,
                        keyHash: digest(key), keyCipher: encryptKey(key, c.secret), keySuffix: key.slice(-6), startsOnUse,
                        expiresAt: startsOnUse ? null : expiry(plan, now) } });
                    await event(tx, l, 'CREATED', actorId, `Sua licença de ${productLabel(product)} · ${environmentLabel(environment)} foi criada. Plano: ${plan}. ${startsOnUse ? 'A validade começa na primeira ativação deste ambiente.' : 'A validade começa agora.'} Baixe o script em /planos quando a versão estiver publicada.`);
                    licenses.push(l);
                }
                return { licenses, created: true };
            });
        } catch (error) {
            if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
            throw error;
        }
    }
}
export async function ownedLicense(id: string, userId: string) {
    const c = requireLicenses();
    const l = await getPrisma().scriptLicense.findFirst({ where: { id, guildId: c.guildId, ownerId: userId } });
    if (!l)
        throw new PermissionError('Licença não pertence ao usuário.', { userMessage: 'Licença não encontrada na sua conta.' });
    return l;
}
export async function revealKey(id: string, userId: string) {
    return decryptKey((await ownedLicense(id, userId)).keyCipher, requireLicenses().secret);
}
export async function changeLicense(id: string, actorId: string, operation: 'renovar' | 'suspender' | 'reativar' | 'desvincular', plan?: LicensePlan) {
    const c = requireLicenses();
    return serial(async (tx) => {
        const l = await tx.scriptLicense.findFirst({ where: { id, guildId: c.guildId } });
        if (!l)
            throw new ValidationError('Licença não encontrada.');
        const data: Prisma.ScriptLicenseUpdateInput = {};
        let message = '';
        if (operation === 'renovar') {
            if (!plan || !isPlan(plan))
                throw new ValidationError('Escolha um plano válido.');
            data.plan = plan;
            data.expiresAt = l.startsOnUse && !l.activatedAt ? null : expiry(plan, new Date(Math.max(Date.now(), l.expiresAt?.getTime() || 0)));
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
export type ValidationResult = {
    valid: false;
    reason: string;
    nonce: string;
} | {
    valid: true;
    nonce: string;
    licenseId: string;
    expiresAt: number | null;
    leaseSeconds: number;
};
export async function validateLicense(key: string, input: {
    product: string;
    resource: string;
    installation: string;
    nonce: string;
}): Promise<ValidationResult> {
    const c = requireLicenses();
    const deny = (reason: string): ValidationResult => ({ valid: false, reason, nonce: input.nonce });
    if (!/^VOOK-[A-F\d]{64}$/.test(key) || !isProduct(input.product) || !(PRODUCTS[input.product].resources as readonly string[]).includes(input.resource)
        || !/^[a-zA-Z\d_-]{24,128}$/.test(input.installation) || !/^[a-zA-Z\d_-]{16,128}$/.test(input.nonce))
        return deny('invalid');
    return serial(async (tx) => {
        const l = await tx.scriptLicense.findUnique({ where: { keyHash: digest(key) } });
        const now = new Date();
        if (!l || l.guildId !== c.guildId || l.product !== input.product)
            return deny('invalid');
        if (l.state !== 'ACTIVE')
            return deny('suspended');
        if (l.expiresAt && l.expiresAt <= now)
            return deny('expired');
        const hash = digest(input.installation);
        if ((l.installationHash && l.installationHash !== hash) || (l.resource && l.resource !== input.resource))
            return deny('server_mismatch');
        const first = !l.activatedAt;
        if (!isPlan(l.plan))
            return deny('invalid');
        const updated = await tx.scriptLicense.update({ where: { id: l.id }, data: {
                installationHash: hash, resource: input.resource, lastSeenAt: now,
                ...(first ? { activatedAt: now, ...(l.startsOnUse ? { expiresAt: expiry(l.plan, now) } : {}) } : {})
            } });
        if (!l.installationHash)
            await event(tx, updated, first ? 'ACTIVATED' : 'BOUND', 'server', first ? 'Sua licença foi ativada no servidor.' : 'Sua licença foi vinculada a um servidor.');
        const leaseSeconds = Math.max(0, Math.min(900, updated.expiresAt ? Math.floor((updated.expiresAt.getTime() - now.getTime()) / 1000) : 900));
        return { valid: true, nonce: input.nonce, licenseId: l.id, expiresAt: updated.expiresAt ? Math.floor(updated.expiresAt.getTime() / 1000) : null, leaseSeconds };
    });
}
