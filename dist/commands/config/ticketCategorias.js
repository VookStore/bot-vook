"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketCategoriasCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const categories_1 = require("../../interactions/categories");
/**
 * `/ticket-categorias gerenciar`
 *
 * Abre o painel administrativo das categorias de atendimento (criar, editar,
 * reordenar, ativar/desativar e excluir). A resposta e sempre efemera: e uma
 * tela de configuracao, nao deve poluir o canal.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('ticket-categorias')
    .setDescription('Gerencia as categorias de atendimento da Vook Store.')
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .setContexts(discord_js_1.InteractionContextType.Guild)
    .addSubcommand((subcommand) => subcommand
    .setName('gerenciar')
    .setDescription('Abre o painel de categorias de atendimento.'));
exports.ticketCategoriasCommand = {
    builder,
    guildOnly: true,
    async execute(interaction) {
        // A permissao do comando no Discord e apenas a primeira barreira.
        (0, PermissionService_1.assertCanManageSystem)(interaction.member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, reply_1.editReplyV2)(interaction, await (0, categories_1.renderCategoryMenu)(interaction.guildId));
    },
};
//# sourceMappingURL=ticketCategorias.js.map