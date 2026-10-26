"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cartButton = cartButton;
exports.ordersButton = ordersButton;
exports.catalogHomeButton = catalogHomeButton;
exports.buildCatalogPanel = buildCatalogPanel;
exports.buildCatalogHome = buildCatalogHome;
exports.buildCategorySelect = buildCategorySelect;
exports.buildCatalogList = buildCatalogList;
exports.buildPackSelect = buildPackSelect;
exports.normalizeImageIndex = normalizeImageIndex;
exports.buildPackCard = buildPackCard;
exports.buildPackDetails = buildPackDetails;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
const packValidators_1 = require("../validators/packValidators");
const catalog_1 = require("../types/catalog");
/**
 * Vitrine do catalogo (Components V2).
 *
 * LIMITES REAIS RESPEITADOS AQUI
 *  - Container aceita 10 componentes filhos; o cabecalho ja consome 2.
 *  - Uma mensagem V2 aceita 4000 caracteres somando TODOS os TextDisplay.
 *  - Um select aceita 25 opcoes; por isso a listagem e paginada.
 *
 * Politica visual da loja: sem barra de cor e todos os botoes cinza.
 */
/** Orcamento de texto da listagem, com folga para cabecalho e rodape. */
const LIST_TEXT_BUDGET = Math.floor(limits_1.DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL * 0.6);
function catalogButton(action, emoji, label, ...args) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, action, ...args))
        .setEmoji(emoji)
        .setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.BUTTON_LABEL))
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/** Botao "Meu Carrinho" — sempre a mesma rota, venha de onde vier. */
function cartButton() {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CART, customIds_1.CART_ACTION.VIEW))
        .setEmoji(branding_1.EMOJIS.CART)
        .setLabel('Meu Carrinho')
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/** Botao "Meus Pedidos" (pagina 1). */
function ordersButton() {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, customIds_1.ORDER_ACTION.LIST, '1'))
        .setEmoji(branding_1.EMOJIS.PACKAGE)
        .setLabel('Meus Pedidos')
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
function catalogHomeButton(label = 'Abrir Catalogo') {
    return catalogButton(customIds_1.CATALOG_ACTION.HOME, branding_1.EMOJIS.STORE, label);
}
/** Preco exibido: produto sem preco valido nunca aparece como comprável. */
function priceLabel(pack) {
    return (0, packValidators_1.hasSellablePrice)(pack.price) ? (0, money_1.formatCents)(pack.price) : 'Indisponivel';
}
// ---------------------------------------------------------------------------
// Painel publico fixo
// ---------------------------------------------------------------------------
/**
 * Painel publicado no canal do catalogo.
 *
 * Ele NAO lista produtos: quem clica recebe a loja em mensagem efemera, para
 * que carrinho e pedidos (dados do cliente) nunca virem conteudo publico.
 */
function buildCatalogPanel(config, stats) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, config.catalogTitle, { thumbnailUrl: config.panelThumbnailUrl });
    root.addTextDisplayComponents((0, v2_1.text)(config.catalogDescription));
    if (config.catalogBannerUrl !== null && config.catalogBannerUrl.length > 0) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([config.catalogBannerUrl], `${config.storeName} — catalogo`));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Produtos disponiveis', String(stats.packs)],
        ['Categorias', String(stats.categories)],
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(catalogHomeButton(), cartButton(), ordersButton()));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Sua loja, seu carrinho e seus pedidos aparecem apenas para voce.'));
    return root;
}
/**
 * Tela inicial da loja.
 *
 * Mostra no maximo um destaque com botao proprio: uma home com dez produtos
 * fica ilegivel no Discord mobile, que e onde a maioria dos clientes compra.
 */
