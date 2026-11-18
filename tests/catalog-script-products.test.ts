import { beforeEach, expect, it, vi } from 'vitest';
import type { CatalogCategory, CatalogPack } from '@prisma/client';
import { SCRIPT_CATALOG, SCRIPT_IMAGES, isScriptPreview } from '../src/modules/catalog/scriptProducts';
import { buildPackCard, buildPackDetails } from '../src/modules/catalog/builders/CatalogBuilders';

const db = vi.hoisted(() => ({ catalogPack: { findMany: vi.fn() } }));
const categories = vi.hoisted(() => ({ getCatalogCategoryById: vi.fn(), getCatalogCategories: vi.fn() }));
const cart = vi.hoisted(() => ({ findActiveCart: vi.fn() }));
vi.mock('../src/core/database/prisma', () => ({ getPrisma: () => db }));
vi.mock('../src/core/cache/CacheService', () => ({ CACHE_NAMESPACE: {}, cache: {
    getOrLoad: (_namespace: string, _id: string, load: () => Promise<unknown>) => load(), delete: vi.fn(),
} }));
vi.mock('../src/modules/catalog/services/CatalogCategoryService', () => categories);
vi.mock('../src/modules/catalog/repositories/CartRepository', async original => ({
    ...await original<typeof import('../src/modules/catalog/repositories/CartRepository')>(), ...cart,
}));
import { getSellablePack } from '../src/modules/catalog/services/CatalogService';
import { getCartView } from '../src/modules/catalog/services/CartService';

const pack = (offer: typeof SCRIPT_CATALOG[number] = SCRIPT_CATALOG[0]): CatalogPack => ({
    id: 'pack1', guildId: 'guild1', categoryId: 'cat1', name: offer.name, slug: offer.slug, sku: offer.sku,
    shortDescription: offer.summary, description: offer.description, price: 10000, position: 0,
    enabled: true, featured: true, createdById: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
});
beforeEach(() => {
    vi.clearAllMocks();
    categories.getCatalogCategoryById.mockResolvedValue({ enabled: true });
    categories.getCatalogCategories.mockResolvedValue([{ id: 'cat1', enabled: true }]);
});
it('mostra quatro ofertas padrão; box e VIP não duplicam produtos e TrueBlood não é oferta', () => {
    expect(SCRIPT_CATALOG).toHaveLength(4);
    expect(SCRIPT_CATALOG.map(v => v.product)).not.toContain('pelucias');
    expect(JSON.stringify(SCRIPT_CATALOG.map(v => v.name))).not.toMatch(/TrueBlood|True Blood/i);
    for (const offer of SCRIPT_CATALOG.slice(2)) expect(offer.summary).toMatch(/box ou VIP/i);
    for (const images of Object.values(SCRIPT_IMAGES)) expect(images.length).toBeLessThanOrEqual(10);
});
it.each(SCRIPT_CATALOG)('$name bloqueia compra mesmo com preço positivo, por SKU ou slug', async offer => {
    const value = pack(offer);
    db.catalogPack.findMany.mockResolvedValue([value]);
    await expect(getSellablePack('guild1', value.id)).rejects.toThrow(/pagamentos.*não estão disponíveis/);
    expect(isScriptPreview({ ...value, sku: null })).toBe(true);
    expect(isScriptPreview({ ...value, slug: 'outro-nome' })).toBe(true);
    const view = { pack: value, category: null as CatalogCategory | null, images: [], details: [] };
    const card = JSON.stringify(buildPackCard({ view, imageIndex: 0 }).toJSON());
    expect(card).toContain('apresentação');
    expect(card).not.toMatch(/Comprar Agora|Adicionar ao Carrinho/);
    expect(JSON.stringify(buildPackDetails(view).toJSON())).toContain('"disabled":true');
});
it('carrinho antigo ou forjado não transforma apresentação em cobrança', async () => {
    const value = pack();
    cart.findActiveCart.mockResolvedValue({ items: [{ packId: value.id, quantity: 1 }] });
    db.catalogPack.findMany.mockResolvedValue([value]);
    const result = await getCartView('guild1', 'customer1');
    expect(result.subtotal).toBe(0);
    expect(result.sellableCount).toBe(0);
    expect(result.lines[0]).toMatchObject({ unavailable: true });
});
it('não bloqueia o catálogo de outros produtos já existentes', async () => {
    const value = { ...pack(), sku: 'PCK-001', slug: 'cabelos' };
    db.catalogPack.findMany.mockResolvedValue([value]);
    expect(await getSellablePack('guild1', value.id)).toEqual(value);
});
