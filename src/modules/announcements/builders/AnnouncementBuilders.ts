import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type ModalActionRowComponentBuilder,
} from 'discord.js';

import { EMOJIS } from '../../../constants/branding';
import { ANNOUNCE_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { channelMention } from '../../../utils/discord';
import { sanitizeImageUrl, truncate } from '../../../utils/sanitize';
import { formatButtonEmoji, type ButtonEmoji } from '../validators/emoji';
import { formatEmbedColor, parseEmbedColor, sanitizeLinkUrl } from '../validators/link';
import type {
  AnnouncementButton,
  AnnouncementDraft,
  AnnouncementEmbed,
} from '../services/AnnouncementDraftService';

/**
 * Formularios, previa e mensagem final do anuncio.
 *
 * POR QUE ESTE MODULO NAO E COMPONENTS V2. O resto do bot fala V2 exclusivamente
 * (`components/reply.ts` sempre manda a flag `IsComponentsV2`). Aqui nao da: a
 * flag PROIBE `embeds` e `content` na mesma mensagem, e o que foi pedido —
 * titulo, descricao, thumbnail, imagem, rodape COM icone e autor — e exatamente
 * a anatomia de um embed classico. Um container V2 nao tem icone de rodape nem
 * autor, entao emular custaria os dois campos. Este e o unico lugar do bot que
 * publica mensagem classica, e por isso monta o payload a mao em vez de passar
 * por `sendV2`.
 */

/** customIds dos campos dos formularios. */
export const ANNOUNCE_FIELD = {
  TITLE: 'title',
  DESCRIPTION: 'description',
  IMAGES: 'images',
  FOOTER: 'footer',
  STYLE: 'style',
  PLAIN: 'plain',
  BUTTON_LABEL: 'btn-label',
  BUTTON_URL: 'btn-url',
  BUTTON_EMOJI: 'btn-emoji',
} as const;

/**
 * Separador dos campos agrupados.
 *
 * MESMO IDIOMA do modal visual da configuracao, que ja carrega tres URLs num
 * campo so. A razao e dura: um modal do Discord aceita no maximo CINCO campos,
 * e o anuncio precisa de nove valores. Agrupar por assunto (as duas imagens
 * juntas, o rodape com seu icone) mantem tudo num formulario, que foi o pedido
 * — a alternativa seria espalhar o anuncio por tres modais em sequencia.
 */
export const FIELD_SEPARATOR = ' | ';

/** Descricao no maximo que o TextInput do Discord aceita (4000), nao os 4096 do embed. */
const DESCRIPTION_MAX = Math.min(
  DISCORD_LIMITS.EMBED_DESCRIPTION,
  DISCORD_LIMITS.TEXT_INPUT_SHORT_VALUE,
);

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

function modalRow(input: TextInputBuilder): ActionRowBuilder<ModalActionRowComponentBuilder> {
  return new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
}

function modalInput(params: {
  customId: string;
  label: string;
  style: TextInputStyle;
  required: boolean;
  maxLength: number;
  value?: string | null;
  placeholder?: string;
}): TextInputBuilder {
  const max = Math.min(params.maxLength, DISCORD_LIMITS.TEXT_INPUT_SHORT_VALUE);
  const input = new TextInputBuilder()
    .setCustomId(params.customId)
    .setLabel(truncate(params.label, DISCORD_LIMITS.TEXT_INPUT_LABEL))
    .setStyle(params.style)
    .setRequired(params.required)
    .setMaxLength(max);

  if (params.placeholder !== undefined) {
    input.setPlaceholder(truncate(params.placeholder, DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));
  }
  // `setValue` maior que `max_length` toma 400 do Discord, entao trunca antes.
  if (params.value !== undefined && params.value !== null && params.value.length > 0) {
    input.setValue(truncate(params.value, max));
  }
  return input;
}

/** Junta valores num campo agrupado, preservando as posicoes vazias do meio. */
function joinGrouped(parts: ReadonlyArray<string | null>): string {
  return parts.some((part) => part !== null && part.length > 0)
    ? parts.map((part) => part ?? '').join(FIELD_SEPARATOR)
    : '';
}

/**
 * Separa um campo agrupado em `count` posicoes.
 *
 * Posicao ausente ou vazia vira `null` — e assim que "so preenchi a thumbnail"
 * continua significando "sem imagem grande", e nao "imagem com string vazia",
 * que o Discord recusaria.
 */
function splitGrouped(raw: string, count: number): Array<string | null> {
  const parts = raw.split('|').map((part) => part.trim());
  return Array.from({ length: count }, (_, index) => {
    const value = parts[index];
    return value === undefined || value.length === 0 ? null : value;
  });
}

/**
 * Formulario do anuncio.
 *
 * Reaberto pelo botao "Editar" ja preenchido com o que o rascunho tem: quem
 * volta para trocar a cor nao pode perder a descricao que acabou de escrever.
 */
export function buildAnnouncementModal(draft: AnnouncementDraft): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ANNOUNCE, ANNOUNCE_ACTION.EDIT_MODAL, draft.id))
    .setTitle(
      truncate(
        draft.withEmbed ? 'Anuncio — conteudo do embed' : 'Anuncio — mensagem',
        DISCORD_LIMITS.MODAL_TITLE,
      ),
    );

  if (!draft.withEmbed) {
    return modal.addComponents(
      modalRow(
        modalInput({
          customId: ANNOUNCE_FIELD.PLAIN,
          label: 'Mensagem do anuncio',
          style: TextInputStyle.Paragraph,
          required: true,
          maxLength: BUSINESS_LIMITS.ANNOUNCE_PLAIN_MAX,
          value: draft.plainText,
          placeholder: 'Texto que sera publicado no canal.',
        }),
      ),
    );
  }

  const { embed } = draft;

  return modal.addComponents(
    modalRow(
      modalInput({
        customId: ANNOUNCE_FIELD.TITLE,
        label: 'Titulo',
        style: TextInputStyle.Short,
        required: false,
        maxLength: DISCORD_LIMITS.EMBED_TITLE,
        value: embed.title,
        placeholder: 'Opcional.',
      }),
    ),
    modalRow(
      modalInput({
        customId: ANNOUNCE_FIELD.DESCRIPTION,
        label: 'Descricao',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: DESCRIPTION_MAX,
        value: embed.description,
        placeholder: 'Opcional. Aceita markdown do Discord.',
      }),
    ),
    modalRow(
      modalInput({
        customId: ANNOUNCE_FIELD.IMAGES,
        label: 'Thumbnail | Imagem',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: BUSINESS_LIMITS.IMAGE_URL_MAX * 2 + FIELD_SEPARATOR.length,
        value: joinGrouped([embed.thumbnailUrl, embed.imageUrl]),
        placeholder: 'https://.../logo.png | https://.../banner.png',
      }),
    ),
    modalRow(
      modalInput({
        customId: ANNOUNCE_FIELD.FOOTER,
        label: 'Rodape | Icone do rodape',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: DISCORD_LIMITS.EMBED_FOOTER_TEXT + BUSINESS_LIMITS.IMAGE_URL_MAX,
        value: joinGrouped([embed.footerText, embed.footerIconUrl]),
        placeholder: 'Vook Store | https://.../icone.png',
      }),
    ),
    modalRow(
      modalInput({
        customId: ANNOUNCE_FIELD.STYLE,
        label: 'Cor | Autor | Icone do autor',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength:
          16 + DISCORD_LIMITS.EMBED_AUTHOR_NAME + BUSINESS_LIMITS.IMAGE_URL_MAX,
        value: joinGrouped([
          formatEmbedColor(embed.color),
          embed.authorName,
          embed.authorIconUrl,
        ]),
        placeholder: '#8b5cf6 | Vook Store | https://.../logo.png',
      }),
    ),
  );
}

