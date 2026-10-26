import { ButtonBuilder, ButtonStyle, ContainerBuilder } from 'discord.js';
import type { GuildConfig, Ticket, TicketCategory } from '@prisma/client';

import { COLORS, EMOJIS } from '../../../constants/branding';
import { NAMESPACE, TICKET_ACTION, buildCustomId } from '../../../constants/customIds';
import { DISCORD_LIMITS } from '../../../constants/limits';
import {
  buttonRow,
  container,
  footerNote,
  mediaGallery,
  separator,
  text,
} from '../../../components/v2';
import { channelUrl, isMissingAccessError } from '../../../utils/discord';
import { isSafeImageUrl, truncate } from '../../../utils/sanitize';
import { formatTicketNumber } from './TicketInternalPanelBuilder';

/**
 * Painel "Localizar meu ticket", publicado no canal de destino da categoria.
 *
 * POR QUE ELE EXISTE. Com o ticket virando TOPICO PRIVADO, ele nao aparece mais
 * como um canal na barra lateral: some da lista quando o cliente sai do topico,
 * quando o Discord esconde topicos inativos, ou quando ele simplesmente rola a
 * lista para longe. Antes, com um canal por ticket, achar era trivial. O painel
 * devolve esse caminho — e e por isso que ele mora justamente no canal onde os
 * topicos vivem.
 *
 * O QUE ELE FAZ ALEM DE LISTAR. O clique reinsere o cliente no topico. O modo
 * de falha real nao e "nao sei o link", e sim "sai do topico e nao consigo
 * voltar" — um link para topico privado nao readmite ninguem sozinho.
 */

/** Rotulo do botao publicado no canal de destino. */
export const LOCATOR_BUTTON_LABEL = 'Localizar meu ticket';

export function buildLocatorButton(categoryId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.LOCATE, categoryId))
    .setLabel(LOCATOR_BUTTON_LABEL)
    .setEmoji(EMOJIS.SEARCH)
    .setStyle(ButtonStyle.Secondary);
}

/**
 * O painel fixo do canal.
 *
 * Mesma anatomia do painel publico de abertura (banner, chamada, botao,
 * assinatura) de proposito: sao duas telas do mesmo sistema, e o cliente que
 * reconhece uma reconhece a outra.
 */
export function buildTicketLocatorPanel(
  config: GuildConfig,
  category: TicketCategory,
): ContainerBuilder {
  const root = container(COLORS.BRAND);

  if (isSafeImageUrl(config.panelBannerUrl)) {
    root.addMediaGalleryComponents(
      mediaGallery([config.panelBannerUrl as string], config.storeName),
    );
    root.addSeparatorComponents(separator());
  }

  root.addTextDisplayComponents(
    text(
      `### ${EMOJIS.SEARCH} Localizar Ticket\n\n` +
        'Nao consegue encontrar seu atendimento?\n' +
        `Toque no botao abaixo para ver seus tickets abertos em **${category.name}** — ` +
        'e voltar para dentro deles.',
    ),
  );

  root.addActionRowComponents(buttonRow(buildLocatorButton(category.id)));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(footerNote(`Equipe ${config.storeName}`));

  return root;
}

// ---------------------------------------------------------------------------
// Canal de entregas
// ---------------------------------------------------------------------------

export const DELIVERED_LOCATOR_BUTTON_LABEL = 'Localizar minha entrega';

export function buildDeliveredLocatorButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.LOCATE_DELIVERED))
    .setLabel(DELIVERED_LOCATOR_BUTTON_LABEL)
    .setEmoji(EMOJIS.SEARCH)
    .setStyle(ButtonStyle.Secondary);
}

/**
 * O painel fixo do canal de entregas.
 *
 * POR QUE ELE EXISTE. Na entrega, o topico do ticket e arquivado — sai da lista
 * lateral sem fechar —, e o cliente que fecha a DM ou rola o servidor perde o
 * caminho de volta. E justamente la dentro que ele baixa o arquivo, tira duvida
 * e confirma o recebimento. Este canal so aparece para quem tem entrega
 * pendente, e o painel devolve o caminho.
 *
 * Mesma anatomia do localizador das categorias: o cliente que conhece um
 * reconhece o outro.
 */
export function buildDeliveredLocatorPanel(config: GuildConfig): ContainerBuilder {
  const root = container(COLORS.BRAND);

  if (isSafeImageUrl(config.panelBannerUrl)) {
    root.addMediaGalleryComponents(
      mediaGallery([config.panelBannerUrl as string], config.storeName),
    );
    root.addSeparatorComponents(separator());
  }

  root.addTextDisplayComponents(
    text(
      `### ${EMOJIS.PACKAGE} Seu pedido foi entregue?\n\n` +
        'Toque no botão abaixo para voltar ao atendimento da sua entrega — é lá que você ' +
        'baixa o arquivo, tira dúvidas e **confirma o recebimento**.',
    ),
  );

  root.addActionRowComponents(buttonRow(buildDeliveredLocatorButton()));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    footerNote(`Este canal fica visível enquanto você tiver uma entrega para confirmar. Equipe ${config.storeName}`),
  );

  return root;
}

