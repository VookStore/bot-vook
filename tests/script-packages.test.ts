import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, type Unzipped } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriptLicense } from '@prisma/client';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { ComponentType } from 'discord.js';
import { inspectPackage, archiveHash, LICENSE_SLOT, personalizePackage, validateDistributionContent } from '../src/modules/licenses/packages';
import { encryptKey, newLicenseKey } from '../src/modules/licenses/crypto';

const db = vi.hoisted(() => ({
    scriptRelease: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    scriptLicense: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    scriptDownload: { create: vi.fn() }, $transaction: vi.fn(),
}));
vi.mock('../src/core/database/prisma', () => ({ getPrisma: () => db }));
import { availableReleases, prepareDownload, publishRelease, registerRelease, withdrawRelease, withPackageJob } from '../src/modules/licenses/releases';
import { licenseButtons, licenseCommand } from '../src/modules/licenses/commands';
import { detailPanel, packagesPanel, listPanel } from '../src/modules/licenses/panel';
import { SCRIPT_CATALOG } from '../src/modules/catalog/scriptProducts';

const guildId = '123456789012345678', ownerId = '223456789012345678', secret = 'a1'.repeat(32);
function packageFiles(resource = 'vook_plush'): Unzipped {
    return {
        [`${resource}/fxmanifest.lua`]: Buffer.from(`fx_version 'cerulean'\ngame 'gta5'\nname '${resource}'\nversion '1.0.0'\nshared_script 'config.lua'\nserver_scripts { 'server/license.lua', 'server/main.lua' }\nclient_scripts { 'client/main.lua' }\nfiles { 'web/*.html' }`),
        [`${resource}/config.lua`]: Buffer.from("Config = { Inventory = { provider = 'ox_inventory' } }"),
        [`${resource}/server/license.lua`]: Buffer.from(readFileSync('integrations/fivem/license.lua', 'utf8').replace('__VOOK_LICENSE_ENDPOINT__', 'https://vook-auth.shardweb.app/v1/licenses/validate').replace("local key = GetConvar(keyConvar, '')", `local key = '${LICENSE_SLOT}'`)),
        [`${resource}/server/main.lua`]: Buffer.from('assert(PlushLicense)'),
        [`${resource}/client/main.lua`]: Buffer.from('-- client'),
        [`${resource}/web/index.html`]: Buffer.from('<html>Produto</html>'),
    };
}
function stageFiles(): Unzipped {
    return {
        'stage_hall/fxmanifest.lua': Buffer.from("fx_version 'cerulean'\ngame 'gta5'\nnode_version '22'\nname 'stage_hall'\nversion '1.0.0'\nserver_scripts { 'server/main.js' }\nfiles { 'web/**', 'stream/tablet.ytyp' }\ndata_file 'DLC_ITYP_REQUEST' 'stream/tablet.ytyp'"),
        'stage_hall/config.json': Buffer.from('{"venues":[],"framework":"auto"}'),
        'stage_hall/server/main.js': Buffer.from(`const auth = new VookAuth({key: '${LICENSE_SLOT}', onStop: () => StopResource(resource)});`),
        'stage_hall/server/auth.cjs': Buffer.from("const PRODUCT = 'stage_hall'; const ENDPOINT = 'https://vook-auth.shardweb.app/v1/licenses/validate'; // leaseSeconds server_mismatch"),
        'stage_hall/web/index.html': Buffer.from('<html>Produto</html>'),
        'stage_hall/stream/tablet.ytyp': Buffer.from('<asset/>'),
    };
}
function license(key: string, changes: Partial<ScriptLicense> = {}): ScriptLicense {
    return { id: 'license1', ownerId, guildId, product: 'pelucias', plan: 'mensal', state: 'ACTIVE', keyHash: 'hash', keyCipher: encryptKey(key, secret), keySuffix: key.slice(-6), startsOnUse: true, expiresAt: null, activatedAt: null, resource: null, installationHash: null, lastSeenAt: null, createdAt: new Date(), updatedAt: new Date(), environment: 'TEST', issuanceId: 'pair1', ...changes };
}
function release(files = packageFiles()) {
    const archive = zipSync(files);
    return { id: 'release1', guildId, product: 'pelucias', resource: 'vook_plush', version: '1.0.0', archive, sha256: archiveHash(archive), status: 'PUBLISHED', fileCount: Object.keys(files).length };
}
beforeEach(() => {
    vi.resetAllMocks();vi.stubEnv('LICENSE_ENABLED', 'true');vi.stubEnv('LICENSE_GUILD_ID', guildId);vi.stubEnv('LICENSE_ENCRYPTION_KEY', secret);
    vi.stubEnv('LICENSE_PUBLIC_ENDPOINT', 'https://vook-auth.shardweb.app/v1/licenses/validate');
    db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
    db.scriptRelease.count.mockResolvedValue(1);
});
afterEach(() => vi.unstubAllEnvs());

