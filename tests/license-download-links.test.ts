import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { DownloadLinks, issueDownloadLink, privateDownloads } from '../src/modules/licenses/downloadLinks';

const state = vi.hoisted(() => ({ ownedLicense: vi.fn(), count: vi.fn(), prepare: vi.fn() }));
vi.mock('../src/modules/licenses/service', async original => ({
    ...await original<typeof import('../src/modules/licenses/service')>(), ownedLicense: state.ownedLicense,
}));
vi.mock('../src/core/database/prisma', () => ({ getPrisma: () => ({ scriptRelease: { count: state.count } }) }));
vi.mock('../src/modules/licenses/releases', async original => ({
    ...await original<typeof import('../src/modules/licenses/releases')>(), prepareDownload: state.prepare,
}));
import { createLicenseServer } from '../src/modules/licenses/runtime';
const grant = { licenseId: 'license1', releaseId: 'release1', ownerId: 'owner1' };
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it('tokens são opacos, expiram, funcionam uma vez e um novo link substitui o anterior', () => {
    let now = 1000;
    const links = new DownloadLinks(() => now, 100, 1);
    const first = links.issue(grant), second = links.issue(grant);
    expect(first).toMatch(/^[a-f\d]{64}$/);
    expect(links.take(first)).toBeUndefined();
    expect(links.take(second)).toEqual(grant);
    expect(links.take(second)).toBeUndefined();
    const expired = links.issue(grant);
    now = 1100;
    expect(links.take(expired)).toBeUndefined();
    expect(links.take('../license1')).toBeUndefined();
});
it('limita tokens sem remover arbitrariamente outro cliente', () => {
    const links = new DownloadLinks(() => 1000, 100, 1);
    const token = links.issue(grant);
    expect(() => links.issue({ ...grant, ownerId: 'owner2', licenseId: 'license2' })).toThrow(/Muitos downloads/);
    expect(links.take(token)).toEqual(grant);
});
it('só emite link para dono ativo e versão publicada do produto/recurso correto', async () => {
    const license = { ...grant, guildId: 'guild1', product: 'companheiros_sanrio', resource: null, state: 'ACTIVE', plan: 'vitalicio' };
    state.ownedLicense.mockResolvedValue(license);
    state.count.mockResolvedValue(0);
    await expect(issueDownloadLink(grant.licenseId, grant.releaseId, grant.ownerId)).rejects.toThrow(/indisponível/);
    expect(state.count).toHaveBeenCalledWith({ where: { id: grant.releaseId, guildId: 'guild1', product: 'companheiros_sanrio', status: 'PUBLISHED' } });
    state.count.mockResolvedValue(1);
    const url = new URL(await issueDownloadLink(grant.licenseId, grant.releaseId, grant.ownerId));
    expect(url.protocol).toBe('https:');
    expect(url.pathname).toMatch(/^\/v1\/downloads\/[a-f\d]{64}$/);
    expect(url.toString()).not.toContain('VOOK-');
    expect(privateDownloads.take(url.pathname.split('/').pop()!)).toEqual(grant);
    state.ownedLicense.mockResolvedValue({ ...license, state: 'SUSPENDED' });
    await expect(issueDownloadLink(grant.licenseId, grant.releaseId, grant.ownerId)).rejects.toThrow(/suspensa/);
});
it('HTTP revalida a entrega, não aceita replay e não expõe erros privados', async () => {
    const server = createLicenseServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Servidor sem porta.');
    const base = `http://127.0.0.1:${address.port}/v1/downloads/`;
    try {
        state.prepare.mockResolvedValue({ bytes: Buffer.from('ZIP PRIVADO'), name: 'vook_plush-1.10.0-test.zip' });
        const token = privateDownloads.issue(grant);
        const result = await fetch(base + token);
        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('no-store');
        expect(result.headers.get('content-type')).toBe('application/zip');
        expect(await result.text()).toBe('ZIP PRIVADO');
        expect(state.prepare).toHaveBeenCalledWith(grant.licenseId, grant.releaseId, grant.ownerId, 129 * 1024 * 1024);
        expect((await fetch(base + token)).status).toBe(404);
        const origin = new URL(base).origin;
        expect((await fetch(`${origin}/catalog-assets/flyer-sanrio-v2.png`)).status).toBe(200);
        expect((await fetch(`${origin}/catalog-assets/secret.png`)).status).toBe(404);
        expect((await fetch(`${origin}/catalog-assets/../.env`)).status).toBe(404);
        state.prepare.mockRejectedValue(new Error('SECRET KEY: never expose'));
        const denied = await fetch(base + privateDownloads.issue(grant));
        expect(denied.status).toBe(503);
        expect(await denied.text()).not.toContain('SECRET');
    } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }); }
});
