import { ButtonBuilder, ButtonStyle, type ContainerBuilder } from 'discord.js';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  separator,
  text,
} from '../../../components/v2';
import { formatDuration } from '../../../utils/money';
import { discordTimestamp } from '../../../utils/time';
import { userMention } from '../../../utils/discord';
import { formatTicketNumber } from './TicketInternalPanelBuilder';

export interface CloseLogData {
  ticketNumber: number;
  ownerId: string;
  categoryName: string;
  subject: string;
  staffId: string | null;
  closedById: string;
  openedAt: Date;
  closedAt: Date;
  durationMs: number;
  closeReason: string | null;
  participantIds: readonly string[];
  messageCount: number;
  /**
   * Transcript hospedado. Ausente quando a hospedagem esta desligada ou o
   * upload falhou — nesses casos o anexo continua sendo a unica copia.
   */
  transcriptUrl?: string;
}

/** Registro de encerramento enviado ao canal de logs, com o transcript anexado. */
export function buildCloseLog(data: CloseLogData): ContainerBuilder {
  const root = container(COLORS.NEUTRAL);
  addHeader(root, TITLES.TICKET_LOG);

  /*
   * UMA LINHA POR DADO.
   *
   * A versao anterior usava `fields()`: rotulo numa linha, valor na seguinte,
   * linha em branco entre cada um. Onze dados viravam trinta e tres linhas, e a
   * equipe rolava a tela inteira para achar o motivo do encerramento. Aqui cada
   * dado ocupa uma linha e os relacionados dividem a mesma.
   */
  root.addTextDisplayComponents(
    text(
      [
        `**Ticket** \`${formatTicketNumber(data.ticketNumber)}\`  •  **Categoria** ${data.categoryName}`,
        `**Cliente** ${userMention(data.ownerId)}  •  **Responsavel** ${
          data.staffId !== null ? userMention(data.staffId) : 'nao atribuido'
        }`,
        `**Assunto** ${data.subject}`,
      ].join('\n'),
    ),
  );

  root.addSeparatorComponents(separator());

  /*
   * As tres datas viram UMA linha. Separadas, "Criado", "Finalizado" e
   * "Duracao" gastavam nove linhas para dizer uma coisa so: quanto tempo o
   * atendimento levou.
   */
  const detalhes = [
    `${EMOJIS.LOCK} **Encerrado por** ${userMention(data.closedById)}  •  ` +
      `**Duracao** ${formatDuration(data.durationMs)}`,
    `-# Aberto ${discordTimestamp(data.openedAt, 'f')} · finalizado ${discordTimestamp(
      data.closedAt,
      'f',
    )}`,
    `-# Motivo: ${data.closeReason ?? 'nenhum informado.'}`,
  ];

  if (data.participantIds.length > 0) {
    detalhes.push(`-# Participantes: ${data.participantIds.map(userMention).join(', ')}`);
  }

  root.addTextDisplayComponents(text(detalhes.join('\n')));

  root.addSeparatorComponents(separator());

  /*
   * O link e melhor que o anexo e por isso vem antes dele no texto: o anexo e
   * cortado pela metade quando passa dos 20 MiB do Discord, enquanto a versao
   * hospedada guarda a conversa inteira. O anexo continua indo junto como copia
   * de seguranca, para o historico nao depender de um servico externo.
   */
  if (data.transcriptUrl !== undefined) {
    root.addActionRowComponents(
      buttonRow(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('Abrir transcript completo')
          .setEmoji(EMOJIS.LIST)
          .setURL(data.transcriptUrl),
      ),
    );
  }

  root.addTextDisplayComponents(
    footerNote(
      data.transcriptUrl === undefined
        ? `${data.messageCount} mensagem(ns) registrada(s) no transcript anexo.`
        : `${data.messageCount} mensagem(ns). O anexo pode vir reduzido; o link traz tudo.`,
    ),
  );

  return root;
}
