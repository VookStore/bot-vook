import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, editReplyV2 } from '../../components/reply';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { renderTeamPanel } from '../../interactions/categories';
import type { SlashCommandDefinition } from '../../types';

/**
 * `/ticket-equipe configurar`
 *
 * Define quais cargos sao responsaveis por cada categoria de atendimento —
 * quem pode assumir, administrar e encerrar os tickets daquele setor.
 */

const builder = new SlashCommandBuilder()
  .setName('ticket-equipe')
  .setDescription('Define os cargos responsaveis por cada categoria de atendimento.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('configurar')
      .setDescription('Abre o painel de equipes das categorias.'),
  );

export const ticketEquipeCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  async execute(interaction) {
    assertCanManageSystem(interaction.member);
    await deferIfNeeded(interaction, { ephemeral: true });
    await editReplyV2(interaction, await renderTeamPanel(interaction.guild));
  },
};
