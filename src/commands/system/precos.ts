import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import {
  deferIfNeeded,
  editReplyV2,
  successContainer,
  warningContainer,
} from '../../components/reply';
import { ValidationError } from '../../core/errors';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { buildPricingPanel } from '../../modules/pricing/builders/PricingBuilder';
import {
  publishPricingPanel,
  refreshPricingPanel,
} from '../../modules/pricing/services/PricingPanelService';
import { getGuildConfig } from '../../modules/configuration/services/GuildConfigService';
import { channelUrl, isSendableTextChannel } from '../../utils/discord';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * /precos previa | enviar | atualizar
 *
 * A tabela de precos vive em `src/modules/pricing/data/priceTable.ts`. Mudou um
 * valor? Edita o arquivo, `npm run build`, reinicia e roda `/precos atualizar` —
 * a mensagem publicada e reescrita no lugar.
 *
 * `previa` existe para conferir o texto antes de ele virar publico: a tabela vai
 * para um canal aberto e um erro de digitacao ali e uma cobranca errada.
 */

const builder = new SlashCommandBuilder()
  .setName('precos')
  .setDescription('Publica e atualiza a tabela de precos da loja')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('previa')
      .setDescription('Mostra a tabela so para voce, sem publicar nada'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('enviar')
      .setDescription('Publica a tabela em um canal')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal onde a tabela sera publicada (padrao: canal atual)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('atualizar')
      .setDescription('Reescreve a tabela ja publicada com os valores atuais'),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  // O customId/permissao do Discord pode ser afrouxado por um admin na
  // interface; a checagem que vale e esta.
  assertCanManageSystem(interaction.member);

  const subcommand = interaction.options.getSubcommand();
  await deferIfNeeded(interaction, { ephemeral: true });

  if (subcommand === 'previa') {
    const config = await getGuildConfig(interaction.guildId);
    await editReplyV2(interaction, buildPricingPanel(config));
    return;
  }

  if (subcommand === 'enviar') {
    const target = interaction.options.getChannel('canal') ?? interaction.channel;
    if (!isSendableTextChannel(target)) {
      throw new ValidationError('Canal invalido para a tabela de precos.', {
        userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
      });
    }

    await publishPricingPanel(interaction.guild, target);

    await editReplyV2(
      interaction,
      successContainer(`Tabela publicada em ${channelUrl(interaction.guildId, target.id)}`, {
        footer:
          'Para mudar um valor: edite priceTable.ts, refaca o build e rode /precos atualizar.',
      }),
    );
    return;
  }

  // atualizar
  const result = await refreshPricingPanel(interaction.guild);

  await editReplyV2(
    interaction,
    result.updated
      ? successContainer('Tabela atualizada com os valores atuais.')
      : warningContainer(result.reason ?? 'Nao foi possivel atualizar a tabela.'),
  );
}

export const precosCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
