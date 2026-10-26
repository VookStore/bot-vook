import { ButtonBuilder, ButtonStyle, ContainerBuilder } from 'discord.js';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  separator,
  text,
} from '../../../components/v2';
import { channelUrl, userMention } from '../../../utils/discord';
import { escapeMarkdownLayout } from '../../../utils/sanitize';
import { discordTimestamp } from '../../../utils/time';

/**
 * Cartao do ticket entregue, no canal de concluidos.
 *
 * POR QUE UM CARTAO, E NAO O TOPICO. O pedido era mover o topico para o canal
 * de concluidos, e o Discord nao move topico: ele pertence para sempre ao canal
 * onde nasceu. Entao o topico e ARQUIVADO (sai da lista de ativos, sem fechar)
 * e este cartao e o atalho — o canal de concluidos vira a lista dos
 * atendimentos entregues, com o estado de cada um.
 *
 * O cartao e reconstruido do banco a cada mudanca, nunca remendado: tudo que
 * ele mostra vem do ticket (e do pedido, quando ha um).
 */

/**
 * Em que pe o atendimento esta.
 *
 * `cliente` e `equipe` separam QUEM fechou: o fechamento pela equipe, num
 * ticket entregue, significa que o cliente nao chegou a confirmar o
 * recebimento — e isso e informacao, nao detalhe.
 */
export type TicketDoneState = 'aguardando' | 'cliente' | 'equipe';

export interface TicketDoneCardData {
  guildId: string;
  /** Topico do atendimento; nulo esconde o botao (canal apagado). */
  ticketChannelId: string | null;
  /** `#0042`. */
  ticketLabel: string;
  categoryName: string;
  customerId: string;
  /** Quem assumiu o atendimento; nulo omite a linha. */
  staffId: string | null;
  deliveredById: string | null;
  deliveredAt: Date | null;
  /** `VK-000184`; nulo quando a entrega nao teve pedido. */
  orderLabel: string | null;
  state: TicketDoneState;
  closedById: string | null;
  closedAt: Date | null;
  /** Transcript hospedado, quando o ticket ja fechou e a hospedagem esta ligada. */
  transcriptUrl: string | null;
}

function detailLines(data: TicketDoneCardData): string {
  const linhas = [
    `${EMOJIS.TICKET} **Ticket:** \`${data.ticketLabel}\`  •  ${EMOJIS.TICKET_FOLDER} ${escapeMarkdownLayout(data.categoryName)}`,
    `${EMOJIS.ROLE} **Cliente:** ${userMention(data.customerId)}`,
  ];
  if (data.staffId !== null) {
    linhas.push(`${EMOJIS.CLAIM} **Atendente:** ${userMention(data.staffId)}`);
  }
  if (data.orderLabel !== null) {
    linhas.push(`${EMOJIS.RECEIPT} **Pedido:** \`${data.orderLabel}\``);
  }
  if (data.deliveredAt !== null) {
    const por = data.deliveredById === null ? '' : ` por ${userMention(data.deliveredById)}`;
    linhas.push(`${EMOJIS.DELIVER} **Entregue${por}** • ${discordTimestamp(data.deliveredAt, 'f')}`);
  }
  return linhas.join('\n');
}

function statusBlock(data: TicketDoneCardData): string {
  if (data.state === 'aguardando') {
    return (
      `${EMOJIS.PACKAGE} **Aguardando o cliente confirmar o recebimento.**\n` +
      '-# O ticket saiu da lista de ativos, mas continua aberto: se o cliente responder, ele volta sozinho.'
    );
  }

  const quando = data.closedAt === null ? '' : ` ${discordTimestamp(data.closedAt, 'R')}`;

  if (data.state === 'cliente') {
    return `${EMOJIS.APPROVE} **Concluído pelo cliente**${quando} — recebimento confirmado.`;
  }

  const quem = data.closedById === null ? '' : ` por ${userMention(data.closedById)}`;
  return (
    `${EMOJIS.LOCK} **Encerrado pela equipe**${quem}${quando}.\n` +
    '-# O cliente não chegou a confirmar o recebimento.'
  );
}

function subtitle(data: TicketDoneCardData): string {
  if (data.state === 'aguardando') return '-# Produto entregue, esperando o cliente.';
  return '-# Atendimento concluído.';
}

/**
 * Botoes de link, e so de link: o cartao nao opera nada.
 *
 * O topico continua abrindo depois de fechado (arquivado e trancado, so
 * leitura), entao o atalho segue util como historico. O transcript entra
 * quando existe — e a versao que sobrevive mesmo se o topico for apagado.
 */
function buttons(data: TicketDoneCardData): ButtonBuilder[] {
  const lista: ButtonBuilder[] = [];
  if (data.ticketChannelId !== null) {
    lista.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(`Abrir ticket ${data.ticketLabel}`)
        .setEmoji(EMOJIS.TICKET)
        .setURL(channelUrl(data.guildId, data.ticketChannelId)),
    );
  }
  if (data.state !== 'aguardando' && data.transcriptUrl !== null) {
    lista.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Ver transcript')
        .setEmoji(EMOJIS.LIST)
        .setURL(data.transcriptUrl),
    );
  }
  return lista;
}

export function buildTicketDoneCard(data: TicketDoneCardData): ContainerBuilder {
  const root = container(data.state === 'aguardando' ? COLORS.INFO : COLORS.SUCCESS);
  addHeader(root, `${EMOJIS.APPROVE} ${TITLES.TICKET_DONE}`, { subtitle: subtitle(data) });

  root.addTextDisplayComponents(text(detailLines(data)));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text(statusBlock(data)));

  const lista = buttons(data);
  if (lista.length > 0) {
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(buttonRow(...lista));
  }

  root.addTextDisplayComponents(
    footerNote('Este cartão acompanha o atendimento até o fim e fica como registro.'),
  );

  /*
   * Pior caso dos 10 filhos do Container: titulo, subtitulo e separador (3),
   * dados (4), separador (5), estado (6), separador (7), botoes (8) e rodape (9).
   */
  return root;
}
