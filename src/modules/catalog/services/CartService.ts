import { CartStatus, type CartItem, type CatalogPack } from '@prisma/client';

import { BUSINESS_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { isUniqueConstraintError } from '../../../core/database/prisma';
import { createLogger } from '../../../core/logger/Logger';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import {
  addCartItem,
  clearCartItems,
  closeCart,
  countActiveCarts,
  ensureActiveCart,
  findActiveCart,
  findCartItem,
  removeCartItem,
  type CartWithItems,
} from '../repositories/CartRepository';
import { findPacksByIds } from '../repositories/CatalogPackRepository';
import { getCatalogCategories } from './CatalogCategoryService';
import { getSellablePack } from './CatalogService';
import { hasSellablePrice } from '../validators/packValidators';
import type { CartLine, CartView } from '../types/catalog';

/**
 * Carrinho do cliente.
 *
 * PERSISTENTE: vive no PostgreSQL, entao o cliente reencontra os itens depois
 * de um restart do bot — ou de dois dias.
 *
 * O carrinho NAO congela preco. O preco exibido e sempre o preco ATUAL do
 * produto; o valor vinculante so nasce no PEDIDO, onde vira snapshot. Prometer
 * um preco antigo so porque o item estava no carrinho seria mentir para o
 * cliente ou vender no prejuizo.
 */

const logger = createLogger('cart');

const CART_BUSY_MESSAGE = 'Seu carrinho esta sendo atualizado. Aguarde um instante.';

/** Chave do lock: um carrinho por cliente por guild. */
function cartKey(guildId: string, customerId: string): string {
  return `${guildId}:${customerId}`;
}

export async function getActiveCart(
  guildId: string,
  customerId: string,
): Promise<CartWithItems | null> {
  return findActiveCart(guildId, customerId);
}

/**
 * Monta a visao do carrinho resolvendo cada item com o produto ATUAL.
 *
 * Itens cujo produto sumiu, foi desativado ou perdeu preco valido continuam
 * aparecendo — marcados como indisponiveis. Some-los em silencio faria o total
 * mudar sem explicacao entre uma tela e outra.
 */
export async function getCartView(guildId: string, customerId: string): Promise<CartView> {
  const cart = await findActiveCart(guildId, customerId);
  if (cart === null || cart.items.length === 0) {
    return { cart, lines: [], subtotal: 0, sellableCount: 0 };
  }

  const packs = await findPacksByIds(cart.items.map((item) => item.packId));
  const byId = new Map<string, CatalogPack>(packs.map((pack) => [pack.id, pack]));

  const categories = await getCatalogCategories(guildId);
  const enabledCategories = new Set(
    categories.filter((category) => category.enabled).map((category) => category.id),
  );

  const lines: CartLine[] = [];
  let subtotal = 0;
  let sellableCount = 0;

  for (const item of cart.items) {
    const pack = byId.get(item.packId);
    if (pack === undefined || pack.guildId !== guildId) continue;

    const reason = unavailableReason(pack, enabledCategories);
    const unavailable = reason !== null;

    if (!unavailable) {
      subtotal += pack.price * item.quantity;
      sellableCount += 1;
    }

    lines.push({ item, pack, unavailable, reason });
  }

  return { cart, lines, subtotal, sellableCount };
}

function unavailableReason(
  pack: CatalogPack,
  enabledCategories: ReadonlySet<string>,
): string | null {
  if (pack.deletedAt !== null) return 'Produto removido do catalogo.';
  if (!pack.enabled) return 'Produto indisponivel no momento.';
  if (!enabledCategories.has(pack.categoryId)) return 'Categoria indisponivel no momento.';
  if (!hasSellablePrice(pack.price)) return 'Produto sem preco definido.';
  return null;
}

export interface AddToCartResult {
  cart: CartWithItems;
  item: CartItem;
  /** True quando o pack ja estava no carrinho (nada foi duplicado). */
  alreadyPresent: boolean;
  itemCount: number;
}

/**
 * Adiciona um pack ao carrinho.
 *
 * Pack digital nao tem quantidade: o par (cartId, packId) e UNIQUE no banco,
 * entao um duplo clique nunca cria dois itens iguais. O lock em memoria evita
 * o caminho de erro; o UNIQUE e a garantia real.
 */
export async function addToCart(
  guildId: string,
  customerId: string,
  packId: string,
): Promise<AddToCartResult> {
  const pack = await getSellablePack(guildId, packId);

  return locks.withLock(
    LOCK_NAMESPACE.CART_ACTION,
    cartKey(guildId, customerId),
    async () => {
      const cart = await ensureActiveCart(guildId, customerId);

      const existing = await findCartItem(cart.id, pack.id);
      if (existing !== null) {
        return {
          cart,
          item: existing,
          alreadyPresent: true,
          itemCount: cart.items.length,
        };
      }

      if (cart.items.length >= BUSINESS_LIMITS.MAX_CART_ITEMS) {
        throw new ValidationError(`Carrinho cheio: ${cart.items.length}`, {
          userMessage: `Seu carrinho ja possui o limite de ${BUSINESS_LIMITS.MAX_CART_ITEMS} itens. Finalize a compra ou remova algum item.`,
        });
      }

      try {
        const item = await addCartItem(cart.id, pack.id);
        logger.debug('Item adicionado ao carrinho.', {
          guildId,
          userId: customerId,
          entityType: 'cart',
          entityId: cart.id,
          packId: pack.id,
        });
        return {
          cart,
          item,
          alreadyPresent: false,
          itemCount: cart.items.length + 1,
        };
      } catch (error) {
        // Corrida vencida por outro clique: o item ja esta la, o que era
        // exatamente o objetivo. Devolve como "ja presente".
        if (isUniqueConstraintError(error)) {
          const item = await findCartItem(cart.id, pack.id);
          if (item !== null) {
            return { cart, item, alreadyPresent: true, itemCount: cart.items.length };
          }
        }
        throw error;
      }
    },
    { userMessage: CART_BUSY_MESSAGE },
  );
}

export async function removeFromCart(
  guildId: string,
  customerId: string,
  itemId: string,
): Promise<boolean> {
  return locks.withLock(
    LOCK_NAMESPACE.CART_ACTION,
    cartKey(guildId, customerId),
    async () => {
      const cart = await findActiveCart(guildId, customerId);
      if (cart === null) return false;
      // Remove com `cartId` no where: um id de item de OUTRO cliente nunca
      // apaga nada, mesmo que o customId seja adulterado.
      return removeCartItem(cart.id, itemId);
    },
    { userMessage: CART_BUSY_MESSAGE },
  );
}

export async function clearCart(guildId: string, customerId: string): Promise<number> {
  return locks.withLock(
    LOCK_NAMESPACE.CART_ACTION,
    cartKey(guildId, customerId),
    async () => {
      const cart = await findActiveCart(guildId, customerId);
      if (cart === null) return 0;
      return clearCartItems(cart.id);
    },
    { userMessage: CART_BUSY_MESSAGE },
  );
}

/**
 * Encerra o carrinho apos o checkout.
 * Condicional ao status ATIVO: se outra interacao ja encerrou, devolve false e
 * o chamador sabe que perdeu a corrida.
 */
export async function finishCart(cartId: string): Promise<boolean> {
  return closeCart(cartId, CartStatus.CHECKED_OUT);
}

export async function countCarts(guildId: string): Promise<number> {
  return countActiveCarts(guildId);
}
