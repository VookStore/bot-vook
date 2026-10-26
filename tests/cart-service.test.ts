import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { Cart, CartItem, CatalogCategory, CatalogPack } from '@prisma/client';

import { ValidationError } from '../src/core/errors';
import { BUSINESS_LIMITS } from '../src/constants/limits';
import { locks } from '../src/core/locks/LockService';
import {
  addToCart,
  clearCart,
  getCartView,
  removeFromCart,
} from '../src/modules/catalog/services/CartService';

/**
 * Carrinho: regras de negocio, com os repositorios trocados por dublês.
 *
 * O que estes testes garantem:
 *  - pack digital nunca duplica no carrinho (constraint + caminho de corrida);
 *  - o carrinho NAO congela preco: o valor exibido e sempre o preco atual;
 *  - item indisponivel continua visivel, marcado, em vez de sumir calado;
 *  - remover so afeta o carrinho de quem pediu.
 */

const GUILD_ID = '111111111111111111';
const CUSTOMER_ID = '222222222222222222';
const OTHER_CUSTOMER_ID = '333333333333333333';
const CART_ID = 'ckcart000000000000000000';

/**
 * `vi.hoisted` porque o Vitest sobe as chamadas `vi.mock` para o topo do
 * arquivo: sem isso, a fabrica do mock rodaria antes destes objetos existirem.
 */
const repo = vi.hoisted(() => ({
  findActiveCart: vi.fn(),
  ensureActiveCart: vi.fn(),
  addCartItem: vi.fn(),
  findCartItem: vi.fn(),
  removeCartItem: vi.fn(),
  clearCartItems: vi.fn(),
  closeCart: vi.fn(),
  countActiveCarts: vi.fn(),
}));

const packRepo = vi.hoisted(() => ({ findPacksByIds: vi.fn() }));
const catalogService = vi.hoisted(() => ({ getSellablePack: vi.fn() }));
const categoryService = vi.hoisted(() => ({ getCatalogCategories: vi.fn() }));

vi.mock('../src/modules/catalog/repositories/CartRepository', () => ({
  findActiveCart: (...args: unknown[]): unknown => repo.findActiveCart(...args),
  ensureActiveCart: (...args: unknown[]): unknown => repo.ensureActiveCart(...args),
  addCartItem: (...args: unknown[]): unknown => repo.addCartItem(...args),
  findCartItem: (...args: unknown[]): unknown => repo.findCartItem(...args),
  removeCartItem: (...args: unknown[]): unknown => repo.removeCartItem(...args),
  clearCartItems: (...args: unknown[]): unknown => repo.clearCartItems(...args),
  closeCart: (...args: unknown[]): unknown => repo.closeCart(...args),
  countActiveCarts: (...args: unknown[]): unknown => repo.countActiveCarts(...args),
}));

vi.mock('../src/modules/catalog/repositories/CatalogPackRepository', () => ({
  findPacksByIds: (...args: unknown[]): unknown => packRepo.findPacksByIds(...args),
}));

vi.mock('../src/modules/catalog/services/CatalogService', () => ({
  getSellablePack: (...args: unknown[]): unknown => catalogService.getSellablePack(...args),
}));

vi.mock('../src/modules/catalog/services/CatalogCategoryService', () => ({
  getCatalogCategories: (...args: unknown[]): unknown => categoryService.getCatalogCategories(...args),
}));

const CATEGORY_ID = 'ckcategoria000000000000';

