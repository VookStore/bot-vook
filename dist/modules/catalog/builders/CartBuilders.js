"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCartView = buildCartView;
exports.buildCartRemovePanel = buildCartRemovePanel;
exports.buildCartClearConfirm = buildCartClearConfirm;
exports.buildCheckoutConfirm = buildCheckoutConfirm;
exports.buildBuyNowConfirm = buildBuyNowConfirm;
exports.buildAbandonedCartDm = buildAbandonedCartDm;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
/** Itens listados na DM de carrinho abandonado; o resto vira "e mais N". */
const CART_DM_ITEM_LIMIT = 6;
const discord_1 = require("../../../utils/discord");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
const CatalogBuilders_1 = require("./CatalogBuilders");
/**
 * Carrinho (Components V2).
 *
 * O carrinho e SEMPRE efemero: e informacao do cliente e nao pode virar
 * conteudo publico do canal do catalogo.
 *
 * Aqui NAO existe campo de cupom. Cupom e ferramenta interna da equipe — o
 * cliente nunca digita, escolhe nem ve codigo de desconto.
 */
function cartButton(action, emoji, label, ...args) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CART, action, ...args))
        .setEmoji(emoji)
        .setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.BUTTON_LABEL))
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
function buildCartView(view, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CART);
    if (options.notice !== undefined && options.notice.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(options.notice));
    }
    if (view.lines.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Seu carrinho esta vazio.\n\nExplore o catalogo da Vook Store para adicionar packs.'));
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)((0, CatalogBuilders_1.catalogHomeButton)('Abrir Catalogo'), (0, CatalogBuilders_1.ordersButton)()));
        return root;
    }
    const lines = view.lines.map((line, index) => {
        const price = line.unavailable ? '—' : (0, money_1.formatCents)(line.pack.price);
        const suffix = line.unavailable ? `\n⚠️ ${line.reason ?? 'Indisponivel.'}` : '';
        return `**${index + 1}.** ${(0, sanitize_1.truncate)(line.pack.name, 70)}\n${price}${suffix}`;
    });
    root.addTextDisplayComponents((0, v2_1.text)(lines.join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(`**SUBTOTAL**\n# ${(0, money_1.formatCents)(view.subtotal)}\n\n` +
        `${view.lines.length} item(ns) no carrinho` +
        (view.sellableCount !== view.lines.length
            ? ` • ${view.lines.length - view.sellableCount} indisponivel(is)`
            : '')));
    root.addActionRowComponents((0, v2_1.buttonRow)(cartButton(customIds_1.CART_ACTION.REMOVE, branding_1.EMOJIS.DELETE, 'Remover Item'), cartButton(customIds_1.CART_ACTION.CLEAR, branding_1.EMOJIS.CLEAR, 'Limpar Carrinho'), (0, CatalogBuilders_1.catalogHomeButton)('Continuar Comprando'), cartButton(customIds_1.CART_ACTION.CHECKOUT, branding_1.EMOJIS.PAYMENT, 'Finalizar Compra').setDisabled(view.sellableCount === 0)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('O valor final e confirmado quando o pedido e criado. Descontos sao aplicados pela equipe da Vook Store.'));
    return root;
}
/** Seletor de item a remover (no maximo 25 itens, limite do Discord). */
function buildCartRemovePanel(view) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CART, { subtitle: 'Escolha o item que deseja remover.' });
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CART, customIds_1.CART_ACTION.REMOVE_SELECT))
        .setPlaceholder('Selecione o item a remover')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(view.lines.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((line) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(line.pack.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
        .setDescription((0, sanitize_1.truncate)(line.unavailable
        ? (line.reason ?? 'Indisponivel.')
        : (0, money_1.formatCents)(line.pack.price), limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
        // O valor e o id do ITEM (nao do pack): a remocao confere o carrinho
        // dono antes de apagar, entao um id trocado na mao nao remove nada.
        .setValue(line.item.id)));
    root.addActionRowComponents((0, v2_1.selectRow)(menu));
    root.addActionRowComponents((0, v2_1.buttonRow)(cartButton(customIds_1.CART_ACTION.VIEW, branding_1.EMOJIS.BACK, 'Voltar ao Carrinho')));
    return root;
}
/** Confirmacao antes de esvaziar o carrinho. */
function buildCartClearConfirm(view) {
    const root = (0, v2_1.container)(branding_1.COLORS.WARNING);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CART, { subtitle: 'Confirmar limpeza do carrinho' });
    root.addTextDisplayComponents((0, v2_1.text)(`Voce esta prestes a remover **${view.lines.length} item(ns)** do seu carrinho.\n` +
        'Esta acao nao pode ser desfeita.'));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(cartButton(customIds_1.CART_ACTION.CLEAR_CONFIRM, branding_1.EMOJIS.CLEAR, 'Confirmar'), cartButton(customIds_1.CART_ACTION.VIEW, branding_1.EMOJIS.BACK, 'Voltar')));
    return root;
}
/**
 * Confirmacao da compra.
 *
 * Deixa explicito que quem prepara o pagamento e a equipe: o cliente cria o
 * PEDIDO, e a cobranca vem depois, pelo mesmo fluxo de `/pagamento`.
 */
