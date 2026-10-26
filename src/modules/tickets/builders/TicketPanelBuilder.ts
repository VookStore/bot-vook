import { ButtonBuilder, ButtonStyle, ContainerBuilder } from 'discord.js';
import type { GuildConfig, TicketCategory } from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { NAMESPACE, TICKET_ACTION, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  mediaGallery,
  sectionWithThumbnail,
  separator,
  text,
} from '../../../components/v2';
import { channelUrl } from '../../../utils/discord';
import { isSafeImageUrl, truncate } from '../../../utils/sanitize';
import { formatTicketNumber } from './TicketInternalPanelBuilder';

/**
 * Painel publico da central de atendimento (Components V2).
 *
 * Ordem visual: banner -> divisoria -> titulo + descricao -> avisos ->
 * botao -> divisoria -> assinatura da equipe.
 *
 * O BANNER ABRE O PAINEL. Ele ficava depois dos avisos, com o argumento de que
 * o titulo precisava vir primeiro; na pratica a arte da loja E o cabecalho —
 * ela identifica o servidor antes de qualquer texto, e o painel passou a ser
 * lido como um cartaz, com o titulo servindo de chamada logo abaixo.
 *
 * UM BOTAO, NAO UM MENU. O select de categorias saiu daqui e entrou no
 * formulario: o cliente escolhia a categoria no painel publico e so entao via o
 * campo do motivo, num segundo passo. Agora o painel faz uma pergunta so
 * ("quer abrir um ticket?") e o formulario recebe motivo e categoria juntos.
 */

/** Rotulo do botao que abre o formulario. */
export const START_BUTTON_LABEL = 'Iniciar atendimento';

/**
 * Botao que abre o formulario de abertura.
 *
 * `Secondary` como todo botao do bot — a politica visual da loja e que a cor
 * nunca carregue significado, e ha um teste estatico varrendo o fonte.
 */
export function buildTicketStartButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CREATE))
    .setLabel(START_BUTTON_LABEL)
    .setEmoji(EMOJIS.TICKET)
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Renderiza os avisos como CITACAO do Discord (barra lateral).
 *
 * O prefixo `> ` vai linha a linha de proposito: `>>>` transformaria todo o
 * resto da mensagem em citacao, engolindo o que vier depois. Linhas vazias
 * viram `>` sozinho para a barra nao se partir em blocos separados.
 *
 * A enfase (negrito) fica no TEXTO do operador, nao aqui — o builder cuida da
 * estrutura, o conteudo continua sendo dele.
 */
function asBlockquote(notice: string): string {
  return notice
    .split('\n')
    .map((line) => (line.trim().length === 0 ? '>' : `> ${line}`))
    .join('\n');
}

/**
 * Monta o painel publico.
 *
 * Quando nao ha categoria habilitada, o botao e substituido por um aviso —
 * nunca fica um botao que so sabe responder que nao da para abrir ticket.
 */
export function buildTicketPanel(
  config: GuildConfig,
  categories: readonly TicketCategory[],
): ContainerBuilder {
  const root = container(COLORS.BRAND);

  if (isSafeImageUrl(config.panelBannerUrl)) {
    root.addMediaGalleryComponents(
      mediaGallery([config.panelBannerUrl as string], config.storeName),
    );
    root.addSeparatorComponents(separator());
  }

  /*
   * `###` e nao `##`: o titulo agora e uma chamada abaixo do banner, nao o
   * cabecalho da mensagem. Um H2 aqui competia em peso com a propria arte.
   */
  const title = `### ${config.panelTitle || TITLES.TICKET_PANEL}`;
  const description = config.panelDescription.trim();
  const thumbnailUrl = isSafeImageUrl(config.panelThumbnailUrl)
    ? (config.panelThumbnailUrl as string)
    : null;

  // Titulo e descricao no MESMO bloco para a miniatura alinhar com os dois.
  const headerBlocks = description.length > 0 ? [title, description] : [title];

  if (thumbnailUrl !== null) {
    root.addSectionComponents(sectionWithThumbnail(headerBlocks, thumbnailUrl, config.storeName));
  } else {
    root.addTextDisplayComponents(text(headerBlocks.join('\n\n')));
  }

  if (config.panelNotice !== null && config.panelNotice.trim().length > 0) {
    root.addTextDisplayComponents(text(asBlockquote(config.panelNotice.trim())));
  }

  const usable = categories.filter((category) => category.enabled && category.deletedAt === null);
  if (usable.length === 0) {
    root.addTextDisplayComponents(
      text(
        `${EMOJIS.DISABLE} **Nenhuma categoria disponivel no momento.**\n` +
          'A equipe ainda esta configurando os setores de atendimento.',
      ),
    );
    return root;
  }

  root.addActionRowComponents(buttonRow(buildTicketStartButton()));
  root.addSeparatorComponents(separator());

  /*
   * O excedente de 25 e avisado no painel, e nao no formulario: quem precisa
   * ver isso e a equipe, que le o painel publicado — o cliente que abre o
   * formulario nao tem o que fazer com a informacao.
   */
  const overflow =
    usable.length > DISCORD_LIMITS.SELECT_OPTIONS
      ? ` — o formulario exibe as primeiras ${DISCORD_LIMITS.SELECT_OPTIONS} de ${usable.length} categorias`
      : '';
  root.addTextDisplayComponents(footerNote(`Equipe ${config.storeName}${overflow}`));

  return root;
}

