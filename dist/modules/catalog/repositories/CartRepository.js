"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findActiveCart = findActiveCart;
exports.findCartById = findCartById;
exports.ensureActiveCart = ensureActiveCart;
exports.addCartItem = addCartItem;
exports.findCartItem = findCartItem;
exports.removeCartItem = removeCartItem;
exports.clearCartItems = clearCartItems;
exports.countCartItems = countCartItems;
exports.closeCart = closeCart;
exports.countActiveCarts = countActiveCarts;
exports.listAbandonedCarts = listAbandonedCarts;
exports.markAbandonedNoticeSent = markAbandonedNoticeSent;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../../core/database/prisma");
async function findActiveCart(guildId, customerId, db = (0, prisma_1.getPrisma)()) {
    return db.cart.findUnique({
        where: { guildId_activeCustomerId: { guildId, activeCustomerId: customerId } },
        include: { items: { orderBy: { createdAt: 'asc' } } },
    });
}
async function findCartById(id, db = (0, prisma_1.getPrisma)()) {
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
async function ensureActiveCart(guildId, customerId, db = (0, prisma_1.getPrisma)()) {
    await db.cart.upsert({
        where: { guildId_activeCustomerId: { guildId, activeCustomerId: customerId } },
        create: {
            guildId,
            customerId,
            activeCustomerId: customerId,
            status: client_1.CartStatus.ACTIVE,
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
async function addCartItem(cartId, packId, db = (0, prisma_1.getPrisma)()) {
    return db.cartItem.create({ data: { cartId, packId, quantity: 1 } });
}
async function findCartItem(cartId, packId, db = (0, prisma_1.getPrisma)()) {
    return db.cartItem.findUnique({ where: { cartId_packId: { cartId, packId } } });
}
/** Remove um item garantindo que ele pertence ao carrinho informado. */
async function removeCartItem(cartId, itemId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.cartItem.deleteMany({ where: { id: itemId, cartId } });
    return result.count === 1;
}
async function clearCartItems(cartId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.cartItem.deleteMany({ where: { cartId } });
    return result.count;
}
async function countCartItems(cartId, db = (0, prisma_1.getPrisma)()) {
    return db.cartItem.count({ where: { cartId } });
}
/**
 * Encerra o carrinho (checkout concluido).
 *
 * `activeCustomerId` vira NULL, liberando o UNIQUE para o proximo carrinho.
 * O update e CONDICIONAL ao status ATIVO: dois checkouts simultaneos, so um
 * ganha — e o outro descobre que perdeu pelo retorno `false`.
 */
async function closeCart(cartId, status, db = (0, prisma_1.getPrisma)()) {
    const result = await db.cart.updateMany({
        where: { id: cartId, status: client_1.CartStatus.ACTIVE },
        data: { status, activeCustomerId: null },
    });
    return result.count === 1;
}
async function countActiveCarts(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.cart.count({ where: { guildId, status: client_1.CartStatus.ACTIVE } });
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
async function listAbandonedCarts(inactiveSince, take, db = (0, prisma_1.getPrisma)()) {
    return db.cart.findMany({
        where: {
            status: client_1.CartStatus.ACTIVE,
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
async function markAbandonedNoticeSent(cartId, at = new Date(), db = (0, prisma_1.getPrisma)()) {
    const result = await db.cart.updateMany({
        where: { id: cartId, abandonedNoticeAt: null },
        data: { abandonedNoticeAt: at },
    });
    return result.count === 1;
}
//# sourceMappingURL=CartRepository.js.map