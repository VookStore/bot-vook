"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backupDirectory = backupDirectory;
exports.backupFileName = backupFileName;
exports.resolvePgDump = resolvePgDump;
exports.resetPgDumpCache = resetPgDumpCache;
exports.parseConnection = parseConnection;
exports.listBackups = listBackups;
exports.rotateBackups = rotateBackups;
exports.lastBackupAt = lastBackupAt;
exports.isBackupDue = isBackupDue;
exports.runDatabaseBackup = runDatabaseBackup;
exports.runBackupIfDue = runBackupIfDue;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const env_1 = require("../../../config/env");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
/**
 * Backup do PostgreSQL.
 *
 * O banco guarda pedido, pagamento, comprovante e avaliacao — o historico
 * comercial inteiro da loja — e roda em `localhost`, num disco so. Ate aqui nao
 * existia job nenhum: uma perda de disco levava tudo junto, sem copia.
 *
 * O QUE ESTE MODULO GARANTE
 *
 *  - Um dump por dia, em formato custom (`-Fc`), restauravel com `pg_restore`.
 *  - Rotacao: os N mais recentes ficam, o resto e apagado.
 *  - Retomada apos reinicio. O "ja fiz hoje?" e respondido pela data do arquivo
 *    mais novo NO DISCO, nao por um contador em memoria: reiniciar o bot cinco
 *    vezes num dia nao gera cinco dumps, e ficar tres dias fora nao faz o
 *    proximo backup esperar mais um dia.
 *  - Verificacao. Um `pg_dump` que sai com codigo 0 mas escreve um arquivo
 *    vazio (disco cheio, por exemplo) e um backup que so falha no dia do
 *    resgate. O cabecalho do arquivo e conferido antes de a rodada contar como
 *    sucesso, e o arquivo e apagado quando nao confere.
 *
 * SEGREDO NUNCA VAI PARA A LINHA DE COMANDO. A senha viaja em `PGPASSWORD` no
 * ambiente do processo filho; em `argv` ela apareceria para qualquer usuario da
 * maquina que listasse processos.
 */
const logger = (0, Logger_1.createLogger)('backup');
/** Espaco entre dois backups. Menor que 24h para nao "andar" com o horario do boot. */
const BACKUP_INTERVAL_MS = 20 * 60 * 60 * 1000;
/** Teto do `pg_dump`. Estourado, o processo e morto e o backup conta como falha. */
const DUMP_TIMEOUT_MS = 10 * 60 * 1000;
/** Primeiros bytes de todo dump em formato custom. */
const CUSTOM_FORMAT_MAGIC = 'PGDMP';
/** Arquivos gerados por este modulo. A rotacao so mexe no que casa aqui. */
const BACKUP_FILE = /^vookstore-\d{8}T\d{6}Z\.dump$/;
/** Pasta de backup, sempre absoluta e relativa a raiz do processo. */
function backupDirectory() {
    const configured = (0, env_1.getEnv)().BACKUP_DIR;
    return (0, node_path_1.isAbsolute)(configured) ? configured : (0, node_path_1.resolve)(process.cwd(), configured);
}
/**
 * Nome do arquivo em UTC compacto: `vookstore-20260830T191500Z.dump`.
 *
 * UTC, e nao horario local, por dois motivos: o horario de verao produz uma
 * hora repetida por ano (dois dumps com o mesmo nome, um sobrescrevendo o
 * outro), e o formato ordena igual cronologicamente — o que deixa a rotacao ser
 * uma ordenacao de strings, sem ler a data de cada arquivo.
 */
function backupFileName(now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    return `vookstore-${stamp}.dump`;
}
let cachedPgDump = null;
/** True quando o caminho existe e e um arquivo. */
async function isFile(path) {
    try {
        return (await (0, promises_1.stat)(path)).isFile();
    }
    catch {
        return false;
    }
}
/** True quando `pg_dump` responde por PATH. */
function respondsOnPath(command) {
    return new Promise((done) => {
        const child = (0, node_child_process_1.spawn)(command, ['--version'], { stdio: 'ignore' });
        child.once('error', () => done(false));
        child.once('close', (code) => done(code === 0));
    });
}
/**
 * Instalacoes padrao do PostgreSQL no Windows, da versao mais nova para a mais
 * velha. Um `pg_dump` mais ANTIGO que o servidor recusa gerar o dump, entao a
 * ordem importa: a mais nova e a unica com chance de servir a todas.
 */
