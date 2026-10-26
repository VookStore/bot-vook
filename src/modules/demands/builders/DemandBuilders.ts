import { ButtonBuilder, ButtonStyle, ContainerBuilder } from 'discord.js';
import { OrderStatus } from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { DISCORD_LIMITS } from '../../../constants/limits';
import { NAMESPACE, ORDER_ACTION, buildCustomId } from '../../../constants/customIds';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  separator,
  text,
} from '../../../components/v2';
import { channelUrl, userMention } from '../../../utils/discord';
import { formatCents } from '../../../utils/money';
import { escapeMarkdownLayout, truncate } from '../../../utils/sanitize';
import { discordTimestamp } from '../../../utils/time';

/**
 * Quadro de demandas (Components V2).
 *
 * Uma demanda e um PEDIDO PAGO: existe trabalho a fazer e alguem esperando.
 * O cartao responde, sem ninguem precisar abrir nada: o que produzir, para
 * quem, ate quando, quem esta cuidando — e leva direto ao atendimento do
 * cliente, que e onde a conversa esta.
 *
 * Os botoes de acao NAO sao proprios deste modulo: sao os mesmos do painel de
 * pedidos (`ORDER_ACTION`). Clicar num deles a partir do cartao publico abre o
 * painel efemero do pedido, porque `beginPanel` responde de forma nova quando a
 * origem nao e efemera. Duplicar os handlers so criaria dois caminhos para a
 * mesma transicao, e um deles envelheceria.
 */

/** Dados que o cartao mostra. Montados pelo service; o builder nao busca nada. */
export interface DemandCardData {
  guildId: string;
  orderId: string;
  /** `VK-000184`, ja formatado. */
  orderLabel: string;
  customerId: string;
  status: OrderStatus;
  /** Texto do status ("Pago — preparando entrega"), ja resolvido. */
  statusLabel: string;
  /** Icone do status, ja resolvido. */
  statusIcon: string;
  /** Total em centavos. */
  totalCents: number;
  /** Quem produz; nulo = livre na fila. */
  assignedToId: string | null;
  dueAt: Date | null;
  /** True quando o prazo ja venceu. */
  overdue: boolean;
  /** Itens do catalogo, quando a venda teve pack. */
  items: ReadonlyArray<{ name: string; priceCents: number; quantity: number }>;
  /**
   * O que foi vendido, quando NAO ha itens.
   *
   * Venda de balcao (`/pagamento criar`) nasce sem pack — a descricao da
   * cobranca e a unica coisa que diz o que produzir. Sem ela, o cartao seria
   * uma demanda sem demanda.
   */
  description: string | null;
  /** Canal do atendimento de onde a venda saiu; nulo esconde o botao. */
  ticketChannelId: string | null;
  /** `#0042` quando a origem e um ticket conhecido. */
  ticketLabel: string | null;
  /** Quando a producao comecou; so aparece no cartao de iniciada. */
  startedAt: Date | null;
  /** Quando o arquivo foi entregue; so aparece no cartao de concluida. */
  deliveredAt: Date | null;
  /**
   * True quando quem CONCLUIU o pedido foi o proprio cliente (confirmando o
   * recebimento no ticket).
   *
   * "Concluido" nao significa "o cliente confirmou": a equipe tambem conclui,
   * pelo botao do painel do pedido. Um cartao que afirmasse a confirmacao do
   * cliente sem ela ter acontecido levaria a equipe a dar por encerrado um
   * atendimento que ainda espera resposta.
   */
  completedByCustomer: boolean;
}

const ITEM_MAX = 6;

function demandButton(action: string, emoji: string, label: string, orderId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, action, orderId))
    .setEmoji(emoji)
    .setLabel(truncate(label, DISCORD_LIMITS.BUTTON_LABEL))
    .setStyle(ButtonStyle.Secondary);
}

/**
 * O que produzir.
 *
 * Lista de itens quando a venda veio do catalogo; a descricao da cobranca
 * quando veio do balcao. Um dos dois sempre existe — se nao existisse, a
 * demanda nao teria conteudo.
 */
function whatToBuild(data: DemandCardData): string {
  if (data.items.length > 0) {
    const linhas = data.items
      .slice(0, ITEM_MAX)
      .map(
        (item) =>
          `• ${escapeMarkdownLayout(item.name)}` +
          (item.quantity > 1 ? ` ×${item.quantity}` : '') +
          ` — ${formatCents(item.priceCents)}`,
      );
    if (data.items.length > ITEM_MAX) {
      linhas.push(`-# e mais ${data.items.length - ITEM_MAX} item(ns) — abra o pedido para ver.`);
    }
    return `${EMOJIS.PACKAGE} **O que produzir**\n${linhas.join('\n')}`;
  }

  if (data.description !== null && data.description.length > 0) {
    return `${EMOJIS.PACKAGE} **O que produzir**\n> ${escapeMarkdownLayout(data.description)}`;
  }

  return `${EMOJIS.PACKAGE} **O que produzir**\n> -# Sem descrição — abra o pedido para ver a cobrança.`;
}