describe('verificação real dos bytes de distribuição', () => {
    it.each(['vook_plush', 'vook_plush_tb'])('personaliza %s somente no script privado e mantém defaults', async resource => {
        const files = packageFiles(resource), key = newLicenseKey();
        const archive = zipSync(files), original = Buffer.from(archive);
        const output = await personalizePackage(archive, 'pelucias', resource, '1.0.0', key, 'Testes/Desenvolvimento');
        const unpacked = unzipSync(output);
        for (const [path, bytes] of Object.entries(unpacked)) {
            expect(Buffer.from(bytes).toString().includes(key)).toBe(path === `${resource}/server/license.lua`);
            expect(Buffer.from(bytes).toString()).not.toContain(LICENSE_SLOT);
        }
        expect(Buffer.from(unpacked[`${resource}/config.lua`])).toEqual(Buffer.from(files[`${resource}/config.lua`]));
        expect(Buffer.from(archive)).toEqual(original);
        expect(Buffer.from(unpacked['INSTALACAO-VOOK.txt']).toString()).toContain('Testes/Desenvolvimento');
        expect(unpacked[`${resource}/server/license.lua`]).not.toEqual(files[`${resource}/server/license.lua`]);
    });
    it('Stage Hall mantém integração JS e cria somente data vazio, sem estado de testes', async () => {
        const key = newLicenseKey();
        const output = unzipSync(await personalizePackage(zipSync(stageFiles()), 'stage_hall', 'stage_hall', '1.0.0', key, 'Produção'));
        expect(Buffer.from(output['stage_hall/server/main.js']).toString()).toContain(`key: '${key}'`);
        expect(output['stage_hall/data/']).toHaveLength(0);
        expect(JSON.parse(Buffer.from(output['stage_hall/config.json']).toString()).venues).toEqual([]);
    });
    it.each(['../escape.lua', 'vook_plush/tests/main.lua', 'vook_plush/data/installation.json', 'vook_plush/.env', 'vook_plush/web/backups/file.json', 'vook_plush/server/logs.txt', 'vook_plush/tools/build.js', 'vook_plush/server.cfg', 'vook_plush/web/other.zip', 'vook_plush/web/CON.txt'])('bloqueia arquivo indevido: %s', path => {
        const files = packageFiles();files[path] = Buffer.from('data');
        expect(() => inspectPackage(zipSync(files), 'pelucias', 'vook_plush', '1.0.0')).toThrow();
    });
    it.each([newLicenseKey(), 'DATABASE_URL=postgresql://user:password@host/db', 'https://discord.com/api/webhooks/123/token', 'https://127.0.0.1:4000/api', "Debug = true", "Config = { Inventory = { provider = 'internal' } }"])('recusa segredo/configuração de desenvolvimento no conteúdo', content => {
        const files = packageFiles();files['vook_plush/config.lua'] = Buffer.from(content);
        expect(() => inspectPackage(zipSync(files), 'pelucias', 'vook_plush', '1.0.0')).toThrow();
    });
    it('recusa salas de testes disfarçadas em config padrão e estado em outro diretório', () => {
        expect(() => validateDistributionContent('stage_hall/config.json', '{"venues":[{"label":"Unicorn · sala de teste"}]}', 'stage_hall')).toThrow(/venues vazio/);
        const files = packageFiles();files['vook_plush/web/players.json'] = Buffer.from('{}');
        expect(() => inspectPackage(zipSync(files), 'pelucias', 'vook_plush', '1.0.0')).toThrow(/persistidos/);
    });
    it.each(["files { '**/*' }", "shared_script 'server/license.lua'", "client_scripts { 'server/*.lua' }", "files { 'SERVER/license.lua' }", "data_file 'TYPE' 'server/license.lua'", "dofile('other.lua')"])('impede exposição/dinamismo do manifest: %s', extra => {
        const files = packageFiles();files['vook_plush/fxmanifest.lua'] = Buffer.concat([Buffer.from(files['vook_plush/fxmanifest.lua']), Buffer.from('\n' + extra)]);
        expect(() => inspectPackage(zipSync(files), 'pelucias', 'vook_plush', '1.0.0')).toThrow();
    });
    it('recusa slot público, versão divergente, recurso errado e pacote incompleto', () => {
        const files = packageFiles();files['vook_plush/web/index.html'] = Buffer.from(LICENSE_SLOT);
        expect(() => inspectPackage(zipSync(files), 'pelucias', 'vook_plush', '1.0.0')).toThrow();
        expect(() => inspectPackage(zipSync(packageFiles()), 'pelucias', 'vook_plush', '2.0.0')).toThrow(/Versão/);
        expect(() => inspectPackage(zipSync(packageFiles()), 'stage_hall', 'vook_plush', '1.0.0')).toThrow();
        delete files['vook_plush/config.lua'];expect(() => inspectPackage(zipSync(files), 'pelucias', 'vook_plush', '1.0.0')).toThrow();
    });
    it('bloqueia endpoint de homologação mesmo quando é HTTPS público', () => {
        const files = packageFiles();
        files['vook_plush/server/license.lua'] = Buffer.from(Buffer.from(files['vook_plush/server/license.lua']).toString().replace('vook-auth.shardweb.app', 'staging.example'));
        expect(() => inspectPackage(zipSync(files), 'pelucias', 'vook_plush', '1.0.0')).toThrow(/autenticação/);
    });
    it('recusa bomba ZIP antes de descompactar o arquivo grande', () => {
        const files = packageFiles();files['vook_plush/web/image.png'] = new Uint8Array(31 * 1024 * 1024);
        expect(() => inspectPackage(zipSync(files), 'pelucias', 'vook_plush', '1.0.0')).toThrow(/limite/);
    });
});

