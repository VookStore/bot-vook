import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, editReplyV2 } from '../../components/reply';
import { ValidationError } from '../../core/errors';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { buildConfigMenu } from '../../modules/configuration/builders/ConfigBuilders';
import { getGuildConfig } from '../../modules/configuration/services/GuildConfigService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * /ticket-config geral — painel de configuracao geral da guild.
 *
 * A permissao padrao do comando (ManageGuild) apenas esconde o comando de quem
 * nao pode usa-lo; a autorizacao real e sempre revalidada aqui e em cada
 * componente do painel.
 */

const SUBCOMMAND_GENERAL = 'geral';

export const ticketConfigCommand: SlashCommandDefinition = {
  builder: new SlashCommandBuilder()
    .setName('ticket-config')
    .setDescription('Configuracoes gerais da Vook Store neste servidor.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName(SUBCOMMAND_GENERAL)
        .setDescription('Abre o painel de configuracao geral (canais, auto-role, visual, limites).'),
    ),

  guildOnly: true,

  async execute(interaction: GuildChatInputInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== SUBCOMMAND_GENERAL) {
      throw new ValidationError(`Subcomando desconhecido em /ticket-config: ${subcommand}`, {
        userMessage: 'Use `/ticket-config geral` para abrir o painel de configuracao.',
      });
    }

    assertCanManageSystem(interaction.member);

    await deferIfNeeded(interaction, { ephemeral: true });

    const config = await getGuildConfig(interaction.guildId);
    await editReplyV2(interaction, buildConfigMenu(config, interaction.guild));
  },
};
