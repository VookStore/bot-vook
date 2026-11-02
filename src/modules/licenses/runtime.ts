import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Routes, type Client } from 'discord.js';
import { getPrisma } from '../../core/database/prisma';
import { sendV2 } from '../../components/reply';
import { createLogger } from '../../core/logger/Logger';
import { licenseConfig } from './config';
import { validateLicense } from './service';
import { digest } from './crypto';
import { detailPanel } from './panel';
import { licenseCommand, plansCommand } from './commands';
const logger = createLogger('licenses');
let server: Server | undefined;
let timer: NodeJS.Timeout | undefined;
let running: Promise<void> | undefined;
export function createLicenseServer(validate = validateLicense): Server {
    // Bounded fixed windows, per credential plus a global cap. Do not trust X-Forwarded-For.
    let windowStart = Date.now();
    let total = 0;
    const hits = new Map<string, number>();
    const api = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        const reply = (status: number, body: unknown) => { res.writeHead(status); res.end(JSON.stringify(body)); };
        if (req.url === '/health' && req.method === 'GET') {
            reply(200, { ok: true });
            return;
        }
        if (req.url !== '/v1/licenses/validate' || req.method !== 'POST') {
            reply(404, { error: 'not_found' });
            return;
        }
        if (Date.now() - windowStart >= 60000) {
            hits.clear();
            total = 0;
            windowStart = Date.now();
        }
        const auth = req.headers.authorization || '';
        const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!/^VOOK-[A-F\d]{64}$/.test(key)) {
            reply(401, { error: 'unauthorized' });
            return;
        }
        const bucket = digest(key);
        const count = (hits.get(bucket) || 0) + 1;
        if (++total > 1000 || count > 20) {
            reply(429, { error: 'rate_limited' });
            return;
        }
        hits.set(bucket, count);
        if (!req.headers['content-type']?.startsWith('application/json')) {
            reply(415, { error: 'json_required' });
            return;
        }
        let body = '';
        let size = 0;
        try {
            for await (const chunk of req) {
                if (!Buffer.isBuffer(chunk))
                    throw new Error('Invalid stream chunk');
                size += chunk.length;
                if (size > 4096) {
                    reply(413, { error: 'too_large' });
                    return;
                }
                body += chunk.toString('utf8');
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(body);
            }
            catch {
                reply(400, { error: 'invalid_json' });
                return;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                reply(400, { error: 'invalid_request' });
                return;
            }
            const v = parsed as Record<string, unknown>;
            if (!['product', 'resource', 'installation', 'nonce'].every(k => typeof v[k] === 'string' && v[k].length <= 128)) {
                reply(400, { error: 'invalid_request' });
                return;
            }
            const result = await validate(key, v as {
                product: string;
                resource: string;
                installation: string;
                nonce: string;
            });
            reply(200, result);
        }
        catch {
            if (!res.headersSent)
                reply(503, { error: 'temporarily_unavailable' });
        }
    });
    api.requestTimeout = 10000;
    api.headersTimeout = 10000;
    api.timeout = 10000;
    api.maxHeadersCount = 25;
    return api;
}
export async function queueLicenseReminders(now = new Date()): Promise<void> {
    const db = getPrisma();
    const c = licenseConfig();
    // A cursor prevents a large customer list from creating an unbounded memory/query workload.
    let cursor: string | undefined;
    do {
        const batch = await db.scriptLicense.findMany({ where: { guildId: c.guildId, state: 'ACTIVE', expiresAt: { lte: new Date(now.getTime() + 3 * 86400000) } }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        for (const l of batch) {
            if (!l.expiresAt)
                continue;
            const remaining = l.expiresAt.getTime() - now.getTime();
            const kind = remaining <= 0 ? 'EXPIRED' : remaining <= 86400000 ? 'REMINDER_1' : 'REMINDER_3';
            const dedupe = `${l.id}:${l.expiresAt.toISOString()}:${kind}`;
            await db.scriptLicenseEvent.upsert({ where: { dedupe }, update: {}, create: { licenseId: l.id, actorId: 'scheduler', kind, dedupe, message: remaining <= 0 ? 'Sua licença venceu. Entre em contato com a VOOK para renovar.' : `Sua licença vence em ${remaining <= 86400000 ? 'até 24 horas' : 'até 3 dias'}.` } });
        }
        cursor = batch.length === 100 ? batch[batch.length - 1].id : undefined;
    } while (cursor);
}
export async function deliverLicenseEvents(client: Client<true>): Promise<void> {
    const db = getPrisma();
    const now = new Date();
    const pending = await db.scriptLicenseEvent.findMany({ where: { license: { guildId: licenseConfig().guildId }, deliveredAt: null, failedAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, orderBy: { createdAt: 'asc' }, take: 20, include: { license: true } });
    for (const e of pending) {
        const token = randomUUID();
        const claim = await db.scriptLicenseEvent.updateMany({ where: { id: e.id, deliveredAt: null, failedAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockToken: token, lockedUntil: new Date(Date.now() + 300000), attempts: { increment: 1 } } });
        if (!claim.count)
            continue;
        try {
            // Refresh state at send time. A reminder already queued before renewal is obsolete.
            const current = await db.scriptLicense.findUniqueOrThrow({ where: { id: e.licenseId } });
            const stale = (e.kind === 'EXPIRED' || e.kind.startsWith('REMINDER')) && (current.state !== 'ACTIVE' || current.expiresAt?.getTime() !== e.license.expiresAt?.getTime() || !e.dedupe.includes(current.expiresAt?.toISOString() || 'never'));
            if (!stale) {
                const user = await client.users.fetch(current.ownerId);
                await sendV2(await user.createDM(), detailPanel(current, e.message));
            }
            await db.scriptLicenseEvent.updateMany({ where: { id: e.id, lockToken: token }, data: { deliveredAt: new Date(), lockedUntil: null, lockToken: null } });
        }
        catch (error) {
            const blocked = typeof error === 'object' && error !== null && 'code' in error && error.code === 50007;
            await db.scriptLicenseEvent.updateMany({ where: { id: e.id, lockToken: token }, data: { failedAt: blocked || e.attempts >= 4 ? new Date() : null, lockedUntil: new Date(Date.now() + 300000), lockToken: null } });
            logger.warn('Não foi possível entregar aviso de licença.', { eventId: e.id, blocked });
        }
    }
}
export async function startLicenseRuntime(client: Client<true>): Promise<void> {
    const c = licenseConfig();
    if (!c.enabled)
        return;
    server = createLicenseServer();
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(c.port, '0.0.0.0', resolve); });
    server.on('error', () => logger.warn('Falha no serviço HTTP de licenças.'));
    // POST upserts only these commands; never overwrites the bot's other commands.
    try {
        await client.rest.post(Routes.applicationCommands(client.application.id), { body: plansCommand.builder.toJSON() });
        await client.rest.post(Routes.applicationGuildCommands(client.application.id, c.guildId), { body: licenseCommand.builder.toJSON() });
    }
    catch {
        logger.warn('Falha ao registrar /planos e /licenca. Confira o acesso do bot ao servidor oficial.');
    }
    const tick = () => { if (running)
        return; running = (async () => { await queueLicenseReminders(); await deliverLicenseEvents(client); })().catch(() => logger.warn('Falha transitória na fila de avisos de licenças.')).finally(() => { running = undefined; }); };
    timer = setInterval(tick, 60000);
    timer.unref();
    tick();
    logger.info('Licenciamento manual iniciado.', { port: c.port });
}
export async function stopLicenseRuntime(): Promise<void> {
    if (timer)
        clearInterval(timer);
    timer = undefined;
    if (server) {
        const api = server;
        server = undefined;
        await new Promise<void>(resolve => { api.close(() => resolve()); api.closeIdleConnections(); });
    }
    if (running)
        await running;
}