/** Um ticket do cliente, ja com o que a tela precisa mostrar. */
export interface LocatedTicket {
  ticket: Ticket;
  /** Posicao na fila; 0 quando ja esta em atendimento. */
  queuePosition: number;
  /** False quando o topico sumiu do Discord (apagado a mao). */
  reachable: boolean;
  /** True quando o cliente foi reinserido no topico neste clique. */
  rejoined: boolean;
}

function statusLine(entry: LocatedTicket): string {
  if (!entry.reachable) {
    return `${EMOJIS.DISABLE} conversa indisponivel — avise a equipe`;
  }
  // Entregue vem antes de "em atendimento": e a unica coisa que falta ao
  // cliente fazer, e o botao de confirmar esta la dentro.
  //
  // `instanceof Date`, e nao `!== null`: "entregue" e TER uma data de entrega.
  // Um ticket montado pela metade (projecao parcial, cache antigo) traz o campo
  // `undefined`, e `undefined !== null` o faria aparecer como entregue.
  if (entry.ticket.deliveredAt instanceof Date) {
    return `${EMOJIS.PACKAGE} produto entregue — confirme o recebimento no ticket`;
  }
  if (entry.ticket.claimedById !== null) {
    return `${EMOJIS.CLAIM} em atendimento`;
  }
  return entry.queuePosition > 0
    ? `${EMOJIS.QUEUE} na fila, posicao #${entry.queuePosition}`
    : `${EMOJIS.QUEUE} aguardando atendimento`;
}

/**
 * Resposta efemera do clique.
 *
 * Um botao de LINK por ticket, ate o teto de uma linha. Link nao gera
 * interacao: a mensagem efemera some sozinha e o botao continua valendo
 * enquanto ela estiver na tela.
 */
export function buildLocatorResult(
  guildId: string,
  categoryName: string,
  entries: readonly LocatedTicket[],
  /**
   * Frase de "nao achei nada". O padrao fala do painel de abertura, que e o
   * caminho certo no canal de uma categoria; no canal de entregas o cliente sem
   * entrega pendente nao precisa abrir ticket nenhum.
   */
  options: { emptyMessage?: string } = {},
): ContainerBuilder {
  const root = container(COLORS.INFO);

  if (entries.length === 0) {
    root.addTextDisplayComponents(
      text(
        options.emptyMessage ??
          `${EMOJIS.SEARCH} **Nenhum ticket aberto em ${categoryName}.**\n` +
            'Use o painel de atendimento para abrir um novo — assim que ele existir, ' +
            'este botao traz voce de volta para dentro dele.',
      ),
    );
    return root;
  }

  const shown = entries.slice(0, DISCORD_LIMITS.BUTTONS_PER_ROW);

  root.addTextDisplayComponents(
    text(
      shown
        .map((entry) => {
          const numero = formatTicketNumber(entry.ticket.ticketNumber);
          const assunto = truncate(entry.ticket.subject.replace(/\s+/g, ' ').trim(), 120);
          const readmitido = entry.rejoined ? '\n-# Voce foi readicionado a este topico.' : '';
          return `**${numero}** — ${statusLine(entry)}\n-# ${assunto}${readmitido}`;
        })
        .join('\n\n'),
    ),
  );

  const links = shown
    .filter((entry) => entry.reachable && entry.ticket.channelId !== null)
    .map((entry) =>
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(truncate(formatTicketNumber(entry.ticket.ticketNumber), DISCORD_LIMITS.BUTTON_LABEL))
        .setURL(channelUrl(guildId, entry.ticket.channelId as string)),
    );

  if (links.length > 0) {
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(buttonRow(...links));
  }

  if (entries.length > shown.length) {
    root.addTextDisplayComponents(
      footerNote(`Exibindo ${shown.length} de ${entries.length} atendimentos abertos.`),
    );
  }

  return root;
}

/**
 * Falha de readmissao que NAO deve derrubar a tela.
 *
 * Sem permissao para adicionar membro, o cliente ainda ve a lista e o link — e
 * o link funciona se ele nunca chegou a sair do topico. Perder a tela inteira
 * por causa da readmissao seria trocar um problema parcial por um total.
 */
export function isRecoverableRejoinError(error: unknown): boolean {
  return isMissingAccessError(error);
}
