import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type GuildMember,
} from 'discord.js';

import {
  deferIfNeeded,
  replySuccess,
  replyWarning,
  sendV2,
  successContainer,
  warningContainer,
} from '../../components/reply';
import {
  buildCustomId,
  INFLUENCER_ACTION,
  NAMESPACE,
  requireArg,
  type ParsedCustomId,
} from '../../constants/customIds';
import { getEnv } from '../../config/env';
import {
  ConfigurationError,
  DiscordResourceError,
  PermissionError,
  ValidationError,
} from '../../core/errors';
import {
  assertCanManageOrders,
  canBotAssignRole,
} from '../../core/permissions/PermissionService';
import type { ButtonHandler } from '../../types';
import { fetchMemberSafe } from '../../utils/discord';

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const DEFAULT_APPROVAL_CHANNEL_ID = '1564371577686986782';
const CREATOR_ROLE_ID = '1405241505467338843';
const processingMessages = new Set<string>();

function decisionRow(discordId: string, decision: 'approved' | 'rejected') {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.INFLUENCER, INFLUENCER_ACTION.APPROVE, discordId))
      .setLabel(decision === 'approved' ? 'Aprovado' : 'Aprovar')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.INFLUENCER, INFLUENCER_ACTION.REJECT, discordId))
      .setLabel(decision === 'rejected' ? 'Reprovado' : 'Reprovar')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

function targetId(parsed: ParsedCustomId): string {
  const value = requireArg(parsed, 0, 'candidato');
  if (!DISCORD_SNOWFLAKE.test(value)) {
    throw new ValidationError('Discord ID invalido em inscricao de creator.', {
      userMessage: 'Esta inscrição possui um ID do Discord inválido.',
      context: { customId: parsed.raw },
    });
  }
  return value;
}

async function assertCanReview(interaction: ButtonInteraction): Promise<GuildMember> {
  if (!interaction.inCachedGuild()) {
    throw new PermissionError('Decisao de influencer tentada fora da guild.', {
      userMessage: 'Esta ação só pode ser realizada no servidor da loja.',
    });
  }
  const configuredChannel =
    getEnv().INFLUENCER_APPROVAL_CHANNEL_ID ?? DEFAULT_APPROVAL_CHANNEL_ID;
  if (interaction.channelId !== configuredChannel) {
    throw new PermissionError('Decisao de influencer fora do canal configurado.', {
      userMessage: 'Este botão não pertence ao canal oficial de aprovações.',
      context: { channelId: interaction.channelId, guildId: interaction.guildId },
    });
  }
  await assertCanManageOrders(interaction.member);
  return interaction.member;
}

async function notifyCandidate(
  interaction: ButtonInteraction,
  discordId: string,
  decision: 'approved' | 'rejected',
): Promise<boolean> {
  try {
    const user = await interaction.client.users.fetch(discordId);
    const dm = await user.createDM();
    const root =
      decision === 'approved'
        ? successContainer(
            'Sua inscrição para o programa de creators da Vook Store foi **aprovada**! A equipe entrará em contato para orientar os próximos passos.',
            { title: 'INSCRIÇÃO APROVADA', footer: 'Vook Store • Programa de creators' },
          )
        : warningContainer(
            'Sua inscrição para o programa de creators da Vook Store foi analisada e **não foi aprovada neste momento**. Você poderá tentar novamente em uma futura seleção.',
            { title: 'RESULTADO DA INSCRIÇÃO', footer: 'Vook Store • Programa de creators' },
          );
    await sendV2(dm, root);
    return true;
  } catch {
    return false;
  }
}

