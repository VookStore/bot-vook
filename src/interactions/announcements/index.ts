import {
  GuildMember,
  MessageFlags,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type Guild,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type ModalSubmitInteraction,
} from 'discord.js';

import { ANNOUNCE_ACTION, NAMESPACE, requireArg } from '../../constants/customIds';
import { NO_MENTIONS, messageUrl } from '../../utils/discord';
import { PermissionError, ValidationError } from '../../core/errors';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import {
  ANNOUNCE_FIELD,
  buildAnnouncementButtonModal,
  buildAnnouncementModal,
  buildAnnouncementPreview,
  buildButtonRemoveSelect,
  describeButton,
  readAnnouncementButton,
  readAnnouncementEmbed,
  readAnnouncementPlainText,
  type AnnouncementPreview,
} from '../../modules/announcements/builders/AnnouncementBuilders';
import {
  addDraftButton,
  deleteDraft,
  getDraft,
  removeDraftButton,
  setDraftEmbed,
  setDraftPlainText,
  type AnnouncementDraft,
} from '../../modules/announcements/services/AnnouncementDraftService';
import { publishAnnouncement } from '../../modules/announcements/services/AnnouncementService';
import { parseButtonEmoji, type ButtonEmoji } from '../../modules/announcements/validators/emoji';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';

/**
 * Composicao do anuncio.
 *
 * REGRAS APLICADAS EM TODOS OS HANDLERS:
 *  - o `draftId` do customId identifica, nunca autoriza: `assertCanManageSystem`
 *    roda de novo e `getDraft` reconfere guild e autoria;
 *  - toda tela e efemera — o anuncio so aparece no canal no clique em Publicar;
 *  - nada aqui usa `sendV2`: a previa carrega um embed classico, e a flag V2
 *    proibe `embeds` na mesma mensagem (ver `AnnouncementBuilders`).
 */

type AnnounceInteraction = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

interface AnnounceContext {
  guild: Guild;
  guildId: string;
  actorId: string;
}

function requireAnnounceContext(interaction: AnnounceInteraction): AnnounceContext {
  const { guild, member } = interaction;

  if (guild === null || !(member instanceof GuildMember)) {
    throw new PermissionError('Interacao de anuncio fora de uma guild em cache.', {
      userMessage: 'Esta acao so pode ser usada dentro do servidor.',
    });
  }

  assertCanManageSystem(member);
  return { guild, guildId: guild.id, actorId: member.id };
}

