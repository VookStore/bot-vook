"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketConfigCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const ConfigBuilders_1 = require("../../modules/configuration/builders/ConfigBuilders");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
/**
 * /ticket-config geral — painel de configuracao geral da guild.
 *
 * A permissao padrao do comando (ManageGuild) apenas esconde o comando de quem
 * nao pode usa-lo; a autorizacao real e sempre revalidada aqui e em cada
 * componente do painel.
 */
const SUBCOMMAND_GENERAL = 'geral';
exports.ticketConfigCommand = {
    builder: new discord_js_1.SlashCommandBuilder()
        .setName('ticket-config')
        .setDescription('Configuracoes gerais da Vook Store neste servidor.')
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
        .setContexts(discord_js_1.InteractionContextType.Guild)
        .addSubcommand((subcommand) => subcommand
        .setName(SUBCOMMAND_GENERAL)
        .setDescription('Abre o painel de configuracao geral (canais, auto-role, visual, limites).')),
    guildOnly: true,
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== SUBCOMMAND_GENERAL) {
            throw new errors_1.ValidationError(`Subcomando desconhecido em /ticket-config: ${subcommand}`, {
                userMessage: 'Use `/ticket-config geral` para abrir o painel de configuracao.',
            });
        }
        (0, PermissionService_1.assertCanManageSystem)(interaction.member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const config = await (0, GuildConfigService_1.getGuildConfig)(interaction.guildId);
        await (0, reply_1.editReplyV2)(interaction, (0, ConfigBuilders_1.buildConfigMenu)(config, interaction.guild));
    },
};
//# sourceMappingURL=ticketConfig.js.map