"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeparatorSpacingSize = void 0;
exports.text = text;
exports.separator = separator;
exports.container = container;
exports.heading = heading;
exports.subheading = subheading;
exports.field = field;
exports.fields = fields;
exports.bullets = bullets;
exports.buttonRow = buttonRow;
exports.selectRow = selectRow;
exports.thumbnail = thumbnail;
exports.mediaGallery = mediaGallery;
exports.sectionWithButton = sectionWithButton;
exports.sectionWithThumbnail = sectionWithThumbnail;
exports.addHeader = addHeader;
exports.footerNote = footerNote;
const discord_js_1 = require("discord.js");
Object.defineProperty(exports, "SeparatorSpacingSize", { enumerable: true, get: function () { return discord_js_1.SeparatorSpacingSize; } });
const limits_1 = require("../constants/limits");
const sanitize_1 = require("../utils/sanitize");
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
function text(content) {
    return new discord_js_1.TextDisplayBuilder().setContent(content);
}
/** Separador visual entre blocos. */
function separator(options = {}) {
    return new discord_js_1.SeparatorBuilder()
        .setSpacing(options.spacing ?? discord_js_1.SeparatorSpacingSize.Small)
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
function container(_accentColor) {
    return new discord_js_1.ContainerBuilder();
}
/** Titulo padrao dos paineis: `## TITULO`. */
function heading(title) {
    return text(`## ${title}`);
}
function subheading(title) {
    return text(`### ${title}`);
}
/**
 * Campo rotulado no formato visual da Vook Store:
 *
 *   **Cliente**
 *   @cliente
 */
function field(label, value) {
    return `**${label}**\n${value}`;
}
/** Varios campos em um unico bloco de texto. */
function fields(entries) {
    return entries.map(([label, value]) => field(label, value)).join('\n\n');
}
/** Lista com marcadores. */
function bullets(items) {
    return items.map((item) => `• ${item}`).join('\n');
}
/** Linha de botoes (maximo 5, limite real do Discord). */
function buttonRow(...buttons) {
    if (buttons.length > limits_1.DISCORD_LIMITS.BUTTONS_PER_ROW) {
        throw new RangeError(`Uma action row aceita no maximo ${limits_1.DISCORD_LIMITS.BUTTONS_PER_ROW} botoes.`);
    }
    return new discord_js_1.ActionRowBuilder().addComponents(...buttons);
}
/** Linha contendo um unico select menu. */
function selectRow(menu) {
    return new discord_js_1.ActionRowBuilder().addComponents(menu);
}
/** Miniatura para usar como acessorio de Section. */
function thumbnail(url, description) {
    const builder = new discord_js_1.ThumbnailBuilder().setURL(url);
    if (description !== undefined && description.length > 0) {
        builder.setDescription((0, sanitize_1.truncate)(description, 256));
    }
    return builder;
}
/** Galeria de midia (banner). */
function mediaGallery(urls, description) {
    const gallery = new discord_js_1.MediaGalleryBuilder();
    for (const url of urls) {
        const item = new discord_js_1.MediaGalleryItemBuilder().setURL(url);
        if (description !== undefined && description.length > 0) {
            item.setDescription((0, sanitize_1.truncate)(description, 256));
        }
        gallery.addItems(item);
    }
    return gallery;
}
/** Section com texto a esquerda e botao a direita. */
function sectionWithButton(contents, button) {
    const section = new discord_js_1.SectionBuilder();
    for (const content of contents)
        section.addTextDisplayComponents(text(content));
    return section.setButtonAccessory(button);
}
/** Section com texto a esquerda e miniatura a direita. */
function sectionWithThumbnail(contents, thumbnailUrl, description) {
    const section = new discord_js_1.SectionBuilder();
    for (const content of contents)
        section.addTextDisplayComponents(text(content));
    return section.setThumbnailAccessory(thumbnail(thumbnailUrl, description));
}
/**
 * Adiciona um cabecalho padrao ao container: titulo, separador e (opcional)
 * miniatura ao lado do titulo.
 */
function addHeader(target, title, options = {}) {
    const titleText = `## ${title}`;
    const thumbnailUrl = options.thumbnailUrl;
    if (thumbnailUrl !== null && thumbnailUrl !== undefined && thumbnailUrl.length > 0) {
        const contents = options.subtitle !== undefined ? [titleText, options.subtitle] : [titleText];
        const description = options.thumbnailDescription === undefined ? title : (options.thumbnailDescription ?? '');
        target.addSectionComponents(sectionWithThumbnail(contents, thumbnailUrl, description));
    }
    else {
        target.addTextDisplayComponents(text(titleText));
        if (options.subtitle !== undefined)
            target.addTextDisplayComponents(text(options.subtitle));
    }
    return target.addSeparatorComponents(separator({ spacing: discord_js_1.SeparatorSpacingSize.Small }));
}
/** Rodape discreto. */
function footerNote(content) {
    return text(`-# ${content}`);
}
//# sourceMappingURL=v2.js.map