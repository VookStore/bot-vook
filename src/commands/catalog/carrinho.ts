import { SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded } from '../../components/reply';
import { renderCartForCommand } from '../../interactions/cart';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * `/carrinho` — atalho para o proprio carrinho.
 *
 * Sempre efemero: o carrinho e informacao do cliente e nunca vira conteudo do
 * canal. E aqui NAO existe campo de cupom — desconto e decisao da equipe.
 */

const builder = new SlashCommandBuilder()
  .setName('carrinho')
  .setDescription('Mostra o seu carrinho da Vook Store')
  .setDMPermission(false);

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  await deferIfNeeded(interaction, { ephemeral: true });
  await renderCartForCommand(interaction, interaction.guildId, interaction.user.id);
}

export const carrinhoCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
