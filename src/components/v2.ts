import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
  type RoleSelectMenuBuilder,
  type StringSelectMenuBuilder,
  type UserSelectMenuBuilder,
} from 'discord.js';

import { DISCORD_LIMITS } from '../constants/limits';
import { truncate } from '../utils/sanitize';

/**
 * Camada de composicao Components V2.
 *
 * Toda a interface do Vook Store Bot e construida com Components V2
 * (ContainerBuilder + TextDisplay + Section + Separator + MediaGallery).
 * Estes helpers existem para padronizar o visual e evitar repeticao.
 *
 * API verificada contra @discordjs/builders 1.14.1 (discord.js 14.27.0).
 */

/** Bloco de texto simples. */
export function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

export interface SeparatorOptions {
  spacing?: SeparatorSpacingSize;
  divider?: boolean;
}

/** Separador visual entre blocos. */
export function separator(options: SeparatorOptions = {}): SeparatorBuilder {
  return new SeparatorBuilder()
    .setSpacing(options.spacing ?? SeparatorSpacingSize.Small)
    .setDivider(options.divider ?? true);
}

/**
 * POLITICA VISUAL DA VOOK STORE: nenhum painel tem barra de cor.
 *
 * O parametro continua existindo — os chamadores seguem passando a cor que
 * representa o estado (sucesso, erro, aguardando) — mas ele NAO e aplicado.
 * Concentrar a decisao aqui mantem a semantica no codigo e torna a politica
 * reversivel numa linha, em vez de espalhar a mudanca por ~40 pontos de chamada
 * e perder a informacao de estado no caminho.
 */
export function container(_accentColor?: number): ContainerBuilder {
  return new ContainerBuilder();
}

/** Titulo padrao dos paineis: `## TITULO`. */
export function heading(title: string): TextDisplayBuilder {
  return text(`## ${title}`);
}

export function subheading(title: string): TextDisplayBuilder {
  return text(`### ${title}`);
}

/**
 * Campo rotulado no formato visual da Vook Store:
 *
 *   **Cliente**
 *   @cliente
 */
export function field(label: string, value: string): string {
  return `**${label}**\n${value}`;
}

/** Varios campos em um unico bloco de texto. */
export function fields(entries: ReadonlyArray<[string, string]>): string {
  return entries.map(([label, value]) => field(label, value)).join('\n\n');
}

/** Lista com marcadores. */
export function bullets(items: readonly string[]): string {
  return items.map((item) => `• ${item}`).join('\n');
}

/** Linha de botoes (maximo 5, limite real do Discord). */
export function buttonRow(
  ...buttons: readonly ButtonBuilder[]
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  if (buttons.length > DISCORD_LIMITS.BUTTONS_PER_ROW) {
    throw new RangeError(
      `Uma action row aceita no maximo ${DISCORD_LIMITS.BUTTONS_PER_ROW} botoes.`,
    );
  }
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons);
}

export type AnySelectMenuBuilder =
  | StringSelectMenuBuilder
  | UserSelectMenuBuilder
  | RoleSelectMenuBuilder
  | ChannelSelectMenuBuilder;

/** Linha contendo um unico select menu. */
export function selectRow(
  menu: AnySelectMenuBuilder,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    menu as unknown as MessageActionRowComponentBuilder,
  );
}

/** Miniatura para usar como acessorio de Section. */
export function thumbnail(url: string, description?: string): ThumbnailBuilder {
  const builder = new ThumbnailBuilder().setURL(url);
  if (description !== undefined && description.length > 0) {
    builder.setDescription(truncate(description, 256));
  }
  return builder;
}

/** Galeria de midia (banner). */
export function mediaGallery(urls: readonly string[], description?: string): MediaGalleryBuilder {
  const gallery = new MediaGalleryBuilder();
  for (const url of urls) {
    const item = new MediaGalleryItemBuilder().setURL(url);
    if (description !== undefined && description.length > 0) {
      item.setDescription(truncate(description, 256));
    }
    gallery.addItems(item);
  }
  return gallery;
}

/** Section com texto a esquerda e botao a direita. */
export function sectionWithButton(
  contents: readonly string[],
  button: ButtonBuilder,
): SectionBuilder {
  const section = new SectionBuilder();
  for (const content of contents) section.addTextDisplayComponents(text(content));
  return section.setButtonAccessory(button);
}

/** Section com texto a esquerda e miniatura a direita. */
export function sectionWithThumbnail(
  contents: readonly string[],
  thumbnailUrl: string,
  description?: string,
): SectionBuilder {
  const section = new SectionBuilder();
  for (const content of contents) section.addTextDisplayComponents(text(content));
  return section.setThumbnailAccessory(thumbnail(thumbnailUrl, description));
}

/**
 * Adiciona um cabecalho padrao ao container: titulo, separador e (opcional)
 * miniatura ao lado do titulo.
 */
export function addHeader(
  target: ContainerBuilder,
  title: string,
  options: {
    thumbnailUrl?: string | null;
    subtitle?: string;
    /**
     * Texto alternativo da miniatura. Omitido usa o titulo; `null` deixa a
     * miniatura SEM alternativo — util quando ela e puramente a marca e
     * repetir o titulo em voz alta so atrapalharia quem usa leitor de tela.
     */
    thumbnailDescription?: string | null;
  } = {},
): ContainerBuilder {
  const titleText = `## ${title}`;
  const thumbnailUrl = options.thumbnailUrl;

  if (thumbnailUrl !== null && thumbnailUrl !== undefined && thumbnailUrl.length > 0) {
    const contents = options.subtitle !== undefined ? [titleText, options.subtitle] : [titleText];
    const description =
      options.thumbnailDescription === undefined ? title : (options.thumbnailDescription ?? '');
    target.addSectionComponents(sectionWithThumbnail(contents, thumbnailUrl, description));
  } else {
    target.addTextDisplayComponents(text(titleText));
    if (options.subtitle !== undefined) target.addTextDisplayComponents(text(options.subtitle));
  }

  return target.addSeparatorComponents(separator({ spacing: SeparatorSpacingSize.Small }));
}

/** Rodape discreto. */
export function footerNote(content: string): TextDisplayBuilder {
  return text(`-# ${content}`);
}

export { SeparatorSpacingSize };

/** Interacoes de componente que suportam `update`. */
export type ComponentInteraction = ButtonInteraction | AnySelectMenuInteraction;
