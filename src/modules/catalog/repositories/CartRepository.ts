import { CartStatus, type Cart, type CartItem } from '@prisma/client';

import { getPrisma, type DatabaseClient } from '../../../core/database/prisma';

/**
 * Persistencia do carrinho.
 *
 * O carrinho vive no PostgreSQL — nunca em memoria: o cliente precisa
 * reencontrar os itens depois de um restart do bot (e depois de dias).
 *
 * "No maximo um carrinho ATIVO por cliente" e garantido pelo BANCO, atraves da
 * coluna `activeCustomerId` (igual ao customerId enquanto ativo, NULL depois) e
 * do UNIQUE (guildId, activeCustomerId).
 */

export type CartWithItems = Cart & { items: CartItem[] };

export async function findActiveCart(
  guildId: string,
  customerId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CartWithItems | null> {
  return db.cart.findUnique({
    where: { guildId_activeCustomerId: { guildId, activeCustomerId: customerId } },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function findCartById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<CartWithItems | null> {
  return db.cart.findUnique({
    where: { id },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Carrega o carrinho ativo, criando-o se ainda nao existir.
 * O `upsert` na chave (guildId, activeCustomerId) torna a operacao segura sob
 * concorrencia: dois cliques simultaneos convergem para o MESMO carrinho.
 */
export async function ensureActiveCart(
  guildId: string,
  customerId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CartWithItems> {
  await db.cart.upsert({
    where: { guildId_activeCustomerId: { guildId, activeCustomerId: customerId } },
    create: {
      guildId,
      customerId,
      activeCustomerId: customerId,
      status: CartStatus.ACTIVE,
    },
    update: {},
  });

  const cart = await findActiveCart(guildId, customerId, db);
  if (cart === null) {
    // Impossivel na pratica (acabou de ser criado), mas o tipo precisa fechar.
    throw new Error(`Carrinho ativo nao encontrado apos upsert: ${guildId}/${customerId}`);
  }
  return cart;
}

export async function addCartItem(
  cartId: string,
  packId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CartItem> {
  return db.cartItem.create({ data: { cartId, packId, quantity: 1 } });
}

export async function findCartItem(
  cartId: string,
  packId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CartItem | null> {
  return db.cartItem.findUnique({ where: { cartId_packId: { cartId, packId } } });
}

/** Remove um item garantindo que ele pertence ao carrinho informado. */
export async function removeCartItem(
  cartId: string,
  itemId: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.cartItem.deleteMany({ where: { id: itemId, cartId } });
  return result.count === 1;
}

export async function clearCartItems(
  cartId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  const result = await db.cartItem.deleteMany({ where: { cartId } });
  return result.count;
}

export async function countCartItems(
  cartId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.cartItem.count({ where: { cartId } });
}

/**
 * Encerra o carrinho (checkout concluido).
 *
 * `activeCustomerId` vira NULL, liberando o UNIQUE para o proximo carrinho.
 * O update e CONDICIONAL ao status ATIVO: dois checkouts simultaneos, so um
 * ganha — e o outro descobre que perdeu pelo retorno `false`.
 */
export async function closeCart(
  cartId: string,
  status: CartStatus,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.cart.updateMany({
    where: { id: cartId, status: CartStatus.ACTIVE },
    data: { status, activeCustomerId: null },
  });
  return result.count === 1;
}

export async function countActiveCarts(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.cart.count({ where: { guildId, status: CartStatus.ACTIVE } });
}

/**
 * Carrinhos parados ha tempo demais e que ainda nao receberam lembrete.
 *
 * O filtro `items: { some: {} }` e essencial: carrinho vazio e o estado normal
 * de quem so abriu a vitrine, e mandar "voce esqueceu algo" para essa pessoa
 * seria propaganda pura — exatamente o que faz alguem bloquear as DMs do bot.
 *
 * `updatedAt` (nao `createdAt`) e o relogio certo: ele se move a cada item
 * adicionado ou removido, entao a contagem comeca da ULTIMA interacao real com
 * o carrinho, e nao da primeira.
 */
export async function listAbandonedCarts(
  inactiveSince: Date,
  take: number,
  db: DatabaseClient = getPrisma(),
): Promise<CartWithItems[]> {
  return db.cart.findMany({
    where: {
      status: CartStatus.ACTIVE,
      abandonedNoticeAt: null,
      updatedAt: { lte: inactiveSince },
      items: { some: {} },
    },
    orderBy: { updatedAt: 'asc' },
    take,
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Marca o carrinho como ja avisado.
 *
 * O `where` exige `abandonedNoticeAt: null`, entao duas rodadas concorrentes do
 * job nao conseguem avisar o mesmo carrinho duas vezes: a segunda escrita nao
 * casa e devolve false.
 */
export async function markAbandonedNoticeSent(
  cartId: string,
  at: Date = new Date(),
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.cart.updateMany({
    where: { id: cartId, abandonedNoticeAt: null },
    data: { abandonedNoticeAt: at },
  });
  return result.count === 1;
}
