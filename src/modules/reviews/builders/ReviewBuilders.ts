import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { COLORS, EMOJIS, TITLES, renderStars } from '../../../constants/branding';
import { NAMESPACE, REVIEW_ACTION, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  buttonRow,
  container,
  field,
  footerNote,
  separator,
  text,
} from '../../../components/v2';
import { escapeMarkdownLayout, truncate } from '../../../utils/sanitize';
import { discordTimestamp } from '../../../utils/time';

/**
 * Interface da avaliacao pos-atendimento (Components V2).
 *
 * PRIVACIDADE — regra que nao pode ser flexibilizada:
 * a publicacao no canal publico mostra SOMENTE nota, cliente, numero do ticket,
 * categoria, atendente, comentario sanitizado e data. Assunto do ticket,
 * transcript, motivo de encerramento, valores, cobrancas e chave PIX NUNCA
 * entram aqui — nem sequer sao parametros destas funcoes.
 */

/** Menor e maior nota aceitas. */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/** Notas disponiveis no painel de avaliacao (1..5). */
export const REVIEW_RATINGS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Id do CAMPO de texto do modal (lido pelo handler via `interaction.fields`).
 *
 * Nao e um customId de roteamento: campos de modal nao passam pelo router, por
 * isso usam um nome simples em vez de `namespace:action` (que daria a entender,
 * erradamente, que existe um handler escutando `review:comment`).
 */
export const REVIEW_COMMENT_INPUT_ID = 'comment';

/** Numero do atendimento no formato visual da Vook Store: `#0125`. */
export function formatTicketNumber(ticketNumber: number): string {
  return `#${String(Math.max(0, Math.trunc(ticketNumber))).padStart(4, '0')}`;
}

export interface ReviewRequestParams {
  /** Alvo dos customIds dos botoes de nota. */
  ticketId: string;
  storeName: string;
  ticketNumber: number;
  categoryName: string;
}

/**
 * Convite de avaliacao no cartao de encerramento.
 *
 * UM botao, e nao as cinco notas direto: o cartao de encerramento e um aviso, e
 * cinco estrelas ali dentro competem com os detalhes do atendimento que o
 * cliente foi ler. O clique abre o painel de notas, que ai sim so trata disso.
 */
export function buildReviewInviteButton(ticketId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.REVIEW, REVIEW_ACTION.START, ticketId))
    .setLabel('Avaliar este atendimento')
    .setEmoji(EMOJIS.REVIEW)
    .setStyle(ButtonStyle.Secondary);
}

/** Um botao por nota, com o alvo embutido no customId. */
function buildRatingButton(ticketId: string, rating: number): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(
      buildCustomId(NAMESPACE.REVIEW, REVIEW_ACTION.RATE, ticketId, String(rating)),
    )
    .setLabel(`${EMOJIS.REVIEW} ${rating}`)
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Painel enviado por DM ao cliente quando o atendimento e encerrado.
 * As cinco notas ficam em UMA action row (limite real do Discord: 5 botoes).
 */
export function buildReviewRequest(params: ReviewRequestParams): ContainerBuilder {
  const root = container(COLORS.BRAND);

  addHeader(root, TITLES.REVIEW_REQUEST);

  root.addTextDisplayComponents(
    text(
      `Seu atendimento ${formatTicketNumber(params.ticketNumber)} foi concluido.\n` +
        'Como foi sua experiencia com nossa equipe?',
    ),
  );

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text(field('Categoria', params.categoryName)));
  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    buttonRow(...REVIEW_RATINGS.map((rating) => buildRatingButton(params.ticketId, rating))),
  );

  root.addTextDisplayComponents(
    footerNote(`${params.storeName} — sua avaliacao e opcional e leva menos de um minuto.`),
  );

  return root;
}

/**
 * Modal de comentario. O campo e OPCIONAL: quem so quer dar a nota confirma
 * sem escrever nada.
 */
