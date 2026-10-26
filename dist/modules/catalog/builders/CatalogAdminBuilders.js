"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_FIELD = exports.PACK_FIELD = void 0;
exports.adminBackButton = adminBackButton;
exports.buildCatalogAdminPanel = buildCatalogAdminPanel;
exports.buildOrderChannelPanel = buildOrderChannelPanel;
exports.buildPackPickerPanel = buildPackPickerPanel;
exports.buildCategoryChooserPanel = buildCategoryChooserPanel;
exports.buildPackModal = buildPackModal;
exports.buildPackPriceModal = buildPackPriceModal;
exports.buildPackDetailsModal = buildPackDetailsModal;
exports.buildPackImagesPanel = buildPackImagesPanel;
exports.buildImagePickerPanel = buildImagePickerPanel;
exports.buildImageModal = buildImageModal;
exports.buildCategoryAdminPanel = buildCategoryAdminPanel;
exports.buildCategoryPickerPanel = buildCategoryPickerPanel;
exports.buildCategoryModal = buildCategoryModal;
exports.buildCatalogSearchModal = buildCatalogSearchModal;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const errors_1 = require("../../../core/errors");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
const packValidators_1 = require("../validators/packValidators");
const catalog_1 = require("../types/catalog");
/**
 * Administracao do catalogo (Components V2).
 *
 * Formularios respeitam o limite REAL do Discord: 5 campos por modal. Por isso
 * o cadastro e dividido — dados comerciais em um modal, ficha tecnica em outro,
 * imagens em um painel proprio. Espremer tudo em um formulario so seria
 * recusado pela API.
 */
