import { SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded } from '../../components/reply';
import { renderCustomerOrdersForCommand } from '../../interactions/orders';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * `/meus-pedidos` — historico do proprio cliente.
 *
 * O comando nunca aceita "cliente" como parametro: cada pessoa ve apenas os
 * proprios pedidos. A equipe consulta pedidos por `/pedidos gerenciar`.
 */

const builder = new SlashCommandBuilder()
  .setName('meus-pedidos')
  .setDescription('Mostra os seus pedidos na Vook Store')
  .setDMPermission(false);

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  await deferIfNeeded(interaction, { ephemeral: true });
  await renderCustomerOrdersForCommand(interaction, interaction.guildId, interaction.user.id, 1);
}

export const meusPedidosCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
