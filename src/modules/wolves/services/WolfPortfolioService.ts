import { PermissionFlagsBits, type Guild, type Message } from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import { sendV2, sendV2WithLargeFile, type SentMessageRef } from '../../../components/reply';
import { ConfigurationError, ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { enqueueTransfer } from '../../../core/queue/TransferQueue';
import {
  fetchChannelSafe,
  isPayloadTooLargeError,
  isSendableTextChannel,
  type SendableGuildChannel,
} from '../../../utils/discord';
import { downloadDiscordAttachment } from '../../../utils/download';
import { hostAsset, isAssetHostingEnabled } from '../../hosting/AssetHostingService';
import {
  getGuildConfig,
  updateGuildConfig,
} from '../../configuration/services/GuildConfigService';
import {
  publishBoundPanel,
  refreshBoundPanel,
  type PanelBinding,
  type PanelContent,
  type PanelRefreshResult,
} from '../../configuration/services/PublishedPanelService';
import { buildWolfPanel, buildWolfPortfolioPost, type WolfSubmission } from '../builders/WolfBuilders';
import {
  assertRenderDeclaration,
  describeRenderFormats,
  describeRenderMaxSize,
  detectRenderFormat,
  discordRenderLimit,
  renderTransferTimeoutMs,
  type RenderFormat,
  type RenderUpload,
} from '../validators/render';

/**
 * Portfolio de lobos: o painel da equipe e o post publico.
 *
 * O painel usa a mecanica de `PublishedPanelService` (publica uma vez, reescreve
 * no lugar). O post NAO: cada lobo e uma mensagem nova e permanente, e ninguem
 * volta para edita-la — por isso o bot nao guarda o id dela.
 */

const logger = createLogger('wolf:portfolio');

/** Cancelamento por tempo (o `AbortController` do cliente de anexo grande). */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

const PANEL_BINDING: PanelBinding = {
  name: 'Painel de lobos',
  read: (config) => ({
    channelId: config.wolfPanelChannelId,
    messageId: config.wolfPanelMessageId,
  }),
  write: (channelId, messageId) => ({
    wolfPanelChannelId: channelId,
    wolfPanelMessageId: messageId,
  }),
};

/**
 * O painel mostra o teto EFETIVO do render (`effectiveRenderLimit`): o maior
 * entre o anexo que o bot envia neste servidor e o que a hospedagem aceita.
 *
 * Mudou o nivel de impulsos, ou a hospedagem foi ligada? O formulario ja usa o
 * valor novo a cada clique — quem calcula e o handler, na hora. O TEXTO do
 * painel fica congelado ate o proximo `/lobos atualizar`, porque um painel
 * publicado so muda quando alguem o reescreve.
 */
function panelRenderer(maxRenderBytes: number): (config: GuildConfig) => PanelContent {
  return (config) => ({
    root: buildWolfPanel({ portfolioChannelId: config.wolfPortfolioChannelId, maxRenderBytes }),
  });
}

/** Publica o painel num canal da equipe e memoriza a mensagem. */
export async function publishWolfPanel(
  guild: Guild,
  channel: SendableGuildChannel,
  maxRenderBytes: number,
): Promise<Message> {
  return publishBoundPanel(guild, channel, PANEL_BINDING, panelRenderer(maxRenderBytes));
}

/** Reescreve o painel ja publicado (ex.: depois de definir o portfolio). */
export async function refreshWolfPanel(
  guild: Guild,
  maxRenderBytes: number,
): Promise<PanelRefreshResult> {
  return refreshBoundPanel(guild, PANEL_BINDING, panelRenderer(maxRenderBytes));
}

/**
 * Canal do portfolio, conferido no momento do uso.
 *
 * Tres permissoes, e cada uma falha de um jeito diferente se faltar: sem
 * `ViewChannel` o Discord responde "Missing Access"; sem `SendMessages`, 403;
 * sem `AttachFiles` a mensagem sai SEM o render — o post chegaria ao canal como
 * um cartao de texto de um lobo que ninguem ve. Conferir aqui transforma as
 * tres numa frase que diz o que ajustar.
 */
export async function resolvePortfolioChannel(
  guild: Guild,
  channelId: string | null,
): Promise<SendableGuildChannel> {
  if (channelId === null) {
    throw new ConfigurationError('Portfolio de lobos sem canal definido.', {
      userMessage:
        'O canal do portfólio ainda não foi definido. Um administrador precisa rodar `/lobos portfolio`.',
    });
  }

  const channel = await fetchChannelSafe(guild, channelId);
  if (!isSendableTextChannel(channel)) {
    throw new ConfigurationError(`Canal do portfolio indisponivel: ${channelId}`, {
      userMessage:
        'O canal do portfólio não existe mais ou o bot perdeu acesso a ele. ' +
        'Um administrador precisa definir outro com `/lobos portfolio`.',
    });
  }

  const me = guild.members.me;
  const permissions = me === null ? null : channel.permissionsFor(me);
  const missing = [
    { flag: PermissionFlagsBits.ViewChannel, label: 'Ver canal' },
    { flag: PermissionFlagsBits.SendMessages, label: 'Enviar mensagens' },
    { flag: PermissionFlagsBits.AttachFiles, label: 'Anexar arquivos' },
  ].filter((entry) => permissions === null || !permissions.has(entry.flag));

  if (missing.length > 0) {
    throw new ConfigurationError(`Permissoes faltando no portfolio ${channelId}`, {
      userMessage:
        `O bot precisa de **${missing.map((entry) => entry.label).join('**, **')}** ` +
        `em <#${channelId}> para publicar o lobo com o render.`,
    });
  }

  return channel;
}

/**
 * Define o canal do portfolio e atualiza o painel.
 *
 * O canal e validado ANTES de ser gravado: aceitar um canal onde o bot nao pode
 * anexar deixaria o painel com o botao ligado para um destino que recusaria
 * todo envio.
 */
export async function setPortfolioChannel(
  guild: Guild,
  channel: SendableGuildChannel,
  maxRenderBytes: number,
): Promise<PanelRefreshResult> {
  await resolvePortfolioChannel(guild, channel.id);
  await updateGuildConfig(guild.id, { wolfPortfolioChannelId: channel.id });

  logger.info('Canal do portfolio de lobos definido.', {
    guildId: guild.id,
    channelId: channel.id,
  });

  // O painel publicado mostra o destino e liga o botao; sem este refresh ele
  // continuaria dizendo "canal nao definido" com o botao desligado.
  return refreshWolfPanel(guild, maxRenderBytes);
}

export interface PublishWolfPostParams {
  guild: Guild;
  actorId: string;
  submission: WolfSubmission;
  render: RenderUpload;
  /** Teto efetivo desta interacao (`effectiveRenderLimit`). */
  maxRenderBytes: number;
}

/**
 * Sobe o render para o Worker e devolve a URL publica.
 *
 * LANCA quando nao da. Aqui a hospedagem nao e enfeite: se ela falhar, nao ha
 * como publicar o render (ele ja nao cabe como anexo), e publicar o post com a
 * imagem quebrada seria pior — post de portfolio fica no canal para sempre e
 * ninguem o reescreve.
 *
 * A extensao no endereco existe para o Discord tratar o link como imagem. Ela
 * exige o Worker atualizado; na versao antiga da rota o PUT e recusado, e a
 * equipe recebe a frase abaixo em vez de um post quebrado.
 */
async function hostRender(
  bytes: Buffer,
  filename: string,
  format: RenderFormat,
): Promise<string> {
  const url = await hostAsset({
    bytes,
    name: filename,
    contentType: format.mime,
    ext: format.ext,
    timeoutMs: renderTransferTimeoutMs(bytes.length),
  });

  if (url === null) {
    throw new ValidationError(`Hospedagem do render indisponivel: ${bytes.length} bytes`, {
      userMessage:
        'O render nao cabe como anexo neste servidor e a hospedagem da loja nao respondeu. ' +
        'Tente de novo; se persistir, avise o administrador (Worker da Cloudflare) ou exporte um arquivo menor.',
    });
  }
  return url;
}

/**
 * Publica o lobo no portfolio.
 *
 * Sequencia: declaracao do arquivo -> canal -> download -> formato pelos bytes
 * -> envio. A ordem poe o que e barato primeiro: recusar um arquivo grande
 * demais nao pode custar a consulta ao canal, e recusar um canal sem permissao
 * nao pode custar o download.
 *
 * O RENDER NUNCA FICA NA URL DO FORMULARIO: ela e assinada e expira em horas.
 * Ele segue por um de dois caminhos, decididos pelo tamanho:
 *
 *  - CABE NO ANEXO (ate o limite do nivel de impulsos): vai como anexo da
 *    propria mensagem do bot, e o post aponta para `attachment://`. E o caminho
 *    preferido — a imagem vive junto da mensagem e nao depende de mais nada.
 *  - NAO CABE: sobe para o Worker da loja e o post aponta para a URL. E o que
 *    permite publicar um render de 50 MB num servidor sem impulso; em troca, a
 *    imagem daquele post passa a depender do Worker continuar no ar.
 *
 * UMA TRANSFERENCIA POR VEZ. O render e baixado inteiro e o reenvio faz mais
 * uma copia (o `Blob` do @discordjs/rest): MEDIDO em +208 MB de RSS para um
 * arquivo de 100 MiB, num processo que o PM2 reinicia em 512 MB. Uma cabe; duas
 * em paralelo nao — a segunda entra na fila e sai quando a primeira terminar. A
 * fila e COMPARTILHADA com a entrega de produto no ticket (`TransferQueue`),
 * porque o que ela protege e a memoria do processo, nao o portfolio.
 *
 * Esse numero so e esse porque o download le em streaming (ver
 * `downloadDiscordAttachment`). Com `response.arrayBuffer()` o mesmo arquivo
 * custava +434 MB e derrubava o processo sozinho.
 */
export async function publishWolfPost(params: PublishWolfPostParams): Promise<SentMessageRef> {
  const { guild, submission, render, maxRenderBytes } = params;
  const hostingEnabled = isAssetHostingEnabled();

  assertRenderDeclaration(render, maxRenderBytes, hostingEnabled);

  return enqueueTransfer(guild.id, async () => {
    const config = await getGuildConfig(guild.id);
    const channel = await resolvePortfolioChannel(guild, config.wolfPortfolioChannelId);

    const download = await downloadDiscordAttachment(
      render.url,
      maxRenderBytes,
      renderTransferTimeoutMs(render.size),
    );

    const format = detectRenderFormat(download.bytes);
    if (format === null) {
      throw new ValidationError(`Render nao e imagem reconhecida: ${render.name}`, {
        userMessage: `O arquivo enviado não é uma imagem ${describeRenderFormats()}. Exporte o render de novo.`,
      });
    }

    const imageFilename = `lobo-${submission.kind}.${format.ext}`;
    const startedAt = Date.now();

    /*
     * Anexo quando cabe; hospedagem quando nao cabe.
     *
     * O limite de anexo e do BOT neste servidor (nivel de impulsos), nao de
     * quem preencheu o formulario — quem tem Nitro sobe 500 MB pelo modal e o
     * bot continua limitado.
     */
    const asAttachment = download.bytes.length <= discordRenderLimit(guild);

    const imageUrl = asAttachment
      ? `attachment://${imageFilename}`
      : await hostRender(download.bytes, imageFilename, format);

    const post = buildWolfPortfolioPost({
      submission,
      imageUrl,
      ticketChannelId: config.ticketPanelChannelId,
      storeName: config.storeName,
    });

    let message: SentMessageRef;
    if (!asAttachment) {
      // Sem anexo: a mensagem e pequena e vai pelo caminho normal.
      const sent = await sendV2(channel, post);
      message = { id: sent.id, channelId: sent.channelId };
    } else {
      try {
        message = await sendV2WithLargeFile(channel, post, {
          name: imageFilename,
          data: download.bytes,
          contentType: format.mime,
        });
      } catch (error) {
        /*
         * Envio cancelado por tempo.
         *
         * `retries: 0` impede a repeticao AUTOMATICA, mas nao a humana: sem
         * esta traducao a equipe le "erro inesperado", preenche o formulario de
         * novo e publica o MESMO lobo duas vezes — exatamente o que o
         * `retries: 0` existia para evitar. O aborto acontece justo no caso em
         * que o Discord pode ja ter recebido o arquivo inteiro, entao a frase
         * manda conferir o canal ANTES de repetir.
         */
        if (isAbortError(error)) {
          logger.warn('Envio do render cancelado por tempo.', {
            guildId: guild.id,
            channelId: channel.id,
            userId: params.actorId,
            bytes: download.bytes.length,
            uploadMs: Date.now() - startedAt,
          });

          throw new ValidationError(`Envio do render abortado: ${download.bytes.length} bytes`, {
            userMessage:
              'O envio do render passou do tempo e foi cancelado. **Confira o canal do portfólio antes de publicar de novo** — ' +
              'a mensagem pode ter sido criada mesmo assim.',
          });
        }

        /*
         * Recusa por tamanho — segunda linha de defesa.
         *
         * O teto por nivel de impulsos ja barra o arquivo ANTES do download,
         * mas a tabela 50/100 MB vem da FAQ de impulsos, nao da referencia da
         * API: se o Discord mudar, o reenvio volta a tomar 40005. Sem esta
         * traducao, a equipe veria "erro inesperado" e o canal de alertas
         * trataria como defeito do bot. O WARN guarda os numeros que permitem
         * corrigir o teto.
         */
        if (!isPayloadTooLargeError(error)) throw error;

        logger.warn('Discord recusou o render por tamanho acima do teto calculado.', {
          guildId: guild.id,
          channelId: channel.id,
          userId: params.actorId,
          bytes: download.bytes.length,
          maxRenderBytes,
          premiumTier: guild.premiumTier,
        });

        throw new ValidationError(`Render recusado pelo Discord (40005): ${download.bytes.length} bytes`, {
          userMessage:
            `O Discord recusou o render por tamanho (${describeRenderMaxSize(download.bytes.length)}). ` +
            'O bot envia menos que isso neste servidor — exporte em JPG ou WEBP, ou reduza a resolucao.',
        });
      }
    }

    logger.info('Lobo publicado no portfolio.', {
      guildId: guild.id,
      channelId: channel.id,
      userId: params.actorId,
      entityType: 'message',
      entityId: message.id,
      kind: submission.kind,
      format: format.ext,
      bytes: download.bytes.length,
      maxRenderBytes,
      // Qual caminho a imagem tomou: e a primeira pergunta quando um post
      // antigo aparece com a imagem quebrada.
      via: asAttachment ? 'anexo' : 'hospedagem',
      uploadMs: Date.now() - startedAt,
    });

    return message;
  });
}
