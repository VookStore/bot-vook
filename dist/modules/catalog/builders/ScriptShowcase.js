"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isScriptShowcase = isScriptShowcase;
exports.buildScriptShowcase = buildScriptShowcase;
exports.buildScriptProductCard = buildScriptProductCard;
exports.buildScriptProductDetails = buildScriptProductDetails;
const discord_js_1 = require("discord.js");
const customIds_1 = require("../../../constants/customIds");
const v2_1 = require("../../../components/v2");
const sanitize_1 = require("../../../utils/sanitize");
const scriptProducts_1 = require("../scriptProducts");
const presentation = {
    companheiros_sanrio: { title: 'Sanrio', summary: 'Sete companheiros animados, com a caixa e o painel rosa.', order: 0 },
    companheiros_monster_high: { title: 'Monster High', summary: 'Dez companheiras animadas, com a caixa e o painel de controle.', order: 1 },
    pelucias_base: { title: 'Sistema de pelúcias', summary: 'O sistema completo para organizar caixas, coleções e trocas. Sem coleção de brinde.', order: 2 },
    pelucias_dragoes: { title: 'Sistema + Dragões', summary: 'O sistema de pelúcias com seis dragões de brinde.', order: 3 },
};
function display(pack) {
    const offer = scriptProducts_1.SCRIPT_CATALOG.find(value => value.sku === pack.sku || value.slug === pack.slug);
    if (!offer)
        return { title: pack.name, summary: pack.shortDescription ?? '', order: 4 };
    return { ...presentation[offer.product], title: pack.name === offer.name ? presentation[offer.product].title : (0, sanitize_1.truncate)(pack.name, 80),
        summary: pack.shortDescription && pack.shortDescription !== offer.summary ? (0, sanitize_1.truncate)(pack.shortDescription, 180) : presentation[offer.product].summary };
}
function button(action, label, ...args) {
    return new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, action, ...args))
        .setLabel(label).setStyle(discord_js_1.ButtonStyle.Secondary);
}
/** A vitrine pequena abre cada produto diretamente; catálogos mistos mantêm sua navegação. */
function isScriptShowcase(packs) {
    return packs !== undefined && packs.length > 0 && packs.length <= scriptProducts_1.SCRIPT_CATALOG.length
        && packs.every(pack => pack.enabled && pack.deletedAt === null && (0, scriptProducts_1.isScriptPreview)(pack));
}
function buildScriptShowcase(packs, bannerUrl, notice) {
    const root = (0, v2_1.container)();
    (0, v2_1.addHeader)(root, 'VOOK · Coleções e pelúcias');
    if (bannerUrl)
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([bannerUrl], 'Coleções VOOK'));
    root.addTextDisplayComponents((0, v2_1.text)(notice ? `${notice}\n\nEscolha o que você quer conhecer.` : 'Escolha o que você quer conhecer.'));
    for (const pack of [...packs].sort((a, b) => display(a).order - display(b).order)) {
        const info = display(pack);
        root.addSectionComponents((0, v2_1.sectionWithButton)([`### ${info.title}\n${info.summary}`], button(customIds_1.CATALOG_ACTION.PACK_VIEW, 'Conhecer', pack.id, '0')));
    }
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.LIST, '0'))
        .setLabel('Meus arquivos').setStyle(discord_js_1.ButtonStyle.Secondary)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Já tem uma licença? Use Meus arquivos. Compras ainda não disponíveis.'));
    return root;
}
function buildScriptProductCard(view, requestedIndex, notice) {
    const { pack, images } = view;
    const info = display(pack), total = images.length;
    const index = total ? ((Number.isFinite(requestedIndex) ? Math.trunc(requestedIndex) : 0) % total + total) % total : 0;
    const root = (0, v2_1.container)();
    (0, v2_1.addHeader)(root, info.title);
    const image = images[index];
    if (image)
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([image.url], image.altText ?? info.title));
    root.addTextDisplayComponents((0, v2_1.text)(`${notice ? `${notice}\n\n` : ''}${(0, sanitize_1.truncate)(pack.shortDescription ?? info.summary, 400)}`));
    if (total > 1)
        root.addTextDisplayComponents((0, v2_1.footerNote)(`Arte ${index + 1} de ${total}`));
    const actions = [button(customIds_1.CATALOG_ACTION.HOME, 'Voltar')];
    if (total > 1)
        actions.push(button(customIds_1.CATALOG_ACTION.IMAGE_NEXT, 'Ver outras artes', pack.id, String(index)));
    actions.push(button(customIds_1.CATALOG_ACTION.PACK_INFO, 'O que está incluído', pack.id));
    root.addActionRowComponents((0, v2_1.buttonRow)(...actions));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Compras ainda não disponíveis.'));
    return root;
}
function buildScriptProductDetails(view) {
    const root = (0, v2_1.container)();
    (0, v2_1.addHeader)(root, `${display(view.pack).title} · O que está incluído`);
    root.addTextDisplayComponents((0, v2_1.text)((0, sanitize_1.truncate)(view.pack.description ?? view.pack.shortDescription ?? '', 1600)));
    const details = view.details.filter(detail => !['Disponibilidade', 'Licença'].includes(detail.label)).slice(0, 6);
    if (details.length)
        root.addTextDisplayComponents((0, v2_1.text)(details.map(detail => `**${detail.label}:** ${(0, sanitize_1.truncate)(detail.value, 240)}`).join('\n')));
    root.addActionRowComponents((0, v2_1.buttonRow)(button(customIds_1.CATALOG_ACTION.PACK_VIEW, 'Voltar ao produto', view.pack.id, '0'), button(customIds_1.CATALOG_ACTION.HOME, 'Todas as opções')));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Compras ainda não disponíveis.'));
    return root;
}
//# sourceMappingURL=ScriptShowcase.js.map