/** Formulario de UM botao de link. */
export function buildAnnouncementButtonModal(draftId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ANNOUNCE, ANNOUNCE_ACTION.BUTTON_ADD_MODAL, draftId))
    .setTitle(truncate('Anuncio — novo botao', DISCORD_LIMITS.MODAL_TITLE))
    .addComponents(
      modalRow(
        modalInput({
          customId: ANNOUNCE_FIELD.BUTTON_LABEL,
          label: 'Nome do botao',
          style: TextInputStyle.Short,
          required: true,
          maxLength: BUSINESS_LIMITS.ANNOUNCE_BUTTON_LABEL_MAX,
          placeholder: 'Ver catalogo',
        }),
      ),
      modalRow(
        modalInput({
          customId: ANNOUNCE_FIELD.BUTTON_URL,
          label: 'Link',
          style: TextInputStyle.Short,
          required: true,
          maxLength: BUSINESS_LIMITS.IMAGE_URL_MAX,
          placeholder: 'https://vookstore.com/catalogo',
        }),
      ),
      modalRow(
        modalInput({
          customId: ANNOUNCE_FIELD.BUTTON_EMOJI,
          label: 'Emoji (opcional)',
          style: TextInputStyle.Short,
          required: false,
          maxLength: 64,
          placeholder: '🔥 ou <:hairmtc:1403457616792785017>',
        }),
      ),
    );
}

