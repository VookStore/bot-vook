import type {
  Cart,
  CartItem,
  CatalogCategory,
  CatalogPack,
  CatalogPackDetail,
  Order,
  OrderItem,
  PackImage,
  Payment,
} from '@prisma/client';

/**
 * Contratos compartilhados do catalogo.
 *
 * REGRA DE OURO DO MODULO: o catalogo cria PEDIDO, nunca cobranca. Toda
 * cobranca sai do `PaymentService` central — o mesmo usado por `/pagamento`.
 */

/** Pack com tudo que a vitrine precisa em uma unica leitura. */
export interface PackView {
  pack: CatalogPack;
  category: CatalogCategory | null;
  images: PackImage[];
  details: CatalogPackDetail[];
}

/** Item do carrinho ja resolvido com o produto atual (preco vivo). */
export interface CartLine {
  item: CartItem;
  pack: CatalogPack;
  /** Produto sumiu, foi desativado ou perdeu preco valido. */
  unavailable: boolean;
  reason: string | null;
}

export interface CartView {
  cart: Cart | null;
  lines: CartLine[];
  subtotal: number;
  /** Quantidade de itens vendaveis (ignora indisponiveis). */
  sellableCount: number;
}

/** Pedido carregado com itens, cobranca atual e nada mais. */
export interface OrderView {
  order: Order;
  items: OrderItem[];
  payment: Payment | null;
}

/** Uma pagina de resultados (catalogo e pedidos usam o mesmo formato). */
export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

/** Alvo de uma acao administrativa sobre packs. */
export const PACK_PICK_KIND = {
  EDIT: 'edit',
  PRICE: 'price',
  TOGGLE: 'toggle',
  FEATURE: 'feature',
  DELETE: 'delete',
  IMAGES: 'images',
  DETAILS: 'details',
  CATEGORY: 'category',
} as const;

export type PackPickKind = (typeof PACK_PICK_KIND)[keyof typeof PACK_PICK_KIND];

export function isPackPickKind(value: string): value is PackPickKind {
  return (Object.values(PACK_PICK_KIND) as string[]).includes(value);
}

/** Alvo de uma acao administrativa sobre imagens. */
export const IMAGE_PICK_KIND = {
  REMOVE: 'remove',
  UP: 'up',
  DOWN: 'down',
  COVER: 'cover',
} as const;

export type ImagePickKind = (typeof IMAGE_PICK_KIND)[keyof typeof IMAGE_PICK_KIND];

export function isImagePickKind(value: string): value is ImagePickKind {
  return (Object.values(IMAGE_PICK_KIND) as string[]).includes(value);
}

/** Alvo de uma acao administrativa sobre categorias do catalogo. */
export const CATEGORY_PICK_KIND = {
  EDIT: 'edit',
  TOGGLE: 'toggle',
  DELETE: 'delete',
  UP: 'up',
  DOWN: 'down',
} as const;

export type CategoryPickKind =
  (typeof CATEGORY_PICK_KIND)[keyof typeof CATEGORY_PICK_KIND];

export function isCategoryPickKind(value: string): value is CategoryPickKind {
  return (Object.values(CATEGORY_PICK_KIND) as string[]).includes(value);
}

/** Valor usado no seletor de categorias para "todos os produtos". */
export const ALL_CATEGORIES_VALUE = 'all';
