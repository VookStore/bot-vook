"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCatalogWorkspace = buildCatalogWorkspace;
exports.buildProductWorkspace = buildProductWorkspace;
exports.buildProductTextModal = buildProductTextModal;
exports.buildProductCoverModal = buildProductCoverModal;
const discord_js_1 = require("discord.js");
const customIds_1 = require("../../../constants/customIds");
const v2_1 = require("../../../components/v2");
const sanitize_1 = require("../../../utils/sanitize");
function action(kind, label, ...args) {
    return new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, kind, ...args)).setLabel(label).setStyle(discord_js_1.ButtonStyle.Secondary);
}
function buildCatalogWorkspace(packs, notice) {
    const root = (0, v2_1.container)();
    (0, v2_1.addHeader)(root, 'Gerenciar catálogo');
    root.addTextDisplayComponents((0, v2_1.text)(`${notice ? `${notice}\n\n` : ''}Escolha o produto que você quer ajustar.`));
    for (const pack of packs)
        root.addSectionComponents((0, v2_1.sectionWithButton)([
            `**${(0, sanitize_1.truncate)(pack.name, 80)}**\n${pack.enabled ? 'Publicado' : 'Arquivado / oculto'}`,
        ], action(customIds_1.CATALOG_ACTION.PRODUCT_PANEL, 'Editar produto', pack.id)));
    root.addActionRowComponents((0, v2_1.buttonRow)(action(customIds_1.CATALOG_ACTION.PACK_NEW, 'Novo produto'), action(customIds_1.CATALOG_ACTION.CATEGORIES, 'Categorias'), action(customIds_1.CATALOG_ACTION.ADMIN_ADVANCED, 'Outras opções')));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Os ajustes são feitos no produto escolhido, sem selecionar tudo outra vez.'));
    return root;
}
function buildProductWorkspace(pack, images, notice) {
    const root = (0, v2_1.container)();
    (0, v2_1.addHeader)(root, (0, sanitize_1.truncate)(pack.name, 100));
    root.addTextDisplayComponents((0, v2_1.text)(`${notice ? `${notice}\n\n` : ''}${pack.enabled ? 'Publicado' : 'Arquivado / oculto'} · ${images.length} artes\n\n${(0, sanitize_1.truncate)(pack.shortDescription ?? '', 300)}`));
    root.addActionRowComponents((0, v2_1.buttonRow)(action(customIds_1.CATALOG_ACTION.PRODUCT_ACTION, 'Editar textos', 'text', pack.id), action(customIds_1.CATALOG_ACTION.PRODUCT_ACTION, 'Trocar capa', 'cover', pack.id), action(customIds_1.CATALOG_ACTION.IMAGES_PANEL, 'Artes e ordem', pack.id)));
    root.addActionRowComponents((0, v2_1.buttonRow)(action(customIds_1.CATALOG_ACTION.PRODUCT_ACTION, 'Conteúdo incluído', 'details', pack.id), action(customIds_1.CATALOG_ACTION.PRODUCT_ACTION, pack.enabled ? 'Arquivar / ocultar' : 'Republicar', 'toggle', pack.id), action(customIds_1.CATALOG_ACTION.PACK_VIEW, 'Ver como cliente', pack.id, '0')));
    root.addActionRowComponents((0, v2_1.buttonRow)(action(customIds_1.CATALOG_ACTION.ADMIN, 'Voltar aos produtos')));
    return root;
}
function field(id, label, value, max, paragraph = false) {
    const input = new discord_js_1.TextInputBuilder().setCustomId(id).setStyle(paragraph ? discord_js_1.TextInputStyle.Paragraph : discord_js_1.TextInputStyle.Short).setRequired(id === 'nome' || id === 'url').setMaxLength(max);
    if (value)
        input.setValue((0, sanitize_1.truncate)(value, max));
    return new discord_js_1.LabelBuilder().setLabel(label).setTextInputComponent(input);
}
function buildProductTextModal(pack) {
    return new discord_js_1.ModalBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PRODUCT_TEXT_MODAL, pack.id)).setTitle('Editar textos')
        .addLabelComponents(field('nome', 'Nome do produto', pack.name, 80), field('resumo', 'Resumo', pack.shortDescription ?? '', 240), field('descricao', 'Descrição completa', pack.description ?? '', 2000, true));
}
function buildProductCoverModal(pack, cover) {
    return new discord_js_1.ModalBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PRODUCT_COVER_MODAL, pack.id, cover?.id ?? 'new')).setTitle('Trocar capa')
        .addLabelComponents(field('url', 'Link HTTPS da capa', cover?.url ?? '', 2048), field('alt', 'Descrição da imagem', cover?.altText ?? '', 240));
}
//# sourceMappingURL=CatalogWorkspace.js.map