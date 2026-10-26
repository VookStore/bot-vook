import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
} from 'discord.js';
import { ReceiptCheckStatus, type OrderReceipt, type Payment } from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import {
  NAMESPACE,
  ORDER_ACTION,
  PAYMENT_ACTION,
  buildCustomId,
} from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  mediaGallery,
  separator,
  text,
} from '../../../components/v2';
import { formatCents } from '../../../utils/money';
import { truncate } from '../../../utils/sanitize';
import { discordTimestamp } from '../../../utils/time';
import { userMention } from '../../../utils/discord';
import { checkIcon, type ReceiptAnalysis } from '../validators/receiptParser';
import { formatOrderNumber } from '../services/OrderService';
import type { OrderWithItems } from '../repositories/OrderRepository';

/**
 * Comprovante enviado pelo cliente (Components V2).
 *
 * O PAINEL NAO APROVA NADA SOZINHO. Ele coloca lado a lado o que a cobranca
 * esperava e o que o OCR leu, e deixa o vendedor decidir com a imagem na tela.
 * O texto avisa, em toda tela, que comprovante e falsificavel — porque a pessoa
 * que clica em "Aprovar" precisa saber exatamente o que esta assumindo.
 */

function statusHeadline(status: ReceiptCheckStatus): string {
  switch (status) {
    case ReceiptCheckStatus.MATCH:
      return '🟢 **Confere com a cobranca**';
    case ReceiptCheckStatus.MISMATCH:
      return '🔴 **DIVERGENCIA encontrada**';
    case ReceiptCheckStatus.SKIPPED:
      return '🟡 **Nao analisado automaticamente**';
    default:
      return '🟡 **Nao foi possivel conferir**';
  }
}

function accentFor(status: ReceiptCheckStatus): number {
  if (status === ReceiptCheckStatus.MATCH) return COLORS.SUCCESS;
  if (status === ReceiptCheckStatus.MISMATCH) return COLORS.DANGER;
  return COLORS.WARNING;
}

/** Campo do modal que carrega o arquivo. */
export const RECEIPT_UPLOAD_FIELD = 'arquivo';

/**
 * Modal de envio, aberto pelo botao `Enviar Comprovante` do cartao da cobranca.
 *
 * POR QUE ELE PASSOU A EXISTIR: enquanto o modal do Discord nao aceitava
 * arquivo, anexo so existia como opcao de slash command — dai
 * `/comprovante enviar`. Com o componente de upload em modal, quem pagou manda
 * o arquivo sem sair da mensagem onde acabou de ler o PIX e sem ter de decorar
 * o numero do pedido. O comando continua valendo para quem prefere digitar.
 *
 * O `paymentId` viaja no customId apenas para IDENTIFICAR a cobranca. Ele nao
 * autoriza nada: dono, estado do pedido e limites sao reconferidos no servidor
 * quando o arquivo chega.
 */
export function buildReceiptUploadModal(paymentId: string): ModalBuilder {
  const maxMegabytes = Math.floor(BUSINESS_LIMITS.RECEIPT_MAX_BYTES / (1024 * 1024));

  return new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.RECEIPT_MODAL, paymentId))
    .setTitle(truncate('Enviar comprovante do PIX', DISCORD_LIMITS.MODAL_TITLE))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Comprovante do pagamento')
        .setDescription(`Imagem (PNG, JPG, WEBP) ou PDF de ate ${maxMegabytes} MB.`)
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId(RECEIPT_UPLOAD_FIELD)
            .setMinValues(1)
            // UM arquivo por envio: cada comprovante vira um registro proprio e
            // custa um OCR. Aceitar varios de uma vez furaria o limite
            // anti-abuso por pedido sem que ninguem percebesse.
            .setMaxValues(1)
            .setRequired(true),
        ),
    );
}

/**
 * Aviso publicado para a EQUIPE, com a imagem do comprovante anexada.
 *
 * `imageFilename` vem do reenvio do arquivo pelo bot: o anexo original do
 * cliente tem URL assinada e expira, entao a imagem precisa viver numa mensagem
 * que o bot controla.
 */
