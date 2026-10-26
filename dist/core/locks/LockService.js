"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cooldowns = exports.CooldownService = exports.COOLDOWN_NAMESPACE = exports.locks = exports.LockService = exports.LOCK_NAMESPACE = void 0;
const node_crypto_1 = require("node:crypto");
const errors_1 = require("../errors");
/**
 * Locks cooperativos em memoria.
 *
 * IMPORTANTE: locks de RAM protegem apenas contra duplo clique e corridas
 * dentro deste processo. Eles NAO substituem constraints UNIQUE, updates
 * condicionais (`updateMany` com `where`) e transacoes — que continuam sendo a
 * garantia real de integridade.
 */
exports.LOCK_NAMESPACE = {
    TICKET_CREATE: 'ticket:create',
    TICKET_CLAIM: 'ticket:claim',
    TICKET_CLOSE: 'ticket:close',
    TICKET_ADMIN: 'ticket:admin',
    PAYMENT_ACTION: 'payment:action',
    REVIEW_SUBMIT: 'review:submit',
    COUPON_ADMIN: 'coupon:admin',
    PANEL_UPDATE: 'panel:update',
    CATALOG_ADMIN: 'catalog:admin',
    CART_ACTION: 'cart:action',
    ORDER_CREATE: 'order:create',
    ORDER_ACTION: 'order:action',
};
const DEFAULT_TTL_MS = 30_000;
class LockService {
    locks = new Map();
    static key(namespace, resource) {
        return `${namespace}::${resource}`;
    }
    /**
     * Adquire o lock e devolve o token do dono (ou `null` se ocupado).
     *
     * O token existe porque o lock expira por TTL: uma operacao que passe do TTL
     * perde o lock para outra e NAO pode apagar a chave de quem entrou depois.
     */
    acquireToken(namespace, resource, ttlMs) {
        const key = LockService.key(namespace, resource);
        const now = Date.now();
        const existing = this.locks.get(key);
        if (existing !== undefined && existing.expiresAt > now)
            return null;
        const owner = (0, node_crypto_1.randomUUID)();
        this.locks.set(key, { owner, acquiredAt: now, expiresAt: now + ttlMs });
        return owner;
    }
    /** Tenta adquirir. Retorna false se ja houver um lock ativo. */
    tryAcquire(namespace, resource, ttlMs = DEFAULT_TTL_MS) {
        return this.acquireToken(namespace, resource, ttlMs) !== null;
    }
    /**
     * Libera o lock. Com `token`, so apaga se o lock ainda pertencer a ele —
     * caso contrario o dono atual (que adquiriu depois do TTL) e preservado.
     */
    release(namespace, resource, token) {
        const key = LockService.key(namespace, resource);
        if (token !== undefined) {
            const entry = this.locks.get(key);
            if (entry === undefined || entry.owner !== token)
                return;
        }
        this.locks.delete(key);
    }
    isLocked(namespace, resource) {
        const entry = this.locks.get(LockService.key(namespace, resource));
        if (entry === undefined)
            return false;
        if (entry.expiresAt <= Date.now()) {
            this.locks.delete(LockService.key(namespace, resource));
            return false;
        }
        return true;
    }
    /**
     * Executa `fn` sob lock exclusivo. O lock e SEMPRE liberado no finally.
     * Lanca `LockBusyError` quando o recurso ja esta ocupado.
     */
    async withLock(namespace, resource, fn, options = {}) {
        const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        const token = this.acquireToken(namespace, resource, ttlMs);
        if (token === null) {
            throw new errors_1.LockBusyError(`${namespace}:${resource}`, {
                userMessage: options.userMessage,
                context: { namespace, resource },
            });
        }
        try {
            return await fn();
        }
        finally {
            // Passa o token: se o TTL estourou e outra operacao ja adquiriu o lock,
            // este release nao pode apagar a chave dela.
            this.release(namespace, resource, token);
        }
    }
    size() {
        this.prune();
        return this.locks.size;
    }
    /** Remove locks expirados (job de manutencao). */
    prune() {
        const now = Date.now();
        let removed = 0;
        for (const [key, entry] of this.locks) {
            if (entry.expiresAt <= now) {
                this.locks.delete(key);
                removed += 1;
            }
        }
        return removed;
    }
    clearAll() {
        this.locks.clear();
    }
}
exports.LockService = LockService;
exports.locks = new LockService();
// ---------------------------------------------------------------------------
// Cooldowns (rate limit interno por usuario/recurso)
// ---------------------------------------------------------------------------
exports.COOLDOWN_NAMESPACE = {
    TICKET_CREATE: 'ticket:create',
    TICKET_NOTIFY: 'ticket:notify',
    TICKET_RENAME: 'ticket:rename',
    PAYMENT_CREATE: 'payment:create',
    REVIEW_SUBMIT: 'review:submit',
    PANEL_REFRESH: 'panel:refresh',
    ORDER_CREATE: 'order:create',
    RECEIPT_UPLOAD: 'receipt:upload',
};
class CooldownService {
    entries = new Map();
    static key(namespace, resource) {
        return `${namespace}::${resource}`;
    }
    /** Segundos restantes (0 quando liberado). */
    remainingSeconds(namespace, resource, windowSeconds) {
        if (windowSeconds <= 0)
            return 0;
        const last = this.entries.get(CooldownService.key(namespace, resource));
        if (last === undefined)
            return 0;
        const elapsedMs = Date.now() - last;
        const remainingMs = windowSeconds * 1000 - elapsedMs;
        return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
    }
    mark(namespace, resource) {
        this.entries.set(CooldownService.key(namespace, resource), Date.now());
    }
    clear(namespace, resource) {
        this.entries.delete(CooldownService.key(namespace, resource));
    }
    /** Remove marcas antigas para nao crescer indefinidamente. */
    prune(maxAgeMs = 3_600_000) {
        const cutoff = Date.now() - maxAgeMs;
        let removed = 0;
        for (const [key, timestamp] of this.entries) {
            if (timestamp < cutoff) {
                this.entries.delete(key);
                removed += 1;
            }
        }
        return removed;
    }
    clearAll() {
        this.entries.clear();
    }
    size() {
        return this.entries.size;
    }
}
exports.CooldownService = CooldownService;
exports.cooldowns = new CooldownService();
//# sourceMappingURL=LockService.js.map