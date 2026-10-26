import { PermissionFlagsBits, type Guild, type Message } from 'discord.js';

import { createLogger } from '../../../core/logger/Logger';
import { ConfigurationError, ValidationError } from '../../../core/errors';
import {
  NO_MENTIONS,
  fetchChannelSafe,
  isSendableTextChannel,
  type SendableGuildChannel,
} from '../../../utils/discord';
import { buildAnnouncementPayload, isDraftPublishable } from '../builders/AnnouncementBuilders';
import { deleteDraft, type AnnouncementDraft } from './AnnouncementDraftService';

/**
 * Publicacao do anuncio.
 *
 * O anuncio e a unica mensagem do bot que NAO passa por `sendV2`: ele carrega
 * um embed classico, e a flag `IsComponentsV2` proibe `embeds` e `content` na
 * mesma mensagem. O motivo esta em `AnnouncementBuilders`.
 */

const logger = createLogger('announce');

/**
 * Canal de destino, revalidado no momento da publicacao.
 *
 * O canal foi escolhido quando o comando rodou e o rascunho vive ate meia hora:
 * nesse intervalo ele pode ter sido apagado, arquivado ou ter perdido a
 * permissao do bot. Conferir aqui transforma um 403 cru numa frase que diz o
 * que fazer.
 */
export async function resolveAnnouncementChannel(
  guild: Guild,
  channelId: string,
): Promise<SendableGuildChannel> {
  const channel = await fetchChannelSafe(guild, channelId);

  if (!isSendableTextChannel(channel)) {
    throw new ConfigurationError(`Canal de anuncio indisponivel: ${channelId}`, {
      userMessage:
        'O canal escolhido nao existe mais ou o bot perdeu acesso a ele. Rode `/anunciar` de novo.',
    });
  }

  const me = guild.members.me;
  const permissions = me === null ? null : channel.permissionsFor(me);

  if (permissions === null || !permissions.has(PermissionFlagsBits.SendMessages)) {
    throw new ConfigurationError(`Sem permissao de envio em ${channelId}`, {
      userMessage: `O bot nao pode enviar mensagens em <#${channelId}>. Ajuste as permissoes do canal.`,
    });
  }

  /*
   * `EmbedLinks` e checada de proposito: sem ela o Discord ACEITA a mensagem e
   * simplesmente nao desenha o embed. O anuncio sairia vazio no canal, com os
   * botoes soltos, e ninguem saberia por que.
   */
  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    throw new ConfigurationError(`Sem permissao de embed em ${channelId}`, {
      userMessage:
        `O bot precisa da permissao **Inserir links** em <#${channelId}> — ` +
        'sem ela o embed nao aparece e o anuncio sai em branco.',
    });
  }

  return channel;
}

/**
 * Envia o anuncio e encerra o rascunho.
 *
 * O rascunho so e apagado DEPOIS do envio confirmado: se o Discord recusar a
 * mensagem, o autor volta para a previa com tudo preenchido em vez de perder o
 * texto que acabou de escrever.
 */
export async function publishAnnouncement(
  guild: Guild,
  draft: AnnouncementDraft,
): Promise<Message> {
  if (!isDraftPublishable(draft)) {
    throw new ValidationError('Anuncio sem conteudo.', {
      userMessage: 'Preencha o conteudo do anuncio antes de publicar.',
    });
  }

  const channel = await resolveAnnouncementChannel(guild, draft.channelId);
  const payload = buildAnnouncementPayload(draft);

  const message = await channel.send({
    ...(payload.content !== undefined ? { content: payload.content } : {}),
    embeds: payload.embeds,
    components: payload.components,
    /*
     * Anuncio NAO menciona ninguem por padrao. `@everyone` escrito no texto
     * continua aparecendo como texto; para tocar o sino, quem publica usa uma
     * mensagem propria — um anuncio que notifica o servidor inteiro por engano
     * nao tem como ser desfeito.
     */
    allowedMentions: NO_MENTIONS,
  });

  deleteDraft(draft.id);

  logger.info('Anuncio publicado.', {
    guildId: guild.id,
    channelId: channel.id,
    entityType: 'announcement',
    entityId: message.id,
    userId: draft.createdById,
    withEmbed: draft.withEmbed,
    buttons: draft.buttons.length,
  });

  return message;
}
