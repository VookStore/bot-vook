"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketEquipeCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const categories_1 = require("../../interactions/categories");
/**
 * `/ticket-equipe configurar`
 *
 * Define quais cargos sao responsaveis por cada categoria de atendimento —
 * quem pode assumir, administrar e encerrar os tickets daquele setor.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('ticket-equipe')
    .setDescription('Define os cargos responsaveis por cada categoria de atendimento.')
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .setContexts(discord_js_1.InteractionContextType.Guild)
    .addSubcommand((subcommand) => subcommand
    .setName('configurar')
    .setDescription('Abre o painel de equipes das categorias.'));
exports.ticketEquipeCommand = {
    builder,
    guildOnly: true,
    async execute(interaction) {
        (0, PermissionService_1.assertCanManageSystem)(interaction.member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, reply_1.editReplyV2)(interaction, await (0, categories_1.renderTeamPanel)(interaction.guild));
    },
};
//# sourceMappingURL=ticketEquipe.js.map