import { expect, it } from 'vitest';
import type { CatalogPack, GuildConfig } from '@prisma/client';
import { SCRIPT_CATALOG } from '../src/modules/catalog/scriptProducts';
import { buildCatalogPanel, buildPackCard, buildPackDetails } from '../src/modules/catalog/builders/CatalogBuilders';
import { buildCatalogWorkspace, buildProductTextModal } from '../src/modules/catalog/builders/CatalogWorkspace';
import { parseCustomId, CATALOG_ACTION } from '../src/constants/customIds';
type Node = { type?: number; components?: Node[]; accessory?: Node; custom_id?: string; content?: string };
function nodes(node: Node): Node[] { return [node, ...(node.components ?? []).flatMap(nodes), ...(node.accessory ? nodes(node.accessory) : [])]; }
const packs = SCRIPT_CATALOG.map(offer => ({ id: offer.product, name: offer.name, slug: offer.slug, sku: offer.sku, shortDescription: offer.summary, description: offer.description, guildId: 'guild1', categoryId: 'cat1', enabled: true, featured: true, price: 0, position: 0, createdAt: new Date(), updatedAt: new Date(), createdById: null, deletedAt: null } satisfies CatalogPack));
it('abre cada produto direto no painel e respeita os limites de componentes', () => {
    const config = { catalogBannerUrl: 'https://example.com/cover.png' } as GuildConfig;
    const json = buildCatalogPanel(config, { packs: 4, categories: 2, products: packs }).toJSON();
    expect(json.components.length).toBeLessThanOrEqual(10);
    const ids = nodes(json).filter(n => n.custom_id).map(n => parseCustomId(n.custom_id!));
    expect(ids.filter(p => p?.action === CATALOG_ACTION.PACK_VIEW).map(p => p?.args[0]).sort()).toEqual(packs.map(p => p.id).sort());
    expect(JSON.stringify(json)).not.toMatch(/Meu Carrinho|Meus Pedidos|Selecione uma categoria/);
});
it.each(packs)('$name mantém apenas ações de consulta no produto e nos detalhes', pack => {
    const view = { pack, images: [], details: [], category: null };
    for (const json of [buildPackCard({ view, imageIndex: 0 }).toJSON(), buildPackDetails(view).toJSON()]) {
        expect(JSON.stringify(json)).not.toMatch(/SKU|Comprar Agora|Carrinho|Meus Pedidos/);
        expect(nodes(json).some(n => n.custom_id && parseCustomId(n.custom_id)?.action === CATALOG_ACTION.HOME)).toBe(true);
    }
});
it('a administração seleciona um produto uma vez e não exige preço no texto', () => {
    const json = buildCatalogWorkspace(packs).toJSON();
    expect(json.components.length).toBeLessThanOrEqual(10);
    expect(nodes(json).filter(n => n.custom_id && parseCustomId(n.custom_id)?.action === CATALOG_ACTION.PRODUCT_PANEL)).toHaveLength(4);
    const modal = JSON.stringify(buildProductTextModal(packs[0]).toJSON());
    expect(modal).not.toMatch(/"custom_id":"preco"|"custom_id":"sku"/);
});