// ---------------------------------------------------------------------------
// Leitura dos formularios
// ---------------------------------------------------------------------------

/** Valor de um campo do modal, ja aparado; `null` quando vazio. */
type FieldReader = (customId: string) => string;

function optional(read: FieldReader, customId: string): string | null {
  const value = read(customId).trim();
  return value.length === 0 ? null : value;
}

/**
 * Le o formulario do embed.
 *
 * Cada URL passa por `sanitizeImageUrl` (https, sem credencial, dentro do teto)
 * AQUI e nao na publicacao: URL torta rejeitada no envio do formulario ainda
 * tem o texto digitado na tela para corrigir; rejeitada no "Publicar", o autor
 * ja perdeu de vista qual dos quatro campos estava errado.
 */
export function readAnnouncementEmbed(read: FieldReader): AnnouncementEmbed {
  const [thumbnailUrl, imageUrl] = splitGrouped(read(ANNOUNCE_FIELD.IMAGES), 2);
  const [footerText, footerIconUrl] = splitGrouped(read(ANNOUNCE_FIELD.FOOTER), 2);
  const [color, authorName, authorIconUrl] = splitGrouped(read(ANNOUNCE_FIELD.STYLE), 3);

  const embed: AnnouncementEmbed = {
    title: optional(read, ANNOUNCE_FIELD.TITLE),
    description: optional(read, ANNOUNCE_FIELD.DESCRIPTION),
    thumbnailUrl: sanitizeImageUrl(thumbnailUrl),
    imageUrl: sanitizeImageUrl(imageUrl),
    footerText: footerText ?? null,
    footerIconUrl: sanitizeImageUrl(footerIconUrl),
    authorName: authorName ?? null,
    authorIconUrl: sanitizeImageUrl(authorIconUrl),
    color: parseEmbedColor(color),
  };

  /*
   * Um embed precisa ter ALGO que o Discord saiba desenhar. So cor, ou so icone
   * de rodape, produz uma mensagem que a API aceita e que o leitor ve como um
   * retangulo vazio — pior que o erro, porque o anuncio sai publicado assim.
   */
  if (!hasVisibleContent(embed)) {
    throw new ValidationError('Embed sem conteudo visivel.', {
      userMessage:
        'Preencha ao menos titulo, descricao, imagem ou rodape — um embed so com cor sai vazio.',
    });
  }

  assertEmbedTotal(embed);
  return embed;
}

function hasVisibleContent(embed: AnnouncementEmbed): boolean {
  return (
    embed.title !== null ||
    embed.description !== null ||
    embed.imageUrl !== null ||
    embed.thumbnailUrl !== null ||
    embed.footerText !== null ||
    embed.authorName !== null
  );
}

/**
 * Teto de 6000 caracteres somando os textos do embed.
 *
 * O Discord conta titulo + descricao + rodape + autor JUNTOS e recusa a
 * mensagem inteira ao estourar. Cada campo isolado cabe no proprio limite, e e
 * a soma que escapa — por isso a conferencia e aqui, e nao no `maxLength` de
 * cada input.
 */
function assertEmbedTotal(embed: AnnouncementEmbed): void {
  const total =
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footerText?.length ?? 0) +
    (embed.authorName?.length ?? 0);

  if (total > DISCORD_LIMITS.EMBED_TOTAL) {
    throw new ValidationError(`Embed com ${total} caracteres.`, {
      userMessage:
        `O texto do embed soma ${total} caracteres e o Discord aceita ` +
        `${DISCORD_LIMITS.EMBED_TOTAL}. Encurte a descricao.`,
    });
  }
}

/** Le o formulario do anuncio SEM embed. */
export function readAnnouncementPlainText(read: FieldReader): string {
  const value = read(ANNOUNCE_FIELD.PLAIN).trim();
  if (value.length === 0) {
    throw new ValidationError('Anuncio sem texto.', {
      userMessage: 'Escreva a mensagem do anuncio.',
    });
  }
  return truncate(value, BUSINESS_LIMITS.ANNOUNCE_PLAIN_MAX);
}