export function buildReceiptStaffNotice(params: {
  order: OrderWithItems;
  payment: Payment | null;
  analysis: ReceiptAnalysis;
  uploadedById: string;
  imageFilename?: string;
  fileName: string;
}): ContainerBuilder {
  const { order, payment, analysis } = params;

  const root = container(accentFor(analysis.status));
  addHeader(root, TITLES.ORDER_RECEIPT, {
    subtitle: `Pedido #${formatOrderNumber(order.orderNumber)}`,
  });

  root.addTextDisplayComponents(
    text(
      `${statusHeadline(analysis.status)}\n\n` +
        `**Cliente** ${userMention(params.uploadedById)}  •  **Cobranca** ` +
        `${payment === null ? 'nao vinculada' : formatCents(payment.finalAmount)}\n` +
        `-# Enviado ${discordTimestamp(new Date(), 'R')}`,
    ),
  );

  if (params.imageFilename !== undefined) {
    root.addMediaGalleryComponents(
      mediaGallery([`attachment://${params.imageFilename}`], 'Comprovante enviado pelo cliente'),
    );
  }

  root.addTextDisplayComponents(
    text(
      `**Conferencia automatica**\n${analysis.checks
        .map((check) => `${checkIcon(check.status)} **${check.label}** — ${check.detail}`)
        .join('\n')}`,
    ),
  );

  root.addSeparatorComponents(separator());

  const actions: ButtonBuilder[] = [];
  if (payment !== null) {
    actions.push(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.APPROVE, payment.id))
        .setEmoji(EMOJIS.APPROVE)
        .setLabel(truncate('Confirmar Recebimento', DISCORD_LIMITS.BUTTON_LABEL))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  actions.push(
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.STAFF, order.id))
      .setEmoji(EMOJIS.LIST)
      .setLabel('Abrir Pedido')
      .setStyle(ButtonStyle.Secondary),
  );
  root.addActionRowComponents(buttonRow(...actions));

  /*
   * O aviso e o ponto exato em que alguem decide dar o produto por pago. E aqui
   * que precisa estar escrito que imagem de comprovante se falsifica — a
   * conferencia acima pega engano, nao pega fraude.
   */
  root.addTextDisplayComponents(
    footerNote(
      `${params.fileName} • Comprovante e IMAGEM e pode ser forjado. ` +
        'A conferencia acima e auxilio, nao prova: confirme o recebimento na sua conta antes de aprovar.',
    ),
  );

  return root;
}

/** Confirmacao efemera para o cliente que enviou o comprovante. */
export function buildReceiptCustomerAck(
  order: OrderWithItems,
  analysis: ReceiptAnalysis,
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.ORDER_RECEIPT, {
    subtitle: `Pedido #${formatOrderNumber(order.orderNumber)}`,
  });

  root.addTextDisplayComponents(
    text(
      `${EMOJIS.RECEIPT} **Comprovante recebido.**\n\n` +
        'A equipe da Vook Store vai conferir o recebimento e confirmar o pagamento. ' +
        'Voce recebe um aviso por aqui assim que for confirmado.',
    ),
  );

  // O cliente NAO ve o resultado da conferencia automatica: dizer "divergencia"
  // para quem pagou certo gera atrito, e dizer "confere" para quem forjou daria
  // a impressao de aprovacao. Quem le esse detalhe e a equipe.
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      analysis.status === ReceiptCheckStatus.SKIPPED
        ? '-# Arquivos PDF sao conferidos manualmente pela equipe.'
        : '-# A confirmacao e feita por uma pessoa da equipe, nao automaticamente.',
    ),
  );

  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.VIEW, order.id))
        .setEmoji(EMOJIS.REFRESH)
        .setLabel('Ver Pedido')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return root;
}

/** Linha exibida no pedido do cliente quando ja existe comprovante enviado. */
export function describeReceiptForCustomer(receipt: OrderReceipt | null): string | null {
  if (receipt === null) return null;
  return `${EMOJIS.RECEIPT} Enviado ${discordTimestamp(receipt.createdAt, 'R')} — aguardando conferencia`;
}
