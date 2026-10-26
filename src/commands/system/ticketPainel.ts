import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, replyInfo, replySuccess, replyWarning } from '../../components/reply';
import { ConfigurationError, ValidationError } from '../../core/errors';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { publishLocatorPanels } from '../../modules/tickets/services/TicketLocatorService';
import { isSendableTextChannel } from '../../utils/discord';
import { getEnabledCategories } from '../../modules/tickets/services/TicketConfigService';
import {
  publishPanel,
  refreshPublicPanel,
  removePanel,
} from '../../modules/tickets/services/TicketPanelService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/** /ticket-painel enviar | atualizar | remover */

const builder = new SlashCommandBuilder()
  .setName('ticket-painel')
  .setDescription('Gerencia o painel publico de atendimento')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('enviar')
      .setDescription('Publica o painel publico em um canal')
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
      .setDescription('Reconstroi o painel ja publicado (edita a mesma mensagem)'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('remover').setDescription('Remove o painel publico'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('localizadores')
      .setDescription(
        'Publica o painel "Localizar meu ticket" no canal de cada categoria e acerta as permissoes',
      ),
  );

/**
 * Relatorio do `localizadores`.
 *
 * Uma linha por categoria, dizendo o que aconteceu com cada uma. Um "pronto"
 * generico esconderia justamente o caso que importa — a categoria que ficou de
 * fora por falta de canal ou de permissao.
 */
function describeLocatorReport(
  entries: Awaited<ReturnType<typeof publishLocatorPanels>>,
): string {
  if (entries.length === 0) {
    return 'Nenhuma categoria ativa. Cadastre uma em `/ticket-categorias gerenciar`.';
  }

  const lines = entries.map((entry) => {
    if (entry.published) {
      const roles =
        entry.missingRoles.length > 0
          ? ` — ${entry.missingRoles.length} cargo(s) de equipe ja nao existem`
          : '';
      return `✅ **${entry.categoryName}** — painel em <#${entry.channelId ?? ''}>${roles}`;
    }

    const faltando =
      entry.missingPermissions.length > 0
        ? `\n-# Faltam ao bot: ${entry.missingPermissions.join(', ')}.`
        : '';
    return `⚠️ **${entry.categoryName}** — ${entry.reason ?? 'nao publicado'}${faltando}`;
  });

  return lines.join('\n');
}

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  assertCanManageSystem(interaction.member);
  const subcommand = interaction.options.getSubcommand(true);

  /*
   * DEFER ANTES DE QUALQUER SUBCOMANDO.
   *
   * O Discord invalida a interacao em 3 segundos, e TODO caminho daqui faz
   * chamada REST: publicar, editar ou apagar mensagem, e no caso de
   * `localizadores` uma volta inteira por categoria — permissoes do canal,
   * um overwrite por cliente com ticket aberto e a mensagem do painel. Isso
   * passa dos 3s com facilidade, e a resposta morria com 10062 DEPOIS de o
   * trabalho ja ter sido feito: os paineis iam para o canal e o operador via
   * "O aplicativo nao respondeu", sem saber que dera certo.
   *
   * `replySuccess`/`replyWarning` enxergam o defer e caem em `editReply`.
   */
  await deferIfNeeded(interaction, { ephemeral: true });

  if (subcommand === 'localizadores') {
    /*
     * Este e o comando que tambem ACERTA AS PERMISSOES do canal de destino.
     * As duas coisas andam juntas de proposito: um painel publicado num canal
     * onde a equipe nao enxerga topico nao leva a lugar nenhum, e mexer em
     * permissao de canal alheio so pode acontecer por acao explicita do
     * administrador — nunca no meio de um atendimento.
     */
    const entries = await publishLocatorPanels(interaction.guild);
    const ok = entries.filter((entry) => entry.published).length;

    if (ok === entries.length && ok > 0) {
      await replySuccess(interaction, describeLocatorReport(entries));
      return;
    }
    await replyWarning(interaction, describeLocatorReport(entries));
    return;
  }

  if (subcommand === 'enviar') {
    const target = interaction.options.getChannel('canal') ?? interaction.channel;
    if (!isSendableTextChannel(target)) {
      throw new ValidationError('Canal invalido para o painel.', {
        userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
      });
    }

    const categories = await getEnabledCategories(interaction.guildId);
    if (categories.length === 0) {
      throw new ConfigurationError('Nenhuma categoria ativa.', {
        userMessage:
          'Cadastre ao menos uma categoria ativa em `/ticket-categorias gerenciar` antes de publicar o painel.',
      });
    }

    const message = await publishPanel(interaction.guild, target);
    await replySuccess(
      interaction,
      `Painel publicado em <#${target.id}>.\n[Ir para o painel](${message.url})`,
    );
    return;
  }

  if (subcommand === 'atualizar') {
    const result = await refreshPublicPanel(interaction.guild);
    if (result.updated) {
      await replySuccess(
        interaction,
        result.reason ?? 'Painel publico atualizado com a configuracao atual.',
      );
      return;
    }
    await replyWarning(
      interaction,
      result.reason ?? 'Nao foi possivel atualizar o painel publico.',
    );
    return;
  }

  const removed = await removePanel(interaction.guild);
  if (removed) {
    await replySuccess(interaction, 'Painel publico removido.');
    return;
  }
  await replyInfo(
    interaction,
    'Nenhuma mensagem de painel foi encontrada. A configuracao foi limpa mesmo assim.',
  );
}

export const ticketPainelCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