/** Le o formulario de um botao de link. */
export function readAnnouncementButton(
  read: FieldReader,
  parseEmoji: (raw: string) => ButtonEmoji | null,
): AnnouncementButton {
  const label = read(ANNOUNCE_FIELD.BUTTON_LABEL).trim();
  if (label.length === 0) {
    throw new ValidationError('Botao de anuncio sem nome.', {
      userMessage: 'Informe o nome que aparece no botao.',
    });
  }

  return {
    label: truncate(label, BUSINESS_LIMITS.ANNOUNCE_BUTTON_LABEL_MAX),
    url: sanitizeLinkUrl(read(ANNOUNCE_FIELD.BUTTON_URL)),
    emoji: parseEmoji(read(ANNOUNCE_FIELD.BUTTON_EMOJI)),
  };
}

// ---------------------------------------------------------------------------
// Mensagem publicada
// ---------------------------------------------------------------------------

/** Embed do rascunho no formato da API. */
export function buildAnnouncementEmbed(embed: AnnouncementEmbed): EmbedBuilder {
  const built = new EmbedBuilder();

  if (embed.title !== null) built.setTitle(embed.title);
  if (embed.description !== null) built.setDescription(embed.description);
  if (embed.thumbnailUrl !== null) built.setThumbnail(embed.thumbnailUrl);
  if (embed.imageUrl !== null) built.setImage(embed.imageUrl);
  if (embed.color !== null) built.setColor(embed.color);

  if (embed.footerText !== null) {
    built.setFooter({
      text: embed.footerText,
      ...(embed.footerIconUrl !== null ? { iconURL: embed.footerIconUrl } : {}),
    });
  }
  if (embed.authorName !== null) {
    built.setAuthor({
      name: embed.authorName,
      ...(embed.authorIconUrl !== null ? { iconURL: embed.authorIconUrl } : {}),
    });
  }

  return built;
}

/**
 * Botoes de link, em linhas de cinco.
 *
 * Sao `ButtonStyle.Link`: nao tem customId, nao geram interacao e por isso
 * continuam funcionando com o bot offline — que e o que se espera de um anuncio
 * publicado, que fica no canal por semanas.
 */
export function buildAnnouncementButtonRows(
  buttons: readonly AnnouncementButton[],
): Array<ActionRowBuilder<ButtonBuilder>> {
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];

  for (let start = 0; start < buttons.length; start += DISCORD_LIMITS.BUTTONS_PER_ROW) {
    const slice = buttons.slice(start, start + DISCORD_LIMITS.BUTTONS_PER_ROW);
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...slice.map((button) => {
          const built = new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(truncate(button.label, DISCORD_LIMITS.BUTTON_LABEL))
            .setURL(button.url);
          if (button.emoji !== null) built.setEmoji(button.emoji);
          return built;
        }),
      ),
    );
  }

  return rows;
}

export interface AnnouncementPayload {
  content?: string;
  embeds: EmbedBuilder[];
  components: Array<ActionRowBuilder<ButtonBuilder>>;
}

/**
 * A mensagem exatamente como sera publicada.
 *
 * A MESMA funcao alimenta a previa efemera e o envio no canal. Ter uma unica
 * fonte e o que garante que a previa nao minta: nao existe caminho em que o
 * publicado difira do que o autor aprovou.
 */
export function buildAnnouncementPayload(draft: AnnouncementDraft): AnnouncementPayload {
  const components = buildAnnouncementButtonRows(draft.buttons);

  if (draft.withEmbed) {
    return { embeds: [buildAnnouncementEmbed(draft.embed)], components };
  }
  return { content: draft.plainText ?? '', embeds: [], components };
}

/** True quando o rascunho ja tem o que publicar. */
export function isDraftPublishable(draft: AnnouncementDraft): boolean {
  return draft.withEmbed
    ? hasVisibleContent(draft.embed)
    : draft.plainText !== null && draft.plainText.length > 0;
}

// ---------------------------------------------------------------------------
// Painel de composicao (a previa)
// ---------------------------------------------------------------------------

/**
 * Botao do painel de composicao.
 *
 * `Secondary` sem excecao: a politica visual da loja e que TODO botao do bot
 * seja cinza — quem separa "Publicar" de "Descartar" e o emoji, nao a cor.
 * Ha um teste estatico varrendo o fonte inteiro para garantir isso.
 */
function composerButton(
  action: string,
  draftId: string,
  label: string,
  emoji: string,
  disabled = false,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ANNOUNCE, action, draftId))
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
}

/**
 * Nota de rodape da previa.
 *
 * Vai num embed PROPRIO, e nao misturado ao anuncio, por um motivo simples: o
 * que esta acima precisa ser identico ao que sera publicado. Um cabecalho
 * escrito dentro do `content` funcionaria no modo embed e falsearia o modo sem
 * embed, onde o `content` E o anuncio.
 */
