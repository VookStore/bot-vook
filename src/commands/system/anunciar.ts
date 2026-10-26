import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { ValidationError } from '../../core/errors';
import { isSendableTextChannel } from '../../utils/discord';
import { buildAnnouncementModal } from '../../modules/announcements/builders/AnnouncementBuilders';
import { createDraft } from '../../modules/announcements/services/AnnouncementDraftService';
import { resolveAnnouncementChannel } from '../../modules/announcements/services/AnnouncementService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * `/anunciar [canal] [embed]`
 *
 * Abre o formulario do anuncio e devolve uma PREVIA efemera, onde o autor
 * acrescenta botoes de link e publica. Nada e enviado ao canal antes do clique
 * em "Publicar": um anuncio publicado nao tem como ser desfeito, e a mensagem
 * ja fica lida por quem estava no canal.
 *
 * O canal e conferido AQUI, antes de o formulario abrir. Descobrir que o bot
 * nao pode escrever no canal depois de digitar o anuncio inteiro custaria o
 * texto — o modal nao guarda nada se o envio falhar.
 */

const builder = new SlashCommandBuilder()
  .setName('anunciar')
  .setDescription('Monta e publica um anuncio, com ou sem embed')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName('canal')
      .setDescription('Canal onde o anuncio sera publicado (padrao: canal atual)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option
      .setName('embed')
      .setDescription('Com embed (titulo, imagens, rodape) ou mensagem de texto simples')
      .setRequired(false),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  assertCanManageSystem(interaction.member);

  const target = interaction.options.getChannel('canal') ?? interaction.channel;
  if (!isSendableTextChannel(target)) {
    throw new ValidationError('Canal invalido para anuncio.', {
      userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
    });
  }

  // Revalida existencia e permissoes do bot antes de abrir o formulario.
  await resolveAnnouncementChannel(interaction.guild, target.id);

  const draft = createDraft({
    guildId: interaction.guildId,
    channelId: target.id,
    createdById: interaction.user.id,
    // Embed e o padrao: e o formato que o pedido descreve e o que a loja usa.
    withEmbed: interaction.options.getBoolean('embed') ?? true,
  });

  // `showModal` precisa ser a PRIMEIRA resposta da interacao — nada de defer.
  await interaction.showModal(buildAnnouncementModal(draft));
}

export const anunciarCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
