"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachmentLimitError = exports.downloadResource = exports.releaseMetadata = void 0;
exports.withPackageJob = withPackageJob;
exports.registerRelease = registerRelease;
exports.publishRelease = publishRelease;
exports.withdrawRelease = withdrawRelease;
exports.assertDownloadAccess = assertDownloadAccess;
exports.availableReleases = availableReleases;
exports.prepareDownload = prepareDownload;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../core/database/prisma");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
const service_1 = require("./service");
const packages_1 = require("./packages");
exports.releaseMetadata = { id: true, product: true, resource: true, version: true, sha256: true, status: true, fileCount: true, publishedAt: true };
let packageBusy = false;
// Bound archive memory/CPU work per process; requests can be retried without issuing keys.
async function withPackageJob(job) {
    if (packageBusy)
        (0, packages_1.packageError)('Outro pacote está sendo preparado. Tente novamente em alguns segundos.');
    packageBusy = true;
    try {
        return await job();
    }
    finally {
        packageBusy = false;
    }
}
async function registerRelease(product, resource, version, archive, actorId) {
    const c = (0, config_1.requireLicenses)();
    const files = (0, packages_1.inspectPackage)(archive, product, resource, version);
    const sha256 = (0, packages_1.archiveHash)(archive);
    const where = { guildId_product_resource_version: { guildId: c.guildId, product, resource, version } };
    const existing = await (0, prisma_1.getPrisma)().scriptRelease.findUnique({ where, select: exports.releaseMetadata });
    if (existing) {
        if (existing.sha256 !== sha256)
            (0, packages_1.packageError)('Essa versão já existe com outro conteúdo. Cadastre uma nova versão.');
        return existing;
    }
    try {
        return await (0, prisma_1.getPrisma)().scriptRelease.create({ data: { guildId: c.guildId, product, resource, version, archive: new Uint8Array(archive), sha256, fileCount: Object.keys(files).length, createdById: actorId }, select: exports.releaseMetadata });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
            (0, packages_1.packageError)('Versão cadastrada simultaneamente. Consulte /licenca pacotes.');
        throw error;
    }
}
async function publishRelease(id, sha256, actorId, reviewed) {
    if (!reviewed)
        (0, packages_1.packageError)('A publicação exige revisão da versão final e confirmação de que não contém testes, dados de clientes ou segredos.');
    const guildId = (0, config_1.requireLicenses)().guildId;
    return (0, service_1.serial)(async (tx) => {
        const release = await tx.scriptRelease.findFirst({ where: { id, guildId } });
        if (!release || release.sha256 !== sha256 || (0, packages_1.archiveHash)(release.archive) !== sha256)
            (0, packages_1.packageError)('Pacote não encontrado ou SHA-256 diferente do revisado.');
        if (release.status === 'WITHDRAWN')
            (0, packages_1.packageError)('Versão retirada não pode ser republicada. Cadastre uma nova versão.');
        if (release.status === 'PUBLISHED')
            return release;
        (0, packages_1.inspectPackage)(release.archive, release.product, release.resource, release.version);
        return tx.scriptRelease.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actorId } });
    });
}
async function withdrawRelease(id, actorId) {
    const result = await (0, prisma_1.getPrisma)().scriptRelease.updateMany({ where: { id, guildId: (0, config_1.requireLicenses)().guildId, status: { not: 'WITHDRAWN' } }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnById: actorId } });
    if (!result.count)
        (0, packages_1.packageError)('Pacote não encontrado ou já retirado.');
}
function assertDownloadAccess(license) {
    if (license.state !== 'ACTIVE' || (license.expiresAt && license.expiresAt <= new Date()) || !(0, crypto_1.isPlan)(license.plan))
        (0, packages_1.packageError)('Esta licença está suspensa ou vencida. Consulte a VOOK para regularizar o acesso.');
}
const downloadResource = (license) => license.resource || (license.product === 'pelucias' ? 'vook_plush' : undefined);
exports.downloadResource = downloadResource;
class AttachmentLimitError extends Error {
    constructor() { super('Pacote excede o limite de anexos do Discord.'); }
}
exports.AttachmentLimitError = AttachmentLimitError;
async function availableReleases(licenseId, ownerId, page = 0) {
    const license = await (0, service_1.ownedLicense)(licenseId, ownerId);
    assertDownloadAccess(license);
    const resource = (0, exports.downloadResource)(license);
    const where = { guildId: license.guildId, product: license.product, status: 'PUBLISHED', ...(resource ? { resource } : {}) };
    const total = await (0, prisma_1.getPrisma)().scriptRelease.count({ where });
    const last = Math.max(0, Math.ceil(total / 5) - 1);
    page = Math.min(last, Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0));
    const releases = await (0, prisma_1.getPrisma)().scriptRelease.findMany({ where, select: exports.releaseMetadata, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], skip: page * 5, take: 5 });
    return { license, releases, page, last };
}
async function prepareDownload(licenseId, releaseId, ownerId, maxBytes) {
    const license = await (0, service_1.ownedLicense)(licenseId, ownerId);
    assertDownloadAccess(license);
    const resource = (0, exports.downloadResource)(license);
    const where = { id: releaseId, guildId: license.guildId, product: license.product, status: 'PUBLISHED', ...(resource ? { resource } : {}) };
    const release = await (0, prisma_1.getPrisma)().scriptRelease.findFirst({ where });
    if (!release)
        (0, packages_1.packageError)('Versão indisponível para esta licença ou recurso já vinculado.');
    if ((0, packages_1.archiveHash)(release.archive) !== release.sha256)
        (0, packages_1.packageError)('Falha na integridade do pacote. Contate a VOOK.');
    if (release.archive.length + 65536 > maxBytes)
        throw new AttachmentLimitError();
    const bytes = await (0, packages_1.personalizePackage)(release.archive, release.product, release.resource, release.version, (0, crypto_1.decryptKey)(license.keyCipher, (0, config_1.requireLicenses)().secret), (0, service_1.environmentLabel)(license.environment));
    if (bytes.length > maxBytes)
        throw new AttachmentLimitError();
    // Recheck access after compression: suspension, binding or withdrawal may have changed.
    const current = await (0, service_1.ownedLicense)(licenseId, ownerId);
    assertDownloadAccess(current);
    if (current.resource && current.resource !== release.resource)
        (0, packages_1.packageError)('Esta licença foi vinculada a outra edição. Atualize /planos.');
    if (!await (0, prisma_1.getPrisma)().scriptRelease.count({ where }))
        (0, packages_1.packageError)('A versão foi retirada durante a preparação.');
    // Audit generation, not a promise of successful Discord delivery. No keys in the record.
    await (0, prisma_1.getPrisma)().scriptDownload.create({ data: { licenseId, releaseId, ownerId } });
    return { bytes, name: `${release.resource}-${release.version}-${license.environment?.toLowerCase() ?? 'anterior'}.zip`, license, release };
}
//# sourceMappingURL=releases.js.map