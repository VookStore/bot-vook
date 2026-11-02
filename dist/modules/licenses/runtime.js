"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLicenseServer = createLicenseServer;
exports.queueLicenseReminders = queueLicenseReminders;
exports.deliverLicenseEvents = deliverLicenseEvents;
exports.startLicenseRuntime = startLicenseRuntime;
exports.stopLicenseRuntime = stopLicenseRuntime;
const node_http_1 = require("node:http");
const node_crypto_1 = require("node:crypto");
const discord_js_1 = require("discord.js");
const prisma_1 = require("../../core/database/prisma");
const reply_1 = require("../../components/reply");
const Logger_1 = require("../../core/logger/Logger");
const config_1 = require("./config");
const service_1 = require("./service");
const crypto_1 = require("./crypto");
const panel_1 = require("./panel");
const commands_1 = require("./commands");
const logger = (0, Logger_1.createLogger)('licenses');
let server;
let timer;
let running;
function createLicenseServer(validate = service_1.validateLicense) {
    // Bounded fixed windows, per credential plus a global cap. Do not trust X-Forwarded-For.
    let windowStart = Date.now();
    let total = 0;
    const hits = new Map();
    const api = (0, node_http_1.createServer)(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
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
        const bucket = (0, crypto_1.digest)(key);
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
            let parsed;
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
            const v = parsed;
            if (!['product', 'resource', 'installation', 'nonce'].every(k => typeof v[k] === 'string' && v[k].length <= 128)) {
                reply(400, { error: 'invalid_request' });
                return;
            }
            const result = await validate(key, v);
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
async function queueLicenseReminders(now = new Date()) {
    const db = (0, prisma_1.getPrisma)();
    const c = (0, config_1.licenseConfig)();
    // A cursor prevents a large customer list from creating an unbounded memory/query workload.
    let cursor;
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
async function deliverLicenseEvents(client) {
    const db = (0, prisma_1.getPrisma)();
    const now = new Date();
    const pending = await db.scriptLicenseEvent.findMany({ where: { license: { guildId: (0, config_1.licenseConfig)().guildId }, deliveredAt: null, failedAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, orderBy: { createdAt: 'asc' }, take: 20, include: { license: true } });
    for (const e of pending) {
        const token = (0, node_crypto_1.randomUUID)();
        const claim = await db.scriptLicenseEvent.updateMany({ where: { id: e.id, deliveredAt: null, failedAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockToken: token, lockedUntil: new Date(Date.now() + 300000), attempts: { increment: 1 } } });
        if (!claim.count)
            continue;
        try {
            // Refresh state at send time. A reminder already queued before renewal is obsolete.
            const current = await db.scriptLicense.findUniqueOrThrow({ where: { id: e.licenseId } });
            const stale = (e.kind === 'EXPIRED' || e.kind.startsWith('REMINDER')) && (current.state !== 'ACTIVE' || current.expiresAt?.getTime() !== e.license.expiresAt?.getTime() || !e.dedupe.includes(current.expiresAt?.toISOString() || 'never'));
            if (!stale) {
                const user = await client.users.fetch(current.ownerId);
                await (0, reply_1.sendV2)(await user.createDM(), (0, panel_1.detailPanel)(current, e.message));
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
async function startLicenseRuntime(client) {
    const c = (0, config_1.licenseConfig)();
    if (!c.enabled)
        return;
    server = createLicenseServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(c.port, '0.0.0.0', resolve); });
    server.on('error', () => logger.warn('Falha no serviço HTTP de licenças.'));
    // POST upserts only these commands; never overwrites the bot's other commands.
    try {
        await client.rest.post(discord_js_1.Routes.applicationCommands(client.application.id), { body: commands_1.plansCommand.builder.toJSON() });
        await client.rest.post(discord_js_1.Routes.applicationGuildCommands(client.application.id, c.guildId), { body: commands_1.licenseCommand.builder.toJSON() });
    }
    catch {
        logger.warn('Falha ao registrar /planos e /licenca. Confira o acesso do bot ao servidor oficial.');
    }
    const tick = () => {
        if (running)
            return;
        running = (async () => { await queueLicenseReminders(); await deliverLicenseEvents(client); })().catch(() => logger.warn('Falha transitória na fila de avisos de licenças.')).finally(() => { running = undefined; });
    };
    timer = setInterval(tick, 60000);
    timer.unref();
    tick();
    logger.info('Licenciamento manual iniciado.', { port: c.port });
}
async function stopLicenseRuntime() {
    if (timer)
        clearInterval(timer);
    timer = undefined;
    if (server) {
        const api = server;
        server = undefined;
        await new Promise(resolve => { api.close(() => resolve()); api.closeIdleConnections(); });
    }
    if (running)
        await running;
}
//# sourceMappingURL=runtime.js.map