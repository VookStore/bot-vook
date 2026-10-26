import { SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded } from '../../components/reply';
import { BUSINESS_LIMITS } from '../../constants/limits';
import { ValidationError } from '../../core/errors';
import { assertCanManageCatalog } from '../../core/permissions/PermissionService';
import {
  renderAdminPanelForCommand,
  renderHomeForCommand,
  renderSearchResults,
} from '../../interactions/catalog';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * `/catalogo` — a loja da Vook Store dentro do Discord.
 *
 * Para o CLIENTE o comando abre a vitrine (`ver`), sempre em resposta efemera:
 * carrinho e pedidos sao dados do cliente e nao viram conteudo do canal.
 *
 * `gerenciar` e administracao e revalida a permissao no `execute` — a permissao
 * padrao do comando apenas esconde a opcao, ela nao autoriza nada.
 */

const SUB = {
  VIEW: 'ver',
  SEARCH: 'buscar',
  MANAGE: 'gerenciar',
} as const;

const builder = new SlashCommandBuilder()
  .setName('catalogo')
  .setDescription('Catalogo de packs da Vook Store')
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand.setName(SUB.VIEW).setDescription('Abre a loja e navega pelos packs disponiveis'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName(SUB.SEARCH)
      .setDescription('Procura um pack por nome, SKU ou descricao')
      .addStringOption((option) =>
        option
          .setName('termo')
          .setDescription('O que voce procura. Ex.: veiculos')
          .setRequired(true)
          .setMinLength(BUSINESS_LIMITS.CATALOG_SEARCH_MIN)
          .setMaxLength(BUSINESS_LIMITS.CATALOG_SEARCH_MAX),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName(SUB.MANAGE)
      .setDescription('[Equipe] Painel de administracao do catalogo'),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === SUB.VIEW) {
    await deferIfNeeded(interaction, { ephemeral: true });
    await renderHomeForCommand(interaction, interaction.guildId);
    return;
  }

  if (subcommand === SUB.SEARCH) {
    await deferIfNeeded(interaction, { ephemeral: true });
    await renderSearchResults(
      interaction,
      interaction.guildId,
      interaction.options.getString('termo', true),
    );
    return;
  }

  if (subcommand === SUB.MANAGE) {
    assertCanManageCatalog(interaction.member);
    await deferIfNeeded(interaction, { ephemeral: true });
    await renderAdminPanelForCommand(interaction, interaction.guildId);
    return;
  }

  throw new ValidationError(`Subcomando de catalogo desconhecido: ${subcommand}`, {
    userMessage: 'Este subcomando nao existe. Use `/catalogo ver`.',
    context: { guildId: interaction.guildId, userId: interaction.user.id },
  });
}

export const catalogoCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
