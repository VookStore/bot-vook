import { randomBytes } from 'node:crypto';

import { PermissionError, ValidationError } from '../../../core/errors';

/**
 * Rascunhos de cobranca.
 *
 * O rascunho existe apenas entre `/pagamento criar` e o clique em "Gerar
 * Cobranca" — e onde o VENDEDOR escolhe o cupom antes de a cobranca existir.
 * Fica em memoria de proposito: nada foi persistido ainda, entao perder um
 * rascunho em um restart nao perde dado nenhum (basta repetir o comando).
 * O mapa e limitado por TTL e podado pelo job de manutencao.
 */

export interface PaymentDraft {
  id: string;
  guildId: string;
  channelId: string;
  createdById: string;
  customerId: string;
  accountId: string;
  description: string;
  amountCents: number;
  couponId: string | null;
  expiresAt: number;
}

const DRAFT_TTL_MS = 10 * 60_000;
const MAX_DRAFTS = 500;

const drafts = new Map<string, PaymentDraft>();

function newDraftId(): string {
  return randomBytes(8).toString('hex');
}

export interface CreateDraftInput {
  guildId: string;
  channelId: string;
  createdById: string;
  customerId: string;
  accountId: string;
  description: string;
  amountCents: number;
}

export function createDraft(input: CreateDraftInput): PaymentDraft {
  pruneDrafts();

  if (drafts.size >= MAX_DRAFTS) {
    throw new ValidationError('Limite de rascunhos simultaneos atingido.', {
      userMessage: 'Ha rascunhos demais em aberto. Tente novamente em alguns minutos.',
    });
  }

  const draft: PaymentDraft = {
    id: newDraftId(),
    ...input,
    couponId: null,
    expiresAt: Date.now() + DRAFT_TTL_MS,
  };
  drafts.set(draft.id, draft);
  return draft;
}

/** Recupera o rascunho validando guild e autoria. */
export function getDraft(draftId: string, guildId: string, userId: string): PaymentDraft {
  const draft = drafts.get(draftId);
  if (draft === undefined || draft.expiresAt <= Date.now()) {
    drafts.delete(draftId);
    throw new ValidationError(`Rascunho inexistente: ${draftId}`, {
      userMessage:
        'Este rascunho de cobranca expirou. Execute `/pagamento criar` novamente.',
    });
  }
  if (draft.guildId !== guildId) {
    throw new ValidationError('Rascunho de outra guild.', {
      userMessage: 'Este rascunho nao pertence a este servidor.',
    });
  }
  if (draft.createdById !== userId) {
    throw new PermissionError('Rascunho pertence a outro vendedor.', {
      userMessage: 'Apenas quem iniciou esta cobranca pode altera-la.',
    });
  }
  return draft;
}

export function setDraftCoupon(
  draftId: string,
  guildId: string,
  userId: string,
  couponId: string | null,
): PaymentDraft {
  const draft = getDraft(draftId, guildId, userId);
  const updated: PaymentDraft = { ...draft, couponId };
  drafts.set(draftId, updated);
  return updated;
}

export function deleteDraft(draftId: string): void {
  drafts.delete(draftId);
}

export function pruneDrafts(): number {
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

export function draftCount(): number {
  return drafts.size;
}

/** Somente para testes. */
export function clearDrafts(): void {
  drafts.clear();
}
