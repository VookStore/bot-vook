"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANNOUNCE_FIELD = exports.announcementModals = exports.announcementSelects = exports.announcementButtons = void 0;
const discord_js_1 = require("discord.js");
const customIds_1 = require("../../constants/customIds");
const discord_1 = require("../../utils/discord");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const AnnouncementBuilders_1 = require("../../modules/announcements/builders/AnnouncementBuilders");
Object.defineProperty(exports, "ANNOUNCE_FIELD", { enumerable: true, get: function () { return AnnouncementBuilders_1.ANNOUNCE_FIELD; } });
const AnnouncementDraftService_1 = require("../../modules/announcements/services/AnnouncementDraftService");
const AnnouncementService_1 = require("../../modules/announcements/services/AnnouncementService");
const emoji_1 = require("../../modules/announcements/validators/emoji");
function requireAnnounceContext(interaction) {
    const { guild, member } = interaction;
    if (guild === null || !(member instanceof discord_js_1.GuildMember)) {
        throw new errors_1.PermissionError('Interacao de anuncio fora de uma guild em cache.', {
            userMessage: 'Esta acao so pode ser usada dentro do servidor.',
        });
    }
    (0, PermissionService_1.assertCanManageSystem)(member);
    return { guild, guildId: guild.id, actorId: member.id };
}
/** Le um campo do modal sem estourar quando ele veio vazio ou ausente. */
function fieldReader(interaction) {
    return (customId) => {
        try {
            return interaction.fields.getTextInputValue(customId);
        }
        catch {
            // Campo opcional nao preenchido nao chega no payload em algumas versoes
            // do cliente. Ausencia e vazio significam a mesma coisa aqui.
            return '';
        }
    };
}
/**
 * Emoji customizado que o bot nao alcanca.
 *
 * O Discord ACEITA o botao e desenha um quadrado vazio no lugar — o anuncio sai
 * publicado torto e ninguem entende por que. Avisar na previa e o unico momento
 * em que ainda da para trocar.
 */
function emojiWarnings(interaction, draft) {
    const missing = draft.buttons
        .filter((button) => button.emoji?.id !== undefined)
        .filter((button) => !interaction.client.emojis.cache.has(button.emoji?.id ?? ''))
        .map((button) => button.label);
    if (missing.length === 0)
        return [];
    return [
        `O bot nao tem acesso ao emoji de: ${missing.join(', ')}. ` +
            'Use um emoji deste servidor ou remova o botao.',
    ];
}
// ---------------------------------------------------------------------------
// Envio da previa
// ---------------------------------------------------------------------------
function replyPayload(preview) {
    return {
        ...(preview.content !== undefined ? { content: preview.content } : {}),
        embeds: preview.embeds,
        components: preview.components,
        flags: discord_js_1.MessageFlags.Ephemeral,
        allowedMentions: discord_1.NO_MENTIONS,
    };
}
/**
 * `content: ''` explicito ao atualizar.
 *
 * Sem isso, trocar um anuncio de texto para um so com embed deixaria o texto
 * ANTIGO na tela: o Discord mantem o campo que a edicao nao mencionar, e a
 * previa passaria a mostrar algo que ja nao seria publicado.
 */
function updatePayload(preview) {
    return {
        content: preview.content ?? '',
        embeds: preview.embeds,
        components: preview.components,
        allowedMentions: discord_1.NO_MENTIONS,
    };
}
/**
 * Mostra a previa: atualiza a mensagem quando ela ja existe, responde quando e
 * a primeira vez (o formulario aberto direto pelo `/anunciar`).
 */
async function showPreview(interaction, draft, extraWarnings = []) {
    const preview = (0, AnnouncementBuilders_1.buildAnnouncementPreview)(draft, [
        ...extraWarnings,
        ...emojiWarnings(interaction, draft),
    ]);
    if (interaction.isModalSubmit()) {
        if (interaction.isFromMessage()) {
            await interaction.update(updatePayload(preview));
            return;
        }
        await interaction.reply(replyPayload(preview));
        return;
    }
    await interaction.update(updatePayload(preview));
}
/** Encerra o painel: substitui a previa por uma linha de desfecho. */
async function closePanel(interaction, message) {
    await interaction.update({
        content: message,
        embeds: [],
        components: [],
        allowedMentions: discord_1.NO_MENTIONS,
    });
}
function draftOf(interaction, parsed) {
    const context = requireAnnounceContext(interaction);
    const draftId = (0, customIds_1.requireArg)(parsed, 0, 'rascunho do anuncio');
    return { draft: (0, AnnouncementDraftService_1.getDraft)(draftId, context.guildId, context.actorId), context };
}
// ---------------------------------------------------------------------------
// Conteudo
// ---------------------------------------------------------------------------
/** Reabre o formulario principal preenchido com o rascunho atual. */
const editHandler = {
    namespace: customIds_1.NAMESPACE.ANNOUNCE,
    action: customIds_1.ANNOUNCE_ACTION.EDIT,
    async handle(interaction, parsed) {
        const { draft } = draftOf(interaction, parsed);
        await interaction.showModal((0, AnnouncementBuilders_1.buildAnnouncementModal)(draft));
    },
};
/**
 * Recebe o formulario principal.
 *
 * Chega por dois caminhos: o `/anunciar`, que abre o modal sem nenhuma mensagem
 * atras (responde), e o botao "Editar" da previa (atualiza). `showPreview`
 * distingue os dois por `isFromMessage`.
 */
