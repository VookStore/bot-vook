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
import { userMention } from '../../../utils/discord';
import { isSafeImageUrl, truncate } from '../../../utils/sanitize';
import { buildReviewInviteButton } from '../../reviews/builders/ReviewBuilders';
import { formatTicketNumber } from './TicketInternalPanelBuilder';

/**
 * Cartao de encerramento enviado na DM do cliente.
 *
 * UMA MENSAGEM SO. Antes o fechamento disparava duas DMs seguidas — o aviso de
 * encerramento e, logo atras, o convite de avaliacao — que chegavam como dois
 * cartoes quase iguais. O cliente lia o mesmo numero de ticket duas vezes e
 * respondia a segunda achando que era repeticao. Os detalhes e o convite sao o
 * mesmo assunto e agora dividem o mesmo cartao.
 *
 * O convite so entra quando ha o que avaliar: ticket ja avaliado nao ganha
 * botao (ver `canRequestReview`). Um botao que so sabe responder "voce ja
 * avaliou" e pior que botao nenhum.
 */

export interface ClosureDmParams {
  storeName: string;
  ownerId: string;
  ticketNumber: number;
  categoryName: string;
  /** Quem encerrou — nao necessariamente quem atendeu. */
  closedById: string | null;
  /** Nome exibido de quem encerrou, mostrado entre parenteses. */
  closedByLabel: string | null;
  closeReason: string | null;
  /** Banner do topo (`ticketBannerUrl` da guild). Ausente apenas omite a arte. */
  bannerUrl: string | null;
  /**
   * Alvo do botao de avaliacao. `null` nao mostra o convite — e o que
   * diferencia "ainda da para avaliar" de "ja avaliou".
   */
  reviewTicketId: string | null;
  /**
   * Transcript hospedado. Ausente apenas omite o botao — o cartao nunca deixa
   * de sair porque a hospedagem falhou.
   */
  transcriptUrl?: string | null;
}

/**
 * Motivo em UMA linha.
 *
 * Ele divide linha com o rotulo, entao uma quebra digitada no modal pelo
 * atendente empurraria o texto para fora do alinhamento do bloco.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildClosureDm(params: ClosureDmParams): ContainerBuilder {
  const root = container(COLORS.NEUTRAL);

  /*
   * O banner abre o cartao, sem cabecalho de texto: o titulo escrito repetiria
   * o que a arte da loja ja diz. Sem banner configurado, o cartao comeca na
   * saudacao — a arte e enfeite e nunca decide se a DM sai.
   */
  const banner = params.bannerUrl;
  if (banner !== null && isSafeImageUrl(banner)) {
    root.addMediaGalleryComponents(
      mediaGallery([banner], `${params.storeName} — atendimento encerrado`),
    );
    root.addSeparatorComponents(separator());
  }

  root.addTextDisplayComponents(
    text(
      `Ola, ${userMention(params.ownerId)}!\n\n` +
        `Seu atendimento foi encerrado em **${params.storeName}**. ` +
        'Aqui estao os detalhes do seu atendimento:',
    ),
  );
  root.addSeparatorComponents(separator());

  const closedBy =
    params.closedById === null
      ? 'Nao informado'
      : `${userMention(params.closedById)}${
          params.closedByLabel === null ? '' : ` (${params.closedByLabel})`
        }`;

  root.addTextDisplayComponents(
    text(
      [
        `${EMOJIS.TICKET_FOLDER} Categoria: ${params.categoryName}`,
        `${EMOJIS.TICKET} Protocolo: \`${formatTicketNumber(params.ticketNumber)}\``,
        `${EMOJIS.LOCK} Encerrado por: ${closedBy}`,
        `${EMOJIS.NOTIFY} Motivo do encerramento: ${
          params.closeReason === null
            ? 'Nenhum motivo informado.'
            : oneLine(truncate(params.closeReason, 300))
        }`,
      ].join('\n'),
    ),
  );

  /*
   * As duas acoes dividem UMA linha de botoes.
   *
   * Avaliar e ler o historico sao coisas diferentes, mas nenhuma das duas
   * merece um bloco proprio num cartao que ja tem quatro campos — e o container
   * tem dez filhos no total. Cada uma aparece quando faz sentido: sem avaliacao
   * pendente, so o transcript; sem hospedagem configurada, so a avaliacao.
   */
  const actions: ButtonBuilder[] = [];
  if (params.reviewTicketId !== null) {
    actions.push(buildReviewInviteButton(params.reviewTicketId));
  }
  if (params.transcriptUrl !== undefined && params.transcriptUrl !== null) {
    actions.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Ver histórico do atendimento')
        .setEmoji(EMOJIS.LIST)
        .setURL(params.transcriptUrl),
    );
  }

  if (actions.length === 0) {
    root.addTextDisplayComponents(
      footerNote(`Obrigado por entrar em contato com a ${params.storeName}.`),
    );
    return root;
  }

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      params.reviewTicketId !== null
        ? `${EMOJIS.REVIEW} Com base no atendimento recebido, gostariamos de convida-lo(a) a ` +
            '**avaliar nosso suporte** para que possamos melhorar cada vez mais nossos servicos.'
        : `${EMOJIS.LIST} O historico completo deste atendimento ficou guardado no link abaixo.`,
    ),
  );
  root.addActionRowComponents(buttonRow(...actions));
  root.addTextDisplayComponents(
    footerNote(
      params.reviewTicketId !== null
        ? `${params.storeName} — a avaliacao e opcional e leva menos de um minuto.`
        : `Obrigado por entrar em contato com a ${params.storeName}.`,
    ),
  );

  /*
   * Contagem no caminho mais pesado (com banner e com convite): galeria,
   * separador, saudacao, separador, detalhes, separador, convite, botao e
   * rodape = 9 dos 10 filhos que um Container aceita.
   */
  return root;
}
