import { createHash } from 'node:crypto';
import { unzipSync, Zip, ZipDeflate, Unzip, UnzipInflate, type Unzipped } from 'fflate';
import { ValidationError } from '../../core/errors';
import { PRODUCTS, isProduct, isCollectionProduct } from './products';

export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const archiveLimit = (product: string) => isCollectionProduct(product) ? 128 * 1024 * 1024 : MAX_ARCHIVE_BYTES;
const MAX_EXPANDED_BYTES = 120 * 1024 * 1024;
export const LICENSE_SLOT = '__VOOK_LICENSE_KEY__';
export const AUTH_FILE = 'server/license.lua';
export const credentialFile = (product: string) => product === 'stage_hall' ? 'server/main.js' : AUTH_FILE;
export const archiveHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function releaseEndpoint(): string {
    const endpoint = process.env.LICENSE_PUBLIC_ENDPOINT || 'https://vook-auth.shardweb.app/v1/licenses/validate';
    let url: URL;
    try { url = new URL(endpoint); } catch { packageError('Configure LICENSE_PUBLIC_ENDPOINT com o endpoint HTTPS oficial.'); }
    if (url.protocol !== 'https:' || url.pathname !== '/v1/licenses/validate' || url.username || url.password || url.search || url.hash)
        packageError('LICENSE_PUBLIC_ENDPOINT deve ser o endpoint HTTPS oficial, sem credenciais ou parâmetros.');
    return endpoint;
}
export function packageError(message: string): never {
    throw new ValidationError(message, { userMessage: message });
}
export function validateReleaseIdentity(product: string, resource: string, version: string): void {
    if (!isProduct(product) || !(PRODUCTS[product].resources as readonly string[]).includes(resource))
        packageError('Produto e recurso incompatíveis.');
    if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version)) packageError('Use uma versão final no formato 1.2.3, sem sufixo de testes.');
}
const allowedExtensions = /\.(?:lua|js|cjs|css|html|json|txt|md|xml|meta|ytyp|ydr|ytd|yft|ymap|ybn|ycd|yld|ydd|png|jpg|jpeg|webp|svg|gif|ogg|mp3|wav|ttf|woff|woff2)$/i;
const forbiddenPart = /^(?:tests?|__tests__|tools?|scripts?|node_modules|backups?|logs?|data|cache|coverage|screenshots?|license-service|\.\w.*|__MACOSX)$/i;
export function validatePackagePath(path: string, resource: string, product = ''): void {
    if (isCollectionProduct(product) && path === 'LEIA-ME.md') return;
    const root = path.split('/')[0];
    const bundle = isProduct(product) && (PRODUCTS[product].bundles as readonly string[]).includes(root);
    if (bundle) resource = root;
    const relative = path.slice(resource.length + 1);
    if (bundle && !/^(?:fxmanifest\.lua|README\.md|LICENCA\.txt|stream\/.*)$/.test(relative)) packageError('Recursos de modelos só podem conter manifest, documentação e stream.');
    const allowedRoot = /^(?:fxmanifest\.lua|config\.(?:lua|json)|README\.md|LICENCA\.txt)$/i.test(relative)
        || (isCollectionProduct(product) && /^(?:edition\.lua|LEIA-ME\.md)$/.test(relative));
    const allowedDirectory = /^(?:server|client|shared|web|stream|integrations)\//.test(relative);
    if (!path.startsWith(resource + '/') || path.length > 200 || !/^[a-zA-Z0-9_./ -]+$/.test(path)
        || (!allowedRoot && !allowedDirectory)
        || path.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' ') || forbiddenPart.test(p)
            || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(p))
        || /(?:^|[/_. -])(?:test|debug|dev|development|backup|logs?|secret|credentials|private|internal)(?:[/_. -]|$)/i.test(path)
        || /(?:^|\/)(?:server\.cfg|package(?:-lock)?\.json|.*\.test\..*|.*\.spec\..*)$/i.test(path)
        || !allowedExtensions.test(path)) packageError('Pacote contém caminho não permitido ou arquivo de desenvolvimento. Revise a lista de arquivos.');
}

