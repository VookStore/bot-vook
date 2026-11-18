import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Unzipped } from 'fflate';
import { SCRIPT_CATALOG } from '../src/modules/catalog/scriptProducts';
import { PRODUCTS } from '../src/modules/licenses/products';
import { archiveHash, inspectPackage, LICENSE_SLOT, validateDistributionContent, validatePackagePath, zipPackage } from '../src/modules/licenses/packages';

/** Prepara cópias comerciais; nunca altera os recursos da cidade nem seus KVPs. */
async function main() {
    const [sourceArg, targetArg] = process.argv.slice(2);
    if (!sourceArg || !targetArg) throw new Error('Uso: npx tsx scripts/prepare-collection-catalog.ts ORIGEM DESTINO_NOVO');
    const source = resolve(sourceArg), target = resolve(targetArg), version = '1.10.0';
    await mkdir(target, { recursive: true });
    const checksums: Record<string, unknown> = {};
    for (const offer of SCRIPT_CATALOG) {
        const files: Unzipped = {};
        const roots = ['vook_plush', ...PRODUCTS[offer.product].bundles];
        async function walk(root: string, relative = ''): Promise<void> {
            for (const entry of await readdir(join(source, offer.package, root, relative), { withFileTypes: true })) {
                if (entry.isSymbolicLink()) throw new Error('Links simbólicos não são permitidos.');
                const path = [root, relative, entry.name].filter(Boolean).join('/');
                if (entry.isDirectory()) { await walk(root, [relative, entry.name].filter(Boolean).join('/')); continue; }
                if (!entry.isFile()) throw new Error(`Entrada inválida: ${path}`);
                validatePackagePath(path, 'vook_plush', offer.product);
                let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await readFile(join(source, offer.package, path)));
                if (path === 'vook_plush/web/images/caixa_dragoes.png') bytes = new Uint8Array(await readFile(join(__dirname, '..', 'assets', 'catalog', 'dragoes-box.png')));
                if (path.endsWith('.png')) bytes = stripPngMetadata(bytes);
                if (path.endsWith('/fxmanifest.lua')) {
                    let text = Buffer.from(bytes).toString('utf8').replace(/^version\s+['"][^'"\r\n]+['"]/m, `version '${version}'`);
                    if (!/^version\s/m.test(text)) text += `\nversion '${version}'\n`;
                    text = text.replace('Sete props Sanrio animados — candidato a teste local', 'Sete companheiros Sanrio animados');
                    bytes = Buffer.from(text);
                }
                if (path === 'vook_plush/server/license.lua') {
                    bytes = Buffer.from(Buffer.from(bytes).toString('utf8')
                        .replace("local key = GetConvar(keyConvar, '')", `local key = '${LICENSE_SLOT}'`)
                        .replace("product = 'pelucias'", `product = '${offer.product}'`));
                }
                if (path.endsWith('LEIA-ME.md')) bytes = cleanGuide(bytes);
                try { validateDistributionContent(path, Buffer.from(bytes).toString('utf8'), offer.product); }
                catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : 'conteúdo inválido'}`); }
                files[path] = bytes;
            }
        }
        for (const root of roots) await walk(root);
        files['LEIA-ME.md'] = cleanGuide(await readFile(join(source, offer.package, 'LEIA-ME.md')));
        const companionTypes = Object.keys(files).filter(path => /^vook_plush\/stream\/companions\/[^/]+\.ytyp$/.test(path)).sort();
        let manifest = Buffer.from(files['vook_plush/fxmanifest.lua']).toString('utf8')
            .replace(/^files \{ 'stream\/companions\/\*\.ytyp' \}\s*$/m, '')
            .replace(/^data_file 'DLC_ITYP_REQUEST' 'stream\/companions\/[^']+\.ytyp'\s*$/gm, '');
        if (companionTypes.length) manifest += `\nfiles { 'stream/companions/*.ytyp' }\n${companionTypes.map(path => `data_file 'DLC_ITYP_REQUEST' '${path.slice('vook_plush/'.length)}'`).join('\n')}\n`;
        files['vook_plush/fxmanifest.lua'] = Buffer.from(manifest);
        const archive = await zipPackage(files);
        try { inspectPackage(archive, offer.product, 'vook_plush', version); }
        catch (error) { throw new Error(`Revisar ${offer.product}: ${error instanceof Error ? error.message : 'pacote inválido'}`); }
        const name = `${offer.package}-${version}.zip`;
        await writeFile(join(target, name), archive, { flag: 'wx' });
        checksums[offer.product] = { file: name, resource: 'vook_plush', version, sha256: archiveHash(archive), bytes: archive.length, files: Object.keys(files).length };
        console.log(`${offer.name}: ${name} (${archive.length} bytes)`);
    }
    await writeFile(join(target, 'CHECKSUMS.json'), JSON.stringify(checksums, null, 2) + '\n', { flag: 'wx' });
}
function cleanGuide(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    // A distribuição do bot já personaliza a credencial no arquivo privado.
    return Buffer.from(Buffer.from(bytes).toString('utf8').replace(
        /Configure a chave fornecida pela VOOK no `server\.cfg` com `set vook_plush_license "CHAVE_FORNECIDA_PELA_VOOK"`\.[^\r\n]*/g,
        'O ZIP baixado em /planos já contém sua licença configurada no arquivo privado do servidor. Não adicione outra chave, não publique esse arquivo nem compartilhe o ZIP. Consulte INSTALACAO-VOOK.txt para o ambiente licenciado.',
    ));
}
function stripPngMetadata(input: Uint8Array): Uint8Array<ArrayBuffer> {
    const bytes = Buffer.from(input);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG inválido.');
    const chunks = [bytes.subarray(0, 8)];
    for (let offset = 8; offset < bytes.length;) {
        if (offset + 12 > bytes.length) throw new Error('Chunk PNG incompleto.');
        const end = offset + 12 + bytes.readUInt32BE(offset);
        if (end > bytes.length) throw new Error('Chunk PNG inválido.');
        // Remove somente metadados de origem, sem decodificar nem alterar os pixels/IDAT.
        if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'oFFs'].includes(bytes.toString('ascii', offset + 4, offset + 8))) chunks.push(bytes.subarray(offset, end));
        offset = end;
    }
    return Buffer.concat(chunks);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha ao preparar pacotes.'); process.exitCode = 1; });
