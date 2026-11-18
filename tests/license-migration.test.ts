import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { ScriptLicense } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown, failEvent: false }));
vi.mock('../src/core/database/prisma', () => ({ getPrisma: () => state.db }));
import { createLicense } from '../src/modules/licenses/service';
import { decryptKey, digest } from '../src/modules/licenses/crypto';

// PostgreSQL WASM, entirely in memory. Never reads DATABASE_URL or contacts Discord.
const pg = new PGlite();
const guildId = '123456789012345678', ownerId = '223456789012345678';
async function insert(tx: Transaction, table: string, data: Record<string, unknown>) {
    const row = { id: randomUUID(), ...data };
    const keys = Object.keys(row);
    const result = await tx.query<ScriptLicense>(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(row));
    return result.rows[0];
}
function adapter(tx: Transaction) {
    return {
        scriptLicense: {
            findMany: async ({ where }: { where: { guildId: string; ownerId: string; product: string } }) => (await tx.query<ScriptLicense>('SELECT * FROM "ScriptLicense" WHERE "guildId"=$1 AND "ownerId"=$2 AND "product"=$3 ORDER BY "createdAt"', [where.guildId, where.ownerId, where.product])).rows,
            create: ({ data }: { data: Record<string, unknown> }) => insert(tx, 'ScriptLicense', { ...data, updatedAt: new Date() }),
        },
        scriptLicenseIssuance: { create: ({ data }: { data: Record<string, unknown> }) => insert(tx, 'ScriptLicenseIssuance', data) },
        scriptLicenseEvent: { create: ({ data }: { data: Record<string, unknown> }) => {
            if (state.failEvent) throw new Error('simulated event failure');
            return insert(tx, 'ScriptLicenseEvent', data);
        } },
    };
}
beforeAll(async () => {
    await pg.exec(readFileSync('prisma/migrations/20261102200000_script_licenses/migration.sql', 'utf8'));
    // Both activated True Blood and sent-but-unused licenses precede the migration.
    await pg.query('INSERT INTO "ScriptLicense" (id,"guildId","ownerId",product,plan,"keyHash","keyCipher","keySuffix","updatedAt","activatedAt","installationHash",resource,"expiresAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        ['legacy', guildId, ownerId, 'pelucias', 'mensal', 'original-hash', 'original-cipher', 'ABCDEF', new Date('2026-11-01'), new Date('2026-11-01'), 'true-blood-original-server', 'vook_plush_tb', new Date('2026-12-01')]);
    await pg.exec(`INSERT INTO "ScriptLicense" (id,"guildId","ownerId",product,plan,"keyHash","keyCipher","keySuffix","updatedAt") VALUES ('sent','${guildId}','323456789012345678','pelucias','vitalicio','sent-hash','sent-cipher','FEDCBA','2026-11-01')`);
    const before = (await pg.query<Record<string, unknown>>('SELECT * FROM "ScriptLicense" ORDER BY id')).rows;
    await pg.exec(readFileSync('prisma/migrations/20261107120000_license_pairs_and_releases/migration.sql', 'utf8'));
    const after = (await pg.query<Record<string, unknown>>('SELECT * FROM "ScriptLicense" ORDER BY id')).rows;
    expect(after).toEqual(before.map(row => ({ ...row, environment: null, issuanceId: null })));
    state.db = { $transaction: <T>(fn: (tx: ReturnType<typeof adapter>) => Promise<T>) => pg.transaction(tx => fn(adapter(tx))) };
}, 30000);
beforeEach(() => {
    state.failEvent = false;
    vi.stubEnv('LICENSE_ENABLED', 'true');vi.stubEnv('LICENSE_GUILD_ID', guildId);vi.stubEnv('LICENSE_ENCRYPTION_KEY', 'a1'.repeat(32));
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await pg.close(); });

describe('migração e emissão em PostgreSQL isolado', () => {
    it('mantém todos os campos anteriores e não cria nova licença para clientes antigos', async () => {
        const before = (await pg.query('SELECT * FROM "ScriptLicense" ORDER BY id')).rows;
        expect((await createLicense(ownerId, 'anual', 'admin')).created).toBe(false);
        expect((await createLicense('323456789012345678', 'anual', 'admin')).created).toBe(false);
        expect((await pg.query('SELECT * FROM "ScriptLicense" ORDER BY id')).rows).toEqual(before);
        expect((await pg.query('SELECT * FROM "ScriptLicenseIssuance"')).rows).toHaveLength(0);
    });
    it('duas solicitações simultâneas geram exatamente um par e dois avisos', async () => {
        const results = await Promise.all([createLicense('423456789012345678', 'mensal', 'admin'), createLicense('423456789012345678', 'mensal', 'admin')]);
        expect(results.map(r => r.created).sort()).toEqual([false, true]);
        const rows = (await pg.query<ScriptLicense>('SELECT * FROM "ScriptLicense" WHERE "ownerId"=$1', ['423456789012345678'])).rows;
        expect(rows).toHaveLength(2);expect(rows.map(r => r.environment).sort()).toEqual(['PRODUCTION', 'TEST']);
        expect(new Set(rows.map(r => r.issuanceId)).size).toBe(1);
        for (const row of rows) expect(digest(decryptKey(row.keyCipher, 'a1'.repeat(32)))).toBe(row.keyHash);
        expect((await pg.query('SELECT * FROM "ScriptLicenseEvent"')).rows).toHaveLength(2);
        // Database constraints reject extra environments, even outside the application.
        const l = rows[0];
        await expect(pg.query('INSERT INTO "ScriptLicense" (id,"guildId","ownerId",product,plan,"keyHash","keyCipher","keySuffix","updatedAt","issuanceId",environment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10)',
            ['third', guildId, l.ownerId, l.product, l.plan, 'third-hash', 'third-cipher', '123456', l.issuanceId, l.environment])).rejects.toThrow(/unique constraint/);
        await expect(pg.query('UPDATE "ScriptLicense" SET environment=$1 WHERE id=$2', ['STAGING', l.id])).rejects.toThrow(/check constraint/);
    });
    it('falha ao gravar aviso reverte toda a emissão, sem par parcial', async () => {
        state.failEvent = true;
        await expect(createLicense('523456789012345678', 'mensal', 'admin')).rejects.toThrow(/event failure/);
        expect((await pg.query('SELECT * FROM "ScriptLicense" WHERE "ownerId"=$1', ['523456789012345678'])).rows).toHaveLength(0);
        expect((await pg.query('SELECT * FROM "ScriptLicenseIssuance" WHERE "ownerId"=$1', ['523456789012345678'])).rows).toHaveLength(0);
    });
});