/** Ids dos campos dos formularios (usados no builder e no handler). */
exports.PACK_FIELD = {
    NAME: 'nome',
    SKU: 'sku',
    PRICE: 'preco',
    SHORT: 'resumo',
    DESCRIPTION: 'descricao',
    DETAILS: 'detalhes',
    IMAGE_URL: 'url',
    IMAGE_ALT: 'alt',
};
exports.CATEGORY_FIELD = {
    NAME: 'nome',
    DESCRIPTION: 'descricao',
    EMOJI: 'emoji',
};
function adminButton(action, emoji, label, ...args) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, action, ...args))
        .setEmoji(emoji)
        .setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.BUTTON_LABEL))
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
function adminBackButton() {
    return adminButton(customIds_1.CATALOG_ACTION.ADMIN, branding_1.EMOJIS.BACK, 'Voltar');
}
function modalField(options) {
    const input = new discord_js_1.TextInputBuilder()
        .setCustomId(options.customId)
        .setStyle(options.style)
        .setRequired(options.required)
        .setMaxLength(options.maxLength)
        .setPlaceholder((0, sanitize_1.truncate)(options.placeholder, limits_1.DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));
    if (options.value !== undefined && options.value !== null && options.value.length > 0) {
        input.setValue((0, sanitize_1.truncate)(options.value, options.maxLength));
    }
    return new discord_js_1.LabelBuilder()
        .setLabel((0, sanitize_1.truncate)(options.label, limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setDescription((0, sanitize_1.truncate)(options.description, limits_1.DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER))
        .setTextInputComponent(input);
}
/**
 * Painel administrativo com diagnostico rapido do catalogo.
 *
 * LIMITE: um Container aceita 10 filhos. Aviso, estatisticas e alertas ficam em
 * UM unico TextDisplay de proposito — cada um em bloco separado, com divisor,
 * estouraria o limite justamente no pior caso (catalogo recem-criado, cheio de
 * alertas) e a mensagem inteira seria recusada com 400.
 */
function buildCatalogAdminPanel(stats, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG_ADMIN);
    const warnings = [];
    if (stats.categories === 0) {
        warnings.push('Nenhuma categoria cadastrada — crie uma antes de cadastrar packs.');
    }
    if (stats.packsWithoutImage > 0) {
        warnings.push(`${stats.packsWithoutImage} pack(s) sem imagem de capa.`);
    }
    if (stats.packsWithoutPrice > 0) {
        warnings.push(`${stats.packsWithoutPrice} pack(s) sem preco valido (nao vendem).`);
    }
    const blocks = [];
    if (options.notice !== undefined && options.notice.length > 0)
        blocks.push(options.notice);
    blocks.push((0, v2_1.fields)([
        ['Packs cadastrados', String(stats.packs)],
        ['Ativos', String(stats.activePacks)],
        ['Em destaque', String(stats.featured)],
        ['Categorias', String(stats.categories)],
    ]));
    if (warnings.length > 0)
        blocks.push(`⚠️ **Atencao**\n${(0, v2_1.bullets)(warnings)}`);
    root.addTextDisplayComponents((0, v2_1.text)(blocks.join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.PACK_NEW, branding_1.EMOJIS.ADD, 'Criar Pack'), adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.EDIT, 'Editar Pack', catalog_1.PACK_PICK_KIND.EDIT, '1'), adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.IMAGE, 'Imagens', catalog_1.PACK_PICK_KIND.IMAGES, '1'), adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.LIST, 'Ficha Tecnica', catalog_1.PACK_PICK_KIND.DETAILS, '1'), adminButton(customIds_1.CATALOG_ACTION.CATEGORIES, branding_1.EMOJIS.CHANNELS, 'Categorias')));
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.PRICE, 'Precos', catalog_1.PACK_PICK_KIND.PRICE, '1'), adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.FEATURED, 'Destaques', catalog_1.PACK_PICK_KIND.FEATURE, '1'), adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.ENABLE, 'Ativar/Desativar', catalog_1.PACK_PICK_KIND.TOGGLE, '1'), adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.TRANSFER, 'Mover Categoria', catalog_1.PACK_PICK_KIND.CATEGORY, '1'), adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.DELETE, 'Excluir', catalog_1.PACK_PICK_KIND.DELETE, '1')));
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.ORDER_CHANNEL, branding_1.EMOJIS.CHANNELS, 'Canal de Pedidos')));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Somente administradores do servidor conseguem usar este painel.'));
    return root;
}
/**
 * Canal onde a equipe recebe os novos pedidos.
 *
 * Fica aqui, e nao em `/ticket-config geral`: aquele painel ja usa as 5 action
 * rows que uma mensagem aceita, e um sexto select simplesmente nao chegaria ao
 * Discord.
 */
