import { MessageFlags } from 'discord.js';
import type { AttachmentBuilder, ContainerBuilder, Guild, Message } from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import { createLogger } from '../../../core/logger/Logger';
import {
  NO_MENTIONS,
  fetchChannelSafe,
  isSendableTextChannel,
  isUnknownResourceError,
  type SendableGuildChannel,
} from '../../../utils/discord';
import { getGuildConfig, updateGuildConfig } from './GuildConfigService';
import type { GuildConfigUpdate } from '../repositories/GuildConfigRepository';

/**
 * Paineis fixos publicados num canal e reescritos no lugar.
 *
 * A tabela de precos e o anuncio de booster fazem a mesma coisa: publicam UMA
 * mensagem, guardam (canal, mensagem) na configuracao e depois EDITAM essa
 * mensagem quando o conteudo muda. Isto aqui e essa mecanica, uma vez so.
 *
 * POR QUE EDITAR E NAO REPUBLICAR. Sao mensagens que declaram compromisso —
 * preco e beneficio. Publicar uma segunda versao deixaria a antiga visivel
 * acima dela, e nao ha como saber qual o cliente leu; num canal desses, a
 * versao velha e uma promessa que a loja nao quer cumprir.
 *
 * O QUE ESTE MODULO NAO SABE. Ele nao conhece preco, booster nem nada do
 * conteudo: recebe uma funcao que desenha e duas funcoes que leem e escrevem as
 * colunas certas. E por isso que ligar um painel novo custa um `PanelBinding` e
 * nao outra copia deste arquivo.
 */

const logger = createLogger('config:panel');

/** O que o painel renderiza: os componentes e os arquivos que os acompanham. */
export interface PanelContent {
  root: ContainerBuilder;
  /**
   * Anexos referenciados por `attachment://`.
   *
   * PRECISAM SER REENVIADOS A CADA EDICAO. Um `edit` com `files` substitui a
   * lista de anexos da mensagem; omitir o arquivo numa atualizacao apagaria a
   * imagem que o painel referencia, deixando um quadrado quebrado.
   */
  files?: readonly AttachmentBuilder[];
}

/**
 * Onde este painel guarda a mensagem publicada.
 *
 * `read`/`write` sao funcoes, e nao nomes de coluna em string, para o
 * TypeScript continuar conferindo os campos: um `pricingMessageId` digitado
 * errado vira erro de compilacao, nao um painel que nunca acha a propria
 * mensagem em producao.
 */
export interface PanelBinding {
  /** Nome legivel, usado em log e nas mensagens de erro ao operador. */
  name: string;
  read: (config: GuildConfig) => { channelId: string | null; messageId: string | null };
  write: (channelId: string | null, messageId: string | null) => GuildConfigUpdate;
}

export interface PanelRefreshResult {
  updated: boolean;
  /** Por que nao atualizou. Ausente quando `updated` e true. */
  reason?: string;
}

/** Apaga a mensagem publicada anteriormente, se ainda existir. */
async function removePublishedMessage(guild: Guild, binding: PanelBinding): Promise<boolean> {
  const { channelId, messageId } = binding.read(await getGuildConfig(guild.id));
  if (channelId === null || messageId === null) return false;

  const channel = await fetchChannelSafe(guild, channelId);
  if (!isSendableTextChannel(channel)) return false;

  try {
    const message = await channel.messages.fetch(messageId);
    await message.delete();
    return true;
  } catch (error) {
    if (isUnknownResourceError(error)) return false;
    throw error;
  }
}

/**
 * Publica o painel num canal e memoriza a mensagem.
 *
 * Apaga a anterior antes: sem isso, republicar em outro canal deixaria duas
 * versoes vivas no servidor, cada uma dizendo uma coisa.
 */
export async function publishBoundPanel(
  guild: Guild,
  channel: SendableGuildChannel,
  binding: PanelBinding,
  render: (config: GuildConfig) => PanelContent,
): Promise<Message> {
  return locks.withLock(LOCK_NAMESPACE.PANEL_UPDATE, `${guild.id}:${binding.name}`, async () => {
    const config = await getGuildConfig(guild.id);
    const content = render(config);

    await removePublishedMessage(guild, binding).catch(() => undefined);

    const message = await sendV2(channel, content.root, {
      ...(content.files !== undefined ? { files: content.files } : {}),
    });

    await updateGuildConfig(guild.id, binding.write(channel.id, message.id));

    logger.info('Painel publicado.', {
      guildId: guild.id,
      channelId: channel.id,
      entityType: 'message',
      entityId: message.id,
      panel: binding.name,
    });

    return message;
  });
}

/**
 * Reescreve o painel ja publicado.
 *
 * NUNCA publica um novo. Se a mensagem sumiu, devolve o motivo e deixa a
 * decisao com quem chamou: republicar sozinho poderia jogar o painel num canal
 * que a equipe tinha esvaziado de proposito.
 */
export async function refreshBoundPanel(
  guild: Guild,
  binding: PanelBinding,
  render: (config: GuildConfig) => PanelContent,
): Promise<PanelRefreshResult> {
  return locks.withLock(LOCK_NAMESPACE.PANEL_UPDATE, `${guild.id}:${binding.name}`, async () => {
    const config = await getGuildConfig(guild.id);
    const { channelId, messageId } = binding.read(config);

    if (channelId === null || messageId === null) {
      return { updated: false, reason: `${binding.name} ainda nao foi publicado.` };
    }

    const channel = await fetchChannelSafe(guild, channelId);
    if (!isSendableTextChannel(channel)) {
      return {
        updated: false,
        reason: 'O canal do painel nao existe mais ou o bot perdeu acesso a ele.',
      };
    }

    const content = render(config);

    try {
      const message = await channel.messages.fetch(messageId);
      await message.edit({
        components: [content.root],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: NO_MENTIONS,
        // Reenviado sempre: `edit` substitui a lista de anexos, e omitir aqui
        // apagaria a imagem que o painel referencia por `attachment://`.
        ...(content.files !== undefined ? { files: [...content.files] } : {}),
      });

      logger.info('Painel atualizado.', {
        guildId: guild.id,
        channelId: channel.id,
        entityType: 'message',
        entityId: message.id,
        panel: binding.name,
      });

      return { updated: true };
    } catch (error) {
      if (isUnknownResourceError(error)) {
        return {
          updated: false,
          reason: 'A mensagem do painel foi apagada. Publique novamente.',
        };
      }
      throw error;
    }
  });
}