export function buildReviewCommentModal(ticketId: string, rating: number): ModalBuilder {
  const commentInput = new TextInputBuilder()
    .setCustomId(REVIEW_COMMENT_INPUT_ID)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(BUSINESS_LIMITS.REVIEW_COMMENT_MAX)
    .setPlaceholder('Opcional — pode enviar em branco.');

  const commentLabel = new LabelBuilder()
    .setLabel(truncate('Conte um pouco sobre sua experiencia', DISCORD_LIMITS.TEXT_INPUT_LABEL))
    .setTextInputComponent(commentInput);

  return new ModalBuilder()
    .setCustomId(
      buildCustomId(NAMESPACE.REVIEW, REVIEW_ACTION.COMMENT_MODAL, ticketId, String(rating)),
    )
    .setTitle(truncate(`Avaliacao ${rating}/5 — Vook Store`, DISCORD_LIMITS.MODAL_TITLE))
    .addLabelComponents(commentLabel);
}

export interface PublishedReviewParams {
  storeName: string;
  rating: number;
  customerId: string;
  ticketNumber: number;
  categoryName: string;
  staffId: string | null;
  comment: string | null;
  createdAt: Date;
}

/**
 * Publicacao no canal publico de avaliacoes.
 * Recebe apenas dados nao sensiveis — ver o bloco de PRIVACIDADE no topo.
 */
export function buildPublishedReview(params: PublishedReviewParams): ContainerBuilder {
  const root = container(COLORS.GOLD);

  addHeader(root, TITLES.REVIEW_PUBLISHED);

  root.addTextDisplayComponents(
    text(`${renderStars(params.rating)}  **${params.rating}/5**`),
  );
  root.addSeparatorComponents(separator());

  // Quatro dados em duas linhas. A NOTA e o comentario sao o conteudo desta
  // publicacao; ficha tecnica empilhada empurrava os dois para baixo da dobra.
  root.addTextDisplayComponents(
    text(
      `**Cliente** <@${params.customerId}>  •  **Atendente** ${
        params.staffId !== null && params.staffId.length > 0
          ? `<@${params.staffId}>`
          : 'nao atribuido'
      }\n` +
        `-# Atendimento ${formatTicketNumber(params.ticketNumber)} · ${params.categoryName}`,
    ),
  );

  root.addSeparatorComponents(separator());

  // O comentario e o UNICO texto livre de cliente que a loja republica em canal
  // publico. Escapar a sintaxe de layout impede que ele finja ser um anuncio
  // oficial (link mascarado, cabecalho, bloco de codigo). O escape vem DEPOIS
  // do corte para nao cortar no meio de uma barra invertida.
  const comment = params.comment;
  const commentBlock =
    comment !== null && comment.trim().length > 0
      ? `"${escapeMarkdownLayout(truncate(comment.trim(), BUSINESS_LIMITS.REVIEW_COMMENT_MAX))}"`
      : 'Nenhum comentario informado.';

  // O comentario abre o bloco sem rotulo: entre aspas ele ja se anuncia, e
  // "Comentario:" gastava uma linha para nomear o obvio.
  root.addTextDisplayComponents(
    text(`${commentBlock}
-# Avaliado ${discordTimestamp(params.createdAt, 'R')}`),
  );
  root.addTextDisplayComponents(footerNote(params.storeName));

  return root;
}

/** Agradecimento efemero exibido ao cliente logo apos avaliar. */
export function buildReviewThanks(rating: number): ContainerBuilder {
  const root = container(COLORS.SUCCESS);
  root.addTextDisplayComponents(text('✅ **Avaliacao registrada. Muito obrigado!**'));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text(`${renderStars(rating)}  **${rating}/5**`));
  root.addTextDisplayComponents(
    footerNote('Sua opiniao ajuda a Vook Store a melhorar o atendimento.'),
  );
  return root;
}
