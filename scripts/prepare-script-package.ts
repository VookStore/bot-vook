// Build from an explicit reviewed file list; no recursion, database or Discord connection.
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Unzipped } from 'fflate';
import { archiveHash, credentialFile, inspectPackage, LICENSE_SLOT, packageError, validatePackagePath, validateReleaseIdentity, zipPackage } from '../src/modules/licenses/packages';

interface Recipe { product: string; resource: string; version: string; files: string[] }
function recipe(value: unknown): Recipe {
    if (!value || typeof value !== 'object' || !('product' in value) || typeof value.product !== 'string'
        || !('resource' in value) || typeof value.resource !== 'string' || !('version' in value) || typeof value.version !== 'string'
        || !('files' in value) || !Array.isArray(value.files) || !value.files.every((f: unknown) => typeof f === 'string') || !value.files.length || value.files.length > 5000)
        packageError('Receita inválida. Informe product, resource, version e files (lista explícita de caminhos relativos).');
    return { product: value.product, resource: value.resource, version: value.version, files: value.files };
}
async function main() {
    const [sourceArg, recipeArg, outputArg] = process.argv.slice(2);
    if (!sourceArg || !recipeArg || !outputArg) packageError('Uso: npm run package:prepare -- "pasta do recurso" "receita.json" "novo-pacote.zip"');
    const source = await realpath(resolve(sourceArg));
    const spec = recipe(JSON.parse(await readFile(recipeArg, 'utf8')) as unknown);
    validateReleaseIdentity(spec.product, spec.resource, spec.version);
    const files: Unzipped = Object.create(null) as Unzipped;
    const names = new Set<string>();
    let total = 0;
    for (const file of spec.files) {
        const archivePath = `${spec.resource}/${file}`;
        validatePackagePath(archivePath, spec.resource);
        if (names.has(file.toLowerCase())) packageError('Lista contém arquivos duplicados.');
        names.add(file.toLowerCase());
        let current = source;
        for (const part of file.split('/')) {
            current = join(current, part);
            if ((await lstat(current)).isSymbolicLink()) packageError('Links simbólicos não são permitidos.');
        }
        const actual = await realpath(current);
        const rel = relative(source, actual);
        if (rel.startsWith('..') || isAbsolute(rel)) packageError('Arquivo fora da origem.');
        const stat = await lstat(actual);
        total += stat.size;
        if (!stat.isFile() || stat.size > 30 * 1024 * 1024 || total > 120 * 1024 * 1024) packageError('Arquivo ou tamanho fora dos limites.');
        files[archivePath] = await readFile(actual);
    }
    const target = `${spec.resource}/${credentialFile(spec.product)}`;
    if (!files[target]) packageError('Inclua a integração privada na lista de arquivos.');
    const sourceCode = Buffer.from(files[target]).toString('utf8');
    const old = spec.product === 'stage_hall' ? "key: GetConvar('stage_hall_license', '')" : "local key = GetConvar(keyConvar, '')";
    const replacement = spec.product === 'stage_hall' ? `key: '${LICENSE_SLOT}'` : `local key = '${LICENSE_SLOT}'`;
    if (sourceCode.split(old).length !== 2) packageError('Integração diferente do modelo VOOK ou já personalizada. Prepare uma origem limpa.');
    files[target] = Buffer.from(sourceCode.replace(old, replacement));
    const bytes = await zipPackage(files);
    inspectPackage(bytes, spec.product, spec.resource, spec.version);
    // Never overwrite an existing ZIP or modify the source installation.
    await writeFile(resolve(outputArg), bytes, { flag: 'wx' });
    console.log(`Candidato preparado, NÃO publicado: ${resolve(outputArg)}`);
    console.log(`${spec.product} / ${spec.resource} / ${spec.version} · ${spec.files.length} arquivos · ${bytes.length} bytes`);
    console.log(`SHA-256: ${archiveHash(bytes)}`);
    console.log('Revise todos os arquivos e teste uma instalação limpa antes de cadastrar/publicar no bot.');
}
void main().catch(error => {
    // Do not print file contents or arbitrary exception details from parsing a recipe.
    console.error(error instanceof Error && error.name === 'ValidationError' ? error.message : 'Falha ao preparar pacote. Confira a receita, origem e se o destino já existe.');
    process.exitCode = 1;
});