/** Le um campo do modal sem estourar quando ele veio vazio ou ausente. */
function fieldReader(interaction: ModalSubmitInteraction): (customId: string) => string {
  return (customId) => {
    try {
      return interaction.fields.getTextInputValue(customId);
    } catch {
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
function emojiWarnings(interaction: AnnounceInteraction, draft: AnnouncementDraft): string[] {
  const missing = draft.buttons
    .filter((button) => button.emoji?.id !== undefined)
    .filter((button) => !interaction.client.emojis.cache.has(button.emoji?.id ?? ''))
    .map((button) => button.label);

  if (missing.length === 0) return [];
  return [
    `O bot nao tem acesso ao emoji de: ${missing.join(', ')}. ` +
      'Use um emoji deste servidor ou remova o botao.',
  ];
}

// ---------------------------------------------------------------------------
// Envio da previa
// ---------------------------------------------------------------------------

function replyPayload(preview: AnnouncementPreview): InteractionReplyOptions {
  return {
    ...(preview.content !== undefined ? { content: preview.content } : {}),
    embeds: preview.embeds,
    components: preview.components,
    flags: MessageFlags.Ephemeral,
    allowedMentions: NO_MENTIONS,
  };
}

/**
 * `content: ''` explicito ao atualizar.
 *
 * Sem isso, trocar um anuncio de texto para um so com embed deixaria o texto
 * ANTIGO na tela: o Discord mantem o campo que a edicao nao mencionar, e a
 * previa passaria a mostrar algo que ja nao seria publicado.
 */
function updatePayload(preview: AnnouncementPreview): InteractionUpdateOptions {
  return {
    content: preview.content ?? '',
    embeds: preview.embeds,
    components: preview.components,
    allowedMentions: NO_MENTIONS,
  };
}

/**
 * Mostra a previa: atualiza a mensagem quando ela ja existe, responde quando e
 * a primeira vez (o formulario aberto direto pelo `/anunciar`).
 */
async function showPreview(
  interaction: AnnounceInteraction,
  draft: AnnouncementDraft,
  extraWarnings: readonly string[] = [],
): Promise<void> {
  const preview = buildAnnouncementPreview(draft, [
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
async function closePanel(interaction: ButtonInteraction, message: string): Promise<void> {
  await interaction.update({
    content: message,
    embeds: [],
    components: [],
    allowedMentions: NO_MENTIONS,
  });
}

function draftOf(
  interaction: AnnounceInteraction,
  parsed: Parameters<ButtonHandler['handle']>[1],
): { draft: AnnouncementDraft; context: AnnounceContext } {
  const context = requireAnnounceContext(interaction);
  const draftId = requireArg(parsed, 0, 'rascunho do anuncio');
  return { draft: getDraft(draftId, context.guildId, context.actorId), context };
}

// ---------------------------------------------------------------------------
// Conteudo
// ---------------------------------------------------------------------------

/** Reabre o formulario principal preenchido com o rascunho atual. */
const editHandler: ButtonHandler = {
  namespace: NAMESPACE.ANNOUNCE,
  action: ANNOUNCE_ACTION.EDIT,
  async handle(interaction, parsed) {
    const { draft } = draftOf(interaction, parsed);
    await interaction.showModal(buildAnnouncementModal(draft));
  },
};

/**
 * Recebe o formulario principal.
 *
 * Chega por dois caminhos: o `/anunciar`, que abre o modal sem nenhuma mensagem
 * atras (responde), e o botao "Editar" da previa (atualiza). `showPreview`
 * distingue os dois por `isFromMessage`.
 */
const editModalHandler: ModalHandler = {
  namespace: NAMESPACE.ANNOUNCE,
  action: ANNOUNCE_ACTION.EDIT_MODAL,
  async handle(interaction, parsed) {
    const context = requireAnnounceContext(interaction);
    const draftId = requireArg(parsed, 0, 'rascunho do anuncio');
    const current = getDraft(draftId, context.guildId, context.actorId);
    const read = fieldReader(interaction);

    const updated = current.withEmbed
      ? setDraftEmbed(draftId, context.guildId, context.actorId, readAnnouncementEmbed(read))
      : setDraftPlainText(
          draftId,
          context.guildId,
          context.actorId,
          readAnnouncementPlainText(read),
        );

    await showPreview(interaction, updated);
  },
};

// ---------------------------------------------------------------------------
// Botoes de link
// ---------------------------------------------------------------------------

const buttonAddHandler: ButtonHandler = {
  namespace: NAMESPACE.ANNOUNCE,
  action: ANNOUNCE_ACTION.BUTTON_ADD,
  async handle(interaction, parsed) {
    const { draft } = draftOf(interaction, parsed);
    await interaction.showModal(buildAnnouncementButtonModal(draft.id));
  },
};

const buttonAddModalHandler: ModalHandler = {
  namespace: NAMESPACE.ANNOUNCE,
  action: ANNOUNCE_ACTION.BUTTON_ADD_MODAL,
  async handle(interaction, parsed) {
    const context = requireAnnounceContext(interaction);
    const draftId = requireArg(parsed, 0, 'rascunho do anuncio');
    const read = fieldReader(interaction);

    const button = readAnnouncementButton(read, (raw: string): ButtonEmoji | null =>
      parseButtonEmoji(raw),
    );
    const updated = addDraftButton(draftId, context.guildId, context.actorId, button);

    await showPreview(interaction, updated);
  },
};

/** Mostra o seletor de remocao junto da previa, sem sair da tela. */
const buttonRemoveHandler: ButtonHandler = {
  namespace: NAMESPACE.ANNOUNCE,
  action: ANNOUNCE_ACTION.BUTTON_REMOVE,
  async handle(interaction, parsed) {
    const { draft } = draftOf(interaction, parsed);

    if (draft.buttons.length === 0) {
      throw new ValidationError('Anuncio sem botoes para remover.', {
        userMessage: 'Este anuncio ainda nao tem botoes.',
      });
    }

    const preview = buildAnnouncementPreview(draft, emojiWarnings(interaction, draft));
    await interaction.update({
      ...updatePayload(preview),
      components: [...preview.components, buildButtonRemoveSelect(draft)],
    });
  },
};

const buttonRemoveSelectHandler: SelectHandler = {
  namespace: NAMESPACE.ANNOUNCE,
  action: ANNOUNCE_ACTION.BUTTON_REMOVE_SELECT,
  async handle(interaction, parsed) {
    const context = requireAnnounceContext(interaction);
    const draftId = requireArg(parsed, 0, 'rascunho do anuncio');

    if (!interaction.isStringSelectMenu()) {
      throw new ValidationError('Select de botao com tipo inesperado.', {
        userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
      });
    }

    const index = Number.parseInt(interaction.values[0] ?? '', 10);
    if (!Number.isInteger(index)) {
      throw new ValidationError('Indice de botao invalido.', {
        userMessage: 'Selecione um botao valido.',
      });
    }

    const updated = removeDraftButton(draftId, context.guildId, context.actorId, index);
    await showPreview(interaction, updated);
  },
};

// ---------------------------------------------------------------------------
// Desfecho
// ---------------------------------------------------------------------------

const publishHandler: ButtonHandler = {
  namespace: NAMESPACE.ANNOUNCE,
  action: ANNOUNCE_ACTION.PUBLISH,
  async handle(interaction, parsed) {
    const { draft, context } = draftOf(interaction, parsed);

    const message = await publishAnnouncement(context.guild, draft);

    await closePanel(
      interaction,
      `Anuncio publicado em <#${draft.channelId}>.\n` +
        `${messageUrl(context.guildId, draft.channelId, message.id)}`,
    );
  },
};

const discardHandler: ButtonHandler = {
  namespace: NAMESPACE.ANNOUNCE,
  action: ANNOUNCE_ACTION.DISCARD,
  async handle(interaction, parsed) {
    const { draft } = draftOf(interaction, parsed);
    const summary =
      draft.buttons.length > 0
        ? `\nBotoes descartados: ${draft.buttons.map(describeButton).join(', ')}`
        : '';

    deleteDraft(draft.id);
    await closePanel(interaction, `Anuncio descartado. Nada foi publicado.${summary}`);
  },
};

export const announcementButtons: readonly ButtonHandler[] = [
  editHandler,
  buttonAddHandler,
  buttonRemoveHandler,
  publishHandler,
  discardHandler,
];

export const announcementSelects: readonly SelectHandler[] = [buttonRemoveSelectHandler];

export const announcementModals: readonly ModalHandler[] = [
  editModalHandler,
  buttonAddModalHandler,
];

/** Campos do formulario, reexportados para os testes. */
export { ANNOUNCE_FIELD };