function ownerLine(data: DemandCardData): string {
  return data.assignedToId === null
    ? `${EMOJIS.PENDING} **Responsável:** livre na fila`
    : `${EMOJIS.CLAIM} **Responsável:** ${userMention(data.assignedToId)}`;
}

function dueLine(data: DemandCardData): string | null {
  if (data.dueAt === null) return null;
  const rotulo = data.overdue ? '**Previsão (atrasado)**' : '**Previsão de entrega**';
  return `${EMOJIS.QUEUE} ${rotulo}: ${discordTimestamp(data.dueAt, 'D')}`;
}

/**
 * Botao que leva a conversa com o cliente.
 *
 * O rotulo muda porque o destino muda: a venda de balcao nasce DENTRO do
 * ticket, e ai o botao leva ao atendimento com numero e tudo; a compra pelo
 * catalogo nasce no canal da loja, e prometer "atendimento" ali seria mentira.
 */
function ticketButton(data: DemandCardData): ButtonBuilder | null {
  if (data.ticketChannelId === null) return null;
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(data.ticketLabel === null ? 'Ir ao canal da compra' : `Ticket ${data.ticketLabel}`)
    .setEmoji(EMOJIS.TICKET)
    .setURL(channelUrl(data.guildId, data.ticketChannelId));
}

/**
 * Botoes do estado ATUAL, e so eles.
 *
 * Um botao que so sabe responder "essa transicao nao vale agora" ensina a
 * equipe a ignorar o cartao. A ordem poe na frente a acao que o estado pede:
 * pago espera comecar, em producao espera entregar, entregue espera concluir.
 */
function statusButtons(data: DemandCardData): ButtonBuilder[] {
  const { orderId } = data;

  if (data.status === OrderStatus.PAID) {
    return [
      demandButton(ORDER_ACTION.PROGRESS, EMOJIS.PREPARING, 'Iniciar demanda', orderId),
      data.assignedToId === null
        ? demandButton(ORDER_ACTION.CLAIM, EMOJIS.CLAIM, 'Assumir', orderId)
        : demandButton(ORDER_ACTION.RELEASE, EMOJIS.BACK, 'Liberar', orderId),
    ];
  }

  if (data.status === OrderStatus.IN_PROGRESS) {
    return [
      demandButton(ORDER_ACTION.DELIVER, EMOJIS.DELIVER, 'Marcar entregue', orderId),
      data.assignedToId === null
        ? demandButton(ORDER_ACTION.CLAIM, EMOJIS.CLAIM, 'Assumir', orderId)
        : demandButton(ORDER_ACTION.RELEASE, EMOJIS.BACK, 'Liberar', orderId),
    ];
  }

  if (data.status === OrderStatus.DELIVERED) {
    return [demandButton(ORDER_ACTION.COMPLETE, EMOJIS.APPROVE, 'Concluir', orderId)];
  }

  // Concluida ou cancelada: nao ha transicao a oferecer, so o historico.
  return [];
}

function buildBody(data: DemandCardData, root: ContainerBuilder): void {
  const linhas = [
    `## ${formatCents(data.totalCents)}`,
    `**Pedido** \`${data.orderLabel}\`  •  **Cliente** ${userMention(data.customerId)}`,
    `${data.statusIcon} ${escapeMarkdownLayout(data.statusLabel)}`,
    ownerLine(data),
    dueLine(data),
  ].filter((linha): linha is string => linha !== null);

  root.addTextDisplayComponents(text(linhas.join('\n')));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text(whatToBuild(data)));
}

function buildActions(data: DemandCardData, root: ContainerBuilder): void {
  const botoes = [
    ...statusButtons(data),
    ticketButton(data),
    demandButton(ORDER_ACTION.STAFF, EMOJIS.LIST, 'Abrir pedido', data.orderId),
  ].filter((botao): botao is ButtonBuilder => botao !== null);

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(buttonRow(...botoes.slice(0, DISCORD_LIMITS.BUTTONS_PER_ROW)));
}

/**
 * O cartao do QUADRO: nasce quando o pedido e pago e e reescrito a cada
 * mudanca de estado, no mesmo lugar.
 *
 * Ele nao some quando a demanda e iniciada — passa a dizer quem esta cuidando.
 * O quadro conta a historia inteira do que entrou; o canal de iniciadas conta
 * so o que esta em producao agora.
 */
export function buildDemandCard(data: DemandCardData): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, `${EMOJIS.PACKAGE} ${TITLES.DEMAND}`, {
    subtitle:
      data.status === OrderStatus.PAID
        ? '-# Pago e aguardando produção.'
        : `-# ${escapeMarkdownLayout(data.statusLabel)}.`,
  });

  buildBody(data, root);
  buildActions(data, root);

  root.addTextDisplayComponents(
    footerNote('Somente a equipe da Vook Store consegue operar esta demanda.'),
  );

  /*
   * Pior caso dos 10 filhos do Container: titulo, subtitulo e separador (3),
   * corpo (4), separador (5), o que produzir (6), separador (7), botoes (8) e
   * rodape (9).
   */
  return root;
}