async function windowsCandidates() {
    const base = 'C:\\Program Files\\PostgreSQL';
    try {
        const versions = await (0, promises_1.readdir)(base);
        return versions
            .filter((name) => /^\d+$/.test(name))
            .sort((a, b) => Number(b) - Number(a))
            .map((version) => (0, node_path_1.join)(base, version, 'bin', 'pg_dump.exe'));
    }
    catch {
        return [];
    }
}
/**
 * Localiza o `pg_dump`.
 *
 * Ordem: o caminho configurado, o PATH, e so entao a instalacao padrao do
 * Windows. Configuracao explicita vence sempre — e por ela que se resolve uma
 * maquina com duas versoes instaladas.
 */
async function resolvePgDump() {
    if (cachedPgDump !== null)
        return cachedPgDump;
    const configured = (0, env_1.getEnv)().PG_DUMP_PATH;
    if (configured !== null) {
        if (!(await isFile(configured))) {
            throw new errors_1.ConfigurationError(`PG_DUMP_PATH nao aponta para um arquivo: ${configured}`, {
                userMessage: 'O caminho do pg_dump configurado no .env nao existe.',
            });
        }
        cachedPgDump = configured;
        return configured;
    }
    if (await respondsOnPath('pg_dump')) {
        cachedPgDump = 'pg_dump';
        return cachedPgDump;
    }
    for (const candidate of await windowsCandidates()) {
        if (await isFile(candidate)) {
            cachedPgDump = candidate;
            return candidate;
        }
    }
    throw new errors_1.ConfigurationError('pg_dump nao encontrado no PATH nem nos caminhos padrao.', {
        userMessage: 'O backup precisa do pg_dump. Instale as ferramentas do PostgreSQL ou defina PG_DUMP_PATH no .env.',
    });
}
/** Somente para testes: descarta o caminho memoizado. */
function resetPgDumpCache() {
    cachedPgDump = null;
}
/**
 * Quebra a `DATABASE_URL` nos campos que o `pg_dump` recebe em flags.
 *
 * O Prisma aceita a URL inteira; o `pg_dump` tambem aceitaria, mas manda-la
 * como argumento colocaria a senha em `argv`, visivel na lista de processos da
 * maquina inteira.
 */
function parseConnection(databaseUrl) {
    const url = new URL(databaseUrl);
    return {
        host: url.hostname || 'localhost',
        port: url.port || '5432',
        user: decodeURIComponent(url.username) || 'postgres',
        database: decodeURIComponent(url.pathname.replace(/^\//, '')),
        password: decodeURIComponent(url.password),
        sslmode: url.searchParams.get('sslmode'),
    };
}
/** True quando o arquivo tem o cabecalho de um dump em formato custom. */
async function looksLikeDump(path) {
    let handle;
    try {
        handle = await (0, promises_1.open)(path, 'r');
        const buffer = Buffer.alloc(CUSTOM_FORMAT_MAGIC.length);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return bytesRead === buffer.length && buffer.toString('ascii') === CUSTOM_FORMAT_MAGIC;
    }
    catch {
        return false;
    }
    finally {
        await handle?.close();
    }
}
/** Roda o `pg_dump`. Resolve quando o arquivo esta gravado; rejeita no resto. */
async function runPgDump(target) {
    const binary = await resolvePgDump();
    const connection = parseConnection((0, env_1.getEnv)().DATABASE_URL);
    const args = [
        '--host',
        connection.host,
        '--port',
        connection.port,
        '--username',
        connection.user,
        '--dbname',
        connection.database,
        // Formato custom: comprimido e restauravel seletivamente com `pg_restore`.
        '--format=custom',
        /*
         * Sem isto, um erro de autenticacao vira um prompt de senha — e um prompt
         * dentro de um job de background nao e respondido por ninguem: o processo
         * ficaria pendurado ate o timeout, todo dia, sem nunca dizer por que.
         */
        '--no-password',
        '--file',
        target,
    ];
    await new Promise((done, fail) => {
        const child = (0, node_child_process_1.spawn)(binary, args, {
            env: {
                ...process.env,
                // Senha pelo ambiente, nunca por argv.
                PGPASSWORD: connection.password,
                ...(connection.sslmode !== null ? { PGSSLMODE: connection.sslmode } : {}),
            },
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        // O stderr do pg_dump e a unica explicacao util quando ele falha.
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
            if (stderr.length < 4000)
                stderr += chunk.toString('utf8');
        });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            fail(new Error(`pg_dump excedeu ${DUMP_TIMEOUT_MS / 1000}s e foi encerrado.`));
        }, DUMP_TIMEOUT_MS);
        timer.unref();
        child.once('error', (error) => {
            clearTimeout(timer);
            fail(error);
        });
        child.once('close', (code) => {
            clearTimeout(timer);
            if (code === 0)
                done();
            else
                fail(new Error(`pg_dump saiu com codigo ${String(code)}. ${stderr.trim()}`));
        });
    });
}
/** Dumps existentes, do mais novo para o mais antigo. */
async function listBackups() {
    try {
        const names = await (0, promises_1.readdir)(backupDirectory());
        return names.filter((name) => BACKUP_FILE.test(name)).sort((a, b) => b.localeCompare(a));
    }
    catch {
        return [];
    }
}
/**
 * Apaga os dumps que passam da retencao. Devolve quantos sairam.
 *
 * So apaga o que CASA com o padrao de nome deste modulo: a pasta de backup e do
 * operador, e um arquivo que ele guardou ali a mao nao pode sumir sozinho.
 */