function buildOrderChannelPanel(config, guild) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG_ADMIN, { subtitle: 'Canal de pedidos da equipe' });
    const current = config.orderChannelId !== null && guild.channels.cache.has(config.orderChannelId)
        ? `<#${config.orderChannelId}>`
        : 'Nao configurado';
    root.addTextDisplayComponents((0, v2_1.text)(`${(0, v2_1.fields)([['Canal atual', current]])}\n\n` +
        'Cada novo pedido e publicado neste canal para a equipe assumir. ' +
        'Escolha um canal **interno**: o aviso mostra cliente e valores.\n' +
        'Sem canal configurado, os pedidos continuam acessiveis por `/pedidos gerenciar`.'));
    const menu = new discord_js_1.ChannelSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.ORDER_CHANNEL_SELECT))
        .setPlaceholder('Canal que recebera os novos pedidos')
        .addChannelTypes(discord_js_1.ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1);
    // So marca o padrao quando o canal ainda existe: a API recusa ID invalido.
    if (config.orderChannelId !== null && guild.channels.cache.has(config.orderChannelId)) {
        menu.setDefaultChannels(config.orderChannelId);
    }
    root.addActionRowComponents((0, v2_1.selectRow)(menu));
    root.addActionRowComponents((0, v2_1.buttonRow)(adminBackButton()));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Desmarque o canal atual para deixar de publicar os pedidos.'));
    return root;
}
// ---------------------------------------------------------------------------
// Selecao de pack (paginada)
// ---------------------------------------------------------------------------
const PACK_PICK_TITLES = {
    [catalog_1.PACK_PICK_KIND.EDIT]: {
        title: 'EDITAR PACK',
        instruction: 'Escolha o pack a editar. O formulario abre ja preenchido.',
    },
    [catalog_1.PACK_PICK_KIND.PRICE]: {
        title: 'ALTERAR PRECO',
        instruction: 'Escolha o pack. Alterar o preco NAO muda pedidos ja criados — eles guardam o valor da compra.',
    },
    [catalog_1.PACK_PICK_KIND.TOGGLE]: {
        title: 'ATIVAR / DESATIVAR',
        instruction: 'Pack desativado some da vitrine e sai dos carrinhos, mas continua nos pedidos historicos.',
    },
    [catalog_1.PACK_PICK_KIND.FEATURE]: {
        title: 'DESTAQUES',
        instruction: 'Packs em destaque aparecem no topo da vitrine e na home do catalogo.',
    },
    [catalog_1.PACK_PICK_KIND.DELETE]: {
        title: 'EXCLUIR PACK',
        instruction: 'A exclusao e logica: o pack some da loja, mas os pedidos ja emitidos continuam intactos.',
    },
    [catalog_1.PACK_PICK_KIND.IMAGES]: {
        title: 'IMAGENS DO PACK',
        instruction: 'Escolha o pack para gerenciar a galeria de imagens.',
    },
    [catalog_1.PACK_PICK_KIND.DETAILS]: {
        title: 'FICHA TECNICA',
        instruction: 'Escolha o pack para editar compatibilidade, quantidade, formato e afins.',
    },
    [catalog_1.PACK_PICK_KIND.CATEGORY]: {
        title: 'MOVER CATEGORIA',
        instruction: 'Escolha o pack que mudara de categoria.',
    },
};
/**
 * Seletor de packs paginado.
 *
 * Um select aceita 25 opcoes; uma loja com centenas de packs precisa paginar —
 * jogar tudo em um menu so simplesmente nao chega ao Discord.
 */
