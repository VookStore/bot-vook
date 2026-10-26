import { MessageFlags } from 'discord.js';
import type { AttachmentBuilder, Guild, Message } from 'discord.js';
import { PaymentStatus, type Payment, type PaymentAccount } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { createLogger } from '../../../core/logger/Logger';
import {
  NO_MENTIONS,
  fetchChannelSafe,
  isMissingAccessError,
  isSendableConversation,
  isUnknownResourceError,
  mentionOnly,
  type SendableConversation,
} from '../../../utils/discord';
import { sanitizeFilename } from '../../../utils/sanitize';
import { buildPaymentCard, type PixReceiver } from '../builders/PaymentBuilders';
import { setPaymentMessage } from '../repositories/PaymentRepository';
import { getAccountById } from './PaymentAccountService';
import { buildQrCodeAttachment, type QrTemplateTarget } from './QrCodeService';

/**
 * Publicacao e atualizacao do cartao de cobranca.
 *
 * O QR Code SEMPRE e gerado a partir do `pixPayload` salvo no banco, entao
 * nunca existe QR antigo apontando para um valor diferente do total atual.
 */

const logger = createLogger('payment:card');

/**
 * Numero do pedido estampado no cartao.
 *
 * INVERSAO DELIBERADA: pagamentos nao conhece pedido — e nao pode conhecer,
 * senao o catalogo deixa de ser substituivel, que e a premissa do modulo. O
 * catalogo registra o resolvedor no boot, do mesmo jeito que ja registra os
 * ouvintes de aprovacao.
 *
 * Sem registro (ou com falha na consulta) o cartao apenas sai sem a linha do
 * pedido: cobranca e QR continuam intactos. Numero de pedido e identificacao,
 * nao pre-requisito para pagar.
 */
export type OrderLabelResolver = (payment: Payment) => Promise<string | null>;

let resolveOrderLabel: OrderLabelResolver | null = null;

export function registerOrderLabelResolver(resolver: OrderLabelResolver): void {
  resolveOrderLabel = resolver;
}

/** Somente para testes. */
export function resetOrderLabelResolver(): void {
  resolveOrderLabel = null;
}

