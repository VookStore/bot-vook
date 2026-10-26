import { randomBytes } from 'node:crypto';

import { BUSINESS_LIMITS } from '../../../constants/limits';
import { PermissionError, ValidationError } from '../../../core/errors';
import type { ButtonEmoji } from '../validators/emoji';

/**
 * Rascunhos de anuncio.
 *
 * Um anuncio se monta em varias etapas — formulario do conteudo, um botao de
 * link por vez, previa — e so vira mensagem no clique em "Publicar". O estado
 * dessas etapas fica em MEMORIA, como o rascunho de cobranca: nada foi
 * publicado ainda, entao perder um rascunho num restart nao perde dado nenhum
 * (basta repetir o comando) e nao suja o banco com anuncio que ninguem enviou.
 *
 * O mapa e limitado por TTL e podado pelo job de manutencao.
 */

export interface AnnouncementButton {
  label: string;
  url: string;
  emoji: ButtonEmoji | null;
}

/**
 * Campos do embed, todos opcionais.
 *
 * `null` significa "nao preenchido" e nao vai para a mensagem — e a diferenca
 * entre um anuncio so com imagem e um anuncio com titulo vazio, que o Discord
 * recusaria.
 */
export interface AnnouncementEmbed {
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  footerText: string | null;
  footerIconUrl: string | null;
  authorName: string | null;
  authorIconUrl: string | null;
  color: number | null;
}

export interface AnnouncementDraft {
  id: string;
  guildId: string;
  /** Canal de DESTINO do anuncio, escolhido no comando. */
  channelId: string;
  createdById: string;
  /** Falso quando o anuncio e mensagem de texto simples, sem embed. */
  withEmbed: boolean;
  /** Texto do anuncio SEM embed. Ignorado quando `withEmbed` e verdadeiro. */
  plainText: string | null;
  embed: AnnouncementEmbed;
  buttons: AnnouncementButton[];
  expiresAt: number;
}

const drafts = new Map<string, AnnouncementDraft>();

function newDraftId(): string {
  return randomBytes(8).toString('hex');
}

export function emptyEmbed(): AnnouncementEmbed {
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

export interface CreateAnnouncementDraftInput {
  guildId: string;
  channelId: string;
  createdById: string;
  withEmbed: boolean;
}

export function createDraft(input: CreateAnnouncementDraftInput): AnnouncementDraft {
  pruneAnnouncementDrafts();

  if (drafts.size >= BUSINESS_LIMITS.MAX_ANNOUNCE_DRAFTS) {
    throw new ValidationError('Limite de rascunhos de anuncio atingido.', {
      userMessage: 'Ha rascunhos demais em aberto. Tente novamente em alguns minutos.',
    });
  }

  const draft: AnnouncementDraft = {
    id: newDraftId(),
    ...input,
    plainText: null,
    embed: emptyEmbed(),
    buttons: [],
    expiresAt: Date.now() + BUSINESS_LIMITS.ANNOUNCE_DRAFT_TTL_MS,
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
export function getDraft(draftId: string, guildId: string, userId: string): AnnouncementDraft {
  const draft = drafts.get(draftId);
  if (draft === undefined || draft.expiresAt <= Date.now()) {
    drafts.delete(draftId);
    throw new ValidationError(`Rascunho de anuncio inexistente: ${draftId}`, {
      userMessage: 'Este rascunho de anuncio expirou. Execute `/anunciar` novamente.',
    });
  }
  if (draft.guildId !== guildId) {
    throw new ValidationError('Rascunho de anuncio de outra guild.', {
      userMessage: 'Este rascunho nao pertence a este servidor.',
    });
  }
  if (draft.createdById !== userId) {
    throw new PermissionError('Rascunho de anuncio pertence a outro membro.', {
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
function replace(draft: AnnouncementDraft, patch: Partial<AnnouncementDraft>): AnnouncementDraft {
  const updated: AnnouncementDraft = {
    ...draft,
    ...patch,
    expiresAt: Date.now() + BUSINESS_LIMITS.ANNOUNCE_DRAFT_TTL_MS,
  };
  drafts.set(draft.id, updated);
  return updated;
}

export function setDraftEmbed(
  draftId: string,
  guildId: string,
  userId: string,
  embed: AnnouncementEmbed,
): AnnouncementDraft {
  return replace(getDraft(draftId, guildId, userId), { embed });
}

export function setDraftPlainText(
  draftId: string,
  guildId: string,
  userId: string,
  plainText: string,
): AnnouncementDraft {
  return replace(getDraft(draftId, guildId, userId), { plainText });
}

export function addDraftButton(
  draftId: string,
  guildId: string,
  userId: string,
  button: AnnouncementButton,
): AnnouncementDraft {
  const draft = getDraft(draftId, guildId, userId);

  if (draft.buttons.length >= BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS) {
    throw new ValidationError('Limite de botoes do anuncio atingido.', {
      userMessage: `Um anuncio aceita no maximo ${BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS} botoes.`,
    });
  }

  return replace(draft, { buttons: [...draft.buttons, button] });
}

export function removeDraftButton(
  draftId: string,
  guildId: string,
  userId: string,
  index: number,
): AnnouncementDraft {
  const draft = getDraft(draftId, guildId, userId);
  if (index < 0 || index >= draft.buttons.length) {
    throw new ValidationError(`Botao inexistente no rascunho: ${index}`, {
      userMessage: 'Este botao ja nao existe. Atualize o painel e tente novamente.',
    });
  }
  return replace(draft, { buttons: draft.buttons.filter((_, position) => position !== index) });
}

export function deleteDraft(draftId: string): void {
  drafts.delete(draftId);
}

export function pruneAnnouncementDrafts(): number {
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

export function announcementDraftCount(): number {
  return drafts.size;
}

/** Somente para testes. */
export function clearAnnouncementDrafts(): void {
  drafts.clear();
}