/** Rotulo do botao que leva o cliente ao atendimento recem-aberto. */
export const GO_TO_TICKET_LABEL = 'Ir para o atendimento';

/**
 * Confirmacao efemera exibida ao cliente logo apos abrir o ticket.
 *
 * DUAS LINHAS E UM BOTAO. A versao anterior empilhava Ticket, Categoria e
 * Posicao em blocos de duas linhas cada, e o caminho para a conversa era uma
 * mencao de canal solta no rodape — que num TOPICO PRIVADO nem sempre e
 * clicavel para quem ainda nao carregou a lista. Esta tela existe para uma
 * coisa so: dizer que deu certo e levar ate la.
 *
 * O botao e `Link`: nao gera interacao, entao funciona mesmo se o bot cair no
 * segundo seguinte, e nao gasta o tempo de resposta de nada.
 */
export function buildTicketCreatedNotice(params: {
  guildId: string;
  ticketNumber: number;
  categoryName: string;
  channelId: string;
  queuePosition: number;
  aheadCount: number;
}): ContainerBuilder {
  const root = container(COLORS.SUCCESS);

  const fila =
    params.aheadCount === 0
      ? 'Voce e o proximo a ser atendido.'
      : params.aheadCount === 1
        ? `Ha 1 atendimento na frente do seu (posicao #${params.queuePosition}).`
        : `Ha ${params.aheadCount} atendimentos na frente do seu (posicao #${params.queuePosition}).`;

  root.addTextDisplayComponents(
    text(
      `${EMOJIS.APPROVE} **Seu atendimento foi aberto.**\n\n` +
        `**Ticket** \`${formatTicketNumber(params.ticketNumber)}\`  •  ` +
        `**Categoria** ${params.categoryName}\n` +
        `-# ${fila}`,
    ),
  );

  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(GO_TO_TICKET_LABEL)
        .setEmoji(EMOJIS.TICKET)
        .setURL(channelUrl(params.guildId, params.channelId)),
    ),
  );

  return root;
}

/**
 * Orcamento de texto do resumo da fila.
 *
 * Um TextDisplay aceita 4000 caracteres e a soma de TODO texto da mensagem V2
 * tambem e 4000. Com 25 categorias e 10 tickets de previa cada, o bloco unico
 * passava de 6000 e o proprio builder ja estourava ("Invalid string length")
 * antes de chegar ao Discord. O corte e por TAMANHO ACUMULADO, deixando folga
 * para o cabecalho e para o rodape de "nao exibidas".
 */
const QUEUE_TEXT_BUDGET = 3200;

/** Resumo da fila por categoria (usado no diagnostico e no status). */
export function buildQueueSummary(
  entries: ReadonlyArray<{ categoryName: string; waiting: number; tickets: number[] }>,
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, 'VOOK STORE — FILA DE ATENDIMENTO');

  if (entries.length === 0) {
    root.addTextDisplayComponents(text('Nenhuma categoria configurada.'));
    return root;
  }

  const blocks: string[] = [];
  let used = 0;
  let omitted = 0;

  for (const entry of entries) {
    const name = truncate(entry.categoryName, 60);
    let block: string;

    if (entry.waiting === 0) {
      block = `**${name}**\nNenhum atendimento aguardando.`;
    } else {
      const preview = entry.tickets
        .slice(0, BUSINESS_LIMITS.QUEUE_PREVIEW_SIZE)
        .map((number, index) => `#${index + 1} Ticket #${String(number).padStart(4, '0')}`)
        .join('\n');
      const extra =
        entry.waiting > BUSINESS_LIMITS.QUEUE_PREVIEW_SIZE
          ? `\n… e mais ${entry.waiting - BUSINESS_LIMITS.QUEUE_PREVIEW_SIZE}.`
          : '';
      block = `**${name}** — ${entry.waiting} na fila\n${preview}${extra}`;
    }

    // O primeiro bloco sempre entra (truncado, se preciso): melhor uma
    // categoria cortada do que um painel vazio.
    if (blocks.length > 0 && used + block.length + 2 > QUEUE_TEXT_BUDGET) {
      omitted += 1;
      continue;
    }

    blocks.push(truncate(block, QUEUE_TEXT_BUDGET));
    used += block.length + 2;
  }

  root.addTextDisplayComponents(text(blocks.join('\n\n')));

  if (omitted > 0) {
    root.addTextDisplayComponents(
      footerNote(`… e mais ${omitted} categoria(s) nao exibida(s) por limite de tamanho.`),
    );
  }

  return root;
}