function previewNote(draft: AnnouncementDraft, warnings: readonly string[]): APIEmbed {
  const parts = [
    `Previa — publica em ${channelMention(draft.channelId)}`,
    `${draft.buttons.length}/${BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS} botoes`,
    'so voce ve esta mensagem',
  ];

  // SEM cor: a politica visual da loja e que nenhum painel do bot tenha barra
  // colorida. A cor escolhida no formulario e do ANUNCIO, que e conteudo da
  // loja; esta nota e cromo do bot e segue a regra da casa.
  const note: APIEmbed = {
    footer: { text: truncate(parts.join(' • '), DISCORD_LIMITS.EMBED_FOOTER_TEXT) },
  };

  if (warnings.length === 0) return note;
  return {
    ...note,
    description: truncate(
      warnings.map((warning) => `${EMOJIS.PENDING} ${warning}`).join('\n'),
      DISCORD_LIMITS.EMBED_DESCRIPTION,
    ),
  };
}

export interface AnnouncementPreview {
  content?: string;
  embeds: Array<EmbedBuilder | APIEmbed>;
  components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>;
}

/**
 * Painel efemero de composicao.
 *
 * E a previa E o painel: o anuncio aparece renderizado de verdade, com os
 * proprios botoes de link, e a ultima linha traz as acoes de quem esta
 * montando. Descrever o embed em texto ("titulo: X, cor: Y") seria mais facil e
 * pior — ninguem consegue julgar espacamento, corte de imagem ou contraste
 * lendo uma lista de campos.
 */
export function buildAnnouncementPreview(
  draft: AnnouncementDraft,
  warnings: readonly string[] = [],
): AnnouncementPreview {
  const payload = buildAnnouncementPayload(draft);
  const publishable = isDraftPublishable(draft);

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    composerButton(
      ANNOUNCE_ACTION.EDIT,
      draft.id,
      draft.withEmbed ? 'Editar embed' : 'Editar texto',
      EMOJIS.EDIT,
    ),
    composerButton(
      ANNOUNCE_ACTION.BUTTON_ADD,
      draft.id,
      'Adicionar botao',
      EMOJIS.ADD,
      draft.buttons.length >= BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS,
    ),
    composerButton(
      ANNOUNCE_ACTION.BUTTON_REMOVE,
      draft.id,
      'Remover botao',
      EMOJIS.REMOVE,
      draft.buttons.length === 0,
    ),
    composerButton(ANNOUNCE_ACTION.PUBLISH, draft.id, 'Publicar', EMOJIS.APPROVE, !publishable),
    composerButton(ANNOUNCE_ACTION.DISCARD, draft.id, 'Descartar', EMOJIS.DELETE),
  );

  const notice = publishable
    ? warnings
    : [...warnings, 'Preencha o conteudo antes de publicar.'];

  const preview: AnnouncementPreview = {
    embeds: [...payload.embeds, previewNote(draft, notice)],
    components: [...payload.components, actions],
  };

  // `content` vazio numa mensagem sem embed proprio deixaria a previa em branco;
  // o aviso do rodape sozinho ja explica o que falta.
  if (payload.content !== undefined && payload.content.length > 0) {
    preview.content = payload.content;
  }
  return preview;
}

/** Select de qual botao remover — rotulado como o botao aparece no anuncio. */
export function buildButtonRemoveSelect(
  draft: AnnouncementDraft,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(
      buildCustomId(NAMESPACE.ANNOUNCE, ANNOUNCE_ACTION.BUTTON_REMOVE_SELECT, draft.id),
    )
    .setPlaceholder('Escolha o botao que sai do anuncio')
    .addOptions(
      ...draft.buttons.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((button, index) => {
        const option = new StringSelectMenuOptionBuilder()
          .setValue(String(index))
          .setLabel(truncate(`${index + 1}. ${button.label}`, DISCORD_LIMITS.SELECT_LABEL))
          .setDescription(truncate(button.url, DISCORD_LIMITS.SELECT_DESCRIPTION));
        if (button.emoji !== null) option.setEmoji(button.emoji);
        return option;
      }),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/** Resumo de um botao para logs e mensagens de confirmacao. */
export function describeButton(button: AnnouncementButton): string {
  const emoji = formatButtonEmoji(button.emoji);
  return `${emoji.length > 0 ? `${emoji} ` : ''}${button.label} → ${button.url}`;
}