function buildCheckoutConfirm(view) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CHECKOUT);
    const lines = view.lines
        .filter((line) => !line.unavailable)
        .map((line) => `• ${(0, sanitize_1.truncate)(line.pack.name, 70)} — ${(0, money_1.formatCents)(line.pack.price)}`);
    root.addTextDisplayComponents((0, v2_1.text)(`${lines.join('\n')}\n\n` +
        `**Itens**\n${view.sellableCount}\n\n**SUBTOTAL**\n# ${(0, money_1.formatCents)(view.subtotal)}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)('Ao confirmar, seu pedido sera registrado e a equipe da Vook Store preparara o pagamento.'));
    root.addActionRowComponents((0, v2_1.buttonRow)(cartButton(customIds_1.CART_ACTION.CHECKOUT_CONFIRM, branding_1.EMOJIS.APPROVE, 'Confirmar'), cartButton(customIds_1.CART_ACTION.VIEW, branding_1.EMOJIS.BACK, 'Voltar')));
    return root;
}
/** Confirmacao do "Comprar Agora" (um pack, sem passar pelo carrinho). */
function buildBuyNowConfirm(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CHECKOUT);
    root.addTextDisplayComponents((0, v2_1.text)(`• ${(0, sanitize_1.truncate)(params.packName, 70)}\n\n**TOTAL**\n# ${(0, money_1.formatCents)(params.price)}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)('Ao confirmar, seu pedido sera registrado e a equipe da Vook Store preparara o pagamento.'));
    root.addActionRowComponents((0, v2_1.buttonRow)(params.buyButton, params.backButton));
    return root;
}
/**
 * DM de carrinho abandonado.
 *
 * O carrinho e persistente e o cliente sai do Discord esquecendo dele. Este e o
 * unico lembrete que ele recebe — nunca ha um segundo, e a coluna
 * `abandonedNoticeAt` e o que garante isso.
 *
 * TOM E CONTEUDO. So lista o que o proprio cliente colocou la, com o preco
 * ATUAL, e oferece um caminho de volta. Sem urgencia inventada, sem contagem
 * regressiva e sem desconto: nada aqui promete algo que a loja nao vai cumprir
 * se a pessoa voltar tres dias depois.
 *
 * ITENS INDISPONIVEIS NAO ENTRAM. Um pack que saiu do ar entre a adicao e o
 * lembrete viraria uma promessa quebrada logo no clique — quem chama filtra
 * antes, e um carrinho que so tem indisponivel nem gera DM.
 */
function buildAbandonedCartDm(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CART_ABANDONED);
    const disponiveis = params.view.lines.filter((line) => !line.unavailable);
    root.addTextDisplayComponents((0, v2_1.text)(`Voce deixou ${disponiveis.length === 1 ? 'um item' : `${disponiveis.length} itens`} ` +
        `no seu carrinho da ${params.storeName}. Esta tudo guardado — e so voltar quando quiser.`));
    root.addSeparatorComponents((0, v2_1.separator)());
    const linhas = disponiveis
        .slice(0, CART_DM_ITEM_LIMIT)
        .map((line) => `• **${(0, sanitize_1.truncate)(line.pack.name, 60)}** — ${(0, money_1.formatCents)(line.pack.price)}`);
    const restantes = disponiveis.length - linhas.length;
    if (restantes > 0) {
        linhas.push(`-# e mais ${restantes} ${restantes === 1 ? 'item' : 'itens'}`);
    }
    root.addTextDisplayComponents((0, v2_1.text)(linhas.join('\n')));
    root.addTextDisplayComponents((0, v2_1.text)(`**Subtotal:** ${(0, money_1.formatCents)(params.view.subtotal)}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setStyle(discord_js_1.ButtonStyle.Link)
        .setLabel('Voltar ao Catalogo')
        .setEmoji(branding_1.EMOJIS.CART)
        .setURL(params.catalogChannelId === null
        ? `https://discord.com/channels/${params.guildId}`
        : (0, discord_1.channelUrl)(params.guildId, params.catalogChannelId))));
    root.addTextDisplayComponents(
    // O preco do carrinho nunca e congelado: quem le isto tres dias depois
    // precisa saber que o valor acima e o de hoje, nao uma promessa.
    (0, v2_1.footerNote)('Os precos exibidos sao os atuais e podem mudar ate a finalizacao do pedido.'));
    return root;
}
//# sourceMappingURL=CartBuilders.js.map