"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketDestinosCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const categories_1 = require("../../interactions/categories");
/**
 * `/ticket-destinos configurar`
 *
 * Define, para cada categoria de atendimento, em qual categoria fisica do
 * Discord os canais de ticket serao criados.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('ticket-destinos')
    .setDescription('Define onde os canais de ticket de cada categoria serao criados.')
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .setContexts(discord_js_1.InteractionContextType.Guild)
    .addSubcommand((subcommand) => subcommand
    .setName('configurar')
    .setDescription('Abre o painel de destinos das categorias.'));
exports.ticketDestinosCommand = {
    builder,
    guildOnly: true,
    async execute(interaction) {
        (0, PermissionService_1.assertCanManageSystem)(interaction.member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, reply_1.editReplyV2)(interaction, await (0, categories_1.renderDestinationPanel)(interaction.guild));
    },
};
//# sourceMappingURL=ticketDestinos.js.map