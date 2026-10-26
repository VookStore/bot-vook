"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveCart = getActiveCart;
exports.getCartView = getCartView;
exports.addToCart = addToCart;
exports.removeFromCart = removeFromCart;
exports.clearCart = clearCart;
exports.finishCart = finishCart;
exports.countCarts = countCarts;
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const prisma_1 = require("../../../core/database/prisma");
const Logger_1 = require("../../../core/logger/Logger");
const LockService_1 = require("../../../core/locks/LockService");
const CartRepository_1 = require("../repositories/CartRepository");
const CatalogPackRepository_1 = require("../repositories/CatalogPackRepository");
const CatalogCategoryService_1 = require("./CatalogCategoryService");
const CatalogService_1 = require("./CatalogService");
const packValidators_1 = require("../validators/packValidators");
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
const logger = (0, Logger_1.createLogger)('cart');
const CART_BUSY_MESSAGE = 'Seu carrinho esta sendo atualizado. Aguarde um instante.';
/** Chave do lock: um carrinho por cliente por guild. */
function cartKey(guildId, customerId) {
    return `${guildId}:${customerId}`;
}
async function getActiveCart(guildId, customerId) {
    return (0, CartRepository_1.findActiveCart)(guildId, customerId);
}
/**
 * Monta a visao do carrinho resolvendo cada item com o produto ATUAL.
 *
 * Itens cujo produto sumiu, foi desativado ou perdeu preco valido continuam
 * aparecendo — marcados como indisponiveis. Some-los em silencio faria o total
 * mudar sem explicacao entre uma tela e outra.
 */
async function getCartView(guildId, customerId) {
    const cart = await (0, CartRepository_1.findActiveCart)(guildId, customerId);
    if (cart === null || cart.items.length === 0) {
        return { cart, lines: [], subtotal: 0, sellableCount: 0 };
    }
    const packs = await (0, CatalogPackRepository_1.findPacksByIds)(cart.items.map((item) => item.packId));
    const byId = new Map(packs.map((pack) => [pack.id, pack]));
    const categories = await (0, CatalogCategoryService_1.getCatalogCategories)(guildId);
    const enabledCategories = new Set(categories.filter((category) => category.enabled).map((category) => category.id));
    const lines = [];
    let subtotal = 0;
    let sellableCount = 0;
    for (const item of cart.items) {
        const pack = byId.get(item.packId);
        if (pack === undefined || pack.guildId !== guildId)
            continue;
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
function unavailableReason(pack, enabledCategories) {
    if (pack.deletedAt !== null)
        return 'Produto removido do catalogo.';
    if (!pack.enabled)
        return 'Produto indisponivel no momento.';
    if (!enabledCategories.has(pack.categoryId))
        return 'Categoria indisponivel no momento.';
    if (!(0, packValidators_1.hasSellablePrice)(pack.price))
        return 'Produto sem preco definido.';
    return null;
}
/**
 * Adiciona um pack ao carrinho.
 *
 * Pack digital nao tem quantidade: o par (cartId, packId) e UNIQUE no banco,
 * entao um duplo clique nunca cria dois itens iguais. O lock em memoria evita
 * o caminho de erro; o UNIQUE e a garantia real.
 */
async function addToCart(guildId, customerId, packId) {
    const pack = await (0, CatalogService_1.getSellablePack)(guildId, packId);
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CART_ACTION, cartKey(guildId, customerId), async () => {
        const cart = await (0, CartRepository_1.ensureActiveCart)(guildId, customerId);
        const existing = await (0, CartRepository_1.findCartItem)(cart.id, pack.id);
        if (existing !== null) {
            return {
                cart,
                item: existing,
                alreadyPresent: true,
                itemCount: cart.items.length,
            };
        }
        if (cart.items.length >= limits_1.BUSINESS_LIMITS.MAX_CART_ITEMS) {
            throw new errors_1.ValidationError(`Carrinho cheio: ${cart.items.length}`, {
                userMessage: `Seu carrinho ja possui o limite de ${limits_1.BUSINESS_LIMITS.MAX_CART_ITEMS} itens. Finalize a compra ou remova algum item.`,
            });
        }
        try {
            const item = await (0, CartRepository_1.addCartItem)(cart.id, pack.id);
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
        }
        catch (error) {
            // Corrida vencida por outro clique: o item ja esta la, o que era
            // exatamente o objetivo. Devolve como "ja presente".
            if ((0, prisma_1.isUniqueConstraintError)(error)) {
                const item = await (0, CartRepository_1.findCartItem)(cart.id, pack.id);
                if (item !== null) {
                    return { cart, item, alreadyPresent: true, itemCount: cart.items.length };
                }
            }
            throw error;
        }
    }, { userMessage: CART_BUSY_MESSAGE });
}
async function removeFromCart(guildId, customerId, itemId) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CART_ACTION, cartKey(guildId, customerId), async () => {
        const cart = await (0, CartRepository_1.findActiveCart)(guildId, customerId);
        if (cart === null)
            return false;
        // Remove com `cartId` no where: um id de item de OUTRO cliente nunca
        // apaga nada, mesmo que o customId seja adulterado.
        return (0, CartRepository_1.removeCartItem)(cart.id, itemId);
    }, { userMessage: CART_BUSY_MESSAGE });
}
async function clearCart(guildId, customerId) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CART_ACTION, cartKey(guildId, customerId), async () => {
        const cart = await (0, CartRepository_1.findActiveCart)(guildId, customerId);
        if (cart === null)
            return 0;
        return (0, CartRepository_1.clearCartItems)(cart.id);
    }, { userMessage: CART_BUSY_MESSAGE });
}
/**
 * Encerra o carrinho apos o checkout.
 * Condicional ao status ATIVO: se outra interacao ja encerrou, devolve false e
 * o chamador sabe que perdeu a corrida.
 */
async function finishCart(cartId) {
    return (0, CartRepository_1.closeCart)(cartId, client_1.CartStatus.CHECKED_OUT);
}
async function countCarts(guildId) {
    return (0, CartRepository_1.countActiveCarts)(guildId);
}
//# sourceMappingURL=CartService.js.map