function buildCatalogHome(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG, { subtitle: params.description });
    if (params.notice !== undefined && params.notice.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(params.notice));
    }
    const highlight = params.featured[0];
    if (highlight !== undefined) {
        root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.FEATURED} **DESTAQUE**\n\n**${highlight.name}**\n` +
            `${(0, sanitize_1.truncate)(highlight.shortDescription ?? 'Pack disponivel na Vook Store.', limits_1.BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX)}\n\n` +
            `**A partir de**\n${priceLabel(highlight)}`));
        root.addActionRowComponents((0, v2_1.buttonRow)(catalogButton(customIds_1.CATALOG_ACTION.PACK_VIEW, '👀', 'Visualizar', highlight.id, '0')));
        root.addSeparatorComponents((0, v2_1.separator)());
    }
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Produtos disponiveis', String(params.totalPacks)],
        ['Categorias', String(params.categories.length)],
    ])));
    if (params.totalPacks === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhum pack disponivel no momento. Volte em breve — a Vook Store esta preparando novidades.'));
        root.addActionRowComponents((0, v2_1.buttonRow)(cartButton(), ordersButton()));
        return root;
    }
    root.addActionRowComponents((0, v2_1.selectRow)(buildCategorySelect(params.categories, null)));
    root.addActionRowComponents((0, v2_1.buttonRow)(catalogButton(customIds_1.CATALOG_ACTION.SEARCH, branding_1.EMOJIS.SEARCH, 'Buscar'), cartButton(), ordersButton()));
    return root;
}
/** Seletor de categorias, sempre com a opcao "todos os produtos". */
function buildCategorySelect(categories, selectedId) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.CATEGORY_SELECT))
        .setPlaceholder('Selecione uma categoria')
        .setMinValues(1)
        .setMaxValues(1);
    const options = [
        new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel('Todos os produtos')
            .setDescription('Ver o catalogo completo')
            .setValue(catalog_1.ALL_CATEGORIES_VALUE)
            .setEmoji(branding_1.EMOJIS.STORE)
            .setDefault(selectedId === null),
        ...categories.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS - 1).map((entry) => {
            const option = new discord_js_1.StringSelectMenuOptionBuilder()
                .setLabel((0, sanitize_1.truncate)(entry.category.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
                .setDescription((0, sanitize_1.truncate)(entry.category.description ?? `${entry.count} produto(s) disponivel(is)`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
                .setValue(entry.category.id)
                .setDefault(entry.category.id === selectedId);
            if (entry.category.emoji !== null && entry.category.emoji.length > 0) {
                option.setEmoji(entry.category.emoji);
            }
            return option;
        }),
    ];
    menu.addOptions(options);
    return menu;
}
/**
 * Lista de produtos de uma categoria (ou de uma busca), paginada.
 *
 * A pagina e cortada por ORCAMENTO DE TEXTO, nunca por contagem fixa: um pack
 * com descricao longa consome muito mais que outro, e uma pagina fixa estoura
 * o teto de 4000 caracteres da mensagem V2 — que o Discord recusa com 400.
 */
function buildCatalogList(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    const title = params.searchTerm !== null && params.searchTerm !== undefined
        ? `${branding_1.TITLES.CATALOG} — BUSCA`
        : branding_1.TITLES.CATALOG;
    (0, v2_1.addHeader)(root, title, {
        subtitle: params.searchTerm !== null && params.searchTerm !== undefined
            ? `Resultados para **${(0, sanitize_1.truncate)(params.searchTerm, 60)}**`
            : `Categoria: **${params.category?.name ?? 'Todos os produtos'}**`,
    });
    if (params.packs.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhum pack encontrado aqui. Tente outra categoria ou outro termo de busca.'));
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)(catalogHomeButton('Voltar ao Catalogo'), cartButton()));
        return root;
    }
    const blocks = [];
    let used = 0;
    for (const pack of params.packs) {
        const lines = [
            `**${(0, sanitize_1.truncate)(pack.name, 80)}**${pack.featured ? ` ${branding_1.EMOJIS.FEATURED}` : ''}`,
            (0, sanitize_1.truncate)(pack.shortDescription ?? 'Sem descricao cadastrada.', 120),
            `${branding_1.EMOJIS.PRICE} ${priceLabel(pack)}${pack.sku !== null ? ` • \`${pack.sku}\`` : ''}`,
        ];
        const block = lines.join('\n');
        if (blocks.length > 0 && used + block.length > LIST_TEXT_BUDGET)
            break;
        blocks.push(block);
        used += block.length + 2;
    }
    root.addTextDisplayComponents((0, v2_1.text)(blocks.join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.selectRow)(buildPackSelect(params.packs.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS))));
    const categoryId = params.category?.id ?? catalog_1.ALL_CATEGORIES_VALUE;
    const navigation = [];
    if (params.totalPages > 1) {
        navigation.push(catalogButton(customIds_1.CATALOG_ACTION.CATEGORY_PAGE, branding_1.EMOJIS.PREVIOUS, 'Anterior', categoryId, String(params.page - 1 < 1 ? params.totalPages : params.page - 1)), catalogButton(customIds_1.CATALOG_ACTION.CATEGORY_PAGE, branding_1.EMOJIS.NEXT, 'Proxima', categoryId, String(params.page + 1 > params.totalPages ? 1 : params.page + 1)));
    }
    navigation.push(catalogHomeButton('Inicio'), cartButton());
    root.addActionRowComponents((0, v2_1.buttonRow)(...navigation));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Pagina ${params.page}/${params.totalPages} • ${params.total} produto(s) • ` +
        `Exibindo ${blocks.length} nesta pagina`));
    return root;
}
/** Select de packs de uma pagina (no maximo 25 opcoes, limite do Discord). */
function buildPackSelect(packs) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_SELECT))
        .setPlaceholder('Selecione um pack para ver os detalhes')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(packs.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((pack) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(pack.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
        .setDescription((0, sanitize_1.truncate)(`${priceLabel(pack)}${pack.shortDescription !== null ? ` • ${pack.shortDescription}` : ''}`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
        .setValue(pack.id)));
    return menu;
}
/** Navegacao CIRCULAR: da ultima imagem, "proxima" volta para a primeira. */
function normalizeImageIndex(index, total) {
    if (total <= 0)
        return 0;
    const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
    return ((safe % total) + total) % total;
}
function currentImage(images, index) {
    if (images.length === 0)
        return null;
    return images[normalizeImageIndex(index, images.length)] ?? null;
}
/**
 * Card do pack.
 *
 * A galeria mostra UMA imagem por vez com ◀️ / ▶️ — dez miniaturas lado a lado
 * nao deixam o cliente ver o produto. O indice viaja no customId, entao a
 * navegacao continua funcionando depois de qualquer restart do bot.
 *
 * Contagem de filhos no pior caso: 2 (cabecalho) + galeria + texto + separador
 * + 2 linhas de botoes + rodape = 8.
 */
function buildPackCard(params) {
    const { pack, images, category, details } = params.view;
    const total = images.length;
    const index = normalizeImageIndex(params.imageIndex, total);
    const image = currentImage(images, index);
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG_PACK);
    if (image !== null) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([image.url], image.altText ?? `${pack.name} — imagem ${index + 1}`));
    }
    const lines = [`**${pack.name}**`];
    if (params.notice !== undefined && params.notice.length > 0)
        lines.push(params.notice);
    lines.push((0, sanitize_1.truncate)(pack.shortDescription ?? 'Sem descricao cadastrada.', limits_1.BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX));
    if (details.length > 0) {
        lines.push(details
            .slice(0, 4)
            .map((detail) => `• **${detail.label}:** ${detail.value}`)
            .join('\n'));
    }
    lines.push((0, v2_1.fields)([
        ['Categoria', category?.name ?? 'Sem categoria'],
        ...(pack.sku !== null ? [['SKU', `\`${pack.sku}\``]] : []),
        ['Imagens', total === 0 ? 'Nenhuma imagem cadastrada' : `Imagem ${index + 1} de ${total}`],
    ]));
    lines.push(`**PRECO**\n# ${priceLabel(pack)}`);
    root.addTextDisplayComponents((0, v2_1.text)(lines.join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    const sellable = (0, packValidators_1.hasSellablePrice)(pack.price) && pack.enabled;
    const actions = [];
    // Com uma imagem so, a navegacao some: dois botoes que nao levam a lugar
    // nenhum sujam o card e confundem o cliente.
    if (total > 1) {
        actions.push(catalogButton(customIds_1.CATALOG_ACTION.IMAGE_PREV, branding_1.EMOJIS.PREVIOUS, 'Anterior', pack.id, String(index)), catalogButton(customIds_1.CATALOG_ACTION.IMAGE_NEXT, branding_1.EMOJIS.NEXT, 'Proxima', pack.id, String(index)));
    }
    actions.push(catalogButton(customIds_1.CATALOG_ACTION.CART_ADD, branding_1.EMOJIS.CART, 'Adicionar ao Carrinho', pack.id)
        .setDisabled(!sellable || params.inCart === true), catalogButton(customIds_1.CATALOG_ACTION.BUY, branding_1.EMOJIS.BUY_NOW, 'Comprar Agora', pack.id).setDisabled(!sellable));
    root.addActionRowComponents((0, v2_1.buttonRow)(...actions.slice(0, limits_1.DISCORD_LIMITS.BUTTONS_PER_ROW)));
    root.addActionRowComponents((0, v2_1.buttonRow)(catalogButton(customIds_1.CATALOG_ACTION.PACK_INFO, branding_1.EMOJIS.INFO, 'Mais Informacoes', pack.id), catalogHomeButton('Voltar ao Catalogo'), cartButton()));
    if (!sellable) {
        root.addTextDisplayComponents((0, v2_1.footerNote)('Este pack esta indisponivel para compra no momento.'));
    }
    else if (params.inCart === true) {
        root.addTextDisplayComponents((0, v2_1.footerNote)('Este pack ja esta no seu carrinho.'));
    }
    return root;
}
/**
 * "Mais Informacoes": descricao completa e ficha tecnica.
 * O card principal fica enxuto para o mobile; o detalhe mora aqui.
 */
function buildPackDetails(view) {
    const { pack, category, details, images } = view;
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG_PACK, { subtitle: `**${pack.name}**` });
    root.addTextDisplayComponents((0, v2_1.text)((0, sanitize_1.truncate)(pack.description ?? pack.shortDescription ?? 'Nenhuma descricao cadastrada para este pack.', limits_1.BUSINESS_LIMITS.PACK_DESCRIPTION_MAX)));
    if (details.length > 0) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addTextDisplayComponents((0, v2_1.text)(details
            .slice(0, limits_1.BUSINESS_LIMITS.MAX_DETAILS_PER_PACK)
            .map((detail) => `**${detail.label}**\n${detail.value}`)
            .join('\n\n')));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Categoria', category?.name ?? 'Sem categoria'],
        ['Preco', priceLabel(pack)],
        ['Imagens', String(images.length)],
    ])));
    root.addActionRowComponents((0, v2_1.buttonRow)(catalogButton(customIds_1.CATALOG_ACTION.PACK_VIEW, branding_1.EMOJIS.BACK, 'Voltar ao Pack', pack.id, '0'), catalogButton(customIds_1.CATALOG_ACTION.CART_ADD, branding_1.EMOJIS.CART, 'Adicionar ao Carrinho', pack.id)
        .setDisabled(!(0, packValidators_1.hasSellablePrice)(pack.price) || !pack.enabled), catalogHomeButton('Catalogo')));
    return root;
}
//# sourceMappingURL=CatalogBuilders.js.map