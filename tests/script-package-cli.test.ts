import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import { expect, it } from 'vitest';

const run = promisify(execFile);
async function removeTestDirectory(directory: string, prefix: string) {
    const target = resolve(directory);
    if (!target.startsWith(prefix)) throw new Error('Unexpected test cleanup path');
    await rm(target, { recursive: true, force: true });
}
it('CLI prepara só a lista aprovada, mantém origem, não sobrescreve ZIP e não copia dados de testes', async () => {
    const prefix = resolve(tmpdir(), 'vook-package-test-');
    const directory = await mkdtemp(prefix);
    try {
        const source = join(directory, 'source');await mkdir(join(source, 'server'), { recursive: true });await mkdir(join(source, 'data'));
        const auth = (await readFile('integrations/fivem/license.lua', 'utf8')).replace('__VOOK_LICENSE_ENDPOINT__', 'https://vook-auth.shardweb.app/v1/licenses/validate');
        await writeFile(join(source, 'server/license.lua'), auth);
        await writeFile(join(source, 'fxmanifest.lua'), "fx_version 'cerulean'\ngame 'gta5'\nname 'vook_plush'\nversion '1.0.0'\nserver_script 'server/license.lua'\nshared_script 'config.lua'");
        await writeFile(join(source, 'config.lua'), "Config = { Inventory = { provider = 'ox_inventory' } }");
        await writeFile(join(source, '.env'), 'DO_NOT_COPY');await writeFile(join(source, 'data/players.json'), '{"test":"DO_NOT_COPY"}');
        const spec = { product: 'pelucias', resource: 'vook_plush', version: '1.0.0', files: ['fxmanifest.lua', 'config.lua', 'server/license.lua'] };
        const recipe = join(directory, 'recipe.json');await writeFile(recipe, JSON.stringify(spec));
        const zip = join(directory, 'candidate.zip');
        const args = [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/prepare-script-package.ts'), source, recipe, zip];
        const result = await run(process.execPath, args, { env: { ...process.env, LICENSE_PUBLIC_ENDPOINT: 'https://vook-auth.shardweb.app/v1/licenses/validate' } });
        expect(result.stdout).toContain('NÃO publicado');expect(result.stdout).toContain('SHA-256');
        const originalZip = await readFile(zip), entries = unzipSync(originalZip);
        expect(Object.keys(entries).sort()).toEqual(spec.files.map(f => `vook_plush/${f}`).sort());
        expect(Buffer.from(entries['vook_plush/server/license.lua']).toString()).toContain("local key = '__VOOK_LICENSE_KEY__'");
        expect(await readFile(join(source, 'server/license.lua'), 'utf8')).toBe(auth);
        await expect(run(process.execPath, args)).rejects.toThrow();expect(await readFile(zip)).toEqual(originalZip);
        await writeFile(recipe, JSON.stringify({ ...spec, files: [...spec.files, 'data/players.json'] }));
        await expect(run(process.execPath, [...args.slice(0, -1), join(directory, 'dirty.zip')])).rejects.toThrow();
    } finally {
        await removeTestDirectory(directory, prefix);
    }
}, 15000);
