import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';

import {
  deferIfNeeded,
  editReplyV2,
  replyInfo,
  replySuccess,
  replyWarning,
  successContainer,
} from '../../components/reply';
import { ConfigurationError, ValidationError } from '../../core/errors';
import {
  assertCanManageCatalog,
  canManageCatalog,
} from '../../core/permissions/PermissionService';
import { DISCORD_LIMITS } from '../../constants/limits';
import { truncate } from '../../utils/sanitize';
import { isSendableTextChannel } from '../../utils/discord';
import {
  publishCatalogPanel,
  refreshCatalogPanel,
  removeCatalogPanel,
} from '../../modules/catalog/services/CatalogPanelService';
import {
  getCatalogCategories,
  getEnabledCatalogCategories,
  setCategoryLeadTime,
} from '../../modules/catalog/services/CatalogCategoryService';
import { listVisiblePacks } from '../../modules/catalog/services/CatalogService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * `/catalogo-painel enviar | atualizar | remover`.
 *
 * Espelha o `/ticket-painel`: o par (canal, mensagem) fica salvo, entao
 * "atualizar" EDITA o painel existente em vez de publicar outro. Um catalogo
 * que duplica o painel a cada alteracao vira poluicao no canal.
 */

const builder = new SlashCommandBuilder()
  .setName('catalogo-painel')
  .setDescription('Gerencia o painel publico do catalogo')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('enviar')
      .setDescription('Publica o painel do catalogo em um canal')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal onde o painel sera publicado (padrao: canal atual)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('atualizar')
      .setDescription('Reconstroi o painel publicado (edita a mesma mensagem)'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('remover').setDescription('Remove o painel publico do catalogo'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('prazo')
      .setDescription('Define o prazo de producao de uma categoria, em dias uteis')
      .addStringOption((option) =>
        option
          .setName('categoria')
          .setDescription('Categoria do catalogo')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('dias')
          .setDescription('Dias uteis de producao. 0 remove o prazo da categoria.')
          .setMinValue(0)
          .setMaxValue(365)
          .setRequired(true),
      ),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  assertCanManageCatalog(interaction.member);
  const subcommand = interaction.options.getSubcommand(true);

  /*
   * Mesmo motivo do `/ticket-painel`: todo subcomando daqui publica, reescreve
   * ou apaga uma mensagem antes de responder, e a interacao expira em 3
   * segundos. Sem o defer, a operacao dava certo e o operador via
   * "O aplicativo nao respondeu".
   */
  await deferIfNeeded(interaction, { ephemeral: true });

  if (subcommand === 'prazo') {
    const categoryId = interaction.options.getString('categoria', true);
    const dias = interaction.options.getInteger('dias', true);

    /*
     * 0 REMOVE o prazo em vez de significar "entrega hoje". Prometer entrega no
     * mesmo dia por engano de digitacao seria muito pior que ficar sem previsao,
     * e ninguem cadastra producao de zero dia de proposito.
     */
    const aplicado = await setCategoryLeadTime(
      interaction.guildId,
      categoryId,
      dias === 0 ? null : dias,
    );

    if (!aplicado) {
      throw new ValidationError(`Categoria inexistente: ${categoryId}`, {
        userMessage: 'Categoria nao encontrada. Escolha uma da lista.',
      });
    }

    await editReplyV2(
      interaction,
      successContainer(
        dias === 0
          ? 'Prazo removido: esta categoria volta a nao gerar previsao de entrega.'
          : `Prazo definido: **${dias} dia(s) util(eis)** de producao.`,
        {
          footer:
            'Vale para as proximas vendas. Pedidos ja pagos mantem a previsao que foi prometida.',
        },
      ),
    );
    return;
  }

  if (subcommand === 'enviar') {
    const target = interaction.options.getChannel('canal') ?? interaction.channel;
    if (!isSendableTextChannel(target)) {
      throw new ValidationError('Canal invalido para o painel do catalogo.', {
        userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
      });
    }

    const [categories, packs] = await Promise.all([
      getEnabledCatalogCategories(interaction.guildId),
      listVisiblePacks(interaction.guildId),
    ]);

    if (categories.length === 0 || packs.length === 0) {
      throw new ConfigurationError('Catalogo vazio.', {
        userMessage:
          'Cadastre ao menos uma categoria ativa e um pack ativo em `/catalogo gerenciar` antes de publicar o painel.',
      });
    }

    const message = await publishCatalogPanel(interaction.guild, target);
    await replySuccess(
      interaction,
      `Painel do catalogo publicado em <#${target.id}>.\n[Ir para o painel](${message.url})`,
    );
    return;
  }

  if (subcommand === 'atualizar') {
    const result = await refreshCatalogPanel(interaction.guild);
    if (result.updated) {
      await replySuccess(
        interaction,
        result.reason ?? 'Painel do catalogo atualizado com os produtos atuais.',
      );
      return;
    }
    await replyWarning(
      interaction,
      result.reason ?? 'Nao foi possivel atualizar o painel do catalogo.',
    );
    return;
  }

  const removed = await removeCatalogPanel(interaction.guild);
  if (removed) {
    await replySuccess(interaction, 'Painel do catalogo removido.');
    return;
  }
  await replyInfo(
    interaction,
    'Nenhuma mensagem de painel foi encontrada. A configuracao foi limpa mesmo assim.',
  );
}

/**
 * Autocomplete das categorias, com o prazo atual no rotulo.
 *
 * Mostrar o prazo vigente ao lado do nome evita o erro mais provavel aqui:
 * redefinir uma categoria que ja estava certa por nao lembrar quanto era.
 *
 * Revalida a permissao — autocomplete e uma interacao separada, e o
 * `setDefaultMemberPermissions` e apenas visual.
 */
async function autocomplete(interaction: AutocompleteInteraction<'cached'>): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'categoria' || !canManageCatalog(interaction.member)) {
    await interaction.respond([]);
    return;
  }

  const query = focused.value.toLowerCase().trim();
  const categories = await getCatalogCategories(interaction.guildId);

  await interaction.respond(
    categories
      .filter((category) => category.deletedAt === null)
      .filter((category) => query.length === 0 || category.name.toLowerCase().includes(query))
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_CHOICES)
      .map((category) => ({
        name: truncate(
          `${category.name}${
            category.leadTimeDays === null ? ' (sem prazo)' : ` (${category.leadTimeDays}d)`
          }`,
          100,
        ),
        value: category.id,
      })),
  );
}

export const catalogoPainelCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
  autocomplete,
};