/**
 * A copia publicada quando a producao COMECA.
 *
 * Mesmo conteudo do quadro, com uma diferenca que e o motivo de este canal
 * existir: ele diz QUANDO comecou e QUEM pegou. Quem olha aqui quer saber o que
 * esta em andamento agora, nao o que ja entrou algum dia.
 */
export function buildDemandStartedCard(data: DemandCardData): ContainerBuilder {
  const root = container(COLORS.SUCCESS);
  addHeader(root, `${EMOJIS.PREPARING} ${TITLES.DEMAND_STARTED}`, {
    subtitle:
      data.startedAt === null
        ? '-# Produção iniciada.'
        : `-# Produção iniciada ${discordTimestamp(data.startedAt, 'R')}.`,
  });

  buildBody(data, root);
  buildActions(data, root);

  root.addTextDisplayComponents(
    footerNote('Este cartão acompanha a demanda até ela ser concluída.'),
  );

  return root;
}

/**
 * O cartao no canal de demandas CONCLUIDAS, publicado na entrega.
 *
 * "Concluida" do ponto de vista da producao: o arquivo saiu, nao ha mais o que
 * fazer. O pedido ainda pode estar ENTREGUE esperando o cliente confirmar — e o
 * subtitulo diz isso, para ninguem achar que a venda fechou quando nao fechou.
 * Quando o cliente confirma, o mesmo cartao e reescrito como concluido.
 */
export function buildDemandDoneCard(data: DemandCardData): ContainerBuilder {
  const root = container(COLORS.SUCCESS);

  const quando =
    data.deliveredAt === null ? '' : ` ${discordTimestamp(data.deliveredAt, 'R')}`;
  const subtitulo =
    data.status !== OrderStatus.COMPLETED
      ? `-# Entregue${quando} — aguardando a confirmação do cliente.`
      : data.completedByCustomer
        ? '-# Concluída: o cliente confirmou o recebimento.'
        : '-# Concluída pela equipe.';

  addHeader(root, `${EMOJIS.APPROVE} ${TITLES.DEMAND_DONE}`, { subtitle: subtitulo });

  buildBody(data, root);
  buildActions(data, root);

  root.addTextDisplayComponents(
    footerNote('Este cartão fica aqui como registro da demanda.'),
  );

  return root;
}

// ---------------------------------------------------------------------------
// Aviso ao cliente
// ---------------------------------------------------------------------------

export interface DemandStartedDmData {
  storeName: string;
  guildId: string;
  customerId: string;
  orderLabel: string;
  dueAt: Date | null;
  overdue: boolean;
  /** Quem produz; nulo nao expoe ninguem. */
  assignedToId: string | null;
  ticketChannelId: string | null;
  ticketLabel: string | null;
}

/**
 * DM de "comecamos a produzir".
 *
 * E o unico aviso entre "paguei" e "recebi", e ate aqui esse intervalo era
 * silencio — o cliente pagava e so ouvia falar da loja de novo na entrega.
 * Encomenda demora dias; saber que o trabalho comecou e o que segura a
 * ansiedade (e as mensagens perguntando se esta tudo bem).
 *
 * NAO promete data que a loja nao tenha assumido: a previsao so entra quando
 * ela existe no pedido, e foi congelada no pagamento.
 */
export function buildDemandStartedDm(data: DemandStartedDmData): ContainerBuilder {
  const root = container(COLORS.SUCCESS);
  addHeader(root, `${EMOJIS.PREPARING} ${TITLES.DEMAND_STARTED}`, {
    subtitle: `-# Seu pedido na ${escapeMarkdownLayout(data.storeName)} entrou em produção.`,
  });

  const quem =
    data.assignedToId === null
      ? 'Nossa equipe'
      : `${userMention(data.assignedToId)}, da nossa equipe,`;

  root.addTextDisplayComponents(
    text(
      `Olá, ${userMention(data.customerId)}! Boas notícias: ${quem} começou a trabalhar no ` +
        `seu pedido \`${data.orderLabel}\` agora.`,
    ),
  );

  const detalhes = [
    `${EMOJIS.RECEIPT} **Pedido:** \`${data.orderLabel}\``,
    data.dueAt === null
      ? null
      : `${EMOJIS.QUEUE} **${data.overdue ? 'Previsão (atrasada)' : 'Previsão de entrega'}:** ` +
        discordTimestamp(data.dueAt, 'D'),
    data.ticketLabel === null
      ? null
      : `${EMOJIS.TICKET} **Atendimento:** \`${data.ticketLabel}\``,
  ].filter((linha): linha is string => linha !== null);

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text(detalhes.join('\n')));

  if (data.ticketChannelId !== null) {
    root.addActionRowComponents(
      buttonRow(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('Ir ao atendimento')
          .setEmoji(EMOJIS.TICKET)
          .setURL(channelUrl(data.guildId, data.ticketChannelId)),
      ),
    );
  }

  root.addTextDisplayComponents(
    footerNote('Qualquer dúvida, é só responder no seu atendimento — a equipe acompanha por lá.'),
  );

  return root;
}
