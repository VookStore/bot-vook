import { Prisma, type ScriptLicense } from '@prisma/client';
import { getPrisma } from '../../core/database/prisma';
import { requireLicenses } from './config';
import { decryptKey, isPlan } from './crypto';
import { ownedLicense, environmentLabel, serial } from './service';
import { archiveHash, inspectPackage, packageError, personalizePackage } from './packages';

export const releaseMetadata = { id: true, product: true, resource: true, version: true, sha256: true, status: true, fileCount: true, publishedAt: true } as const;
let packageBusy = false;
// Bound archive memory/CPU work per process; requests can be retried without issuing keys.
export async function withPackageJob<T>(job: () => Promise<T>): Promise<T> {
    if (packageBusy) packageError('Outro pacote está sendo preparado. Tente novamente em alguns segundos.');
    packageBusy = true;
    try { return await job(); } finally { packageBusy = false; }
}
export async function registerRelease(product: string, resource: string, version: string, archive: Buffer, actorId: string) {
    const c = requireLicenses();
    const files = inspectPackage(archive, product, resource, version);
    const sha256 = archiveHash(archive);
    const where = { guildId_product_resource_version: { guildId: c.guildId, product, resource, version } };
    const existing = await getPrisma().scriptRelease.findUnique({ where, select: releaseMetadata });
    if (existing) {
        if (existing.sha256 !== sha256) packageError('Essa versão já existe com outro conteúdo. Cadastre uma nova versão.');
        return existing;
    }
    try {
        return await getPrisma().scriptRelease.create({ data: { guildId: c.guildId, product, resource, version, archive: new Uint8Array(archive), sha256, fileCount: Object.keys(files).length, createdById: actorId }, select: releaseMetadata });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') packageError('Versão cadastrada simultaneamente. Consulte /licenca pacotes.');
        throw error;
    }
}
export async function publishRelease(id: string, sha256: string, actorId: string, reviewed: boolean) {
    if (!reviewed) packageError('A publicação exige revisão da versão final e confirmação de que não contém testes, dados de clientes ou segredos.');
    const guildId = requireLicenses().guildId;
    return serial(async tx => {
        const release = await tx.scriptRelease.findFirst({ where: { id, guildId } });
        if (!release || release.sha256 !== sha256 || archiveHash(release.archive) !== sha256) packageError('Pacote não encontrado ou SHA-256 diferente do revisado.');
        if (release.status === 'WITHDRAWN') packageError('Versão retirada não pode ser republicada. Cadastre uma nova versão.');
        if (release.status === 'PUBLISHED') return release;
        inspectPackage(release.archive, release.product, release.resource, release.version);
        return tx.scriptRelease.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actorId } });
    });
}
export async function withdrawRelease(id: string, actorId: string) {
    const result = await getPrisma().scriptRelease.updateMany({ where: { id, guildId: requireLicenses().guildId, status: { not: 'WITHDRAWN' } }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnById: actorId } });
    if (!result.count) packageError('Pacote não encontrado ou já retirado.');
}
export function assertDownloadAccess(license: ScriptLicense): void {
    if (license.state !== 'ACTIVE' || (license.expiresAt && license.expiresAt <= new Date()) || !isPlan(license.plan))
        packageError('Esta licença está suspensa ou vencida. Consulte a VOOK para regularizar o acesso.');
}
export const downloadResource = (license: ScriptLicense) => license.resource || (license.product === 'pelucias' ? 'vook_plush' : undefined);
export class AttachmentLimitError extends Error {
    constructor() { super('Pacote excede o limite de anexos do Discord.'); }
}
export async function availableReleases(licenseId: string, ownerId: string, page = 0) {
    const license = await ownedLicense(licenseId, ownerId);
    assertDownloadAccess(license);
    const resource = downloadResource(license);
    const where = { guildId: license.guildId, product: license.product, status: 'PUBLISHED', ...(resource ? { resource } : {}) };
    const total = await getPrisma().scriptRelease.count({ where });
    const last = Math.max(0, Math.ceil(total / 5) - 1);
    page = Math.min(last, Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0));
    const releases = await getPrisma().scriptRelease.findMany({ where, select: releaseMetadata, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], skip: page * 5, take: 5 });
    return { license, releases, page, last };
}
export async function prepareDownload(licenseId: string, releaseId: string, ownerId: string, maxBytes: number) {
    const license = await ownedLicense(licenseId, ownerId);
    assertDownloadAccess(license);
    const resource = downloadResource(license);
    const where = { id: releaseId, guildId: license.guildId, product: license.product, status: 'PUBLISHED', ...(resource ? { resource } : {}) };
    const release = await getPrisma().scriptRelease.findFirst({ where });
    if (!release) packageError('Versão indisponível para esta licença ou recurso já vinculado.');
    if (archiveHash(release.archive) !== release.sha256) packageError('Falha na integridade do pacote. Contate a VOOK.');
    if (release.archive.length + 65536 > maxBytes) throw new AttachmentLimitError();
    const bytes = await personalizePackage(release.archive, release.product, release.resource, release.version,
        decryptKey(license.keyCipher, requireLicenses().secret), environmentLabel(license.environment));
    if (bytes.length > maxBytes) throw new AttachmentLimitError();
    // Recheck access after compression: suspension, binding or withdrawal may have changed.
    const current = await ownedLicense(licenseId, ownerId);
    assertDownloadAccess(current);
    if (current.resource && current.resource !== release.resource) packageError('Esta licença foi vinculada a outra edição. Atualize /planos.');
    if (!await getPrisma().scriptRelease.count({ where })) packageError('A versão foi retirada durante a preparação.');
    // Audit generation, not a promise of successful Discord delivery. No keys in the record.
    await getPrisma().scriptDownload.create({ data: { licenseId, releaseId, ownerId } });
    return { bytes, name: `${release.resource}-${release.version}-${license.environment?.toLowerCase() ?? 'anterior'}.zip`, license, release };
}
