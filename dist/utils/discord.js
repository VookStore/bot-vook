"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_MENTIONS = void 0;
exports.mentionOnly = mentionOnly;
exports.mentionUsers = mentionUsers;
exports.mentionRoles = mentionRoles;
exports.channelUrl = channelUrl;
exports.messageUrl = messageUrl;
exports.userMention = userMention;
exports.roleMention = roleMention;
exports.channelMention = channelMention;
exports.isSendableTextChannel = isSendableTextChannel;
exports.isSendableConversation = isSendableConversation;
exports.fetchChannelSafe = fetchChannelSafe;
exports.fetchMemberSafe = fetchMemberSafe;
exports.isUnknownResourceError = isUnknownResourceError;
exports.isMissingAccessError = isMissingAccessError;
exports.isPayloadTooLargeError = isPayloadTooLargeError;
exports.guildUploadLimit = guildUploadLimit;
exports.isDmBlockedError = isDmBlockedError;
exports.displayNameOf = displayNameOf;
const discord_js_1 = require("discord.js");
const limits_1 = require("../constants/limits");
/**
 * Utilitarios de Discord.
 *
 * REGRA: toda mensagem enviada pelo bot define `allowedMentions` explicitamente.
 * O padrao e NAO mencionar ninguem; mencoes sao liberadas caso a caso.
 */
/** Nenhuma mencao dispara notificacao. Padrao para paineis e textos configuraveis. */
exports.NO_MENTIONS = { parse: [], users: [], roles: [] };
/** Permite notificar exatamente um usuario (cliente do ticket). */
function mentionOnly(userId) {
    return { parse: [], users: [userId], roles: [] };
}
/** Permite notificar uma lista fechada de usuarios. */
function mentionUsers(userIds) {
    return { parse: [], users: [...new Set(userIds)], roles: [] };
}
/** Permite notificar cargos especificos (equipe da categoria). */
function mentionRoles(roleIds) {
    return { parse: [], users: [], roles: [...new Set(roleIds)] };
}
/** Link direto para o canal: https://discord.com/channels/GUILD/CHANNEL */
function channelUrl(guildId, channelId) {
    return `https://discord.com/channels/${guildId}/${channelId}`;
}
/** Link direto para uma mensagem. */
function messageUrl(guildId, channelId, messageId) {
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
function userMention(userId) {
    return `<@${userId}>`;
}
function roleMention(roleId) {
    return `<@&${roleId}>`;
}
function channelMention(channelId) {
    return `<#${channelId}>`;
}
/** Type guard: canal de texto de guild onde o bot pode enviar mensagens. */
function isSendableTextChannel(channel) {
    return (channel !== null &&
        channel !== undefined &&
        (channel.type === discord_js_1.ChannelType.GuildText || channel.type === discord_js_1.ChannelType.GuildAnnouncement) &&
        channel.isTextBased());
}
/**
 * O ramo do TOPICO decide so pelo tipo, sem chamar `channel.isThread()`.
 *
 * A primeira versao perguntava pelo metodo e derrubava com `TypeError` sobre
 * qualquer objeto que nao fosse um canal completo do discord.js — o que inclui
 * as fixtures dos testes. Um type guard precisa responder `false`, nunca
 * estourar.
 */
function isSendableConversation(channel) {
    if (channel === null || channel === undefined)
        return false;
    if (isSendableTextChannel(channel))
        return true;
    return (channel.type === discord_js_1.ChannelType.PublicThread ||
        channel.type === discord_js_1.ChannelType.PrivateThread ||
        channel.type === discord_js_1.ChannelType.AnnouncementThread);
}
/**
 * Busca um canal por ID sem lancar quando ele nao existe mais.
 * Retorna null tambem quando o canal foi apagado ou o bot perdeu acesso.
 */
async function fetchChannelSafe(guild, channelId) {
    if (channelId === null || channelId === undefined || channelId.length === 0)
        return null;
    try {
        const cached = guild.channels.cache.get(channelId);
        if (cached !== undefined)
            return cached;
        return await guild.channels.fetch(channelId);
    }
    catch (error) {
        if (isUnknownResourceError(error))
            return null;
        if (isMissingAccessError(error))
            return null;
        throw error;
    }
}
/** Busca um membro sem lancar quando ele saiu do servidor. */
async function fetchMemberSafe(guild, userId) {
    try {
        const cached = guild.members.cache.get(userId);
        if (cached !== undefined)
            return cached;
        return await guild.members.fetch(userId);
    }
    catch (error) {
        if (isUnknownResourceError(error))
            return null;
        throw error;
    }
}
/** True quando o recurso do Discord nao existe mais (canal/mensagem/membro). */
function isUnknownResourceError(error) {
    if (!(error instanceof discord_js_1.DiscordAPIError))
        return false;
    return (error.code === discord_js_1.RESTJSONErrorCodes.UnknownChannel ||
        error.code === discord_js_1.RESTJSONErrorCodes.UnknownMessage ||
        error.code === discord_js_1.RESTJSONErrorCodes.UnknownMember ||
        error.code === discord_js_1.RESTJSONErrorCodes.UnknownUser ||
        error.code === discord_js_1.RESTJSONErrorCodes.UnknownRole ||
        error.code === discord_js_1.RESTJSONErrorCodes.UnknownGuild ||
        error.code === discord_js_1.RESTJSONErrorCodes.UnknownInteraction);
}
/** True quando falta permissao/acesso. */
function isMissingAccessError(error) {
    if (!(error instanceof discord_js_1.DiscordAPIError))
        return false;
    return (error.code === discord_js_1.RESTJSONErrorCodes.MissingAccess ||
        error.code === discord_js_1.RESTJSONErrorCodes.MissingPermissions);
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
function isPayloadTooLargeError(error) {
    if (error instanceof discord_js_1.DiscordAPIError) {
        return error.code === discord_js_1.RESTJSONErrorCodes.RequestEntityTooLarge || error.status === 413;
    }
    return error instanceof discord_js_1.HTTPError && error.status === 413;
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
function guildUploadLimit(guild) {
    switch (guild.premiumTier) {
        case discord_js_1.GuildPremiumTier.Tier3:
            return 100 * 1024 * 1024;
        case discord_js_1.GuildPremiumTier.Tier2:
            return 50 * 1024 * 1024;
        default:
            return limits_1.DISCORD_LIMITS.ATTACHMENT_BYTES_DEFAULT;
    }
}
/** True quando o usuario bloqueia DMs do bot. */
function isDmBlockedError(error) {
    if (!(error instanceof discord_js_1.DiscordAPIError))
        return false;
    return (error.code === discord_js_1.RESTJSONErrorCodes.CannotSendMessagesToThisUser ||
        error.code === discord_js_1.RESTJSONErrorCodes.CannotSendMessagesInNonTextChannel);
}
/** Nome de exibicao estavel para logs e transcript. */
function displayNameOf(member, fallbackUserId) {
    if (member === null)
        return `Usuario ${fallbackUserId}`;
    return member.displayName || member.user.username;
}
//# sourceMappingURL=discord.js.map