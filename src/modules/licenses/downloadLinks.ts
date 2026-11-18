import { createHash, randomBytes } from 'node:crypto';
import { getPrisma } from '../../core/database/prisma';
import { ownedLicense } from './service';
import { assertDownloadAccess, downloadResource } from './releases';
import { packageError, releaseEndpoint } from './packages';

type Grant = { licenseId: string; releaseId: string; ownerId: string };
/** Links privados, descartáveis e limitados em memória; nunca contêm a chave da licença. */
export class DownloadLinks {
    private grants = new Map<string, Grant & { expires: number }>();
    constructor(private now = () => Date.now(), private ttl = 5 * 60000, private capacity = 250) {}
    issue(grant: Grant): string {
        for (const [id, value] of this.grants) {
            if (value.expires <= this.now() || (value.licenseId === grant.licenseId && value.ownerId === grant.ownerId)) this.grants.delete(id);
        }
        if (this.grants.size >= this.capacity) packageError('Muitos downloads em preparação. Tente novamente em alguns minutos.');
        const token = randomBytes(32).toString('hex');
        this.grants.set(this.hash(token), { ...grant, expires: this.now() + this.ttl });
        return token;
    }
    take(token: string): Grant | undefined {
        if (!/^[a-f\d]{64}$/.test(token)) return;
        const id = this.hash(token), grant = this.grants.get(id);
        this.grants.delete(id);
        if (!grant || grant.expires <= this.now()) return;
        return { licenseId: grant.licenseId, releaseId: grant.releaseId, ownerId: grant.ownerId };
    }
    private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
}
export const privateDownloads = new DownloadLinks();
export async function issueDownloadLink(licenseId: string, releaseId: string, ownerId: string): Promise<string> {
    const license = await ownedLicense(licenseId, ownerId);
    assertDownloadAccess(license);
    const resource = downloadResource(license);
    const exists = await getPrisma().scriptRelease.count({ where: {
        id: releaseId, guildId: license.guildId, product: license.product, status: 'PUBLISHED', ...(resource ? { resource } : {}),
    } });
    if (!exists) packageError('Versão indisponível para esta licença.');
    const token = privateDownloads.issue({ licenseId, releaseId, ownerId });
    return new URL(`/v1/downloads/${token}`, releaseEndpoint()).toString();
}
