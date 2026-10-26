"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_SEPARATOR = exports.ANNOUNCE_FIELD = void 0;
exports.buildAnnouncementModal = buildAnnouncementModal;
exports.buildAnnouncementButtonModal = buildAnnouncementButtonModal;
exports.readAnnouncementEmbed = readAnnouncementEmbed;
exports.readAnnouncementPlainText = readAnnouncementPlainText;
exports.readAnnouncementButton = readAnnouncementButton;
exports.buildAnnouncementEmbed = buildAnnouncementEmbed;
exports.buildAnnouncementButtonRows = buildAnnouncementButtonRows;
exports.buildAnnouncementPayload = buildAnnouncementPayload;
exports.isDraftPublishable = isDraftPublishable;
exports.buildAnnouncementPreview = buildAnnouncementPreview;
exports.buildButtonRemoveSelect = buildButtonRemoveSelect;
exports.describeButton = describeButton;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const emoji_1 = require("../validators/emoji");
const link_1 = require("../validators/link");
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
exports.ANNOUNCE_FIELD = {
    TITLE: 'title',
    DESCRIPTION: 'description',
    IMAGES: 'images',
    FOOTER: 'footer',
    STYLE: 'style',
    PLAIN: 'plain',
    BUTTON_LABEL: 'btn-label',
    BUTTON_URL: 'btn-url',
    BUTTON_EMOJI: 'btn-emoji',
};
/**
 * Separador dos campos agrupados.
 *
 * MESMO IDIOMA do modal visual da configuracao, que ja carrega tres URLs num
 * campo so. A razao e dura: um modal do Discord aceita no maximo CINCO campos,
 * e o anuncio precisa de nove valores. Agrupar por assunto (as duas imagens
 * juntas, o rodape com seu icone) mantem tudo num formulario, que foi o pedido
 * — a alternativa seria espalhar o anuncio por tres modais em sequencia.
 */
