import {
  ChannelType,
  DiscordAPIError,
  GuildPremiumTier,
  HTTPError,
  RESTJSONErrorCodes,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type MessageMentionOptions,
  type AnyThreadChannel,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';

import { DISCORD_LIMITS } from '../constants/limits';

/**
 * Utilitarios de Discord.
 *
 * REGRA: toda mensagem enviada pelo bot define `allowedMentions` explicitamente.
 * O padrao e NAO mencionar ninguem; mencoes sao liberadas caso a caso.
 */

/** Nenhuma mencao dispara notificacao. Padrao para paineis e textos configuraveis. */
export const NO_MENTIONS: MessageMentionOptions = { parse: [], users: [], roles: [] };

/** Permite notificar exatamente um usuario (cliente do ticket). */
export function mentionOnly(userId: string): MessageMentionOptions {
  return { parse: [], users: [userId], roles: [] };
}

/** Permite notificar uma lista fechada de usuarios. */
export function mentionUsers(userIds: readonly string[]): MessageMentionOptions {
  return { parse: [], users: [...new Set(userIds)], roles: [] };
}

/** Permite notificar cargos especificos (equipe da categoria). */
export function mentionRoles(roleIds: readonly string[]): MessageMentionOptions {
  return { parse: [], users: [], roles: [...new Set(roleIds)] };
}

/** Link direto para o canal: https://discord.com/channels/GUILD/CHANNEL */
export function channelUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

/** Link direto para uma mensagem. */
export function messageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export function userMention(userId: string): string {
  return `<@${userId}>`;
}

export function roleMention(roleId: string): string {
  return `<@&${roleId}>`;
}

export function channelMention(channelId: string): string {
  return `<#${channelId}>`;
}

/**
 * Canal de guild onde o bot pode publicar e reler mensagens.
 * Inclui canais de anuncio: e comum configurar logs/avaliacoes/boas-vindas
 * em um canal de anuncio, e recusa-lo silenciosamente confundiria o operador.
 */
export type SendableGuildChannel = TextChannel | NewsChannel;

/** Type guard: canal de texto de guild onde o bot pode enviar mensagens. */
export function isSendableTextChannel(
  channel: GuildBasedChannel | null | undefined,
): channel is SendableGuildChannel {
  return (
    channel !== null &&
    channel !== undefined &&
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) &&
    channel.isTextBased()
  );
}

/**
 * Onde uma CONVERSA acontece: canal de texto ou topico.
 *
 * Existe separado de `isSendableTextChannel` de proposito. Aquele guarda
 * DESTINOS DE CONFIGURACAO — canal de logs, de avaliacoes, de boas-vindas, o
 * alvo de um anuncio — e la topico continua sendo resposta errada.
 *
 * Este guarda o lugar onde se fala com o cliente. Desde que o ticket virou
 * topico privado, exigir canal de texto ali passou a recusar o proprio
 * atendimento: publicar a cobranca dentro do ticket morria com "Nao foi
 * possivel enviar a cobranca neste canal", que e o oposto do que o vendedor
 * acabara de pedir.
 */
export type SendableConversation = SendableGuildChannel | AnyThreadChannel;

/**
 * O ramo do TOPICO decide so pelo tipo, sem chamar `channel.isThread()`.
 *
 * A primeira versao perguntava pelo metodo e derrubava com `TypeError` sobre
 * qualquer objeto que nao fosse um canal completo do discord.js — o que inclui
 * as fixtures dos testes. Um type guard precisa responder `false`, nunca
 * estourar.
 */