function buildPackPickerPanel(params) {
    const copy = PACK_PICK_TITLES[params.kind];
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, `VOOK STORE — ${copy.title}`, { subtitle: copy.instruction });
    if (params.packs.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhum pack cadastrado ainda. Use "Criar Pack" para comecar.'));
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)(adminBackButton()));
        return root;
    }
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_PICK_SELECT, params.kind))
        .setPlaceholder('Selecione o pack')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(params.packs.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((pack) => {
        const option = new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel((0, sanitize_1.truncate)(pack.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
            .setDescription((0, sanitize_1.truncate)(`${(0, money_1.formatCents)(pack.price)} • ${pack.enabled ? 'ativo' : 'desativado'}${pack.featured ? ' • destaque' : ''}`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
            .setValue(pack.id);
        option.setEmoji(pack.enabled ? branding_1.EMOJIS.ENABLE : branding_1.EMOJIS.DISABLE);
        return option;
    }));
    root.addActionRowComponents((0, v2_1.selectRow)(menu));
    const navigation = [];
    if (params.totalPages > 1) {
        navigation.push(adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.PREVIOUS, 'Anterior', params.kind, String(params.page - 1 < 1 ? params.totalPages : params.page - 1)), adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.NEXT, 'Proxima', params.kind, String(params.page + 1 > params.totalPages ? 1 : params.page + 1)));
    }
    navigation.push(adminBackButton());
    root.addActionRowComponents((0, v2_1.buttonRow)(...navigation));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Pagina ${params.page}/${params.totalPages} • ${params.total} pack(s)`));
    return root;
}
/** Seletor de categoria usado na criacao e na movimentacao de packs. */
function buildCategoryChooserPanel(params) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, params.title, { subtitle: params.instruction });
    if (params.categories.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('⚠️ Nenhuma categoria cadastrada.\nCrie uma categoria antes de cadastrar produtos — ' +
            'um pack ativo sem categoria valida nao aparece na vitrine.'));
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.CATEGORIES, branding_1.EMOJIS.CHANNELS, 'Ir para Categorias'), adminBackButton()));
        return root;
    }
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, params.action, ...(params.args ?? [])))
        .setPlaceholder('Selecione a categoria')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(params.categories.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((category) => {
        const option = new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel((0, sanitize_1.truncate)(category.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
            .setDescription((0, sanitize_1.truncate)(category.description ?? (category.enabled ? 'Categoria ativa' : 'Categoria desativada'), limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
            .setValue(category.id);
        if (category.emoji !== null && category.emoji.length > 0)
            option.setEmoji(category.emoji);
        return option;
    }));
    root.addActionRowComponents((0, v2_1.selectRow)(menu));
    root.addActionRowComponents((0, v2_1.buttonRow)(adminBackButton()));
    return root;
}
// ---------------------------------------------------------------------------
// Formularios de pack
// ---------------------------------------------------------------------------
/** Formulario comercial do pack (5 campos — o maximo permitido). */
function buildPackModal(mode, params) {
    if (mode === 'edit' && params.pack === undefined) {
        throw new errors_1.ValidationError('Modal de edicao exige o pack carregado.', {
            userMessage: 'Nao foi possivel abrir este pack. Atualize o painel e tente novamente.',
        });
    }
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId(mode === 'create'
        ? (0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_NEW_MODAL, params.categoryId ?? '')
        : (0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_EDIT_MODAL, params.pack?.id ?? ''))
        .setTitle(mode === 'create' ? 'VOOK STORE — NOVO PACK' : 'VOOK STORE — EDITAR PACK');
    modal.addLabelComponents(modalField({
        customId: exports.PACK_FIELD.NAME,
        label: 'Nome do pack',
        description: 'Aparece na vitrine e no pedido do cliente.',
        placeholder: 'Vook Vehicles Collection',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: limits_1.BUSINESS_LIMITS.PACK_NAME_MAX,
        required: true,
        value: params.pack?.name,
    }), modalField({
        customId: exports.PACK_FIELD.PRICE,
        label: 'Preco',
        description: 'Aceita 149,90 ou R$ 149,90. Nunca zero.',
        placeholder: '149,90',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: 20,
        required: true,
        value: params.pack === undefined ? null : (0, money_1.formatCents)(params.pack.price).replace('R$ ', ''),
    }), modalField({
        customId: exports.PACK_FIELD.SKU,
        label: 'SKU (opcional)',
        description: 'Codigo curto e unico no servidor. Ex.: VEH-001.',
        placeholder: 'VEH-001',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: limits_1.BUSINESS_LIMITS.PACK_SKU_MAX,
        required: false,
        value: params.pack?.sku,
    }), modalField({
        customId: exports.PACK_FIELD.SHORT,
        label: 'Descricao curta',
        description: 'Uma linha, exibida na listagem e no card.',
        placeholder: 'Pack completo de veiculos exclusivos.',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: limits_1.BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX,
        required: false,
        value: params.pack?.shortDescription,
    }), modalField({
        customId: exports.PACK_FIELD.DESCRIPTION,
        label: 'Descricao completa',
        description: 'Exibida em "Mais Informacoes". Aceita varias linhas.',
        placeholder: 'Inclui 15 veiculos, texturas otimizadas e atualizacoes.',
        style: discord_js_1.TextInputStyle.Paragraph,
        maxLength: limits_1.BUSINESS_LIMITS.PACK_DESCRIPTION_MAX,
        required: false,
        value: params.pack?.description,
    }));
    return modal;
}
/** Formulario rapido de preco. */
function buildPackPriceModal(pack) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_PRICE_MODAL, pack.id))
        .setTitle('VOOK STORE — PRECO');
    modal.addLabelComponents(modalField({
        customId: exports.PACK_FIELD.PRICE,
        label: `Preco de ${(0, sanitize_1.truncate)(pack.name, 20)}`,
        description: 'Pedidos ja criados mantem o valor da compra.',
        placeholder: '149,90',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: 20,
        required: true,
        value: (0, money_1.formatCents)(pack.price).replace('R$ ', ''),
    }));
    return modal;
}
/** Formulario da ficha tecnica: uma linha por item, `Rotulo: valor`. */
function buildPackDetailsModal(pack, details) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_DETAILS_MODAL, pack.id))
        .setTitle('VOOK STORE — FICHA TECNICA');
    modal.addLabelComponents(modalField({
        customId: exports.PACK_FIELD.DETAILS,
        label: 'Ficha tecnica',
        description: `Uma linha por item: "Rotulo: valor". Ate ${limits_1.BUSINESS_LIMITS.MAX_DETAILS_PER_PACK} itens.`,
        placeholder: 'Compatibilidade: FiveM\nQuantidade: 15 veiculos\nFormato: Ready-to-use',
        style: discord_js_1.TextInputStyle.Paragraph,
        maxLength: 1000,
        required: false,
        value: (0, packValidators_1.formatPackDetails)(details),
    }));
    return modal;
}
// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------
/** Painel da galeria do pack. */
function buildPackImagesPanel(pack, images, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG_IMAGES, { subtitle: `**${(0, sanitize_1.truncate)(pack.name, 60)}**` });
    if (options.notice !== undefined && options.notice.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(options.notice));
    }
    if (images.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('⚠️ Nenhuma imagem cadastrada.\nA vitrine mostra o pack sem foto — cadastre ao menos a capa.'));
    }
    else {
        root.addTextDisplayComponents((0, v2_1.text)(`**${images.length} imagem(ns) cadastrada(s)**\n\n` +
            images
                .map((image, index) => `**${index + 1}.** ${image.isCover ? `${branding_1.EMOJIS.FEATURED} capa • ` : ''}` +
                `${(0, sanitize_1.truncate)(image.altText ?? image.url, 70)}`)
                .join('\n')));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.IMAGE_ADD, branding_1.EMOJIS.ADD, 'Adicionar Imagem', pack.id).setDisabled(images.length >= limits_1.BUSINESS_LIMITS.MAX_IMAGES_PER_PACK), adminButton(customIds_1.CATALOG_ACTION.IMAGE_PICK, branding_1.EMOJIS.DELETE, 'Remover', catalog_1.IMAGE_PICK_KIND.REMOVE, pack.id).setDisabled(images.length === 0), adminButton(customIds_1.CATALOG_ACTION.IMAGE_PICK, branding_1.EMOJIS.UP, 'Mover Cima', catalog_1.IMAGE_PICK_KIND.UP, pack.id)
        .setDisabled(images.length < 2), adminButton(customIds_1.CATALOG_ACTION.IMAGE_PICK, branding_1.EMOJIS.DOWN, 'Mover Baixo', catalog_1.IMAGE_PICK_KIND.DOWN, pack.id).setDisabled(images.length < 2), adminButton(customIds_1.CATALOG_ACTION.IMAGE_PICK, branding_1.EMOJIS.FEATURED, 'Definir Capa', catalog_1.IMAGE_PICK_KIND.COVER, pack.id).setDisabled(images.length === 0)));
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.PACK_PICK, branding_1.EMOJIS.IMAGE, 'Outro Pack', catalog_1.PACK_PICK_KIND.IMAGES, '1'), adminBackButton()));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`A ordem define a navegacao ◀️ ▶️ do cliente. Maximo de ${limits_1.BUSINESS_LIMITS.MAX_IMAGES_PER_PACK} imagens por pack.`));
    return root;
}
const IMAGE_PICK_TITLES = {
    [catalog_1.IMAGE_PICK_KIND.REMOVE]: 'Escolha a imagem a remover.',
    [catalog_1.IMAGE_PICK_KIND.UP]: 'Escolha a imagem que subira uma posicao.',
    [catalog_1.IMAGE_PICK_KIND.DOWN]: 'Escolha a imagem que descera uma posicao.',
    [catalog_1.IMAGE_PICK_KIND.COVER]: 'Escolha a imagem que sera a capa do pack.',
};
function buildImagePickerPanel(pack, images, kind) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG_IMAGES, { subtitle: IMAGE_PICK_TITLES[kind] });
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.IMAGE_PICK_SELECT, kind, pack.id))
        .setPlaceholder('Selecione a imagem')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(images.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((image, index) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(`${index + 1}. ${image.altText ?? 'Imagem'}`, limits_1.DISCORD_LIMITS.SELECT_LABEL))
        .setDescription((0, sanitize_1.truncate)(image.url, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
        .setValue(image.id)));
    root.addActionRowComponents((0, v2_1.selectRow)(menu));
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.IMAGES_PANEL, branding_1.EMOJIS.BACK, 'Voltar', pack.id), adminBackButton()));
    return root;
}
/** Formulario de cadastro de imagem (URL https + texto alternativo). */
function buildImageModal(pack) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.IMAGE_ADD_MODAL, pack.id))
        .setTitle('VOOK STORE — NOVA IMAGEM');
    modal.addLabelComponents(modalField({
        customId: exports.PACK_FIELD.IMAGE_URL,
        label: 'URL da imagem',
        description: 'Somente https://. Links inseguros sao recusados.',
        placeholder: 'https://cdn.exemplo.com/pack.png',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: limits_1.BUSINESS_LIMITS.IMAGE_URL_MAX,
        required: true,
    }), modalField({
        customId: exports.PACK_FIELD.IMAGE_ALT,
        label: 'Descricao da imagem (opcional)',
        description: 'Ajuda o cliente a entender o que a foto mostra.',
        placeholder: 'Vista frontal do veiculo',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: limits_1.BUSINESS_LIMITS.PACK_IMAGE_ALT_MAX,
        required: false,
    }));
    return modal;
}
// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
function buildCategoryAdminPanel(categories, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG_CATEGORIES);
    if (options.notice !== undefined && options.notice.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(options.notice));
    }
    if (categories.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhuma categoria cadastrada.\nCrie a primeira para organizar a vitrine.'));
    }
    else {
        root.addTextDisplayComponents((0, v2_1.text)(categories
            .map((category, index) => `**${index + 1}.** ${category.emoji ?? ''} ${category.name} — ` +
            `${category.enabled ? `${branding_1.EMOJIS.ENABLE} ativa` : `${branding_1.EMOJIS.DISABLE} desativada`}`)
            .join('\n')));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.CATEGORY_NEW, branding_1.EMOJIS.ADD, 'Criar'), adminButton(customIds_1.CATALOG_ACTION.CATEGORY_PICK, branding_1.EMOJIS.EDIT, 'Editar', catalog_1.CATEGORY_PICK_KIND.EDIT), adminButton(customIds_1.CATALOG_ACTION.CATEGORY_PICK, branding_1.EMOJIS.ENABLE, 'Ativar/Desativar', catalog_1.CATEGORY_PICK_KIND.TOGGLE), adminButton(customIds_1.CATALOG_ACTION.CATEGORY_PICK, branding_1.EMOJIS.UP, 'Subir', catalog_1.CATEGORY_PICK_KIND.UP), adminButton(customIds_1.CATALOG_ACTION.CATEGORY_PICK, branding_1.EMOJIS.DOWN, 'Descer', catalog_1.CATEGORY_PICK_KIND.DOWN)));
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.CATEGORY_PICK, branding_1.EMOJIS.DELETE, 'Excluir', catalog_1.CATEGORY_PICK_KIND.DELETE), adminBackButton()));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Categoria desativada some da vitrine, mas nao afeta pedidos historicos.'));
    return root;
}
const CATEGORY_PICK_TITLES = {
    [catalog_1.CATEGORY_PICK_KIND.EDIT]: 'Escolha a categoria a editar.',
    [catalog_1.CATEGORY_PICK_KIND.TOGGLE]: 'Escolha a categoria para alternar o estado.',
    [catalog_1.CATEGORY_PICK_KIND.DELETE]: 'Escolha a categoria a excluir (precisa estar sem produtos).',
    [catalog_1.CATEGORY_PICK_KIND.UP]: 'Escolha a categoria que subira uma posicao.',
    [catalog_1.CATEGORY_PICK_KIND.DOWN]: 'Escolha a categoria que descera uma posicao.',
};
function buildCategoryPickerPanel(categories, kind) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATALOG_CATEGORIES, { subtitle: CATEGORY_PICK_TITLES[kind] });
    if (categories.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhuma categoria cadastrada.'));
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.CATEGORIES, branding_1.EMOJIS.BACK, 'Voltar')));
        return root;
    }
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.CATEGORY_PICK_SELECT, kind))
        .setPlaceholder('Selecione a categoria')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(categories.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((category) => {
        const option = new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel((0, sanitize_1.truncate)(category.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
            .setDescription((0, sanitize_1.truncate)(category.enabled ? 'Categoria ativa' : 'Categoria desativada', limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
            .setValue(category.id);
        if (category.emoji !== null && category.emoji.length > 0)
            option.setEmoji(category.emoji);
        return option;
    }));
    root.addActionRowComponents((0, v2_1.selectRow)(menu));
    root.addActionRowComponents((0, v2_1.buttonRow)(adminButton(customIds_1.CATALOG_ACTION.CATEGORIES, branding_1.EMOJIS.BACK, 'Voltar')));
    return root;
}
function buildCategoryModal(mode, category) {
    if (mode === 'edit' && category === undefined) {
        throw new errors_1.ValidationError('Modal de edicao exige a categoria carregada.', {
            userMessage: 'Nao foi possivel abrir esta categoria. Atualize o painel.',
        });
    }
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId(mode === 'create'
        ? (0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.CATEGORY_NEW_MODAL)
        : (0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.CATEGORY_EDIT_MODAL, category?.id ?? ''))
        .setTitle(mode === 'create' ? 'VOOK STORE — NOVA CATEGORIA' : 'VOOK STORE — EDITAR CATEGORIA');
    modal.addLabelComponents(modalField({
        customId: exports.CATEGORY_FIELD.NAME,
        label: 'Nome da categoria',
        description: 'Aparece no seletor do catalogo.',
        placeholder: 'Veiculos',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: limits_1.BUSINESS_LIMITS.CATEGORY_NAME_MAX,
        required: true,
        value: category?.name,
    }), modalField({
        customId: exports.CATEGORY_FIELD.DESCRIPTION,
        label: 'Descricao (opcional)',
        description: 'Uma linha exibida junto ao nome no menu.',
        placeholder: 'Veiculos exclusivos para FiveM',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: limits_1.BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX,
        required: false,
        value: category?.description,
    }), modalField({
        customId: exports.CATEGORY_FIELD.EMOJI,
        label: 'Emoji (opcional)',
        description: 'Um emoji unicode ou emoji customizado do servidor.',
        placeholder: '🚗',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: 32,
        required: false,
        value: category?.emoji,
    }));
    return modal;
}
/** Formulario de busca do catalogo. */
function buildCatalogSearchModal() {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.SEARCH_MODAL))
        .setTitle('VOOK STORE — BUSCAR');
    modal.addLabelComponents(modalField({
        customId: 'termo',
        label: 'O que voce procura?',
        description: 'Busca por nome, SKU ou descricao curta.',
        placeholder: 'veiculos',
        style: discord_js_1.TextInputStyle.Short,
        maxLength: limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MAX,
        required: true,
    }));
    return modal;
}
//# sourceMappingURL=CatalogAdminBuilders.js.map