"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commercialProducts = exports.PRODUCTS = void 0;
exports.isProduct = isProduct;
exports.productLabel = productLabel;
exports.isCollectionProduct = isCollectionProduct;
exports.activationInstructions = activationInstructions;
exports.PRODUCTS = {
    // Compatibilidade com licenças existentes. TrueBlood nunca é oferta pública.
    pelucias: { label: 'Pelúcias · licença anterior', resources: ['vook_plush', 'vook_plush_tb'], commercial: false, bundles: [] },
    stage_hall: { label: 'Stage Hall', resources: ['stage_hall', 'stage_hall_vk'], commercial: true, bundles: [] },
    pelucias_base: { label: 'Sistema de Pelúcias · Base', resources: ['vook_plush'], commercial: true, bundles: [] },
    pelucias_dragoes: { label: 'Sistema de Pelúcias · Dragões', resources: ['vook_plush'], commercial: true, bundles: ['vk_htyd'] },
    companheiros_sanrio: { label: 'Companheiros · Sanrio', resources: ['vook_plush'], commercial: true, bundles: ['vook_sanrio_hk'] },
    companheiros_monster_high: { label: 'Companheiros · Monster High', resources: ['vook_plush'], commercial: true, bundles: [] },
};
function isProduct(value) {
    return Object.prototype.hasOwnProperty.call(exports.PRODUCTS, value);
}
function productLabel(value) {
    return isProduct(value) ? exports.PRODUCTS[value].label : 'Produto desconhecido';
}
const commercialProducts = () => Object.entries(exports.PRODUCTS).filter(([, value]) => value.commercial);
exports.commercialProducts = commercialProducts;
function isCollectionProduct(value) {
    return ['pelucias_base', 'pelucias_dragoes', 'companheiros_sanrio', 'companheiros_monster_high'].includes(value);
}
function activationInstructions(product, key) {
    if (product === 'stage_hall')
        return `Mantenha este código privado. No server.cfg, antes do ensure:\n\n\`\`\`cfg\nset stage_hall_license "${key}"\nensure stage_hall\n\`\`\`\nLicença exclusiva do Stage Hall, vinculada a uma instalação. Use somente set, nunca setr ou sets.`;
    if (isCollectionProduct(product))
        return `**${productLabel(product)}**\nMantenha este código privado. No server.cfg, antes do ensure:\n\n\`\`\`cfg\nset vook_plush_license "${key}"\nensure vook_plush\n\`\`\`\nSiga o LEIA-ME para iniciar também os modelos incluídos. O ZIP de /planos já contém a licença configurada. Cada ambiente tem seu próprio código; box/VIP é configurável nas coleções e não muda o produto adquirido.`;
    return `Mantenha este código privado. Escolha SOMENTE a linha da edição que vai ativar, no server.cfg, antes do ensure.\n\n**VOOK padrão**\n\`\`\`cfg\nset vook_plush_license "${key}"\n\`\`\`\n**True Blood · adaptação privada existente**\n\`\`\`cfg\nset vook_plush_tb_license "${key}"\n\`\`\`\nCada código vincula uma edição e uma instalação. Novas concessões têm códigos separados para Testes/Desenvolvimento e Produção; licenças anteriores mantêm seu vínculo. Use somente set, nunca setr ou sets. Se baixar pelo botão de download em /planos, a chave já vem configurada e estas linhas não são necessárias.`;
}
//# sourceMappingURL=products.js.map