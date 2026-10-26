"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDiscountStatus = buildDiscountStatus;
exports.buildEligibilitySelect = buildEligibilitySelect;
exports.buildEligibilityPanel = buildEligibilityPanel;
const discord_js_1 = require("discord.js");
const v2_1 = require("../../../components/v2");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
/**
 * Telas de configuracao do desconto automatico de booster.
 *
 * O QUE ESTA TELA PRECISA DEIXAR OBVIO: o desconto so acontece quando os DOIS
 * lados estao definidos — o cargo (quem ganha) e o cupom (quanto). Meia
 * configuracao nao aplica nada, e o modo de falha e silencioso; quem configurou
 * so o cargo acharia que ligou.
 */
const TITLE = 'DESCONTO DE BOOSTER';
/** Estado atual da automacao, em uma tela. */
function buildDiscountStatus(config, couponLabels) {
    const ligado = config.boosterRoleId !== null && config.boosterCouponId !== null;
    const root = (0, v2_1.container)(ligado ? branding_1.COLORS.SUCCESS : branding_1.COLORS.WARNING);
    (0, v2_1.addHeader)(root, TITLE);
    if (!ligado) {
        root.addTextDisplayComponents((0, v2_1.text)('**Desligado.** Nenhum desconto e aplicado sozinho — a equipe continua ' +
            'lancando o cupom a mao no atendimento.'));
        return root;
    }
    const linhas = [
        `**1 boost** — ${(0, discord_1.roleMention)(config.boosterRoleId)} recebe \`${couponLabels.tier1 ?? '?'}\``,
    ];
    if (config.boosterTier2RoleId !== null && config.boosterTier2CouponId !== null) {
        linhas.push(`**2 boosts** — ${(0, discord_1.roleMention)(config.boosterTier2RoleId)} recebe \`${couponLabels.tier2 ?? '?'}\``);
    }
    else {
        linhas.push('-# Degrau de 2 boosts nao configurado: todo booster recebe o desconto do primeiro degrau.');
    }
    root.addTextDisplayComponents((0, v2_1.text)(linhas.join('\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.footerNote)('Aplicado na criacao do pedido. Pedido com cupom da equipe nao e alterado, ' +
        'e o desconto nao entra se houver item de categoria nao elegivel.'));
    return root;
}
/**
 * Seletor de categorias elegiveis.
 *
 * MULTI-SELECT COM O ESTADO ATUAL PRE-MARCADO: o que estiver selecionado ao
 * confirmar passa a valer desconto, e o que sair deixa de valer. Uma lista de
 * "marque para excluir" seria a mesma informacao invertida e mais facil de ler
 * errado — aqui o que esta marcado e o que o cliente ganha.
 */
function buildEligibilitySelect(categories) {
    const options = categories
        .slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS)
        .map((category) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(category.name, 100))
        .setValue(category.id)
        .setDefault(category.boosterEligible));
    return new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.BOOSTER, customIds_1.BOOSTER_ACTION.ELIGIBILITY_SELECT))
        .setPlaceholder('Categorias em que o desconto vale')
        .setMinValues(0)
        .setMaxValues(options.length)
        .addOptions(options);
}
/** Tela de escolha das categorias. */
function buildEligibilityPanel(categories) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, `${TITLE} — CATEGORIAS`);
    if (categories.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhuma categoria de catalogo cadastrada ainda.'));
        return root;
    }
    root.addTextDisplayComponents((0, v2_1.text)('Marque as categorias em que o desconto de booster **vale**. As desmarcadas ' +
        'ficam de fora — e um pedido que tenha qualquer item delas nao recebe desconto ' +
        'automatico nenhum.'));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.selectRow)(buildEligibilitySelect(categories)));
    const excluidas = categories.filter((category) => !category.boosterEligible);
    root.addTextDisplayComponents((0, v2_1.footerNote)(excluidas.length === 0
        ? 'Hoje o desconto vale em todas as categorias.'
        : `Hoje fora: ${excluidas.map((category) => category.name).join(', ')}.`));
    return root;
}
//# sourceMappingURL=BoosterConfigBuilder.js.map