"use strict";
/**
 * Cache em memoria.
 *
 * REGRA: o PostgreSQL e sempre a fonte de verdade. Este cache existe apenas
 * para evitar consultas repetidas em caminhos quentes (painel, abertura de
 * ticket, validacao de equipe). Toda escrita bem sucedida no banco DEVE
 * invalidar ou atualizar a entrada correspondente.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cache = exports.CacheService = exports.CACHE_NAMESPACE = void 0;
exports.CACHE_NAMESPACE = {
    /** key = guildId */
    GUILD_CONFIG: 'guild_config',
    /** key = guildId */
    CATEGORIES: 'categories',
    /** key = categoryId */
    TEAM_ROLES: 'team_roles',
    /** key = guildId */
    COUPONS: 'coupons',
    /** key = guildId */
    PAYMENT_ACCOUNTS: 'payment_accounts',
    /** key = guildId */
    CATALOG_CATEGORIES: 'catalog_categories',
    /** key = guildId */
    CATALOG_PACKS: 'catalog_packs',
    /** key = packId */
    PACK_IMAGES: 'pack_images',
};
class CacheService {
    stores = new Map();
    hits = 0;
    misses = 0;
    store(namespace) {
        let bucket = this.stores.get(namespace);
        if (bucket === undefined) {
            bucket = new Map();
            this.stores.set(namespace, bucket);
        }
        return bucket;
    }
    get(namespace, key) {
        const entry = this.store(namespace).get(key);
        if (entry === undefined) {
            this.misses += 1;
            return undefined;
        }
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this.store(namespace).delete(key);
            this.misses += 1;
            return undefined;
        }
        this.hits += 1;
        return entry.value;
    }
    /**
     * Armazena um valor.
     *
     * `ttlMs` omitido = sem expiracao (invalidado explicitamente pela escrita).
     * `ttlMs` <= 0 = NAO cacheia. Tratar TTL zero/negativo como "guardar para
     * sempre" seria o pior default possivel: uma constante mal calculada deixaria
     * dado velho preso em memoria indefinidamente.
     */
    set(namespace, key, value, ttlMs) {
        if (ttlMs !== undefined && ttlMs <= 0) {
            this.store(namespace).delete(key);
            return;
        }
        this.store(namespace).set(key, {
            value,
            expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
        });
    }
    has(namespace, key) {
        return this.get(namespace, key) !== undefined;
    }
    /**
     * Busca no cache; em caso de miss executa o loader e armazena o resultado.
     * Valores `null` sao cacheados (representam "confirmadamente inexistente").
     */
    async getOrLoad(namespace, key, loader, ttlMs) {
        const cachedValue = this.get(namespace, key);
        if (cachedValue !== undefined)
            return cachedValue;
        const loaded = await loader();
        this.set(namespace, key, loaded, ttlMs);
        return loaded;
    }
    delete(namespace, key) {
        this.store(namespace).delete(key);
    }
    clearNamespace(namespace) {
        this.store(namespace).clear();
    }
    /**
     * Invalida tudo que pertence a uma guild.
     * Namespaces indexados por outra chave (ex.: TEAM_ROLES por categoryId) sao
     * limpos por completo, pois nao ha como mapear a guild sem consultar o banco.
     */
    invalidateGuild(guildId) {
        this.delete(exports.CACHE_NAMESPACE.GUILD_CONFIG, guildId);
        this.delete(exports.CACHE_NAMESPACE.CATEGORIES, guildId);
        this.delete(exports.CACHE_NAMESPACE.COUPONS, guildId);
        this.delete(exports.CACHE_NAMESPACE.PAYMENT_ACCOUNTS, guildId);
        this.delete(exports.CACHE_NAMESPACE.CATALOG_CATEGORIES, guildId);
        this.delete(exports.CACHE_NAMESPACE.CATALOG_PACKS, guildId);
        this.clearNamespace(exports.CACHE_NAMESPACE.TEAM_ROLES);
        this.clearNamespace(exports.CACHE_NAMESPACE.PACK_IMAGES);
    }
    clearAll() {
        this.stores.clear();
        this.hits = 0;
        this.misses = 0;
    }
    stats() {
        const namespaces = {};
        let entries = 0;
        for (const [namespace, bucket] of this.stores) {
            namespaces[namespace] = bucket.size;
            entries += bucket.size;
        }
        return { hits: this.hits, misses: this.misses, entries, namespaces };
    }
    /** Remove entradas expiradas (job de manutencao). */
    prune() {
        const now = Date.now();
        let removed = 0;
        for (const bucket of this.stores.values()) {
            for (const [key, entry] of bucket) {
                if (entry.expiresAt !== null && entry.expiresAt <= now) {
                    bucket.delete(key);
                    removed += 1;
                }
            }
        }
        return removed;
    }
}
exports.CacheService = CacheService;
/** Instancia compartilhada do processo. */
exports.cache = new CacheService();
//# sourceMappingURL=CacheService.js.map