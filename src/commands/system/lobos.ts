import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import {
  deferIfNeeded,
  editReplyV2,
  successContainer,
  warningContainer,
} from '../../components/reply';
import { ValidationError } from '../../core/errors';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { getGuildConfig } from '../../modules/configuration/services/GuildConfigService';
import {
  publishWolfPanel,
  refreshWolfPanel,
  setPortfolioChannel,
} from '../../modules/wolves/services/WolfPortfolioService';
import {
  describeRenderMaxSize,
  effectiveRenderLimit,
} from '../../modules/wolves/validators/render';
import { isAssetHostingEnabled } from '../../modules/hosting/AssetHostingService';
import { channelMention, channelUrl, isSendableTextChannel } from '../../utils/discord';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * /lobos painel | portfolio | atualizar
 *
 * Configuracao do portfolio de lobos. Quem PUBLICA um lobo e a equipe, pelo
 * botao do painel; este comando so decide onde o painel fica e para onde os
 * posts vao — e por isso exige administracao.
 *
 * Ordem da primeira vez: `/lobos portfolio` (destino) e `/lobos painel` (no
 * canal da equipe). Em qualquer ordem funciona: o painel publicado antes do
 * destino sai com o botao desligado e se liga sozinho quando o destino e
 * definido.
 */

const builder = new SlashCommandBuilder()
  .setName('lobos')
  .setDescription('Painel da equipe e canal do portfolio de lobos')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('painel')
      .setDescription('Publica o painel de criacao de anuncios de lobos')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal da equipe onde o painel fica (padrao: canal atual)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('portfolio')
      .setDescription('Define o canal onde os lobos sao publicados')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal publico do portfolio')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('atualizar')
      .setDescription('Reescreve o painel ja publicado'),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  // A permissao do comando pode ser afrouxada por um admin na interface do
  // Discord; a checagem que vale e esta.
  assertCanManageSystem(interaction.member);

  const subcommand = interaction.options.getSubcommand();
  await deferIfNeeded(interaction, { ephemeral: true });

  // Teto do render NESTE servidor (loja x nivel de impulsos), para o painel
  // mostrar o numero que o formulario vai de fato aceitar.
  const maxRenderBytes = effectiveRenderLimit(interaction.guild, isAssetHostingEnabled());

  if (subcommand === 'painel') {
    const target = interaction.options.getChannel('canal') ?? interaction.channel;
    if (!isSendableTextChannel(target)) {
      throw new ValidationError('Canal invalido para o painel de lobos.', {
        userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
      });
    }

    await publishWolfPanel(interaction.guild, target, maxRenderBytes);
    const config = await getGuildConfig(interaction.guildId);

    await editReplyV2(
      interaction,
      successContainer(`Painel publicado em ${channelUrl(interaction.guildId, target.id)}`, {
        footer:
          config.wolfPortfolioChannelId === null
            ? 'O botao esta desligado: defina o destino com /lobos portfolio e ele se liga sozinho.'
            : 'Os posts saem no canal do portfolio. Para trocar, use /lobos portfolio.',
      }),
    );
    return;
  }

  if (subcommand === 'portfolio') {
    const target = interaction.options.getChannel('canal', true);
    if (!isSendableTextChannel(target)) {
      throw new ValidationError('Canal invalido para o portfolio de lobos.', {
        userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
      });
    }

    const refresh = await setPortfolioChannel(interaction.guild, target, maxRenderBytes);

    await editReplyV2(
      interaction,
      successContainer(`Os lobos passam a ser publicados em ${channelMention(target.id)}.`, {
        footer: refresh.updated
          ? 'O painel da equipe foi atualizado com o novo destino.'
          : 'O painel ainda nao foi publicado. Use /lobos painel no canal da equipe.',
      }),
    );
    return;
  }

  // atualizar
  const result = await refreshWolfPanel(interaction.guild, maxRenderBytes);
  await editReplyV2(
    interaction,
    result.updated
      ? successContainer('Painel de lobos atualizado.', {
          footer: `Renders de ate ${describeRenderMaxSize(maxRenderBytes)} neste servidor.`,
        })
      : warningContainer(result.reason ?? 'Nao foi possivel atualizar o painel.'),
  );
}

export const lobosCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
