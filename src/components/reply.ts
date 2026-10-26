import {
  AttachmentBuilder,
  ContainerBuilder,
  MessageFlags,
  REST,
  Routes,
  type APIMessage,
  type Client,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type Message,
  type MessageCreateOptions,
  type MessageMentionOptions,
  type RepliableInteraction,
  type SendableChannels,
} from 'discord.js';

import { COLORS } from '../constants/branding';
import { NO_MENTIONS } from '../utils/discord';
import { container, footerNote, heading, separator, text } from './v2';
import type { ComponentInteraction } from './v2';

/**
 * Envio de mensagens Components V2.
 *
 * Toda resposta do bot passa por aqui para garantir:
 *  - flag `IsComponentsV2` sempre presente;
 *  - `allowedMentions` sempre explicito (padrao: nao mencionar ninguem);
 *  - tratamento correto de interacao ja respondida/deferida.
 */

export const V2_FLAG = MessageFlags.IsComponentsV2;

/**
 * Nao existe `content` aqui de proposito: a flag `IsComponentsV2` proibe o
 * campo `content` na mensagem, e a API responde 400. Todo texto entra como
 * TextDisplay dentro do container.
 */
export interface V2SendOptions {
  ephemeral?: boolean;
  allowedMentions?: MessageMentionOptions;
  files?: readonly AttachmentBuilder[];
}


/**
 * Uma mensagem V2 aceita ate 10 componentes de topo, entao um painel pode ser
 * dividido em varios containers quando um so estouraria o limite de 10 filhos.
 */
function toComponents(
  root: ContainerBuilder | readonly ContainerBuilder[],
): ContainerBuilder[] {
  // `instanceof` em vez de `Array.isArray`: sobre `readonly T[]` o guard do
  // Array estreita para `any[]` e derruba a tipagem do payload inteiro.
  return root instanceof ContainerBuilder ? [root] : [...root];
}

function replyPayload(
  root: ContainerBuilder | readonly ContainerBuilder[],
  options: V2SendOptions = {},
): InteractionReplyOptions {
  const flags =
    options.ephemeral === true ? V2_FLAG | MessageFlags.Ephemeral : V2_FLAG;
  return {
    components: toComponents(root),
    flags,
    allowedMentions: options.allowedMentions ?? NO_MENTIONS,
    ...(options.files !== undefined ? { files: [...options.files] } : {}),
  };
}

function editPayload(
  root: ContainerBuilder | readonly ContainerBuilder[],
  options: V2SendOptions = {},
): InteractionEditReplyOptions {
  return {
    components: toComponents(root),
    flags: V2_FLAG,
    allowedMentions: options.allowedMentions ?? NO_MENTIONS,
    /*
     * `attachments: []` junto com `files` significa SUBSTITUIR os anexos, nao
     * acrescentar. Sem isso, um painel que e reeditado varias vezes (o pedido
     * do cliente, que tem botao "Atualizar") acumularia um QR novo a cada
     * clique — e o Discord passaria a mostrar a imagem antiga junto da nova.
     */
    ...(options.files !== undefined
      ? { files: [...options.files], attachments: [] }
      : {}),
  };
}

/** Responde a interacao com um container V2. */
export async function replyV2(
  interaction: RepliableInteraction,
  root: ContainerBuilder | readonly ContainerBuilder[],
  options: V2SendOptions = {},
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(editPayload(root, options));
    return;
  }
  await interaction.reply(replyPayload(root, options));
}

/** Edita a resposta original (apos deferReply). */
export async function editReplyV2(
  interaction: RepliableInteraction,
  root: ContainerBuilder | readonly ContainerBuilder[],
  options: V2SendOptions = {},
): Promise<void> {
  await interaction.editReply(editPayload(root, options));
}

/** Envia uma mensagem adicional na mesma interacao. */
export async function followUpV2(
  interaction: RepliableInteraction,
  root: ContainerBuilder | readonly ContainerBuilder[],
  options: V2SendOptions = {},
): Promise<void> {
  await interaction.followUp(replyPayload(root, options));
}

