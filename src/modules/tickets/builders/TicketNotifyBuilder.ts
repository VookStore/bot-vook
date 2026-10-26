import { ButtonBuilder, ButtonStyle, ContainerBuilder } from 'discord.js';

import { COLORS, EMOJIS } from '../../../constants/branding';
import {
  buttonRow,
  container,
  footerNote,
  mediaGallery,
  separator,
  text,
} from '../../../components/v2';
import { channelUrl, userMention } from '../../../utils/discord';
import { escapeMarkdownLayout, isSafeImageUrl, truncate } from '../../../utils/sanitize';
import { discordTimestamp } from '../../../utils/time';
import { formatTicketNumber } from './TicketInternalPanelBuilder';

/**
 * DM de "a equipe esta te aguardando".
 *
 * O QUE MUDOU E POR QUE. A versao anterior dizia apenas "Seu atendimento
 * recebeu uma atualizacao" e listava Ticket, Categoria e Atendente em blocos
 * empilhados. O cliente tinha de abrir o ticket so para descobrir o que estavam
 * perguntando — e essa ida e justamente o atrito que a notificacao existe para
 * remover. Agora a DM carrega a ULTIMA MENSAGEM DA EQUIPE: da para responder
 * sabendo do que se trata, ou perceber que ja respondeu.
 */

/** Quanto da mensagem citada cabe na DM antes de virar parede de texto. */
const QUOTE_MAX = 600;

/** Rotulo do botao que leva ao atendimento. */
export const NOTIFY_BUTTON_LABEL = 'Ir para o atendimento';

export interface LastStaffMessage {
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date;
}

export interface ClientNotifyDmParams {
  storeName: string;
  guildId: string;
  channelId: string;
  ownerId: string;
  ticketNumber: number;
  categoryName: string;
  /** Quem clicou em notificar. */
  staffId: string;
  bannerUrl: string | null;
  /** Ultima mensagem da equipe no ticket; ausente omite a citacao. */
  lastMessage: LastStaffMessage | null;
}

/**
 * Citacao da mensagem da equipe.
 *
 * `escapeMarkdownLayout` neutraliza `#`, `>`, crase e colchete: sem isso, uma
 * mensagem que comece com `#` viraria titulo dentro da DM e uma crase solta
 * abriria bloco de codigo engolindo o resto do cartao. O texto continua legivel
 * — o escape mexe so no que quebraria a estrutura.
 *
 * Cada linha ganha `> ` porque `>>>` transformaria em citacao tudo que viesse
 * depois, inclusive o rodape.
 */
function quote(content: string): string {
  const limpo = escapeMarkdownLayout(truncate(content.trim(), QUOTE_MAX));
  return limpo
    .split('\n')
    .map((linha) => (linha.trim().length === 0 ? '>' : `> ${linha}`))
    .join('\n');
}

export function buildClientNotifyDm(params: ClientNotifyDmParams): ContainerBuilder {
  const root = container(COLORS.INFO);

  const banner = params.bannerUrl;
  if (banner !== null && isSafeImageUrl(banner)) {
    root.addMediaGalleryComponents(mediaGallery([banner], params.storeName));
    root.addSeparatorComponents(separator());
  }

  root.addTextDisplayComponents(
    text(
      `${EMOJIS.NOTIFY} **A equipe esta aguardando sua resposta.**\n\n` +
        `Ola, ${userMention(params.ownerId)}! ${userMention(params.staffId)} respondeu no seu ` +
        `atendimento em **${params.storeName}**.`,
    ),
  );
  root.addSeparatorComponents(separator());

  root.addTextDisplayComponents(
    text(
      `${EMOJIS.TICKET} Ticket \`${formatTicketNumber(params.ticketNumber)}\`  •  ` +
        `${EMOJIS.TICKET_FOLDER} ${params.categoryName}`,
    ),
  );

  /*
   * A citacao e o coracao desta DM. Sem ela, "seu atendimento recebeu uma
   * atualizacao" obriga o cliente a abrir o ticket para descobrir o que
   * perguntaram — e quem esta ocupado simplesmente adia.
   */
  if (params.lastMessage !== null) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(
      text(
        `${EMOJIS.LIST} **${escapeMarkdownLayout(params.lastMessage.authorName)}** ` +
          `— ${discordTimestamp(params.lastMessage.createdAt, 'R')}\n` +
          quote(params.lastMessage.content),
      ),
    );
  }

  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(NOTIFY_BUTTON_LABEL)
        .setEmoji(EMOJIS.TICKET)
        .setURL(channelUrl(params.guildId, params.channelId)),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(`Responda por la — a equipe da ${params.storeName} esta acompanhando.`),
  );

  /*
   * Contagem no pior caso: galeria, separador, saudacao, separador, dados,
   * separador, citacao, botao e rodape = 9 dos 10 filhos do Container.
   */
  return root;
}