function makeCategory(overrides: Partial<CatalogCategory> = {}): CatalogCategory {
  return {
    id: CATEGORY_ID,
    guildId: GUILD_ID,
    name: 'Veiculos',
    identifier: 'veiculos',
    description: null,
    emoji: null,
    position: 0,
    enabled: true,
  boosterEligible: true,
  leadTimeDays: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makePack(overrides: Partial<CatalogPack> = {}): CatalogPack {
  return {
    id: 'ckpack00000000000000001',
    guildId: GUILD_ID,
    categoryId: CATEGORY_ID,
    name: 'Vook Vehicles Collection',
    slug: 'vook-vehicles',
    sku: 'VEH-001',
    shortDescription: null,
    description: null,
    price: 14990,
    position: 0,
    enabled: true,
    featured: false,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeItem(packId: string, id = `ckitem-${packId}`): CartItem {
  return {
    id,
    cartId: CART_ID,
    packId,
    quantity: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCart(items: CartItem[]): Cart & { items: CartItem[] } {
  return {
    id: CART_ID,
    guildId: GUILD_ID,
    customerId: CUSTOMER_ID,
    status: 'ACTIVE',
    activeCustomerId: CUSTOMER_ID,
    abandonedNoticeAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items,
  };
}

beforeEach(() => {
  // `resetAllMocks` (e nao `clearAllMocks`): implementacoes com
  // `mockResolvedValueOnce` de um teste nao podem vazar para o proximo.
  vi.resetAllMocks();
  locks.clearAll();
  categoryService.getCatalogCategories.mockResolvedValue([makeCategory()]);
});

describe('adicionar ao carrinho', () => {
  it('cria o carrinho na primeira adicao e grava o item', async () => {
    const pack = makePack();
    catalogService.getSellablePack.mockResolvedValue(pack);
    repo.ensureActiveCart.mockResolvedValue(makeCart([]));
    repo.findCartItem.mockResolvedValue(null);
    repo.addCartItem.mockResolvedValue(makeItem(pack.id));

    const result = await addToCart(GUILD_ID, CUSTOMER_ID, pack.id);

    expect(repo.ensureActiveCart).toHaveBeenCalledWith(GUILD_ID, CUSTOMER_ID);
    expect(repo.addCartItem).toHaveBeenCalledWith(CART_ID, pack.id);
    expect(result.alreadyPresent).toBe(false);
    expect(result.itemCount).toBe(1);
  });

  it('NAO duplica um pack que ja esta no carrinho', async () => {
    const pack = makePack();
    catalogService.getSellablePack.mockResolvedValue(pack);
    repo.ensureActiveCart.mockResolvedValue(makeCart([makeItem(pack.id)]));
    repo.findCartItem.mockResolvedValue(makeItem(pack.id));

    const result = await addToCart(GUILD_ID, CUSTOMER_ID, pack.id);

    expect(result.alreadyPresent).toBe(true);
    expect(repo.addCartItem).not.toHaveBeenCalled();
  });

  it('corrida perdida no UNIQUE vira "ja esta no carrinho", nao erro', async () => {
    const pack = makePack();
    catalogService.getSellablePack.mockResolvedValue(pack);
    repo.ensureActiveCart.mockResolvedValue(makeCart([]));
    // Primeira leitura nao ve o item; entre ela e o insert, o clique
    // concorrente gravou — o banco recusa com P2002 e a segunda leitura acha.
    repo.findCartItem.mockResolvedValueOnce(null).mockResolvedValueOnce(makeItem(pack.id));
    repo.addCartItem.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );

    const result = await addToCart(GUILD_ID, CUSTOMER_ID, pack.id);

    // O objetivo do clique era ter o pack no carrinho — e ele esta la.
    expect(result.alreadyPresent).toBe(true);
  });

  it('recusa quando o carrinho atingiu o limite de itens', async () => {
    const pack = makePack({ id: 'ckpack-novo' });
    catalogService.getSellablePack.mockResolvedValue(pack);
    repo.ensureActiveCart.mockResolvedValue(
      makeCart(
        Array.from({ length: BUSINESS_LIMITS.MAX_CART_ITEMS }, (_unused, index) =>
          makeItem(`ckpack-${index}`),
        ),
      ),
    );
    repo.findCartItem.mockResolvedValue(null);

    await expect(addToCart(GUILD_ID, CUSTOMER_ID, pack.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(repo.addCartItem).not.toHaveBeenCalled();
  });

  it('pack indisponivel nem chega a tocar o carrinho', async () => {
    catalogService.getSellablePack.mockRejectedValue(
      new ValidationError('Pack desativado', { userMessage: 'indisponivel' }),
    );

    await expect(addToCart(GUILD_ID, CUSTOMER_ID, 'ckpack-x')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(repo.ensureActiveCart).not.toHaveBeenCalled();
  });
});

describe('visao do carrinho', () => {
  it('carrinho inexistente devolve visao vazia (e nao erro)', async () => {
    repo.findActiveCart.mockResolvedValue(null);

    const view = await getCartView(GUILD_ID, CUSTOMER_ID);

    expect(view.cart).toBeNull();
    expect(view.lines).toEqual([]);
    expect(view.subtotal).toBe(0);
  });

  it('usa o preco ATUAL do produto — o carrinho nao congela valor', async () => {
    const pack = makePack({ price: 12000 });
    repo.findActiveCart.mockResolvedValue(makeCart([makeItem(pack.id)]));
    packRepo.findPacksByIds.mockResolvedValue([pack]);

    const view = await getCartView(GUILD_ID, CUSTOMER_ID);

    expect(view.subtotal).toBe(12000);

    // Administrador sobe o preco: o carrinho reflete o novo valor na hora.
    packRepo.findPacksByIds.mockResolvedValue([makePack({ price: 15000 })]);
    const depois = await getCartView(GUILD_ID, CUSTOMER_ID);
    expect(depois.subtotal).toBe(15000);
  });

  it('soma varios itens vendaveis', async () => {
    const packA = makePack({ id: 'ckpack-a', price: 14990 });
    const packB = makePack({ id: 'ckpack-b', price: 11990 });
    repo.findActiveCart.mockResolvedValue(
      makeCart([makeItem(packA.id), makeItem(packB.id)]),
    );
    packRepo.findPacksByIds.mockResolvedValue([packA, packB]);

    const view = await getCartView(GUILD_ID, CUSTOMER_ID);

    expect(view.subtotal).toBe(26980);
    expect(view.sellableCount).toBe(2);
  });

  it('item indisponivel aparece marcado e NAO entra no subtotal', async () => {
    const bom = makePack({ id: 'ckpack-bom', price: 10000 });
    const desativado = makePack({ id: 'ckpack-off', enabled: false });
    const semPreco = makePack({ id: 'ckpack-zero', price: 0 });
    const excluido = makePack({ id: 'ckpack-del', deletedAt: new Date() });
    const categoriaOff = makePack({ id: 'ckpack-cat', categoryId: 'ckoutra-categoria' });

    repo.findActiveCart.mockResolvedValue(
      makeCart([
        makeItem(bom.id),
        makeItem(desativado.id),
        makeItem(semPreco.id),
        makeItem(excluido.id),
        makeItem(categoriaOff.id),
      ]),
    );
    packRepo.findPacksByIds.mockResolvedValue([
      bom,
      desativado,
      semPreco,
      excluido,
      categoriaOff,
    ]);

    const view = await getCartView(GUILD_ID, CUSTOMER_ID);

    expect(view.subtotal).toBe(10000);
    expect(view.sellableCount).toBe(1);
    expect(view.lines).toHaveLength(5);

    const indisponiveis = view.lines.filter((line) => line.unavailable);
    expect(indisponiveis).toHaveLength(4);
    for (const linha of indisponiveis) {
      expect(linha.reason).toBeTypeOf('string');
    }
  });

  it('ignora item cujo pack pertence a outra guild', async () => {
    const intruso = makePack({ id: 'ckpack-intruso', guildId: '999999999999999999' });
    repo.findActiveCart.mockResolvedValue(makeCart([makeItem(intruso.id)]));
    packRepo.findPacksByIds.mockResolvedValue([intruso]);

    const view = await getCartView(GUILD_ID, CUSTOMER_ID);

    expect(view.lines).toEqual([]);
    expect(view.subtotal).toBe(0);
  });
});

describe('remover e limpar', () => {
  it('remocao usa o carrinho do proprio cliente como filtro', async () => {
    repo.findActiveCart.mockResolvedValue(makeCart([makeItem('ckpack-a', 'ckitem-1')]));
    repo.removeCartItem.mockResolvedValue(true);

    const removido = await removeFromCart(GUILD_ID, CUSTOMER_ID, 'ckitem-1');

    expect(removido).toBe(true);
    // O cartId vem do carrinho ATIVO de quem clicou: um id de item de outra
    // pessoa nao encontra linha para apagar.
    expect(repo.removeCartItem).toHaveBeenCalledWith(CART_ID, 'ckitem-1');
  });

  it('remover item que nao existe mais devolve false em vez de estourar', async () => {
    repo.findActiveCart.mockResolvedValue(makeCart([]));
    repo.removeCartItem.mockResolvedValue(false);

    expect(await removeFromCart(GUILD_ID, CUSTOMER_ID, 'ckitem-fantasma')).toBe(false);
  });

  it('cliente sem carrinho nao remove nada', async () => {
    repo.findActiveCart.mockResolvedValue(null);

    expect(await removeFromCart(GUILD_ID, OTHER_CUSTOMER_ID, 'ckitem-1')).toBe(false);
    expect(repo.removeCartItem).not.toHaveBeenCalled();
  });

  it('limpar apaga apenas os itens do carrinho ativo', async () => {
    repo.findActiveCart.mockResolvedValue(makeCart([makeItem('a'), makeItem('b')]));
    repo.clearCartItems.mockResolvedValue(2);

    expect(await clearCart(GUILD_ID, CUSTOMER_ID)).toBe(2);
    expect(repo.clearCartItems).toHaveBeenCalledWith(CART_ID);
  });

  it('limpar sem carrinho e no-op', async () => {
    repo.findActiveCart.mockResolvedValue(null);

    expect(await clearCart(GUILD_ID, CUSTOMER_ID)).toBe(0);
    expect(repo.clearCartItems).not.toHaveBeenCalled();
  });
});
