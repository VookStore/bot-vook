/**
 * Cache em memoria.
 *
 * REGRA: o PostgreSQL e sempre a fonte de verdade. Este cache existe apenas
 * para evitar consultas repetidas em caminhos quentes (painel, abertura de
 * ticket, validacao de equipe). Toda escrita bem sucedida no banco DEVE
 * invalidar ou atualizar a entrada correspondente.
 */

export const CACHE_NAMESPACE = {
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
} as const;

export type CacheNamespace = (typeof CACHE_NAMESPACE)[keyof typeof CACHE_NAMESPACE];

interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
}

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  namespaces: Record<string, number>;
}

export class CacheService {
  private readonly stores = new Map<string, Map<string, CacheEntry>>();
  private hits = 0;
  private misses = 0;

  private store(namespace: string): Map<string, CacheEntry> {
    let bucket = this.stores.get(namespace);
    if (bucket === undefined) {
      bucket = new Map<string, CacheEntry>();
      this.stores.set(namespace, bucket);
    }
    return bucket;
  }

  public get<T>(namespace: CacheNamespace, key: string): T | undefined {
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
    return entry.value as T;
  }

  /**
   * Armazena um valor.
   *
   * `ttlMs` omitido = sem expiracao (invalidado explicitamente pela escrita).
   * `ttlMs` <= 0 = NAO cacheia. Tratar TTL zero/negativo como "guardar para
   * sempre" seria o pior default possivel: uma constante mal calculada deixaria
   * dado velho preso em memoria indefinidamente.
   */
  public set<T>(namespace: CacheNamespace, key: string, value: T, ttlMs?: number): void {
    if (ttlMs !== undefined && ttlMs <= 0) {
      this.store(namespace).delete(key);
      return;
    }
    this.store(namespace).set(key, {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
    });
  }

  public has(namespace: CacheNamespace, key: string): boolean {
    return this.get(namespace, key) !== undefined;
  }

  /**
   * Busca no cache; em caso de miss executa o loader e armazena o resultado.
   * Valores `null` sao cacheados (representam "confirmadamente inexistente").
   */
  public async getOrLoad<T>(
    namespace: CacheNamespace,
    key: string,
    loader: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const cachedValue = this.get<T>(namespace, key);
    if (cachedValue !== undefined) return cachedValue;
    const loaded = await loader();
    this.set(namespace, key, loaded, ttlMs);
    return loaded;
  }

  public delete(namespace: CacheNamespace, key: string): void {
    this.store(namespace).delete(key);
  }

  public clearNamespace(namespace: CacheNamespace): void {
    this.store(namespace).clear();
  }

  /**
   * Invalida tudo que pertence a uma guild.
   * Namespaces indexados por outra chave (ex.: TEAM_ROLES por categoryId) sao
   * limpos por completo, pois nao ha como mapear a guild sem consultar o banco.
   */
  public invalidateGuild(guildId: string): void {
    this.delete(CACHE_NAMESPACE.GUILD_CONFIG, guildId);
    this.delete(CACHE_NAMESPACE.CATEGORIES, guildId);
    this.delete(CACHE_NAMESPACE.COUPONS, guildId);
    this.delete(CACHE_NAMESPACE.PAYMENT_ACCOUNTS, guildId);
    this.delete(CACHE_NAMESPACE.CATALOG_CATEGORIES, guildId);
    this.delete(CACHE_NAMESPACE.CATALOG_PACKS, guildId);
    this.clearNamespace(CACHE_NAMESPACE.TEAM_ROLES);
    this.clearNamespace(CACHE_NAMESPACE.PACK_IMAGES);
  }

  public clearAll(): void {
    this.stores.clear();
    this.hits = 0;
    this.misses = 0;
  }

  public stats(): CacheStats {
    const namespaces: Record<string, number> = {};
    let entries = 0;
    for (const [namespace, bucket] of this.stores) {
      namespaces[namespace] = bucket.size;
      entries += bucket.size;
    }
    return { hits: this.hits, misses: this.misses, entries, namespaces };
  }

  /** Remove entradas expiradas (job de manutencao). */
  public prune(): number {
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

/** Instancia compartilhada do processo. */
export const cache = new CacheService();