async function assignCreatorRole(reviewer: GuildMember, discordId: string): Promise<void> {
  const guild = reviewer.guild;
  const candidate = await fetchMemberSafe(guild, discordId);
  if (candidate === null) {
    const inviteUrl = getEnv().DISCORD_STORE_INVITE_URL;
    let inviteSent = false;
    if (inviteUrl !== null) {
      try {
        const user = await reviewer.client.users.fetch(discordId);
        const dm = await user.createDM();
        await sendV2(
          dm,
          warningContainer(
            `Sua inscrição para o programa de creators da Vook Store foi analisada, mas você ainda não está em nosso servidor.\n\nEntre pelo convite oficial e avise a equipe para concluir sua aprovação:\n${inviteUrl}`,
            { title: 'ENTRE NO DISCORD DA VOOK STORE', footer: 'Vook Store • Programa de creators' },
          ),
        );
        inviteSent = true;
      } catch {
        // A resposta ao avaliador abaixo informa quando a DM esta bloqueada.
      }
    }
    throw new ValidationError('Candidato aprovado nao esta no servidor.', {
      userMessage: inviteSent
        ? 'O candidato ainda não está no servidor. Enviei o convite por DM; tente aprovar novamente depois que ele entrar.'
        : inviteUrl === null
          ? 'O candidato não está no servidor e DISCORD_STORE_INVITE_URL ainda não foi configurado.'
          : 'O candidato não está no servidor e não aceita DMs. Envie o convite por outro meio.',
      context: { discordId, guildId: guild.id },
    });
  }
  if (candidate.roles.cache.has(CREATOR_ROLE_ID)) return;

  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  const assignable = canBotAssignRole(botMember, CREATOR_ROLE_ID);
  if (!assignable.ok) {
    throw new ConfigurationError('Bot nao consegue atribuir o cargo de creator.', {
      userMessage: `Não foi possível aprovar: ${assignable.reason ?? 'o bot não consegue atribuir o cargo de creator.'}`,
      context: { roleId: CREATOR_ROLE_ID, guildId: guild.id },
    });
  }

  try {
    await candidate.roles.add(CREATOR_ROLE_ID, 'Inscrição de creator aprovada pela equipe');
  } catch (cause) {
    throw new DiscordResourceError('Falha ao atribuir cargo de creator ao candidato.', {
      userMessage:
        'Não foi possível aprovar porque o Discord recusou a atribuição do cargo de creator.',
      context: { discordId, roleId: CREATOR_ROLE_ID, guildId: guild.id },
      cause,
    });
  }
}

async function decide(
  interaction: ButtonInteraction,
  parsed: ParsedCustomId,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const reviewer = await assertCanReview(interaction);
  const discordId = targetId(parsed);

  if (processingMessages.has(interaction.message.id)) {
    await replyWarning(interaction, 'Esta inscrição já está sendo processada por outra pessoa.');
    return;
  }
  processingMessages.add(interaction.message.id);

  try {
    await deferIfNeeded(interaction, { ephemeral: true });
    if (decision === 'approved') {
      await assignCreatorRole(reviewer, discordId);
    }
    const dmSent = await notifyCandidate(interaction, discordId, decision);
    const original = interaction.message.embeds[0];
    const label = decision === 'approved' ? 'APROVADA' : 'REPROVADA';
    const roleResult =
      decision === 'approved' ? `\nCargo <@&${CREATOR_ROLE_ID}> atribuído.` : '';
    const result = `**${label}** por <@${interaction.user.id}>${roleResult}\nDM ${dmSent ? 'enviada com sucesso' : 'não entregue'}.`;
    const embed = original === undefined ? new EmbedBuilder() : EmbedBuilder.from(original);
    embed
      .setColor(0xffffff)
      .addFields({ name: 'Resultado', value: result })
      .setFooter({
        text: `${original?.footer?.text ?? 'Inscrição de creator'} • ${label}`,
      });

    await interaction.message.edit({
      embeds: [embed],
      components: [decisionRow(discordId, decision)],
      allowedMentions: { parse: [] },
    });

    if (dmSent) {
      await replySuccess(
        interaction,
        decision === 'approved'
          ? `Inscrição aprovada, cargo atribuído e candidato notificado por DM.`
          : `Inscrição reprovada e candidato notificado por DM.`,
      );
    } else {
      await replyWarning(
        interaction,
        decision === 'approved'
          ? 'Inscrição aprovada e cargo atribuído, mas o Discord bloqueou a DM. Avise o candidato por outro canal.'
          : 'Inscrição reprovada, mas o Discord bloqueou a DM. Avise o candidato por outro canal.',
      );
    }
  } finally {
    processingMessages.delete(interaction.message.id);
  }
}

const approveButton: ButtonHandler = {
  namespace: NAMESPACE.INFLUENCER,
  action: INFLUENCER_ACTION.APPROVE,
  async handle(interaction, parsed): Promise<void> {
    await decide(interaction, parsed, 'approved');
  },
};

const rejectButton: ButtonHandler = {
  namespace: NAMESPACE.INFLUENCER,
  action: INFLUENCER_ACTION.REJECT,
  async handle(interaction, parsed): Promise<void> {
    await decide(interaction, parsed, 'rejected');
  },
};

export const influencerButtons: ButtonHandler[] = [approveButton, rejectButton];