describe('publicação, acesso e repetição de entrega', () => {
    it('os quatro produtos cabem no painel de licenças com os limites reais de botões', async () => {
        db.scriptLicense.count.mockResolvedValue(4);
        db.scriptLicense.findMany.mockResolvedValue(SCRIPT_CATALOG.map(offer => license(newLicenseKey(), { product: offer.product })));
        const panel = (await listPanel(ownerId)).toJSON();
        for (const row of panel.components) if (row.type === ComponentType.ActionRow) {
            for (const button of row.components) if (button.type === ComponentType.Button && 'label' in button) {
                expect(button.label?.length).toBeLessThanOrEqual(80);
                expect(button.label).toContain('Testes');
            }
        }
    });
    it('cadastra bytes imutáveis como rascunho e deduplica reenvio', async () => {
        const r = release();db.scriptRelease.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(r);
        db.scriptRelease.create.mockResolvedValue(r);
        await registerRelease('pelucias', 'vook_plush', '1.0.0', Buffer.from(r.archive), 'admin');
        await registerRelease('pelucias', 'vook_plush', '1.0.0', Buffer.from(r.archive), 'admin');
        expect(db.scriptRelease.create).toHaveBeenCalledTimes(1);
        expect(db.scriptRelease.create.mock.calls[0][0].data).not.toHaveProperty('publishedAt');
        const changed = packageFiles();changed['vook_plush/web/index.html'] = Buffer.from('changed');db.scriptRelease.findUnique.mockResolvedValue(r);
        await expect(registerRelease('pelucias', 'vook_plush', '1.0.0', Buffer.from(zipSync(changed)), 'admin')).rejects.toThrow(/outro conteúdo/);
    });
    it('exige aprovação do hash exato e valida conteúdo novamente ao publicar', async () => {
        const r = { ...release(), status: 'DRAFT' };db.scriptRelease.findFirst.mockResolvedValue(r);db.scriptRelease.update.mockResolvedValue(r);
        await expect(publishRelease(r.id, r.sha256, 'admin', false)).rejects.toThrow(/revisão/);
        await expect(publishRelease(r.id, 'wrong', 'admin', true)).rejects.toThrow(/SHA/);
        expect(db.scriptRelease.update).not.toHaveBeenCalled();
        await publishRelease(r.id, r.sha256, 'admin', true);
        expect(db.scriptRelease.update).toHaveBeenCalledWith({ where: { id: r.id }, data: { status: 'PUBLISHED', publishedAt: expect.any(Date), publishedById: 'admin' } });
        const dirty = packageFiles();dirty['vook_plush/web/players.json'] = Buffer.from('{}');const bad = { ...release(dirty), status: 'DRAFT' };db.scriptRelease.findFirst.mockResolvedValue(bad);
        await expect(publishRelease(bad.id, bad.sha256, 'admin', true)).rejects.toThrow(/persistidos/);
    });
    it('retira versão sem alterar licença e não republica retirada', async () => {
        db.scriptRelease.updateMany.mockResolvedValue({ count: 1 });await withdrawRelease('r', 'admin');
        db.scriptRelease.findFirst.mockResolvedValue({ ...release(), status: 'WITHDRAWN' });
        const r = release();await expect(publishRelease('r', r.sha256, 'admin', true)).rejects.toThrow(/retirada/);
        expect(db.scriptLicense.update).not.toHaveBeenCalled();
    });
    it('reenvio usa a mesma chave, não vincula nem altera validade e isola clientes', async () => {
        const r = release(), keyA = newLicenseKey(), keyB = newLicenseKey();
        const a = license(keyA), b = license(keyB, { ownerId: '323456789012345678', id: 'license2', environment: 'PRODUCTION' });
        db.scriptLicense.findFirst.mockImplementation(({ where }: { where: { id: string; ownerId: string } }) => Promise.resolve([a, b].find(l => l.id === where.id && l.ownerId === where.ownerId) ?? null));
        db.scriptRelease.findFirst.mockResolvedValue(r);
        const first = await prepareDownload(a.id, r.id, a.ownerId, 1000000), second = await prepareDownload(a.id, r.id, a.ownerId, 1000000);
        expect(second.bytes).toEqual(first.bytes);
        const other = await prepareDownload(b.id, r.id, b.ownerId, 1000000);
        expect(Buffer.from(unzipSync(first.bytes)['vook_plush/server/license.lua']).toString()).toContain(keyA);
        expect(Buffer.from(unzipSync(other.bytes)['vook_plush/server/license.lua']).toString()).not.toContain(keyA);
        await expect(prepareDownload(a.id, r.id, b.ownerId, 1000000)).rejects.toThrow(/pertence/);
        expect(db.scriptLicense.create).not.toHaveBeenCalled();expect(db.scriptLicense.update).not.toHaveBeenCalled();
        expect(a.activatedAt).toBeNull();expect(a.expiresAt).toBeNull();
    });
    it.each([{ state: 'SUSPENDED' }, { expiresAt: new Date(0) }, { plan: 'invalid' }])('nega download sem acesso: %j', override => {
        db.scriptLicense.findFirst.mockResolvedValue(license(newLicenseKey(), override));
        return expect(prepareDownload('license1', 'r', ownerId, 1000000)).rejects.toThrow(/suspensa ou vencida/);
    });
    it('consulta somente produto próprio publicado e edição vinculada; preserva legado', async () => {
        const l = license(newLicenseKey(), { environment: null, issuanceId: null, resource: 'vook_plush_tb', installationHash: 'unchanged' });
        db.scriptLicense.findFirst.mockResolvedValue(l);db.scriptRelease.findFirst.mockResolvedValue(null);
        await expect(prepareDownload(l.id, 'r', ownerId, 1000000)).rejects.toThrow(/indisponível/);
        expect(db.scriptRelease.findFirst.mock.calls[0][0].where).toEqual({ id: 'r', guildId, product: 'pelucias', status: 'PUBLISHED', resource: 'vook_plush_tb' });
        expect(l.installationHash).toBe('unchanged');expect(db.scriptLicense.update).not.toHaveBeenCalled();
    });
    it('não entrega rascunho, pacote adulterado, tamanho excedido nem suspensão durante preparação', async () => {
        const l = license(newLicenseKey()), r = release();db.scriptLicense.findFirst.mockResolvedValue(l);
        db.scriptRelease.findFirst.mockResolvedValue({ ...r, sha256: 'wrong' });
        await expect(prepareDownload(l.id, r.id, ownerId, 1000000)).rejects.toThrow(/integridade/);
        db.scriptRelease.findFirst.mockResolvedValue(r);
        await expect(prepareDownload(l.id, r.id, ownerId, 1)).rejects.toThrow(/limite/);
        db.scriptLicense.findFirst.mockResolvedValueOnce(l).mockResolvedValueOnce({ ...l, state: 'SUSPENDED' });
        await expect(prepareDownload(l.id, r.id, ownerId, 1000000)).rejects.toThrow(/suspensa/);
        expect(db.scriptDownload.create).not.toHaveBeenCalled();
    });
    it('revê retirada após compactação e não audita entrega recusada', async () => {
        const l = license(newLicenseKey());db.scriptLicense.findFirst.mockResolvedValue(l);db.scriptRelease.findFirst.mockResolvedValue(release());db.scriptRelease.count.mockResolvedValue(0);
        await expect(prepareDownload(l.id, 'r', ownerId, 1000000)).rejects.toThrow(/retirada/);expect(db.scriptDownload.create).not.toHaveBeenCalled();
    });
    it('catálogo vazio explica preparação pendente sem gerar licença', async () => {
        const l = license(newLicenseKey());db.scriptLicense.findFirst.mockResolvedValue(l);db.scriptRelease.findMany.mockResolvedValue([]);db.scriptRelease.count.mockResolvedValue(0);
        expect(JSON.stringify((await packagesPanel(l.id, ownerId)).toJSON())).toContain('Ainda não há versão final');
        expect((await availableReleases(l.id, ownerId, -5)).page).toBe(0);expect(db.scriptLicense.create).not.toHaveBeenCalled();
    });
    it('botão de download cria resposta privada com arquivo e não edita painel público', async () => {
        const l = license(newLicenseKey()), r = release();db.scriptLicense.findFirst.mockResolvedValue(l);db.scriptRelease.findFirst.mockResolvedValue(r);
        const deferReply = vi.fn().mockResolvedValue(undefined), editReply = vi.fn().mockResolvedValue(undefined);
        const i = { user: { id: ownerId }, inGuild: () => true, deferReply, deferred: true, editReply, attachmentSizeLimit: 1000000 } as unknown as ButtonInteraction;
        await licenseButtons.find(b => b.action === 'download')!.handle(i, { namespace: 'license', action: 'download', args: [l.id, r.id], raw: '' });
        expect(deferReply).toHaveBeenCalledWith({ flags: 64 });expect(editReply.mock.calls[0][0].files).toHaveLength(1);
        expect(JSON.stringify(detailPanel(l).toJSON())).toContain('Baixar script');
    });
    it('publicação usa autorização do dono/equipe antes de qualquer consulta de pacote', async () => {
        const i = { deferReply: vi.fn().mockResolvedValue(undefined), guildId: 'other' } as unknown as ChatInputCommandInteraction<'cached'>;
        await expect(licenseCommand.execute(i)).rejects.toThrow(/servidor oficial/);expect(db.scriptRelease.findFirst).not.toHaveBeenCalled();
    });
    it('limita compactações concorrentes e libera trava após falha', async () => {
        let unblock!: () => void;
        const pending = withPackageJob(() => new Promise<void>(resolve => { unblock = resolve; }));
        await expect(withPackageJob(() => Promise.resolve())).rejects.toThrow(/Outro pacote/);unblock();await pending;
        await expect(withPackageJob(() => Promise.reject(new Error('failed')))).rejects.toThrow('failed');
        await expect(withPackageJob(() => Promise.resolve('ok'))).resolves.toBe('ok');
    });
});