exports.FIELD_SEPARATOR = ' | ';
/** Descricao no maximo que o TextInput do Discord aceita (4000), nao os 4096 do embed. */
const DESCRIPTION_MAX = Math.min(limits_1.DISCORD_LIMITS.EMBED_DESCRIPTION, limits_1.DISCORD_LIMITS.TEXT_INPUT_SHORT_VALUE);
// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------
function modalRow(input) {
    return new discord_js_1.ActionRowBuilder().addComponents(input);
}
function modalInput(params) {
    const max = Math.min(params.maxLength, limits_1.DISCORD_LIMITS.TEXT_INPUT_SHORT_VALUE);
    const input = new discord_js_1.TextInputBuilder()
        .setCustomId(params.customId)
        .setLabel((0, sanitize_1.truncate)(params.label, limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setStyle(params.style)
        .setRequired(params.required)
        .setMaxLength(max);
    if (params.placeholder !== undefined) {
        input.setPlaceholder((0, sanitize_1.truncate)(params.placeholder, limits_1.DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));
    }
    // `setValue` maior que `max_length` toma 400 do Discord, entao trunca antes.
    if (params.value !== undefined && params.value !== null && params.value.length > 0) {
        input.setValue((0, sanitize_1.truncate)(params.value, max));
    }
    return input;
}
/** Junta valores num campo agrupado, preservando as posicoes vazias do meio. */
function joinGrouped(parts) {
    return parts.some((part) => part !== null && part.length > 0)
        ? parts.map((part) => part ?? '').join(exports.FIELD_SEPARATOR)
        : '';
}
/**
 * Separa um campo agrupado em `count` posicoes.
 *
 * Posicao ausente ou vazia vira `null` — e assim que "so preenchi a thumbnail"
 * continua significando "sem imagem grande", e nao "imagem com string vazia",
 * que o Discord recusaria.
 */
function splitGrouped(raw, count) {
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
function buildAnnouncementModal(draft) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ANNOUNCE, customIds_1.ANNOUNCE_ACTION.EDIT_MODAL, draft.id))
        .setTitle((0, sanitize_1.truncate)(draft.withEmbed ? 'Anuncio — conteudo do embed' : 'Anuncio — mensagem', limits_1.DISCORD_LIMITS.MODAL_TITLE));
    if (!draft.withEmbed) {
        return modal.addComponents(modalRow(modalInput({
            customId: exports.ANNOUNCE_FIELD.PLAIN,
            label: 'Mensagem do anuncio',
            style: discord_js_1.TextInputStyle.Paragraph,
            required: true,
            maxLength: limits_1.BUSINESS_LIMITS.ANNOUNCE_PLAIN_MAX,
            value: draft.plainText,
            placeholder: 'Texto que sera publicado no canal.',
        })));
    }
    const { embed } = draft;
    return modal.addComponents(modalRow(modalInput({
        customId: exports.ANNOUNCE_FIELD.TITLE,
        label: 'Titulo',
        style: discord_js_1.TextInputStyle.Short,
        required: false,
        maxLength: limits_1.DISCORD_LIMITS.EMBED_TITLE,
        value: embed.title,
        placeholder: 'Opcional.',
    })), modalRow(modalInput({
        customId: exports.ANNOUNCE_FIELD.DESCRIPTION,
        label: 'Descricao',
        style: discord_js_1.TextInputStyle.Paragraph,
        required: false,
        maxLength: DESCRIPTION_MAX,
        value: embed.description,
        placeholder: 'Opcional. Aceita markdown do Discord.',
    })), modalRow(modalInput({
        customId: exports.ANNOUNCE_FIELD.IMAGES,
        label: 'Thumbnail | Imagem',
        style: discord_js_1.TextInputStyle.Paragraph,
        required: false,
        maxLength: limits_1.BUSINESS_LIMITS.IMAGE_URL_MAX * 2 + exports.FIELD_SEPARATOR.length,
        value: joinGrouped([embed.thumbnailUrl, embed.imageUrl]),
        placeholder: 'https://.../logo.png | https://.../banner.png',
    })), modalRow(modalInput({
        customId: exports.ANNOUNCE_FIELD.FOOTER,
        label: 'Rodape | Icone do rodape',
        style: discord_js_1.TextInputStyle.Paragraph,
        required: false,
        maxLength: limits_1.DISCORD_LIMITS.EMBED_FOOTER_TEXT + limits_1.BUSINESS_LIMITS.IMAGE_URL_MAX,
        value: joinGrouped([embed.footerText, embed.footerIconUrl]),
        placeholder: 'Vook Store | https://.../icone.png',
    })), modalRow(modalInput({
        customId: exports.ANNOUNCE_FIELD.STYLE,
        label: 'Cor | Autor | Icone do autor',
        style: discord_js_1.TextInputStyle.Paragraph,
        required: false,
        maxLength: 16 + limits_1.DISCORD_LIMITS.EMBED_AUTHOR_NAME + limits_1.BUSINESS_LIMITS.IMAGE_URL_MAX,
        value: joinGrouped([
            (0, link_1.formatEmbedColor)(embed.color),
            embed.authorName,
            embed.authorIconUrl,
        ]),
        placeholder: '#8b5cf6 | Vook Store | https://.../logo.png',
    })));
}
/** Formulario de UM botao de link. */
function buildAnnouncementButtonModal(draftId) {
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ANNOUNCE, customIds_1.ANNOUNCE_ACTION.BUTTON_ADD_MODAL, draftId))
        .setTitle((0, sanitize_1.truncate)('Anuncio — novo botao', limits_1.DISCORD_LIMITS.MODAL_TITLE))
        .addComponents(modalRow(modalInput({
        customId: exports.ANNOUNCE_FIELD.BUTTON_LABEL,
        label: 'Nome do botao',
        style: discord_js_1.TextInputStyle.Short,
        required: true,
        maxLength: limits_1.BUSINESS_LIMITS.ANNOUNCE_BUTTON_LABEL_MAX,
        placeholder: 'Ver catalogo',
    })), modalRow(modalInput({
        customId: exports.ANNOUNCE_FIELD.BUTTON_URL,
        label: 'Link',
        style: discord_js_1.TextInputStyle.Short,
        required: true,
        maxLength: limits_1.BUSINESS_LIMITS.IMAGE_URL_MAX,
        placeholder: 'https://vookstore.com/catalogo',
    })), modalRow(modalInput({
        customId: exports.ANNOUNCE_FIELD.BUTTON_EMOJI,
        label: 'Emoji (opcional)',
        style: discord_js_1.TextInputStyle.Short,
        required: false,
        maxLength: 64,
        placeholder: '🔥 ou <:hairmtc:1403457616792785017>',
    })));
}
function optional(read, customId) {
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
function readAnnouncementEmbed(read) {
    const [thumbnailUrl, imageUrl] = splitGrouped(read(exports.ANNOUNCE_FIELD.IMAGES), 2);
    const [footerText, footerIconUrl] = splitGrouped(read(exports.ANNOUNCE_FIELD.FOOTER), 2);
    const [color, authorName, authorIconUrl] = splitGrouped(read(exports.ANNOUNCE_FIELD.STYLE), 3);
    const embed = {
        title: optional(read, exports.ANNOUNCE_FIELD.TITLE),
        description: optional(read, exports.ANNOUNCE_FIELD.DESCRIPTION),
        thumbnailUrl: (0, sanitize_1.sanitizeImageUrl)(thumbnailUrl),
        imageUrl: (0, sanitize_1.sanitizeImageUrl)(imageUrl),
        footerText: footerText ?? null,
        footerIconUrl: (0, sanitize_1.sanitizeImageUrl)(footerIconUrl),
        authorName: authorName ?? null,
        authorIconUrl: (0, sanitize_1.sanitizeImageUrl)(authorIconUrl),
        color: (0, link_1.parseEmbedColor)(color),
    };
    /*
     * Um embed precisa ter ALGO que o Discord saiba desenhar. So cor, ou so icone
     * de rodape, produz uma mensagem que a API aceita e que o leitor ve como um
     * retangulo vazio — pior que o erro, porque o anuncio sai publicado assim.
     */
    if (!hasVisibleContent(embed)) {
        throw new errors_1.ValidationError('Embed sem conteudo visivel.', {
            userMessage: 'Preencha ao menos titulo, descricao, imagem ou rodape — um embed so com cor sai vazio.',
        });
    }
    assertEmbedTotal(embed);
    return embed;
}
function hasVisibleContent(embed) {
    return (embed.title !== null ||
        embed.description !== null ||
        embed.imageUrl !== null ||
        embed.thumbnailUrl !== null ||
        embed.footerText !== null ||
        embed.authorName !== null);
}
/**
 * Teto de 6000 caracteres somando os textos do embed.
 *
 * O Discord conta titulo + descricao + rodape + autor JUNTOS e recusa a
 * mensagem inteira ao estourar. Cada campo isolado cabe no proprio limite, e e
 * a soma que escapa — por isso a conferencia e aqui, e nao no `maxLength` de
 * cada input.
 */
function assertEmbedTotal(embed) {
    const total = (embed.title?.length ?? 0) +
        (embed.description?.length ?? 0) +
        (embed.footerText?.length ?? 0) +
        (embed.authorName?.length ?? 0);
    if (total > limits_1.DISCORD_LIMITS.EMBED_TOTAL) {
        throw new errors_1.ValidationError(`Embed com ${total} caracteres.`, {
            userMessage: `O texto do embed soma ${total} caracteres e o Discord aceita ` +
                `${limits_1.DISCORD_LIMITS.EMBED_TOTAL}. Encurte a descricao.`,
        });
    }
}
/** Le o formulario do anuncio SEM embed. */
function readAnnouncementPlainText(read) {
    const value = read(exports.ANNOUNCE_FIELD.PLAIN).trim();
    if (value.length === 0) {
        throw new errors_1.ValidationError('Anuncio sem texto.', {
            userMessage: 'Escreva a mensagem do anuncio.',
        });
    }
    return (0, sanitize_1.truncate)(value, limits_1.BUSINESS_LIMITS.ANNOUNCE_PLAIN_MAX);
}
/** Le o formulario de um botao de link. */
function readAnnouncementButton(read, parseEmoji) {
    const label = read(exports.ANNOUNCE_FIELD.BUTTON_LABEL).trim();
    if (label.length === 0) {
        throw new errors_1.ValidationError('Botao de anuncio sem nome.', {
            userMessage: 'Informe o nome que aparece no botao.',
        });
    }
    return {
        label: (0, sanitize_1.truncate)(label, limits_1.BUSINESS_LIMITS.ANNOUNCE_BUTTON_LABEL_MAX),
        url: (0, link_1.sanitizeLinkUrl)(read(exports.ANNOUNCE_FIELD.BUTTON_URL)),
        emoji: parseEmoji(read(exports.ANNOUNCE_FIELD.BUTTON_EMOJI)),
    };
}
// ---------------------------------------------------------------------------
// Mensagem publicada
// ---------------------------------------------------------------------------
/** Embed do rascunho no formato da API. */
function buildAnnouncementEmbed(embed) {
    const built = new discord_js_1.EmbedBuilder();
    if (embed.title !== null)
        built.setTitle(embed.title);
    if (embed.description !== null)
        built.setDescription(embed.description);
    if (embed.thumbnailUrl !== null)
        built.setThumbnail(embed.thumbnailUrl);
    if (embed.imageUrl !== null)
        built.setImage(embed.imageUrl);
    if (embed.color !== null)
        built.setColor(embed.color);
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
function buildAnnouncementButtonRows(buttons) {
    const rows = [];
    for (let start = 0; start < buttons.length; start += limits_1.DISCORD_LIMITS.BUTTONS_PER_ROW) {
        const slice = buttons.slice(start, start + limits_1.DISCORD_LIMITS.BUTTONS_PER_ROW);
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(...slice.map((button) => {
            const built = new discord_js_1.ButtonBuilder()
                .setStyle(discord_js_1.ButtonStyle.Link)
                .setLabel((0, sanitize_1.truncate)(button.label, limits_1.DISCORD_LIMITS.BUTTON_LABEL))
                .setURL(button.url);
            if (button.emoji !== null)
                built.setEmoji(button.emoji);
            return built;
        })));
    }
    return rows;
}
/**
 * A mensagem exatamente como sera publicada.
 *
 * A MESMA funcao alimenta a previa efemera e o envio no canal. Ter uma unica
 * fonte e o que garante que a previa nao minta: nao existe caminho em que o
 * publicado difira do que o autor aprovou.
 */
function buildAnnouncementPayload(draft) {
    const components = buildAnnouncementButtonRows(draft.buttons);
    if (draft.withEmbed) {
        return { embeds: [buildAnnouncementEmbed(draft.embed)], components };
    }
    return { content: draft.plainText ?? '', embeds: [], components };
}
/** True quando o rascunho ja tem o que publicar. */
function isDraftPublishable(draft) {
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
function composerButton(action, draftId, label, emoji, disabled = false) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ANNOUNCE, action, draftId))
        .setLabel(label)
        .setEmoji(emoji)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
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
function previewNote(draft, warnings) {
    const parts = [
        `Previa — publica em ${(0, discord_1.channelMention)(draft.channelId)}`,
        `${draft.buttons.length}/${limits_1.BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS} botoes`,
        'so voce ve esta mensagem',
    ];
    // SEM cor: a politica visual da loja e que nenhum painel do bot tenha barra
    // colorida. A cor escolhida no formulario e do ANUNCIO, que e conteudo da
    // loja; esta nota e cromo do bot e segue a regra da casa.
    const note = {
        footer: { text: (0, sanitize_1.truncate)(parts.join(' • '), limits_1.DISCORD_LIMITS.EMBED_FOOTER_TEXT) },
    };
    if (warnings.length === 0)
        return note;
    return {
        ...note,
        description: (0, sanitize_1.truncate)(warnings.map((warning) => `${branding_1.EMOJIS.PENDING} ${warning}`).join('\n'), limits_1.DISCORD_LIMITS.EMBED_DESCRIPTION),
    };
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
function buildAnnouncementPreview(draft, warnings = []) {
    const payload = buildAnnouncementPayload(draft);
    const publishable = isDraftPublishable(draft);
    const actions = new discord_js_1.ActionRowBuilder().addComponents(composerButton(customIds_1.ANNOUNCE_ACTION.EDIT, draft.id, draft.withEmbed ? 'Editar embed' : 'Editar texto', branding_1.EMOJIS.EDIT), composerButton(customIds_1.ANNOUNCE_ACTION.BUTTON_ADD, draft.id, 'Adicionar botao', branding_1.EMOJIS.ADD, draft.buttons.length >= limits_1.BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS), composerButton(customIds_1.ANNOUNCE_ACTION.BUTTON_REMOVE, draft.id, 'Remover botao', branding_1.EMOJIS.REMOVE, draft.buttons.length === 0), composerButton(customIds_1.ANNOUNCE_ACTION.PUBLISH, draft.id, 'Publicar', branding_1.EMOJIS.APPROVE, !publishable), composerButton(customIds_1.ANNOUNCE_ACTION.DISCARD, draft.id, 'Descartar', branding_1.EMOJIS.DELETE));
    const notice = publishable
        ? warnings
        : [...warnings, 'Preencha o conteudo antes de publicar.'];
    const preview = {
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
function buildButtonRemoveSelect(draft) {
    const select = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ANNOUNCE, customIds_1.ANNOUNCE_ACTION.BUTTON_REMOVE_SELECT, draft.id))
        .setPlaceholder('Escolha o botao que sai do anuncio')
        .addOptions(...draft.buttons.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((button, index) => {
        const option = new discord_js_1.StringSelectMenuOptionBuilder()
            .setValue(String(index))
            .setLabel((0, sanitize_1.truncate)(`${index + 1}. ${button.label}`, limits_1.DISCORD_LIMITS.SELECT_LABEL))
            .setDescription((0, sanitize_1.truncate)(button.url, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION));
        if (button.emoji !== null)
            option.setEmoji(button.emoji);
        return option;
    }));
    return new discord_js_1.ActionRowBuilder().addComponents(select);
}
/** Resumo de um botao para logs e mensagens de confirmacao. */
function describeButton(button) {
    const emoji = (0, emoji_1.formatButtonEmoji)(button.emoji);
    return `${emoji.length > 0 ? `${emoji} ` : ''}${button.label} → ${button.url}`;
}
//# sourceMappingURL=AnnouncementBuilders.js.map