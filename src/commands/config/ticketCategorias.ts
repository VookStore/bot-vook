import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, editReplyV2 } from '../../components/reply';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { renderCategoryMenu } from '../../interactions/categories';
import type { SlashCommandDefinition } from '../../types';

/**
 * `/ticket-categorias gerenciar`
 *
 * Abre o painel administrativo das categorias de atendimento (criar, editar,
 * reordenar, ativar/desativar e excluir). A resposta e sempre efemera: e uma
 * tela de configuracao, nao deve poluir o canal.
 */

const builder = new SlashCommandBuilder()
  .setName('ticket-categorias')
  .setDescription('Gerencia as categorias de atendimento da Vook Store.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('gerenciar')
      .setDescription('Abre o painel de categorias de atendimento.'),
  );

export const ticketCategoriasCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  async execute(interaction) {
    // A permissao do comando no Discord e apenas a primeira barreira.
    assertCanManageSystem(interaction.member);
    await deferIfNeeded(interaction, { ephemeral: true });
    await editReplyV2(interaction, await renderCategoryMenu(interaction.guildId));
  },
};