export function validateDistributionContent(path: string, content: string, product: string): void {
    // Never accept saved state disguised as an otherwise permitted JSON/code file.
    if (/(?:^|\/)(?:installation|playlists|layouts|players|collections|history|settings-store|state|dump)(?:[._-]|$)/i.test(path))
        packageError('Pacote contém dados persistidos. Use somente arquivos padrão de distribuição.');
    if (/\b(?:debug|testMode|devMode|development)\s*["']?\s*[:=]\s*true\b/i.test(content)
        || /(?:https?:\/\/)(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?=[:/\s'"\x60]|$)/i.test(content)
        || /[A-Za-z]:[\\/](?:Users|BASE VOOK|Temp)[\\/]/i.test(content))
        packageError('Pacote contém modo de teste, endereço interno ou caminho local.');
    // Only the placeholder is allowed in a literal credential assignment.
    // Nome público do KVP de configurações; não é uma credencial.
    const withoutSlot = content.replaceAll(LICENSE_SLOT, '').replace(/\bkey\s*=\s*['"]vook_plush:v1:settings['"]/g, '');
    if (/\b(?:api[_-]?key|token|password|secret|webhook|license[_-]?key|key)\s*["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i.test(withoutSlot))
        packageError('Pacote contém possível segredo configurado. Use a configuração padrão sem credenciais.');
    if (product === 'stage_hall' && path.endsWith('/config.json')) {
        let config: unknown;
        try { config = JSON.parse(content); } catch { packageError('config.json inválido.'); }
        if (!config || typeof config !== 'object' || !('venues' in config) || !Array.isArray(config.venues) || config.venues.length !== 0)
            packageError('Stage Hall deve ser distribuído com venues vazio; remova salas e posições de testes da cópia de distribuição.');
    }
    if (path.endsWith('/config.lua') && /provider\s*=\s*['"]internal['"]/.test(content.replace(/--[^\r\n]*/g, '')))
        packageError('Pelúcias está configurado com inventário interno de testes. Prepare o padrão de produção.');
}

// Parse a deliberately restricted, declarative fxmanifest. Never execute Lua from an upload.
// Unsupported dynamic manifests must be prepared/reviewed before publication.
export function validateManifest(manifest: string, files: Unzipped, resource: string, product: string, version: string, assetOnly = false): void {
    const scalars = new Set(['fx_version', 'game', 'lua54', 'node_version', 'name', 'author', 'description', 'version', 'ui_page', 'dependency', 'this_is_a_map', 'data_file']);
    const lists = new Set(['games', 'dependencies', 'server_script', 'server_scripts', 'shared_script', 'shared_scripts', 'client_script', 'client_scripts', 'file', 'files', 'escrow_ignore']);
    let rest = manifest.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--[^\r\n]*/g, '').trim();
    const server: string[] = [];
    const publicPaths: string[] = [];
    let declaredVersion = '';
    let fxVersion = '';
    const stringPattern = /^(?:'([^'\r\n\\]*)'|"([^"\r\n\\]*)")/;
    while (rest) {
        const directive = /^(\w+)\s+/.exec(rest);
        if (!directive) packageError('fxmanifest deve conter somente declarações literais revisáveis.');
        const name = directive[1];
        if (assetOnly && /^(?:server_script|client_script|shared_script|ui_page)/.test(name)) packageError('O pacote de modelos só pode conter recursos de assets.');
        rest = rest.slice(directive[0].length);
        if (!scalars.has(name) && !lists.has(name)) packageError('Diretiva do fxmanifest não suportada na entrega automática. Prepare uma versão compatível.');
        const values: string[] = [];
        const table = rest.startsWith('{');
        if (table) rest = rest.slice(1).trimStart();
        do {
            const match = stringPattern.exec(rest);
            if (!match) packageError('fxmanifest contém valor dinâmico ou tabela inválida.');
            values.push(match[1] ?? match[2]);
            rest = rest.slice(match[0].length).trimStart();
            if (!table || rest.startsWith('}')) break;
            if (!rest.startsWith(',')) packageError('Tabela inválida no fxmanifest.');
            rest = rest.slice(1).trimStart();
            if (rest.startsWith('}')) break;
        } while (rest);
        if (table) {
            if (!rest.startsWith('}')) packageError('Tabela incompleta no fxmanifest.');
            rest = rest.slice(1).trimStart();
        }
        if (name === 'data_file') {
            const match = stringPattern.exec(rest);
            if (!match) packageError('data_file precisa de tipo e caminho literais.');
            publicPaths.push(match[1] ?? match[2]);
            rest = rest.slice(match[0].length).trimStart();
        }
        if (name === 'name' && values[0] !== resource) packageError('Nome do recurso diferente do pacote.');
        if (name === 'version') declaredVersion = values[0];
        if (name === 'fx_version') fxVersion = values[0];
        if (name.startsWith('server_script')) server.push(...values);
        if (/^(?:shared_script|client_script|file)/.test(name) || name === 'ui_page') publicPaths.push(...values);
    }
    if (declaredVersion !== version) packageError('Versão do fxmanifest diferente da versão cadastrada.');
    if (isCollectionProduct(product) && fxVersion !== 'cerulean') packageError('A distribuição requer fx_version cerulean.');
    if (!assetOnly && ((product !== 'stage_hall' && server[0] !== AUTH_FILE) || !server.includes(credentialFile(product)) || server.some(p => p.includes('*') || p.includes('..'))))
        packageError('Integração privada ausente da ordem de server_scripts; use caminhos explícitos.');
    for (const path of publicPaths) {
        // Reject any public path that could expose private server code, including broad globs.
        if (path.startsWith('@')) continue;
        if (path.includes('..') || path.includes('\\') || path.startsWith('/') || path.includes(':')) packageError('Caminho público inválido no fxmanifest.');
        const matcher = new RegExp('^' + path.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
        if (matcher.test(credentialFile(product)) || matcher.test('server/') || path.toLowerCase().startsWith('server/')
            || Object.keys(files).some(p => p.startsWith(`${resource}/server/`) && matcher.test(p.slice(resource.length + 1))))
            packageError('O fxmanifest expõe arquivos privados de servidor ao cliente.');
        if (!Object.keys(files).some(p => p.startsWith(resource + '/') && matcher.test(p.slice(resource.length + 1))))
            packageError(`O fxmanifest referencia um arquivo público ausente: ${resource}/${path}.`);
    }
    for (const path of server) {
        if (!path.startsWith('@') && !files[`${resource}/${path}`]) packageError('O fxmanifest referencia um arquivo de servidor ausente.');
    }
}

export function inspectPackage(archive: Uint8Array, product: string, resource: string, version: string): Unzipped {
    validateReleaseIdentity(product, resource, version);
    if (!archive.length || archive.length > archiveLimit(product)) packageError(`ZIP vazio ou maior que ${archiveLimit(product) / 1024 / 1024} MiB.`);
    let total = 0;
    let count = 0;
    const names = new Set<string>();
    let files: Unzipped;
    try {
        files = unzipSync(archive, { filter(entry) {
            if (++count > 5000) packageError('ZIP contém arquivos demais.');
            const normalized = entry.name.toLowerCase();
            if (names.has(normalized)) packageError('ZIP contém caminhos duplicados.');
            names.add(normalized);
            if (entry.name.endsWith('/')) {
                const roots = [resource, ...(isProduct(product) ? PRODUCTS[product].bundles : [])];
                if (!roots.some(root => entry.name.startsWith(root + '/')) || entry.originalSize !== 0 || entry.name.includes('..') || entry.name.includes('\\')) packageError('Pasta inválida no ZIP.');
                return false;
            }
            validatePackagePath(entry.name, resource, product);
            if (entry.compression === 0 && entry.size !== entry.originalSize) packageError('ZIP tem tamanho declarado inconsistente.');
            total += entry.originalSize;
            if (entry.originalSize > 30 * 1024 * 1024 || total > (isCollectionProduct(product) ? 256 * 1024 * 1024 : MAX_EXPANDED_BYTES)) packageError('Conteúdo descompactado excede o limite.');
            return true;
        } });
    } catch (error) {
        if (error instanceof ValidationError) throw error;
        packageError('ZIP inválido. Gere novamente o pacote.');
    }
    let slots = 0;
    for (const [path, bytes] of Object.entries(files)) {
        const content = Buffer.from(bytes).toString('utf8');
        // Scan binary assets as well: credentials must not be hidden in an archive asset.
        if (/VOOK-[a-f\d]{64}|(?:postgres(?:ql)?|mysql):\/\/|discord(?:app)?\.com\/api\/webhooks\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:DISCORD_TOKEN|LICENSE_ENCRYPTION_KEY|DATABASE_URL)\s*[=:]|(?:mfa\.[\w-]{20,}|[\w-]{24,}\.[\w-]{6}\.[\w-]{25,})/i.test(content))
            packageError('Pacote contém possível credencial ou configuração interna. Remova antes de cadastrar.');
        validateDistributionContent(path, content, product);
        const found = content.split(LICENSE_SLOT).length - 1;
        slots += found;
        if (found && path !== `${resource}/${credentialFile(product)}`) packageError('A chave deve existir somente no arquivo privado de autenticação.');
    }
    const credential = Buffer.from(files[`${resource}/${credentialFile(product)}`] ?? []).toString('utf8');
    const auth = product === 'stage_hall' ? Buffer.from(files[`${resource}/server/auth.cjs`] ?? []).toString('utf8') : credential;
    const integrated = product === 'stage_hall'
        ? credential.includes(`key: '${LICENSE_SLOT}'`) && credential.includes('new VookAuth(') && credential.includes('StopResource')
            && auth.includes("const PRODUCT = 'stage_hall'") && auth.includes('leaseSeconds') && auth.includes('server_mismatch')
        : credential.includes(`local key = '${LICENSE_SLOT}'`) && auth.includes(`product = '${product}'`) && auth.includes('PerformHttpRequest') && auth.includes('GetResourceKvpString') && auth.includes('StopResource');
    const endpoint = auth.match(/(?:local|const) ENDPOINT = ['"]([^'"]+)['"]/)?.[1];
    if (slots !== 1 || !integrated || endpoint !== releaseEndpoint())
        packageError('Integração de autenticação ausente/incompatível. Prepare o pacote com o modelo VOOK.');
    const manifest = files[`${resource}/fxmanifest.lua`];
    if (!manifest) packageError('fxmanifest.lua ausente.');
    if (!files[`${resource}/${product === 'stage_hall' ? 'config.json' : 'config.lua'}`]) packageError('Configuração padrão necessária para instalação ausente.');
    if (isCollectionProduct(product) && (!files[`${resource}/edition.lua`] || !files['LEIA-ME.md'] || !files[`${resource}/LEIA-ME.md`])) packageError('A edição e seus leia-me são obrigatórios na distribuição comercial.');
    validateManifest(Buffer.from(manifest).toString('utf8'), files, resource, product, version);
    if (isProduct(product)) for (const bundle of PRODUCTS[product].bundles) {
        const manifest = files[`${bundle}/fxmanifest.lua`];
        if (!manifest) packageError('Recurso de modelos obrigatório ausente.');
        validateManifest(Buffer.from(manifest).toString('utf8'), files, bundle, product, version, true);
    }
    return files;
}

export async function zipPackage(files: Unzipped): Promise<Buffer> {
    // Um arquivo/bloco por vez: não dispara dezenas de workers para os modelos grandes.
    const chunks: Uint8Array[] = [];
    let failure: Error | undefined, finished = false;
    const archive = new Zip((error, data, final) => {
        if (error) failure = error;
        else { chunks.push(data); finished = final; }
    });
    for (const [name, bytes] of Object.entries(files)) {
        const file = new ZipDeflate(name, { level: 6 });
        file.mtime = new Date(2000, 0, 1);
        archive.add(file);
        if (!bytes.length) file.push(bytes, true);
        for (let offset = 0; offset < bytes.length; offset += 1048576) {
            file.push(bytes.subarray(offset, offset + 1048576), offset + 1048576 >= bytes.length);
            if (failure) throw failure;
            await new Promise<void>(resolve => setImmediate(resolve));
        }
    }
    archive.end();
    if (failure) throw failure;
    if (!finished) packageError('Falha ao concluir o ZIP.');
    return Buffer.concat(chunks);
}
export async function personalizePackage(archive: Uint8Array, product: string, resource: string, version: string, key: string, environment: string): Promise<Buffer> {
    if (!/^VOOK-[A-F\d]{64}$/.test(key)) packageError('Credencial inválida. Contate a VOOK.');
    const files = inspectPackage(archive, product, resource, version);
    const authPath = `${resource}/${credentialFile(product)}`;
    files[authPath] = Buffer.from(Buffer.from(files[authPath]).toString('utf8').replace(LICENSE_SLOT, key));
    const bundles = isProduct(product) ? PRODUCTS[product].bundles : [];
    files['INSTALACAO-VOOK.txt'] = Buffer.from(`VOOK · ${resource} · ${version}\nAmbiente: ${environment}\n\nA licença já está configurada no arquivo privado ${credentialFile(product)}.\nCopie todas as pastas para resources. Siga o LEIA-ME incluído para dependências, banco e modo box/VIP.\nOrdem dos recursos deste pacote no server.cfg:\n${[...bundles, resource].map(value => `ensure ${value}`).join('\n')}\nNão renomeie os recursos. Não copie a instalação, data/installation.json ou os KVPs entre servidores.\nInstale cada pacote somente no ambiente indicado; o primeiro uso vincula a licença.\nNão compartilhe este ZIP. Os arquivos server/ nunca devem ser expostos em files/shared_scripts/client_scripts.\nPara atualizar, preserve seus dados e configurações e substitua o código conforme as notas desta versão.\nBaixar novamente em /planos reutiliza sua licença e não muda seu vínculo nem sua validade.\n`);
    // Stage Hall persists runtime data; ship an empty directory, never saved customer data.
    if (product === 'stage_hall') files[`${resource}/data/`] = new Uint8Array();
    const output = await zipPackage(files);
    // Check the actual final ZIP, not only its source/approval flag. It may differ
    // only by the designated credential and the generated installation guide.
    const seen = new Set<string>(), finished = new Set<string>();
    const verify = new Unzip(file => {
        const expected = files[file.name];
        if (!expected || seen.has(file.name)) packageError('Arquivo inesperado ou duplicado no ZIP personalizado.');
        seen.add(file.name);
        let offset = 0;
        file.ondata = (error, bytes, final) => {
            if (error || offset + bytes.length > expected.length
                || !Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).equals(Buffer.from(expected.buffer, expected.byteOffset + offset, bytes.length))) packageError('Conteúdo inesperado no ZIP personalizado.');
            offset += bytes.length;
            if (final) {
                if (offset !== expected.length) packageError('Arquivo incompleto no ZIP personalizado.');
                finished.add(file.name);
            }
        };
        file.start();
    });
    verify.register(UnzipInflate);
    for (let offset = 0; offset < output.length; offset += 1048576) {
        verify.push(output.subarray(offset, offset + 1048576), offset + 1048576 >= output.length);
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (finished.size !== Object.keys(files).length || Buffer.from(files[authPath]).toString('utf8').split(key).length !== 2) packageError('Falha ao verificar o ZIP personalizado.');
    return output;
}
