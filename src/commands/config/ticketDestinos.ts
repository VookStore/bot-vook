import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, editReplyV2 } from '../../components/reply';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { renderDestinationPanel } from '../../interactions/categories';
import type { SlashCommandDefinition } from '../../types';

/**
 * `/ticket-destinos configurar`
 *
 * Define, para cada categoria de atendimento, em qual categoria fisica do
 * Discord os canais de ticket serao criados.
 */

const builder = new SlashCommandBuilder()
  .setName('ticket-destinos')
  .setDescription('Define onde os canais de ticket de cada categoria serao criados.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('configurar')
      .setDescription('Abre o painel de destinos das categorias.'),
  );

export const ticketDestinosCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  async execute(interaction) {
    assertCanManageSystem(interaction.member);
    await deferIfNeeded(interaction, { ephemeral: true });
    await editReplyV2(interaction, await renderDestinationPanel(interaction.guild));
  },
};