/** Atualiza a mensagem que originou a interacao de componente. */
export async function updateV2(
  interaction: ComponentInteraction,
  root: ContainerBuilder | readonly ContainerBuilder[],
  options: V2SendOptions = {},
): Promise<void> {
  const payload: InteractionUpdateOptions = {
    components: toComponents(root),
    flags: V2_FLAG,
    allowedMentions: options.allowedMentions ?? NO_MENTIONS,
    ...(options.files !== undefined ? { files: [...options.files] } : {}),
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(editPayload(root, options));
    return;
  }
  await interaction.update(payload);
}

/** Um arquivo grande, ja em memoria, para `sendV2WithLargeFile`. */
export interface LargeFile {
  name: string;
  data: Buffer;
  contentType?: string;
}

/** Referencia da mensagem criada — o suficiente para montar o link dela. */
export interface SentMessageRef {
  id: string;
  channelId: string;
}

/**
 * Cliente REST exclusivo para anexos grandes.
 *
 * O REST do discord.js desiste de qualquer chamada em 15 s e, ao desistir,
 * TENTA DE NOVO sozinho (ate 3 vezes). Para mensagem comum isso e o certo. Para
 * um anexo de 100 MB sao dois defeitos: 15 s nao bastam para subir o arquivo, e
 * uma tentativa abortada DEPOIS de o Discord ja ter recebido o corpo inteiro
 * criaria a mensagem duas vezes — um post duplicado no canal publico.
 *
 * Aqui: prazo longo e ZERO repeticao automatica. Falhou, quem chamou fica
 * sabendo e decide; nunca duplica. Um cliente so, reaproveitado: cada `REST`
 * novo abriria seu proprio pool de conexoes.
 */
const LARGE_UPLOAD_TIMEOUT_MS = 5 * 60_000;
let largeUploadRest: REST | null = null;

function largeUploadClient(client: Client<true>): REST {
  if (largeUploadRest === null) {
    largeUploadRest = new REST({ timeout: LARGE_UPLOAD_TIMEOUT_MS, retries: 0 });
  }
  return largeUploadRest.setToken(client.token);
}

export interface LargeFileSendOptions {
  /**
   * Quem pode ser notificado. Omitido nao menciona ninguem — o padrao seguro,
   * porque o conteudo destas mensagens vem de formulario. A entrega de produto
   * passa o proprio cliente aqui: e a mensagem dele, no ticket dele, e a
   * notificacao e o ponto.
   */
  allowedMentions?: MessageMentionOptions;
}

/** `allowedMentions` do discord.js no formato cru que o REST espera. */
function rawAllowedMentions(options: LargeFileSendOptions): unknown {
  const mentions = options.allowedMentions;
  if (mentions === undefined) return { parse: [] };
  return {
    parse: mentions.parse ?? [],
    ...(mentions.users !== undefined ? { users: mentions.users } : {}),
    ...(mentions.roles !== undefined ? { roles: mentions.roles } : {}),
  };
}

/**
 * Envia um container V2 com UM anexo grande.
 *
 * Mesmo contrato do `sendV2` — flag V2, ninguem mencionado por padrao — mas
 * pelo cliente de prazo longo. O anexo e referenciado no container por
 * `attachment://nome`.
 *
 * Serve canal, topico e DM: o unico que importa e o id, porque a chamada e
 * `Routes.channelMessages`.
 */
export async function sendV2WithLargeFile(
  channel: { id: string; client: Client<true> },
  root: ContainerBuilder,
  file: LargeFile,
  options: LargeFileSendOptions = {},
): Promise<SentMessageRef> {
  const message = (await largeUploadClient(channel.client).post(
    Routes.channelMessages(channel.id),
    {
      body: {
        components: [root.toJSON()],
        flags: V2_FLAG,
        allowed_mentions: rawAllowedMentions(options),
        attachments: [{ id: 0, filename: file.name }],
      },
      files: [
        {
          name: file.name,
          data: file.data,
          ...(file.contentType !== undefined ? { contentType: file.contentType } : {}),
        },
      ],
    },
  )) as APIMessage;

  return { id: message.id, channelId: message.channel_id };
}