async function rotateBackups() {
    const keep = (0, env_1.getEnv)().BACKUP_RETENTION;
    const existing = await listBackups();
    const excess = existing.slice(keep);
    let removed = 0;
    for (const name of excess) {
        try {
            await (0, promises_1.rm)((0, node_path_1.join)(backupDirectory(), name));
            removed += 1;
        }
        catch (error) {
            logger.warn('Falha ao apagar backup antigo.', {
                file: name,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return removed;
}
/**
 * Momento do backup mais recente, ou `null` quando nao ha nenhum.
 *
 * Lido do DISCO, nao de memoria: e o que faz a agenda sobreviver a reinicio.
 */
async function lastBackupAt() {
    const [newest] = await listBackups();
    if (newest === undefined)
        return null;
    try {
        return (await (0, promises_1.stat)((0, node_path_1.join)(backupDirectory(), newest))).mtime;
    }
    catch {
        return null;
    }
}
/** True quando ja passou tempo suficiente desde o ultimo dump. */
async function isBackupDue(now = new Date()) {
    const last = await lastBackupAt();
    return last === null || now.getTime() - last.getTime() >= BACKUP_INTERVAL_MS;
}
/**
 * Gera um dump agora e roda a rotacao.
 *
 * LANCA em qualquer falha. Backup que falha em silencio e pior que backup
 * nenhum: quem confia nele so descobre no dia do resgate. Quem chama e o
 * scheduler, que ja transforma excecao em alerta.
 */
async function runDatabaseBackup(now = new Date()) {
    const directory = backupDirectory();
    await (0, promises_1.mkdir)(directory, { recursive: true });
    const target = (0, node_path_1.join)(directory, backupFileName(now));
    const startedAt = Date.now();
    await runPgDump(target);
    /*
     * Conferencia. `pg_dump` pode sair com 0 e deixar um arquivo vazio ou
     * truncado — disco cheio e o caso classico. Um arquivo assim contaria como
     * backup do dia e ainda empurraria um dump bom para fora pela rotacao, entao
     * ele e apagado e a rodada falha.
     */
    const { size } = await (0, promises_1.stat)(target);
    if (size === 0 || !(await looksLikeDump(target))) {
        await (0, promises_1.rm)(target).catch(() => undefined);
        throw new Error('pg_dump gerou um arquivo invalido; o backup foi descartado.');
    }
    const removed = await rotateBackups();
    const durationMs = Date.now() - startedAt;
    logger.info('Backup do banco concluido.', {
        file: target,
        bytes: size,
        durationMs,
        removed,
    });
    return { file: target, bytes: size, durationMs, removed };
}
/** Roda o backup so quando ele esta vencido. Devolve `null` quando nao estava. */
async function runBackupIfDue(now = new Date()) {
    if (!(await isBackupDue(now)))
        return null;
    return runDatabaseBackup(now);
}
//# sourceMappingURL=BackupService.js.map