async function orderLabelFor(payment: Payment): Promise<string | undefined> {
  if (resolveOrderLabel === null) return undefined;
  const label = await resolveOrderLabel(payment).catch((error: unknown) => {
    logger.warn('Nao foi possivel resolver o pedido da cobranca para o cartao.', {
      guildId: payment.guildId,
      entityType: 'payment',
      entityId: payment.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  return label ?? undefined;
}

export function buildQrFilename(paymentId: string): string {
  return sanitizeFilename(`pix-${paymentId.slice(0, 12)}.png`, 'pix.png');
}

/**
 * Conta que recebe esta cobranca.
 *
 * Falha de leitura devolve `null` em vez de propagar: tudo que depende daqui e
 * apresentacao (a arte do QR, a chave em texto), e cobranca nao pode deixar de
 * ser publicada porque um enfeite nao carregou. A consulta atravessa o cache de
 * contas do `PaymentAccountService`, entao chamar duas vezes no mesmo cartao
 * nao custa duas idas ao banco.
 */
async function accountOf(payment: Payment): Promise<PaymentAccount | null> {
  return getAccountById(payment.guildId, payment.accountId).catch(() => null);
}

/**
 * Alvo da arte personalizada desta cobranca.
 *
 * A arte e da CONTA (traz nome, chave e banco impressos), entao ela e resolvida
 * pela conta que realmente vai receber — nunca por uma arte "da loja". Com
 * varias contas cadastradas, usar a arte errada mostraria ao cliente um titular
 * diferente de quem recebe o dinheiro.
 *
 * Conta ausente apenas desliga a arte: o QR simples continua valendo.
 */
async function resolveTemplateTarget(payment: Payment): Promise<QrTemplateTarget | undefined> {
  const account = await accountOf(payment);
  if (account === null) return undefined;
  return { guildId: payment.guildId, accountIdentifier: account.identifier };
}

/**
 * Chave e titular impressos em texto no cartao.
 *
 * Saem da MESMA conta que gerou o payload, pelo mesmo motivo da arte: com varias
 * contas cadastradas, mostrar a chave de outra mandaria o cliente pagar para
 * quem nao esta cobrando.
 *
 * Antes isso so existia se a loja tivesse desenhado a chave na arte do QR — uma
 * imagem, que nao da para copiar. Agora vem do banco de dados, entao vale
 * tambem para quem nunca cadastrou arte nenhuma.
 *
 * Conta ausente apenas omite a linha: QR e copia e cola continuam de pe.
 *
 * EXPORTADA pelo mesmo motivo de `buildPaymentQr`: o copia e cola aparece
 * tambem na DM da cobranca e em `/meus-pedidos`, e as tres telas precisam ler a
 * chave da mesma conta.
 */
export async function resolvePixReceiver(payment: Payment): Promise<PixReceiver | undefined> {
  const account = await accountOf(payment);
  if (account === null) return undefined;
  return {
    key: account.pixKey,
    keyType: account.pixKeyType,
    holder: account.receiverName,
  };
}

/**
 * QR desta cobranca, ja com a arte da conta quando ela existir.
 *
 * Exportado porque o QR aparece em mais de um lugar: o cartao publicado no
 * canal, a DM de cobranca e o painel do pedido do cliente. Todos precisam sair
 * do MESMO `pixPayload` salvo no banco — nunca de um payload recalculado.
 */
export async function buildPaymentQr(
  payment: Payment,
): Promise<{ attachment: AttachmentBuilder; filename: string }> {
  const filename = buildQrFilename(payment.id);
  const attachment = await buildQrCodeAttachment(
    payment.pixPayload,
    filename,
    await resolveTemplateTarget(payment),
  );
  return { attachment, filename };
}

/** Publica o cartao no canal e memoriza a mensagem. */
export async function publishPaymentCard(
  channel: SendableConversation,
  payment: Payment,
): Promise<Message> {
  const { attachment, filename } = await buildPaymentQr(payment);
  const orderLabel = await orderLabelFor(payment);
  const receiver = await resolvePixReceiver(payment);

  const message = await sendV2(
    channel,
    buildPaymentCard(payment, {
      qrFilename: filename,
      ...(orderLabel !== undefined ? { orderLabel } : {}),
      ...(receiver !== undefined ? { receiver } : {}),
    }),
    {
      files: [attachment],
      allowedMentions: mentionOnly(payment.customerId),
    },
  );

  await setPaymentMessage(payment.id, channel.id, message.id);
  return message;
}

/**
 * Reescreve o cartao ja publicado.
 * Retorna false (sem lancar) quando canal/mensagem nao existem mais.
 */
export async function refreshPaymentCard(guild: Guild, payment: Payment): Promise<boolean> {
  if (payment.channelId === null || payment.messageId === null) return false;

  /*
   * Aceita TOPICO. O cartao vive dentro do atendimento, que virou topico
   * privado — com o guard antigo esta funcao devolvia `false` em silencio e o
   * cartao nunca era reescrito: aprovar ou cancelar deixava o cliente olhando
   * um PIX pendente que ja nao existia.
   */
  const channel = await fetchChannelSafe(guild, payment.channelId);
  if (!isSendableConversation(channel)) return false;

  try {
    const message = await channel.messages.fetch(payment.messageId);
    const orderLabel = await orderLabelFor(payment);
    const label = orderLabel !== undefined ? { orderLabel } : {};

    // Cobranca encerrada nao precisa mais de QR: remove o anexo antigo.
    if (payment.status !== PaymentStatus.PENDING) {
      await message.edit({
        components: [buildPaymentCard(payment, label)],
        flags: MessageFlags.IsComponentsV2,
        attachments: [],
        allowedMentions: NO_MENTIONS,
      });
      return true;
    }

    const { attachment, filename } = await buildPaymentQr(payment);
    // So a cobranca pendente mostra chave: no cartao resolvido nao ha bloco de
    // pagamento nenhum, e chave de cobranca ja paga so convida a pagar de novo.
    const receiver = await resolvePixReceiver(payment);

    await message.edit({
      components: [
        buildPaymentCard(payment, {
          ...label,
          qrFilename: filename,
          ...(receiver !== undefined ? { receiver } : {}),
        }),
      ],
      flags: MessageFlags.IsComponentsV2,
      // Substitui o anexo: o QR precisa refletir o payload atual.
      attachments: [],
      files: [attachment],
      allowedMentions: NO_MENTIONS,
    });
    return true;
  } catch (error) {
    if (isUnknownResourceError(error)) {
      logger.debug('Cartao de cobranca nao encontrado para atualizacao.', {
        guildId: guild.id,
        entityType: 'payment',
        entityId: payment.id,
      });
      return false;
    }
    // Perder AttachFiles/SendMessages no canal NAO pode virar erro do handler:
    // a aprovacao/cancelamento/reprecificacao ja esta gravada, e relancar aqui
    // mostrava "Ocorreu um erro inesperado" para uma operacao bem-sucedida.
    // Devolver false deixa o chamador avisar que o cartao ficou desatualizado.
    if (isMissingAccessError(error)) {
      logger.warn('Sem permissao para atualizar o cartao de cobranca.', {
        guildId: guild.id,
        channelId: payment.channelId,
        entityType: 'payment',
        entityId: payment.id,
      });
      return false;
    }
    throw error;
  }
}
