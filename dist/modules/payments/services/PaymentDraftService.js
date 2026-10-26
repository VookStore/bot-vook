"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDraft = createDraft;
exports.getDraft = getDraft;
exports.setDraftCoupon = setDraftCoupon;
exports.deleteDraft = deleteDraft;
exports.pruneDrafts = pruneDrafts;
exports.draftCount = draftCount;
exports.clearDrafts = clearDrafts;
const node_crypto_1 = require("node:crypto");
const errors_1 = require("../../../core/errors");
const DRAFT_TTL_MS = 10 * 60_000;
const MAX_DRAFTS = 500;
const drafts = new Map();
function newDraftId() {
    return (0, node_crypto_1.randomBytes)(8).toString('hex');
}
function createDraft(input) {
    pruneDrafts();
    if (drafts.size >= MAX_DRAFTS) {
        throw new errors_1.ValidationError('Limite de rascunhos simultaneos atingido.', {
            userMessage: 'Ha rascunhos demais em aberto. Tente novamente em alguns minutos.',
        });
    }
    const draft = {
        id: newDraftId(),
        ...input,
        couponId: null,
        expiresAt: Date.now() + DRAFT_TTL_MS,
    };
    drafts.set(draft.id, draft);
    return draft;
}
/** Recupera o rascunho validando guild e autoria. */
function getDraft(draftId, guildId, userId) {
    const draft = drafts.get(draftId);
    if (draft === undefined || draft.expiresAt <= Date.now()) {
        drafts.delete(draftId);
        throw new errors_1.ValidationError(`Rascunho inexistente: ${draftId}`, {
            userMessage: 'Este rascunho de cobranca expirou. Execute `/pagamento criar` novamente.',
        });
    }
    if (draft.guildId !== guildId) {
        throw new errors_1.ValidationError('Rascunho de outra guild.', {
            userMessage: 'Este rascunho nao pertence a este servidor.',
        });
    }
    if (draft.createdById !== userId) {
        throw new errors_1.PermissionError('Rascunho pertence a outro vendedor.', {
            userMessage: 'Apenas quem iniciou esta cobranca pode altera-la.',
        });
    }
    return draft;
}
function setDraftCoupon(draftId, guildId, userId, couponId) {
    const draft = getDraft(draftId, guildId, userId);
    const updated = { ...draft, couponId };
    drafts.set(draftId, updated);
    return updated;
}
function deleteDraft(draftId) {
    drafts.delete(draftId);
}
function pruneDrafts() {
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
function draftCount() {
    return drafts.size;
}
/** Somente para testes. */
function clearDrafts() {
    drafts.clear();
}
//# sourceMappingURL=PaymentDraftService.js.map