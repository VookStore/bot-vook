"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogCustomerModals = exports.catalogCustomerSelects = exports.catalogCustomerButtons = void 0;
exports.renderSearchResults = renderSearchResults;
exports.renderHomeForCommand = renderHomeForCommand;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const limits_1 = require("../../constants/limits");
const errors_1 = require("../../core/errors");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
const CatalogBuilders_1 = require("../../modules/catalog/builders/CatalogBuilders");
const CartBuilders_1 = require("../../modules/catalog/builders/CartBuilders");
const CatalogAdminBuilders_1 = require("../../modules/catalog/builders/CatalogAdminBuilders");
const orders_1 = require("../orders");
const CatalogCategoryService_1 = require("../../modules/catalog/services/CatalogCategoryService");
const CatalogService_1 = require("../../modules/catalog/services/CatalogService");
const CartService_1 = require("../../modules/catalog/services/CartService");
const OrderService_1 = require("../../modules/catalog/services/OrderService");
const BoosterDiscountService_1 = require("../../modules/booster/services/BoosterDiscountService");
const OrderNotificationService_1 = require("../../modules/catalog/services/OrderNotificationService");
const catalog_1 = require("../../modules/catalog/types/catalog");
const sanitize_1 = require("../../utils/sanitize");
const shared_1 = require("./shared");
/**
 * Loja do cliente.
 *
 * PRINCIPIOS APLICADOS AQUI
 *  - O customId NUNCA autoriza: todo pack e recarregado do banco e revalidado
 *    (existe, ativo, categoria ativa, preco valido) antes de qualquer acao.
 *  - A navegacao acontece na MESMA mensagem sempre que possivel: a galeria
 *    atualiza o card em vez de despejar uma mensagem por imagem.
 *  - NAO existe campo de cupom em lugar nenhum desta tela. Desconto e decisao
 *    comercial da equipe, tomada no painel do pedido.
 */
/** Renderiza a home da loja. */
async function renderHome(interaction, guildId, notice) {
    const [config, categories, featured, visible] = await Promise.all([
        (0, GuildConfigService_1.getGuildConfig)(guildId),
        (0, CatalogService_1.listCategoriesWithPacks)(guildId),
        (0, CatalogService_1.listFeaturedPacks)(guildId),
        (0, CatalogService_1.listVisiblePacks)(guildId),
    ]);
    await (0, shared_1.showPanel)(interaction, (0, CatalogBuilders_1.buildCatalogHome)({
        storeName: config.storeName,
        description: config.catalogDescription,
        categories,
        featured,
        totalPacks: visible.length,
        ...(notice !== undefined ? { notice } : {}),
    }));
}
/** Renderiza a listagem de uma categoria (ou de todos os produtos). */
async function renderCategory(interaction, guildId, categoryValue, page) {
    const categoryId = categoryValue === catalog_1.ALL_CATEGORIES_VALUE ? null : categoryValue;
    // Categoria vinda do componente e revalidada: ela pode ter sido desativada
    // entre a montagem do menu e o clique.
    const category = categoryId === null ? null : await (0, CatalogCategoryService_1.getCatalogCategoryById)(guildId, categoryId);
    if (categoryId !== null && (category === null || !category.enabled)) {
        await renderHome(interaction, guildId, '⚠️ Esta categoria nao esta mais disponivel.');
        return;
    }
    const [categories, packs] = await Promise.all([
        (0, CatalogService_1.listCategoriesWithPacks)(guildId),
        (0, CatalogService_1.listVisiblePacks)(guildId, { categoryId }),
    ]);
    const pageData = (0, shared_1.paginate)(packs, page, limits_1.BUSINESS_LIMITS.CATALOG_PAGE_SIZE);
    await (0, shared_1.showPanel)(interaction, (0, CatalogBuilders_1.buildCatalogList)({
        categories,
        category,
        packs: pageData.items,
        page: pageData.page,
        totalPages: pageData.totalPages,
        total: pageData.total,
    }));
}
/** Renderiza o card do pack com a imagem indicada. */
async function renderPack(interaction, guildId, customerId, packId, imageIndex, notice) {
    const view = await (0, CatalogService_1.getPackView)(guildId, packId);
    if (view === null) {
        await renderHome(interaction, guildId, '⚠️ Este pack nao existe mais no catalogo.');
        return;
    }
    const cart = await (0, CartService_1.getActiveCart)(guildId, customerId);
    const inCart = cart?.items.some((item) => item.packId === packId) === true;
    await (0, shared_1.showPanel)(interaction, (0, CatalogBuilders_1.buildPackCard)({
        view,
        imageIndex,
        inCart,
        ...(notice !== undefined ? { notice } : {}),
    }));
}
// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------
const homeButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.HOME,
    async handle(interaction) {
        const { guild } = (0, shared_1.requireGuildContext)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        await renderHome(interaction, guild.id);
    },
};
const categoryPageButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CATEGORY_PAGE,
    async handle(interaction, parsed) {
        const { guild } = (0, shared_1.requireGuildContext)(interaction);
        const categoryValue = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        const page = (0, shared_1.parsePage)(parsed.args[1]);
        await (0, shared_1.beginPanel)(interaction);
        await renderCategory(interaction, guild.id, categoryValue, page);
    },
};
const packViewButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_VIEW,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        const index = (0, shared_1.parseIndex)(parsed.args[1]);
        await (0, shared_1.beginPanel)(interaction);
        await renderPack(interaction, guild.id, member.id, packId, index);
    },
};
/**
 * Galeria: imagem anterior.
 *
 * A navegacao e CIRCULAR — da primeira imagem, "anterior" leva a ultima. O
 * indice viaja no customId, entao a galeria continua funcionando depois de
 * qualquer restart: nao existe estado de sessao em memoria para se perder.
 */
const imagePrevButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.IMAGE_PREV,
    async handle(interaction, parsed) {
        await navigateGallery(interaction, parsed, -1);
    },
};
const imageNextButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.IMAGE_NEXT,
    async handle(interaction, parsed) {
        await navigateGallery(interaction, parsed, 1);
    },
};
async function navigateGallery(interaction, parsed, step) {
    const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
    const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
    const current = (0, shared_1.parseIndex)(parsed.args[1]);
    await (0, shared_1.beginPanel)(interaction);
    const view = await (0, CatalogService_1.getPackView)(guild.id, packId);
    if (view === null) {
        await renderHome(interaction, guild.id, '⚠️ Este pack nao existe mais no catalogo.');
        return;
    }
    // O total vem do BANCO a cada clique: uma imagem removida no meio da
    // navegacao nao pode deixar o indice apontando para o vazio.
    const next = (0, CatalogBuilders_1.normalizeImageIndex)(current + step, view.images.length);
    await renderPack(interaction, guild.id, member.id, packId, next);
}
const packInfoButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_INFO,
    async handle(interaction, parsed) {
        const { guild } = (0, shared_1.requireGuildContext)(interaction);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        await (0, shared_1.beginPanel)(interaction);
        const view = await (0, CatalogService_1.getPackView)(guild.id, packId);
        if (view === null) {
            await renderHome(interaction, guild.id, '⚠️ Este pack nao existe mais no catalogo.');
            return;
        }
        await (0, shared_1.showPanel)(interaction, (0, CatalogBuilders_1.buildPackDetails)(view));
    },
};
const cartAddButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CART_ADD,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        await (0, shared_1.beginPanel)(interaction);
        const result = await (0, CartService_1.addToCart)(guild.id, member.id, packId);
        const notice = result.alreadyPresent
            ? `${branding_1.EMOJIS.CART} Este pack **ja esta** no seu carrinho (${result.itemCount} item(ns)).`
            : `${branding_1.EMOJIS.APPROVE} Adicionado ao carrinho. Voce tem **${result.itemCount} item(ns)**.`;
        await renderPack(interaction, guild.id, member.id, packId, 0, notice);
    },
};
/** "Comprar Agora": confirma antes de criar o pedido. */
const buyButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.BUY,
    async handle(interaction, parsed) {
        const { guild } = (0, shared_1.requireGuildContext)(interaction);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        await (0, shared_1.beginPanel)(interaction);
        const view = await (0, CatalogService_1.getPackView)(guild.id, packId);
        if (view === null || !view.pack.enabled) {
            await renderHome(interaction, guild.id, '⚠️ Este pack nao esta mais disponivel.');
            return;
        }
        await (0, shared_1.showPanel)(interaction, (0, CartBuilders_1.buildBuyNowConfirm)({
            packId,
            packName: view.pack.name,
            price: view.pack.price,
            buyButton: new discord_js_1.ButtonBuilder()
                .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.BUY_CONFIRM, packId))
                .setEmoji(branding_1.EMOJIS.APPROVE)
                .setLabel('Confirmar')
                .setStyle(discord_js_1.ButtonStyle.Secondary),
            backButton: new discord_js_1.ButtonBuilder()
                .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_VIEW, packId, '0'))
                .setEmoji(branding_1.EMOJIS.BACK)
                .setLabel('Voltar')
                .setStyle(discord_js_1.ButtonStyle.Secondary),
        }));
    },
};
const buyConfirmButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.BUY_CONFIRM,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        await (0, shared_1.beginPanel)(interaction);
        const { order, duplicated } = await (0, OrderService_1.createOrderForPack)({
            guildId: guild.id,
            customerId: member.id,
            packId,
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
        // O aviso a equipe fica FORA da transacao do pedido: falha de Discord nao
        // pode desfazer uma compra ja registrada.
        if (!duplicated)
            await (0, OrderNotificationService_1.announceNewOrder)(guild, order);
        const full = await (0, OrderService_1.requireOrder)(guild.id, order.id);
        await (0, orders_1.showCustomerOrder)(interaction, full, duplicated
            ? '⚠️ Voce ja tinha criado este pedido ha instantes. Ele esta abaixo.'
            : `${branding_1.EMOJIS.APPROVE} Pedido criado. A equipe da Vook Store vai preparar o pagamento.`);
    },
};
const searchButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.SEARCH,
    async handle(interaction) {
        (0, shared_1.requireGuildContext)(interaction);
        // `showModal` precisa ser a PRIMEIRA resposta da interacao: nada de defer.
        await interaction.showModal((0, CatalogAdminBuilders_1.buildCatalogSearchModal)());
    },
};
// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------
const categorySelect = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CATEGORY_SELECT,
    async handle(interaction) {
        const { guild } = (0, shared_1.requireGuildContext)(interaction);
        const value = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        await renderCategory(interaction, guild.id, value, 1);
    },
};
const packSelect = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_SELECT,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const packId = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        await renderPack(interaction, guild.id, member.id, packId, 0);
    },
};
// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
const searchModal = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.SEARCH_MODAL,
    async handle(interaction) {
        const { guild } = (0, shared_1.requireGuildContext)(interaction);
        const term = (0, sanitize_1.sanitizeConfigText)(interaction.fields.getTextInputValue('termo'), limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MAX).trim();
        if (term.length < limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MIN) {
            await (0, reply_1.replyError)(interaction, `Digite pelo menos ${limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MIN} caracteres para buscar.`);
            return;
        }
        // Modal sempre abre uma resposta nova: nao existe mensagem de origem para
        // atualizar, entao a busca responde de forma privada.
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const [categories, packs] = await Promise.all([
            (0, CatalogService_1.listCategoriesWithPacks)(guild.id),
            (0, CatalogService_1.listVisiblePacks)(guild.id, { search: term }),
        ]);
        const pageData = (0, shared_1.paginate)(packs, 1, limits_1.BUSINESS_LIMITS.CATALOG_PAGE_SIZE);
        await (0, shared_1.showPanel)(interaction, (0, CatalogBuilders_1.buildCatalogList)({
            categories,
            category: null,
            packs: pageData.items,
            page: pageData.page,
            totalPages: pageData.totalPages,
            total: pageData.total,
            searchTerm: term,
        }));
    },
};
/** Busca disparada pelo comando `/catalogo buscar`. */
async function renderSearchResults(interaction, guildId, rawTerm) {
    const term = (0, sanitize_1.sanitizeConfigText)(rawTerm, limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MAX).trim();
    if (term.length < limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MIN) {
        throw new errors_1.ValidationError(`Termo de busca curto: "${term}"`, {
            userMessage: `Digite pelo menos ${limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MIN} caracteres para buscar.`,
        });
    }
    const [categories, packs] = await Promise.all([
        (0, CatalogService_1.listCategoriesWithPacks)(guildId),
        (0, CatalogService_1.listVisiblePacks)(guildId, { search: term }),
    ]);
    const pageData = (0, shared_1.paginate)(packs, 1, limits_1.BUSINESS_LIMITS.CATALOG_PAGE_SIZE);
    await (0, shared_1.showPanel)(interaction, (0, CatalogBuilders_1.buildCatalogList)({
        categories,
        category: null,
        packs: pageData.items,
        page: pageData.page,
        totalPages: pageData.totalPages,
        total: pageData.total,
        searchTerm: term,
    }));
}
/** Home renderizada a partir de um comando (sem componente de origem). */
async function renderHomeForCommand(interaction, guildId) {
    const [config, categories, featured, visible] = await Promise.all([
        (0, GuildConfigService_1.getGuildConfig)(guildId),
        (0, CatalogService_1.listCategoriesWithPacks)(guildId),
        (0, CatalogService_1.listFeaturedPacks)(guildId),
        (0, CatalogService_1.listVisiblePacks)(guildId),
    ]);
    await (0, shared_1.showPanel)(interaction, (0, CatalogBuilders_1.buildCatalogHome)({
        storeName: config.storeName,
        description: config.catalogDescription,
        categories,
        featured,
        totalPacks: visible.length,
    }));
}
exports.catalogCustomerButtons = [
    homeButton,
    categoryPageButton,
    packViewButton,
    imagePrevButton,
    imageNextButton,
    packInfoButton,
    cartAddButton,
    buyButton,
    buyConfirmButton,
    searchButton,
];
exports.catalogCustomerSelects = [categorySelect, packSelect];
exports.catalogCustomerModals = [searchModal];
//# sourceMappingURL=customer.js.map