"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cartSelects = exports.cartButtons = void 0;
exports.renderCartForCommand = renderCartForCommand;
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const CartBuilders_1 = require("../../modules/catalog/builders/CartBuilders");
const orders_1 = require("../orders");
const CartService_1 = require("../../modules/catalog/services/CartService");
const OrderNotificationService_1 = require("../../modules/catalog/services/OrderNotificationService");
const OrderService_1 = require("../../modules/catalog/services/OrderService");
const BoosterDiscountService_1 = require("../../modules/booster/services/BoosterDiscountService");
const shared_1 = require("../catalog/shared");
/**
 * Carrinho do cliente.
 *
 * O carrinho e SEMPRE privado: mesmo clicando num painel publico, a resposta
 * sai efemera. Ninguem ve o carrinho de ninguem.
 *
 * NAO existe campo de cupom aqui — nem no carrinho, nem no checkout. O desconto
 * e decisao comercial da equipe, aplicada no painel do pedido.
 *
 * O preco exibido e sempre o ATUAL do produto: o carrinho nao congela valor. O
 * snapshot vinculante nasce no pedido.
 */
/** Renderiza o carrinho do proprio cliente. */
async function renderCart(interaction, guildId, customerId, notice) {
    const view = await (0, CartService_1.getCartView)(guildId, customerId);
    await (0, shared_1.showPanel)(interaction, (0, CartBuilders_1.buildCartView)(view, notice === undefined ? {} : { notice }));
}
const viewButton = {
    namespace: customIds_1.NAMESPACE.CART,
    action: customIds_1.CART_ACTION.VIEW,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        await renderCart(interaction, guild.id, member.id);
    },
};
const removeButton = {
    namespace: customIds_1.NAMESPACE.CART,
    action: customIds_1.CART_ACTION.REMOVE,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        const view = await (0, CartService_1.getCartView)(guild.id, member.id);
        if (view.lines.length === 0) {
            await renderCart(interaction, guild.id, member.id, '⚠️ Seu carrinho ja esta vazio.');
            return;
        }
        await (0, shared_1.showPanel)(interaction, (0, CartBuilders_1.buildCartRemovePanel)(view));
    },
};
const clearButton = {
    namespace: customIds_1.NAMESPACE.CART,
    action: customIds_1.CART_ACTION.CLEAR,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        const view = await (0, CartService_1.getCartView)(guild.id, member.id);
        if (view.lines.length === 0) {
            await renderCart(interaction, guild.id, member.id, '⚠️ Seu carrinho ja esta vazio.');
            return;
        }
        await (0, shared_1.showPanel)(interaction, (0, CartBuilders_1.buildCartClearConfirm)(view));
    },
};
const clearConfirmButton = {
    namespace: customIds_1.NAMESPACE.CART,
    action: customIds_1.CART_ACTION.CLEAR_CONFIRM,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        // `clearCart` so apaga o carrinho ATIVO de quem clicou: nao existe caminho
        // para limpar o carrinho de outra pessoa.
        const removed = await (0, CartService_1.clearCart)(guild.id, member.id);
        await renderCart(interaction, guild.id, member.id, `${branding_1.EMOJIS.CLEAR} ${removed} item(ns) removido(s) do carrinho.`);
    },
};
const checkoutButton = {
    namespace: customIds_1.NAMESPACE.CART,
    action: customIds_1.CART_ACTION.CHECKOUT,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        const view = await (0, CartService_1.getCartView)(guild.id, member.id);
        if (view.sellableCount === 0) {
            await renderCart(interaction, guild.id, member.id, '⚠️ Nenhum item disponivel para compra no seu carrinho.');
            return;
        }
        await (0, shared_1.showPanel)(interaction, (0, CartBuilders_1.buildCheckoutConfirm)(view));
    },
};
/**
 * Confirmacao do checkout.
 *
 * A criacao do pedido roda sob lock por cliente e revalida tudo no banco. Um
 * duplo clique nao cria dois pedidos: o segundo encontra o carrinho ja
 * encerrado (ou o pedido identico recente) e apenas mostra o resultado.
 */
const checkoutConfirmButton = {
    namespace: customIds_1.NAMESPACE.CART,
    action: customIds_1.CART_ACTION.CHECKOUT_CONFIRM,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        const { order, duplicated } = await (0, OrderService_1.checkoutCart)({
            guildId: guild.id,
            customerId: member.id,
            channelId: interaction.channelId,
        });
        /*
         * Desconto de booster, antes de a equipe ver o pedido.
         *
         * Aqui e o unico ponto do fluxo que tem o `GuildMember` em maos, e sem ele
         * nao da para saber se o cliente impulsiona. Melhor-esforco: o servico
         * engole os proprios erros e o pedido segue com preco cheio.
         */
        if (!duplicated)
            await (0, BoosterDiscountService_1.applyBoosterDiscount)(member, order);
        // Aviso a equipe fica FORA da transacao: falha do Discord nao desfaz venda.
        if (!duplicated)
            await (0, OrderNotificationService_1.announceNewOrder)(guild, order);
        const full = await (0, OrderService_1.requireOrder)(guild.id, order.id);
        await (0, orders_1.showCustomerOrder)(interaction, full, duplicated
            ? '⚠️ Este pedido ja tinha sido criado ha instantes. Ele esta abaixo.'
            : `${branding_1.EMOJIS.APPROVE} Pedido criado. A equipe da Vook Store vai preparar o pagamento.`);
    },
};
const removeSelect = {
    namespace: customIds_1.NAMESPACE.CART,
    action: customIds_1.CART_ACTION.REMOVE_SELECT,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const itemId = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        const removed = await (0, CartService_1.removeFromCart)(guild.id, member.id, itemId);
        await renderCart(interaction, guild.id, member.id, removed
            ? `${branding_1.EMOJIS.DELETE} Item removido do carrinho.`
            : '⚠️ Este item nao esta mais no seu carrinho.');
    },
};
/** Carrinho aberto por comando (`/carrinho`). */
async function renderCartForCommand(interaction, guildId, customerId) {
    await renderCart(interaction, guildId, customerId);
}
exports.cartButtons = [
    viewButton,
    removeButton,
    clearButton,
    clearConfirmButton,
    checkoutButton,
    checkoutConfirmButton,
];
exports.cartSelects = [removeSelect];
//# sourceMappingURL=index.js.map