const editModalHandler = {
    namespace: customIds_1.NAMESPACE.ANNOUNCE,
    action: customIds_1.ANNOUNCE_ACTION.EDIT_MODAL,
    async handle(interaction, parsed) {
        const context = requireAnnounceContext(interaction);
        const draftId = (0, customIds_1.requireArg)(parsed, 0, 'rascunho do anuncio');
        const current = (0, AnnouncementDraftService_1.getDraft)(draftId, context.guildId, context.actorId);
        const read = fieldReader(interaction);
        const updated = current.withEmbed
            ? (0, AnnouncementDraftService_1.setDraftEmbed)(draftId, context.guildId, context.actorId, (0, AnnouncementBuilders_1.readAnnouncementEmbed)(read))
            : (0, AnnouncementDraftService_1.setDraftPlainText)(draftId, context.guildId, context.actorId, (0, AnnouncementBuilders_1.readAnnouncementPlainText)(read));
        await showPreview(interaction, updated);
    },
};
// ---------------------------------------------------------------------------
// Botoes de link
// ---------------------------------------------------------------------------
const buttonAddHandler = {
    namespace: customIds_1.NAMESPACE.ANNOUNCE,
    action: customIds_1.ANNOUNCE_ACTION.BUTTON_ADD,
    async handle(interaction, parsed) {
        const { draft } = draftOf(interaction, parsed);
        await interaction.showModal((0, AnnouncementBuilders_1.buildAnnouncementButtonModal)(draft.id));
    },
};
const buttonAddModalHandler = {
    namespace: customIds_1.NAMESPACE.ANNOUNCE,
    action: customIds_1.ANNOUNCE_ACTION.BUTTON_ADD_MODAL,
    async handle(interaction, parsed) {
        const context = requireAnnounceContext(interaction);
        const draftId = (0, customIds_1.requireArg)(parsed, 0, 'rascunho do anuncio');
        const read = fieldReader(interaction);
        const button = (0, AnnouncementBuilders_1.readAnnouncementButton)(read, (raw) => (0, emoji_1.parseButtonEmoji)(raw));
        const updated = (0, AnnouncementDraftService_1.addDraftButton)(draftId, context.guildId, context.actorId, button);
        await showPreview(interaction, updated);
    },
};
/** Mostra o seletor de remocao junto da previa, sem sair da tela. */
const buttonRemoveHandler = {
    namespace: customIds_1.NAMESPACE.ANNOUNCE,
    action: customIds_1.ANNOUNCE_ACTION.BUTTON_REMOVE,
    async handle(interaction, parsed) {
        const { draft } = draftOf(interaction, parsed);
        if (draft.buttons.length === 0) {
            throw new errors_1.ValidationError('Anuncio sem botoes para remover.', {
                userMessage: 'Este anuncio ainda nao tem botoes.',
            });
        }
        const preview = (0, AnnouncementBuilders_1.buildAnnouncementPreview)(draft, emojiWarnings(interaction, draft));
        await interaction.update({
            ...updatePayload(preview),
            components: [...preview.components, (0, AnnouncementBuilders_1.buildButtonRemoveSelect)(draft)],
        });
    },
};
const buttonRemoveSelectHandler = {
    namespace: customIds_1.NAMESPACE.ANNOUNCE,
    action: customIds_1.ANNOUNCE_ACTION.BUTTON_REMOVE_SELECT,
    async handle(interaction, parsed) {
        const context = requireAnnounceContext(interaction);
        const draftId = (0, customIds_1.requireArg)(parsed, 0, 'rascunho do anuncio');
        if (!interaction.isStringSelectMenu()) {
            throw new errors_1.ValidationError('Select de botao com tipo inesperado.', {
                userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
            });
        }
        const index = Number.parseInt(interaction.values[0] ?? '', 10);
        if (!Number.isInteger(index)) {
            throw new errors_1.ValidationError('Indice de botao invalido.', {
                userMessage: 'Selecione um botao valido.',
            });
        }
        const updated = (0, AnnouncementDraftService_1.removeDraftButton)(draftId, context.guildId, context.actorId, index);
        await showPreview(interaction, updated);
    },
};
// ---------------------------------------------------------------------------
// Desfecho
// ---------------------------------------------------------------------------
const publishHandler = {
    namespace: customIds_1.NAMESPACE.ANNOUNCE,
    action: customIds_1.ANNOUNCE_ACTION.PUBLISH,
    async handle(interaction, parsed) {
        const { draft, context } = draftOf(interaction, parsed);
        const message = await (0, AnnouncementService_1.publishAnnouncement)(context.guild, draft);
        await closePanel(interaction, `Anuncio publicado em <#${draft.channelId}>.\n` +
            `${(0, discord_1.messageUrl)(context.guildId, draft.channelId, message.id)}`);
    },
};
const discardHandler = {
    namespace: customIds_1.NAMESPACE.ANNOUNCE,
    action: customIds_1.ANNOUNCE_ACTION.DISCARD,
    async handle(interaction, parsed) {
        const { draft } = draftOf(interaction, parsed);
        const summary = draft.buttons.length > 0
            ? `\nBotoes descartados: ${draft.buttons.map(AnnouncementBuilders_1.describeButton).join(', ')}`
            : '';
        (0, AnnouncementDraftService_1.deleteDraft)(draft.id);
        await closePanel(interaction, `Anuncio descartado. Nada foi publicado.${summary}`);
    },
};
exports.announcementButtons = [
    editHandler,
    buttonAddHandler,
    buttonRemoveHandler,
    publishHandler,
    discardHandler,
];
exports.announcementSelects = [buttonRemoveSelectHandler];
exports.announcementModals = [
    editModalHandler,
    buttonAddModalHandler,
];
//# sourceMappingURL=index.js.map