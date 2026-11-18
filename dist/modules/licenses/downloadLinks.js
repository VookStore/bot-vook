"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.privateDownloads = exports.DownloadLinks = void 0;
exports.issueDownloadLink = issueDownloadLink;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../../core/database/prisma");
const service_1 = require("./service");
const releases_1 = require("./releases");
const packages_1 = require("./packages");
/** Links privados, descartáveis e limitados em memória; nunca contêm a chave da licença. */
class DownloadLinks {
    now;
    ttl;
    capacity;
    grants = new Map();
    constructor(now = () => Date.now(), ttl = 5 * 60000, capacity = 250) {
        this.now = now;
        this.ttl = ttl;
        this.capacity = capacity;
    }
    issue(grant) {
        for (const [id, value] of this.grants) {
            if (value.expires <= this.now() || (value.licenseId === grant.licenseId && value.ownerId === grant.ownerId))
                this.grants.delete(id);
        }
        if (this.grants.size >= this.capacity)
            (0, packages_1.packageError)('Muitos downloads em preparação. Tente novamente em alguns minutos.');
        const token = (0, node_crypto_1.randomBytes)(32).toString('hex');
        this.grants.set(this.hash(token), { ...grant, expires: this.now() + this.ttl });
        return token;
    }
    take(token) {
        if (!/^[a-f\d]{64}$/.test(token))
            return;
        const id = this.hash(token), grant = this.grants.get(id);
        this.grants.delete(id);
        if (!grant || grant.expires <= this.now())
            return;
        return { licenseId: grant.licenseId, releaseId: grant.releaseId, ownerId: grant.ownerId };
    }
    hash(token) { return (0, node_crypto_1.createHash)('sha256').update(token).digest('hex'); }
}
exports.DownloadLinks = DownloadLinks;
exports.privateDownloads = new DownloadLinks();
async function issueDownloadLink(licenseId, releaseId, ownerId) {
    const license = await (0, service_1.ownedLicense)(licenseId, ownerId);
    (0, releases_1.assertDownloadAccess)(license);
    const resource = (0, releases_1.downloadResource)(license);
    const exists = await (0, prisma_1.getPrisma)().scriptRelease.count({ where: {
            id: releaseId, guildId: license.guildId, product: license.product, status: 'PUBLISHED', ...(resource ? { resource } : {}),
        } });
    if (!exists)
        (0, packages_1.packageError)('Versão indisponível para esta licença.');
    const token = exports.privateDownloads.issue({ licenseId, releaseId, ownerId });
    return new URL(`/v1/downloads/${token}`, (0, packages_1.releaseEndpoint)()).toString();
}
//# sourceMappingURL=downloadLinks.js.map