/** Envia um container V2 para um canal. */
export async function sendV2(
  channel: SendableChannels,
  root: ContainerBuilder | readonly ContainerBuilder[],
  options: V2SendOptions = {},
): Promise<Message> {
  const payload: MessageCreateOptions = {
    components: toComponents(root),
    flags: V2_FLAG,
    allowedMentions: options.allowedMentions ?? NO_MENTIONS,
    ...(options.files !== undefined ? { files: [...options.files] } : {}),
  };
  return channel.send(payload);
}

// ---------------------------------------------------------------------------
// Respostas curtas padronizadas
// ---------------------------------------------------------------------------

export interface NoticeOptions extends V2SendOptions {
  title?: string;
  footer?: string;
}

function noticeContainer(
  accent: number,
  icon: string,
  message: string,
  options: NoticeOptions = {},
): ContainerBuilder {
  const root = container(accent);
  if (options.title !== undefined) {
    root.addTextDisplayComponents(heading(options.title));
    root.addSeparatorComponents(separator());
  }
  root.addTextDisplayComponents(text(`${icon} ${message}`));
  if (options.footer !== undefined) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(footerNote(options.footer));
  }
  return root;
}

export function successContainer(message: string, options: NoticeOptions = {}): ContainerBuilder {
  return noticeContainer(COLORS.SUCCESS, '✅', message, options);
}

export function errorContainer(message: string, options: NoticeOptions = {}): ContainerBuilder {
  return noticeContainer(COLORS.DANGER, '⛔', message, options);
}

export function warningContainer(message: string, options: NoticeOptions = {}): ContainerBuilder {
  return noticeContainer(COLORS.WARNING, '⚠️', message, options);
}

export function infoContainer(message: string, options: NoticeOptions = {}): ContainerBuilder {
  return noticeContainer(COLORS.INFO, 'ℹ️', message, options);
}

/** Resposta efemera de sucesso. */
export async function replySuccess(
  interaction: RepliableInteraction,
  message: string,
  options: NoticeOptions = {},
): Promise<void> {
  await replyV2(interaction, successContainer(message, options), {
    ...options,
    ephemeral: options.ephemeral ?? true,
  });
}

/** Resposta efemera de erro (mensagem ja precisa ser segura para o usuario). */
export async function replyError(
  interaction: RepliableInteraction,
  message: string,
  options: NoticeOptions = {},
): Promise<void> {
  await replyV2(interaction, errorContainer(message, options), {
    ...options,
    ephemeral: options.ephemeral ?? true,
  });
}

export async function replyWarning(
  interaction: RepliableInteraction,
  message: string,
  options: NoticeOptions = {},
): Promise<void> {
  await replyV2(interaction, warningContainer(message, options), {
    ...options,
    ephemeral: options.ephemeral ?? true,
  });
}

export async function replyInfo(
  interaction: RepliableInteraction,
  message: string,
  options: NoticeOptions = {},
): Promise<void> {
  await replyV2(interaction, infoContainer(message, options), {
    ...options,
    ephemeral: options.ephemeral ?? true,
  });
}

/**
 * Defer seguro: nao lanca se a interacao ja foi respondida.
 * `InteractionDeferReplyOptions` aceita apenas a flag Ephemeral — a flag V2
 * entra depois, no `editReply`.
 */
export async function deferIfNeeded(
  interaction: RepliableInteraction,
  options: { ephemeral?: boolean } = {},
): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply(
    options.ephemeral === true ? { flags: MessageFlags.Ephemeral } : {},
  );
}

/** Defer de update (mantem a mensagem atual enquanto processa). */
export async function deferUpdateIfNeeded(interaction: ComponentInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferUpdate();
}
