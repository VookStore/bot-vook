"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogoCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const limits_1 = require("../../constants/limits");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const catalog_1 = require("../../interactions/catalog");
/**
 * `/catalogo` — a loja da Vook Store dentro do Discord.
 *
 * Para o CLIENTE o comando abre a vitrine (`ver`), sempre em resposta efemera:
 * carrinho e pedidos sao dados do cliente e nao viram conteudo do canal.
 *
 * `gerenciar` e administracao e revalida a permissao no `execute` — a permissao
 * padrao do comando apenas esconde a opcao, ela nao autoriza nada.
 */
const SUB = {
    VIEW: 'ver',
    SEARCH: 'buscar',
    MANAGE: 'gerenciar',
};
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('catalogo')
    .setDescription('Catalogo de packs da Vook Store')
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand.setName(SUB.VIEW).setDescription('Abre a loja e navega pelos packs disponiveis'))
    .addSubcommand((subcommand) => subcommand
    .setName(SUB.SEARCH)
    .setDescription('Procura um pack por nome, SKU ou descricao')
    .addStringOption((option) => option
    .setName('termo')
    .setDescription('O que voce procura. Ex.: veiculos')
    .setRequired(true)
    .setMinLength(limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MIN)
    .setMaxLength(limits_1.BUSINESS_LIMITS.CATALOG_SEARCH_MAX)))
    .addSubcommand((subcommand) => subcommand
    .setName(SUB.MANAGE)
    .setDescription('[Equipe] Painel de administracao do catalogo'));
async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === SUB.VIEW) {
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, catalog_1.renderHomeForCommand)(interaction, interaction.guildId);
        return;
    }
    if (subcommand === SUB.SEARCH) {
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, catalog_1.renderSearchResults)(interaction, interaction.guildId, interaction.options.getString('termo', true));
        return;
    }
    if (subcommand === SUB.MANAGE) {
        (0, PermissionService_1.assertCanManageCatalog)(interaction.member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, catalog_1.renderAdminPanelForCommand)(interaction, interaction.guildId);
        return;
    }
    throw new errors_1.ValidationError(`Subcomando de catalogo desconhecido: ${subcommand}`, {
        userMessage: 'Este subcomando nao existe. Use `/catalogo ver`.',
        context: { guildId: interaction.guildId, userId: interaction.user.id },
    });
}
exports.catalogoCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=catalogo.js.map