export function isSendableConversation(
  channel: GuildBasedChannel | null | undefined,
): channel is SendableConversation {
  if (channel === null || channel === undefined) return false;
  if (isSendableTextChannel(channel)) return true;
  return (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
}

/**
 * Busca um canal por ID sem lancar quando ele nao existe mais.
 * Retorna null tambem quando o canal foi apagado ou o bot perdeu acesso.
 */
export async function fetchChannelSafe(
  guild: Guild,
  channelId: string | null | undefined,
): Promise<GuildBasedChannel | null> {
  if (channelId === null || channelId === undefined || channelId.length === 0) return null;
  try {
    const cached = guild.channels.cache.get(channelId);
    if (cached !== undefined) return cached;
    return await guild.channels.fetch(channelId);
  } catch (error) {
    if (isUnknownResourceError(error)) return null;
    if (isMissingAccessError(error)) return null;
    throw error;
  }
}

/** Busca um membro sem lancar quando ele saiu do servidor. */
export async function fetchMemberSafe(
  guild: Guild,
  userId: string,
): Promise<GuildMember | null> {
  try {
    const cached = guild.members.cache.get(userId);
    if (cached !== undefined) return cached;
    return await guild.members.fetch(userId);
  } catch (error) {
    if (isUnknownResourceError(error)) return null;
    throw error;
  }
}

/** True quando o recurso do Discord nao existe mais (canal/mensagem/membro). */
export function isUnknownResourceError(error: unknown): boolean {
  if (!(error instanceof DiscordAPIError)) return false;
  return (
    error.code === RESTJSONErrorCodes.UnknownChannel ||
    error.code === RESTJSONErrorCodes.UnknownMessage ||
    error.code === RESTJSONErrorCodes.UnknownMember ||
    error.code === RESTJSONErrorCodes.UnknownUser ||
    error.code === RESTJSONErrorCodes.UnknownRole ||
    error.code === RESTJSONErrorCodes.UnknownGuild ||
    error.code === RESTJSONErrorCodes.UnknownInteraction
  );
}

/** True quando falta permissao/acesso. */
export function isMissingAccessError(error: unknown): boolean {
  if (!(error instanceof DiscordAPIError)) return false;
  return (
    error.code === RESTJSONErrorCodes.MissingAccess ||
    error.code === RESTJSONErrorCodes.MissingPermissions
  );
}

/**
 * True quando o Discord recusou o envio por TAMANHO.
 *
 * Chega de dois jeitos, e os DOIS como `DiscordAPIError`: com `code` 40005
 * quando a API responde em JSON, ou so com `status` 413 quando quem recusa e a
 * borda antes de a API ler o corpo — nesse caso o corpo nao e JSON e o
 * @discordjs/rest preenche apenas o status. O ramo de `HTTPError` fica como
 * rede de seguranca para versoes que classifiquem diferente; na 2.6.x ele nao
 * e alcancado.
 */
export function isPayloadTooLargeError(error: unknown): boolean {
  if (error instanceof DiscordAPIError) {
    return error.code === RESTJSONErrorCodes.RequestEntityTooLarge || error.status === 413;
  }
  return error instanceof HTTPError && error.status === 413;
}

/**
 * Maior anexo que o BOT pode enviar neste servidor.
 *
 * O limite vem so do nivel de impulsos: bot nao tem Nitro. Nivel 3 libera
 * 100 MiB, nivel 2 libera 50 MiB, e abaixo disso vale o padrao de 20 MiB
 * (`DISCORD_LIMITS.ATTACHMENT_BYTES_DEFAULT`; nivel 1 nao sobe o teto).
 *
 * FONTES. Os 20 MiB estao na referencia da API ("Uploading Files",
 * docs.discord.com/developers/reference). Os 50/100 MiB por nivel NAO estao la —
 * vem da FAQ de impulsos (support.discord.com/hc/articles/360028038352). Por
 * isso quem usa este teto precisa tratar 40005 mesmo assim
 * (`isPayloadTooLargeError`): se a tabela mudar, o erro continua dizendo o que
 * fazer em vez de virar "erro inesperado".
 *
 * NAO use `interaction.attachmentSizeLimit` no lugar disto. A documentacao
 * ("Uploading Files") diz que esse valor e o MAXIMO entre o Nitro de quem
 * clicou e o nivel do servidor — com Nitro na conta de quem usa o painel ele
 * diz 500 MB, e o bot toma 40005 ao reenviar. Foi exatamente o que aconteceu no
 * primeiro render de lobo acima de 20 MB.
 */
export function guildUploadLimit(guild: Pick<Guild, 'premiumTier'>): number {
  switch (guild.premiumTier) {
    case GuildPremiumTier.Tier3:
      return 100 * 1024 * 1024;
    case GuildPremiumTier.Tier2:
      return 50 * 1024 * 1024;
    default:
      return DISCORD_LIMITS.ATTACHMENT_BYTES_DEFAULT;
  }
}

/** True quando o usuario bloqueia DMs do bot. */
export function isDmBlockedError(error: unknown): boolean {
  if (!(error instanceof DiscordAPIError)) return false;
  return (
    error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser ||
    error.code === RESTJSONErrorCodes.CannotSendMessagesInNonTextChannel
  );
}

/** Nome de exibicao estavel para logs e transcript. */
export function displayNameOf(member: GuildMember | null, fallbackUserId: string): string {
  if (member === null) return `Usuario ${fallbackUserId}`;
  return member.displayName || member.user.username;
}
