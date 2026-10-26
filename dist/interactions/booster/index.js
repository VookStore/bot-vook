"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.boosterSelects = void 0;
const reply_1 = require("../../components/reply");
const customIds_1 = require("../../constants/customIds");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const errors_1 = require("../../core/errors");
const BoosterConfigBuilder_1 = require("../../modules/booster/builders/BoosterConfigBuilder");
const CatalogCategoryService_1 = require("../../modules/catalog/services/CatalogCategoryService");
const shared_1 = require("../catalog/shared");
/**
 * Escolha das categorias em que o desconto de booster vale.
 *
 * O SELECT ENTREGA O ESTADO FINAL, nao um delta: o que veio marcado passa a
 * valer desconto e todo o resto deixa de valer. Aplicar como delta ("marcou,
 * liga") tornaria impossivel DESMARCAR — e desmarcar e justamente a operacao
 * que protege PEDs, roupas e props.
 *
 * A tela e redesenhada com o que o banco devolveu, nunca com o que foi enviado:
 * se uma categoria sumiu no meio do caminho, o operador ve a verdade.
 */
const eligibilitySelect = {
    namespace: customIds_1.NAMESPACE.BOOSTER,
    action: customIds_1.BOOSTER_ACTION.ELIGIBILITY_SELECT,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        // O customId nao autoriza nada: esta acao muda quanto a loja cobra.
        (0, PermissionService_1.assertCanManageSystem)(member);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const categories = await (0, CatalogCategoryService_1.getCatalogCategories)(guild.id);
        const marcadas = new Set(interaction.values);
        /*
         * So as categorias exibidas sao afetadas. O painel corta em 25 (limite do
         * select); sem este filtro, uma loja com 30 categorias veria as 5 nao
         * exibidas perderem o desconto por nunca terem tido a chance de ser marcadas.
         */
        const exibidas = categories.slice(0, 25);
        if (exibidas.length === 0) {
            throw new errors_1.ValidationError('Nenhuma categoria para configurar.', {
                userMessage: 'Nenhuma categoria de catalogo cadastrada ainda.',
            });
        }
        await (0, CatalogCategoryService_1.setBoosterEligibility)(guild.id, exibidas.map((category) => ({
            id: category.id,
            eligible: marcadas.has(category.id),
        })));
        await (0, reply_1.updateV2)(interaction, (0, BoosterConfigBuilder_1.buildEligibilityPanel)(await (0, CatalogCategoryService_1.getCatalogCategories)(guild.id)));
    },
};
exports.boosterSelects = [eligibilitySelect];
//# sourceMappingURL=index.js.map