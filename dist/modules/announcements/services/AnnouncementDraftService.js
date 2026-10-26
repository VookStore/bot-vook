"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyEmbed = emptyEmbed;
exports.createDraft = createDraft;
exports.getDraft = getDraft;
exports.setDraftEmbed = setDraftEmbed;
exports.setDraftPlainText = setDraftPlainText;
exports.addDraftButton = addDraftButton;
exports.removeDraftButton = removeDraftButton;
exports.deleteDraft = deleteDraft;
exports.pruneAnnouncementDrafts = pruneAnnouncementDrafts;
exports.announcementDraftCount = announcementDraftCount;
exports.clearAnnouncementDrafts = clearAnnouncementDrafts;
const node_crypto_1 = require("node:crypto");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const drafts = new Map();
function newDraftId() {
    return (0, node_crypto_1.randomBytes)(8).toString('hex');
}
function emptyEmbed() {
    return {
        title: null,
        description: null,
        thumbnailUrl: null,
        imageUrl: null,
        footerText: null,
        footerIconUrl: null,
        authorName: null,
        authorIconUrl: null,
        color: null,
    };
}
function createDraft(input) {
    pruneAnnouncementDrafts();
    if (drafts.size >= limits_1.BUSINESS_LIMITS.MAX_ANNOUNCE_DRAFTS) {
        throw new errors_1.ValidationError('Limite de rascunhos de anuncio atingido.', {
            userMessage: 'Ha rascunhos demais em aberto. Tente novamente em alguns minutos.',
        });
    }
    const draft = {
        id: newDraftId(),
        ...input,
        plainText: null,
        embed: emptyEmbed(),
        buttons: [],
        expiresAt: Date.now() + limits_1.BUSINESS_LIMITS.ANNOUNCE_DRAFT_TTL_MS,
    };
    drafts.set(draft.id, draft);
    return draft;
}
/**
 * Recupera o rascunho revalidando guild e autoria.
 *
 * O `draftId` viaja no customId, que qualquer um consegue ler numa mensagem
 * efemera compartilhada por print. Ele identifica; quem autoriza e esta funcao
 * mais a permissao reconferida no handler.
 */
function getDraft(draftId, guildId, userId) {
    const draft = drafts.get(draftId);
    if (draft === undefined || draft.expiresAt <= Date.now()) {
        drafts.delete(draftId);
        throw new errors_1.ValidationError(`Rascunho de anuncio inexistente: ${draftId}`, {
            userMessage: 'Este rascunho de anuncio expirou. Execute `/anunciar` novamente.',
        });
    }
    if (draft.guildId !== guildId) {
        throw new errors_1.ValidationError('Rascunho de anuncio de outra guild.', {
            userMessage: 'Este rascunho nao pertence a este servidor.',
        });
    }
    if (draft.createdById !== userId) {
        throw new errors_1.PermissionError('Rascunho de anuncio pertence a outro membro.', {
            userMessage: 'Apenas quem iniciou este anuncio pode altera-lo.',
        });
    }
    return draft;
}
/**
 * Substitui campos do rascunho.
 *
 * Renova o TTL: quem esta editando esta usando, e um rascunho nao pode expirar
 * embaixo de quem acabou de digitar o texto.
 */
function replace(draft, patch) {
    const updated = {
        ...draft,
        ...patch,
        expiresAt: Date.now() + limits_1.BUSINESS_LIMITS.ANNOUNCE_DRAFT_TTL_MS,
    };
    drafts.set(draft.id, updated);
    return updated;
}
function setDraftEmbed(draftId, guildId, userId, embed) {
    return replace(getDraft(draftId, guildId, userId), { embed });
}
function setDraftPlainText(draftId, guildId, userId, plainText) {
    return replace(getDraft(draftId, guildId, userId), { plainText });
}
function addDraftButton(draftId, guildId, userId, button) {
    const draft = getDraft(draftId, guildId, userId);
    if (draft.buttons.length >= limits_1.BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS) {
        throw new errors_1.ValidationError('Limite de botoes do anuncio atingido.', {
            userMessage: `Um anuncio aceita no maximo ${limits_1.BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS} botoes.`,
        });
    }
    return replace(draft, { buttons: [...draft.buttons, button] });
}
function removeDraftButton(draftId, guildId, userId, index) {
    const draft = getDraft(draftId, guildId, userId);
    if (index < 0 || index >= draft.buttons.length) {
        throw new errors_1.ValidationError(`Botao inexistente no rascunho: ${index}`, {
            userMessage: 'Este botao ja nao existe. Atualize o painel e tente novamente.',
        });
    }
    return replace(draft, { buttons: draft.buttons.filter((_, position) => position !== index) });
}
function deleteDraft(draftId) {
    drafts.delete(draftId);
}
function pruneAnnouncementDrafts() {
    const now = Date.now();
    let removed = 0;
    for (const [id, draft] of drafts) {
        if (draft.expiresAt <= now) {
            drafts.delete(id);
            removed += 1;
        }
    }
    return removed;
}
function announcementDraftCount() {
    return drafts.size;
}
/** Somente para testes. */
function clearAnnouncementDrafts() {
    drafts.clear();
}
//# sourceMappingURL=AnnouncementDraftService.js.map