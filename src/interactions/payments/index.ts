import type { ButtonInteraction, Guild, GuildMember, ModalSubmitInteraction } from 'discord.js';
import type { StringSelectMenuInteraction } from 'discord.js';
import { PaymentSource, PaymentStatus, type Payment } from '@prisma/client';

import { container, text } from '../../components/v2';
import {
  deferIfNeeded,
  editReplyV2,
  replyError,
  replyV2,
} from '../../components/reply';
import { COLORS, EMOJIS } from '../../constants/branding';
import {
  NAMESPACE,
  PAYMENT_ACTION,
  requireArg,
  type ParsedCustomId,
} from '../../constants/customIds';
import { ValidationError } from '../../core/errors';
import { LOCK_NAMESPACE, locks } from '../../core/locks/LockService';
import {
  assertCanCreatePayments,
  assertCanManagePayments,
} from '../../core/permissions/PermissionService';
import { formatCents, parsePaymentAmount } from '../../utils/money';
import { sanitizeReason } from '../../utils/sanitize';
import { isSendableConversation, fetchChannelSafe, userMention } from '../../utils/discord';
import { calculateDiscount } from '../../modules/coupons/services/CouponCalculator';
import { listSelectableCoupons } from '../../modules/coupons/services/CouponService';
import {
  NO_COUPON_SELECT_VALUE,
  buildAmountModal,
  buildCancelModal,
  buildChargeDraftPanel,
  buildCouponSelectionPanel,
  buildPaymentManagePanel,
} from '../../modules/payments/builders/PaymentBuilders';
import {
  RECEIPT_UPLOAD_FIELD,
  buildReceiptCustomerAck,
  buildReceiptUploadModal,
} from '../../modules/catalog/builders/ReceiptBuilders';
import { submitReceipt } from '../../modules/catalog/services/OrderReceiptService';
import {
  createOrderForCharge,
  discardOrderForFailedCharge,
  formatOrderNumber,
  linkPaymentToOrder,
} from '../../modules/catalog/services/OrderService';
import { refreshInternalPanelByChannel } from '../../modules/tickets/services/TicketViewService';
import { publishPaymentCard, refreshPaymentCard } from '../../modules/payments/services/PaymentCardService';
import {
  deleteDraft,
  getDraft,
  setDraftCoupon,
} from '../../modules/payments/services/PaymentDraftService';
import { getAccountById } from '../../modules/payments/services/PaymentAccountService';
import { cancelPaymentAtomic } from '../../modules/payments/repositories/PaymentRepository';
import {
  approvePayment,
  cancelPayment,
  changePaymentAmount,
  changePaymentCoupon,
  createCharge,
  describeStatus,
  linkedOrderId,
  loadPayment,
} from '../../modules/payments/services/PaymentService';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';

/**
 * Handlers de cobranca PIX.
 *
 * TODA acao revalida a permissao da equipe no servidor — o customId jamais
 * autoriza nada. O cliente pode ver os botoes no cartao, mas nunca consegue
 * aprovar, cancelar ou alterar a cobranca.
 */

function requireGuildContext(interaction: {
  guild: Guild | null;
  member: unknown;
}): { guild: Guild; member: GuildMember } {
  if (interaction.guild === null || interaction.member === null) {
    throw new ValidationError('Interacao fora de guild.', {
      userMessage: 'Esta acao so pode ser usada dentro do servidor.',
    });
  }
  return { guild: interaction.guild, member: interaction.member as GuildMember };
}

/**
 * Aviso acrescentado quando a operacao foi gravada mas o cartao publico nao
 * pode ser reescrito (canal apagado ou bot sem permissao). Sem isto o vendedor
 * ve uma confirmacao de sucesso enquanto o cartao no canal continua mostrando
 * o total antigo, o QR antigo e os botoes de uma cobranca ja resolvida.
 */
function staleCardNote(refreshed: boolean): string {
  return refreshed
    ? ''
    : '\n\n⚠️ A alteracao foi salva, mas o cartao publicado no canal **nao pode ser atualizado** ' +
        '(canal removido ou sem permissao do bot). Verifique as permissoes e atualize o canal.';
}

/**
 * Porteiro do comprovante: devolve o pedido em que a evidencia sera gravada.
 *
 * O botao vive num cartao PUBLICO — todo mundo do canal enxerga e pode clicar.
 * O customId nao autoriza nada (regra do projeto), entao a checagem de dono
 * mora aqui, e `submitReceipt` ainda reconfere por `requireCustomerOrder`.
 * Duas vezes de proposito: e a diferenca entre "anexei no meu pedido" e
 * "anexei no pedido de outra pessoa".
 */
function requireReceiptTarget(payment: Payment, userId: string): string {
  if (payment.customerId !== userId) {
    throw new ValidationError(`Comprovante de terceiro na cobranca ${payment.id}.`, {
      userMessage: 'Somente o cliente desta cobranca pode enviar o comprovante.',
    });
  }

  if (payment.status !== PaymentStatus.PENDING) {
    throw new ValidationError(`Cobranca nao aguarda comprovante: ${payment.status}`, {
      userMessage: `Esta cobranca esta com status "${describeStatus(payment.status)}" e nao aguarda comprovante.`,
    });
  }

  const orderId = linkedOrderId(payment);
  if (orderId === null) {
    throw new ValidationError(`Cobranca sem pedido vinculado: ${payment.id}`, {
      userMessage:
        'Esta cobranca nao pertence a um pedido do catalogo. Envie o comprovante para a equipe no atendimento.',
    });
  }
  return orderId;
}

/** Recarrega o rascunho e devolve o painel de confirmacao atualizado. */
async function renderDraftPanel(
  guild: Guild,
  draftId: string,
  userId: string,
): Promise<ReturnType<typeof buildChargeDraftPanel>> {
  const draft = getDraft(draftId, guild.id, userId);

  const account = await getAccountById(guild.id, draft.accountId);
  if (account === null) {
    throw new ValidationError('Conta PIX do rascunho nao existe mais.', {
      userMessage: 'A conta PIX escolhida nao existe mais. Refaca a cobranca.',
    });
  }

  let couponCode: string | null = null;
  let pricing = {
    originalAmount: draft.amountCents,
    discountAmount: 0,
    finalAmount: draft.amountCents,
  };

  if (draft.couponId !== null) {
    const eligible = await listSelectableCoupons(guild.id, draft.amountCents, draft.customerId);
    const match = eligible.find((entry) => entry.coupon.id === draft.couponId);
    if (match !== undefined) {
      couponCode = match.coupon.code;
      pricing = calculateDiscount(match.coupon, draft.amountCents);
    } else {
      // Cupom deixou de ser elegivel: remove do rascunho em vez de cobrar errado.
      setDraftCoupon(draftId, guild.id, userId, null);
    }
  }

  return buildChargeDraftPanel({
    draftId,
    customerId: draft.customerId,
    description: draft.description,
    account,
    pricing,
    couponCode,
    expirationMinutes: account.defaultExpirationMinutes,
  });
}

// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------

const couponButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.COUPON,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const kind = requireArg(parsed, 0, 'tipo');
    const target = requireArg(parsed, 1, 'alvo');

    await deferIfNeeded(interaction, { ephemeral: true });

    if (kind === 'draft') {
      await assertCanCreatePayments(member);
      const draft = getDraft(target, guild.id, member.id);
      const options = await listSelectableCoupons(guild.id, draft.amountCents, draft.customerId);
      await editReplyV2(
        interaction,
        buildCouponSelectionPanel('draft', target, options, draft.couponId),
      );
      return;
    }

    await assertCanManagePayments(member);
    const payment = await loadPayment(guild.id, target);
    const options = await listSelectableCoupons(
      guild.id,
      payment.originalAmount,
      payment.customerId,
    );
    await editReplyV2(
      interaction,
      buildCouponSelectionPanel('payment', target, options, payment.couponId),
    );
  },
};

const confirmButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.CONFIRM,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const draftId = requireArg(parsed, 0, 'draftId');

    await assertCanCreatePayments(member);
    await deferIfNeeded(interaction, { ephemeral: true });

    /*
     * O rascunho e consumido sob lock.
     *
     * O Discord nao desabilita o botao enquanto a interacao esta deferida, e
     * entre ler o rascunho e apaga-lo ha uma escrita no banco MAIS um round-trip
     * com a API (upload do PNG do QR). Sem o lock, um duplo clique gerava DUAS
     * cobrancas PIX distintas do mesmo rascunho — e o cliente podia pagar as
     * duas.
     */
    const { payment, order } = await locks.withLock(
      LOCK_NAMESPACE.PAYMENT_ACTION,
      `draft:${draftId}`,
      async () => {
        const draft = getDraft(draftId, guild.id, member.id);

        const channel = await fetchChannelSafe(guild, draft.channelId);
        // Aceita TOPICO: o ticket virou topico privado, e a cobranca e
        // publicada dentro do proprio atendimento.
        if (!isSendableConversation(channel)) {
          throw new ValidationError('Canal do rascunho indisponivel.', {
            userMessage: 'Nao foi possivel enviar a cobranca neste canal.',
          });
        }

        /*
         * O PEDIDO NASCE PRIMEIRO.
         *
         * Venda de balcao tambem e venda: o numero `VK-` e o que o cliente usa
         * para achar a compra em `/meus-pedidos`, o que a equipe usa no painel
         * comercial e, acima de tudo, o lugar onde o comprovante e gravado.
         * Sem pedido, quem pagava por `/pagamento criar` nao tinha onde anexar
         * o comprovante.
         *
         * Vem ANTES da cobranca porque e o `sourceId` dela que leva o numero
         * ate o cartao: criar depois exigiria reescrever um cartao que o
         * cliente ja recebeu.
         */
        const newOrder = await createOrderForCharge({
          guildId: guild.id,
          customerId: draft.customerId,
          channelId: draft.channelId,
          amountCents: draft.amountCents,
          staffId: member.id,
        });

        let created;
        try {
          created = await createCharge({
            guild,
            createdBy: member,
            customerId: draft.customerId,
            accountId: draft.accountId,
            description: draft.description,
            amountCents: draft.amountCents,
            couponId: draft.couponId,
            channelId: draft.channelId,
            source: { type: PaymentSource.MANUAL_COMMAND, id: newOrder.id },
          });
        } catch (error) {
          // Conta PIX desativada entre o rascunho e o clique, por exemplo. Sem
          // esta limpeza cada tentativa deixaria um pedido orfao na fila
          // comercial, como se houvesse venda esperando vendedor.
          await discardOrderForFailedCharge(newOrder.id, member.id);
          throw error;
        }

        // A cobranca ja esta commitada: o rascunho nao pode sobreviver a ela,
        // senao um segundo clique geraria uma cobranca duplicada.
        deleteDraft(draftId);

        try {
          await linkPaymentToOrder(guild.id, member.id, newOrder.id, created);
          await publishPaymentCard(channel, created);
        } catch (error) {
          // Sem cartao publicado a cobranca fica PENDING e invisivel: ninguem
          // consegue aprovar, cancelar nem ver, e ela ainda conta como pendente
          // ate expirar. Cancelar deixa o estado limpo para o vendedor repetir.
          await cancelPaymentAtomic(
            created.id,
            member.id,
            'Falha ao publicar o cartao da cobranca.',
          ).catch(() => undefined);
          await discardOrderForFailedCharge(newOrder.id, member.id);
          throw error;
        }

        return { payment: created, order: newOrder };
      },
      { userMessage: 'Esta cobranca ja esta sendo gerada.' },
    );

    /*
     * Painel do ticket.
     *
     * Fora do lock e sem poder derrubar nada: a cobranca ja existe e o cliente
     * ja a recebeu. Se o canal nao for de um ticket, a funcao apenas devolve
     * false — cobrar em canal comum continua valendo.
     */
    if (payment.channelId !== null) {
      await refreshInternalPanelByChannel(guild, payment.channelId).catch(() => false);
    }

    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(
          `${EMOJIS.PAYMENT} Cobranca de **${formatCents(payment.finalAmount)}** enviada para ${userMention(payment.customerId)}.\n` +
            `Pedido **#${formatOrderNumber(order.orderNumber)}** aberto para esta venda.`,
        ),
      ),
    );
  },
};

const discardButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.DISCARD,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const draftId = requireArg(parsed, 0, 'draftId');

    // Valida a posse antes de descartar.
    getDraft(draftId, guild.id, member.id);
    deleteDraft(draftId);

    await replyV2(
      interaction,
      container(COLORS.NEUTRAL).addTextDisplayComponents(
        text(`${EMOJIS.CLOSE} Rascunho de cobranca descartado.`),
      ),
      { ephemeral: true },
    );
  },
};

const approveButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.APPROVE,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');

    await assertCanManagePayments(member);
    await deferIfNeeded(interaction, { ephemeral: true });

    const approved = await approvePayment(guild.id, member, paymentId);
    const refreshed = await refreshPaymentCard(guild, approved);

    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(
          `${EMOJIS.APPROVE} Cobranca de **${formatCents(approved.finalAmount)}** marcada como **aprovada pela equipe**.` +
            (approved.couponCodeSnapshot !== null
              ? `\nO uso do cupom \`${approved.couponCodeSnapshot}\` foi contabilizado agora.`
              : '') +
            staleCardNote(refreshed),
        ),
      ),
    );
  },
};

const cancelButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.CANCEL,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { member } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');

    await assertCanManagePayments(member);
    // showModal precisa ser a primeira resposta.
    await interaction.showModal(buildCancelModal(paymentId));
  },
};

const receiptButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.RECEIPT,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');

    /*
     * Confere ANTES de abrir o modal.
     *
     * Pedir o arquivo para so entao recusar faria o cliente subir a imagem a
     * toa — e, pior, o "nao pode" chegaria depois do envio, parecendo que o
     * comprovante foi perdido pelo bot.
     */
    const payment = await loadPayment(guild.id, paymentId);
    requireReceiptTarget(payment, interaction.user.id);

    // showModal precisa ser a primeira resposta.
    await interaction.showModal(buildReceiptUploadModal(payment.id));
  },
};

const manageButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.MANAGE,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');

    await assertCanManagePayments(member);
    const payment = await loadPayment(guild.id, paymentId);
    await replyV2(interaction, buildPaymentManagePanel(payment), { ephemeral: true });
  },
};

const couponRemoveButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.COUPON_REMOVE,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');

    await assertCanManagePayments(member);
    await deferIfNeeded(interaction, { ephemeral: true });

    const updated = await changePaymentCoupon(guild.id, member, paymentId, null);
    const refreshed = await refreshPaymentCard(guild, updated);

    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(
          `${EMOJIS.DELETE} Cupom removido. Novo total: **${formatCents(updated.finalAmount)}**.\nQR Code e Copia e Cola regenerados.` +
            staleCardNote(refreshed),
        ),
      ),
    );
  },
};

const amountButton: ButtonHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.AMOUNT,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');

    await assertCanManagePayments(member);
    const payment = await loadPayment(guild.id, paymentId);
    await interaction.showModal(buildAmountModal(paymentId, payment.originalAmount));
  },
};

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

const couponSelect: SelectHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.COUPON_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const kind = requireArg(parsed, 0, 'tipo');
    const target = requireArg(parsed, 1, 'alvo');

    const raw = (interaction as StringSelectMenuInteraction).values[0];
    if (raw === undefined) {
      await replyError(interaction, 'Nenhuma opcao selecionada.');
      return;
    }
    const couponId = raw === NO_COUPON_SELECT_VALUE ? null : raw;

    await deferIfNeeded(interaction, { ephemeral: true });

    if (kind === 'draft') {
      await assertCanCreatePayments(member);
      setDraftCoupon(target, guild.id, member.id, couponId);
      await editReplyV2(interaction, await renderDraftPanel(guild, target, member.id));
      return;
    }

    await assertCanManagePayments(member);
    const updated = await changePaymentCoupon(guild.id, member, target, couponId);
    const refreshed = await refreshPaymentCard(guild, updated);

    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(
          (couponId === null
            ? `${EMOJIS.DELETE} Cupom removido. Novo total: **${formatCents(updated.finalAmount)}**.`
            : `${EMOJIS.COUPON} Cupom \`${updated.couponCodeSnapshot ?? ''}\` aplicado. Novo total: **${formatCents(updated.finalAmount)}**.`) +
            staleCardNote(refreshed),
        ),
      ),
    );
  },
};

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

const cancelModal: ModalHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.CANCEL_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');
    const reason = sanitizeReason(interaction.fields.getTextInputValue('reason'));

    await assertCanManagePayments(member);
    await deferIfNeeded(interaction, { ephemeral: true });

    const cancelled = await cancelPayment(guild.id, member, paymentId, reason);
    const refreshed = await refreshPaymentCard(guild, cancelled);

    await editReplyV2(
      interaction,
      container(COLORS.DANGER).addTextDisplayComponents(
        text(
          `${EMOJIS.CLOSE} Cobranca cancelada. O cupom nao foi contabilizado.` +
            staleCardNote(refreshed),
        ),
      ),
    );
  },
};

const receiptModal: ModalHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.RECEIPT_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');

    const file = interaction.fields.getUploadedFiles(RECEIPT_UPLOAD_FIELD)?.first();
    if (file === undefined) {
      throw new ValidationError('Modal de comprovante submetido sem arquivo.', {
        userMessage: 'Nenhum arquivo foi anexado. Toque em Enviar Comprovante e escolha o arquivo.',
      });
    }

    // Efemero: o comprovante traz dados bancarios do cliente e nao pode virar
    // conteudo do canal onde o cartao da cobranca esta publicado.
    await deferIfNeeded(interaction, { ephemeral: true });

    // Recarrega em vez de confiar no que foi checado ao abrir o modal: entre
    // abrir e enviar, a cobranca pode ter sido aprovada ou cancelada.
    const payment = await loadPayment(guild.id, paymentId);
    const orderId = requireReceiptTarget(payment, interaction.user.id);

    const result = await submitReceipt({
      guild,
      customerId: interaction.user.id,
      orderId,
      attachment: {
        url: file.url,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
      },
    });

    await editReplyV2(interaction, buildReceiptCustomerAck(result.order, result.analysis));
  },
};

const amountModal: ModalHandler = {
  namespace: NAMESPACE.PAYMENT,
  action: PAYMENT_ACTION.AMOUNT_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const paymentId = requireArg(parsed, 0, 'paymentId');
    const amountCents = parsePaymentAmount(interaction.fields.getTextInputValue('amount'));

    await assertCanManagePayments(member);
    await deferIfNeeded(interaction, { ephemeral: true });

    const { payment: updated, droppedCoupon } = await changePaymentAmount(
      guild.id,
      member,
      paymentId,
      amountCents,
    );
    const refreshed = await refreshPaymentCard(guild, updated);

    const note =
      droppedCoupon !== null
        ? `\n⚠️ O cupom \`${droppedCoupon}\` **nao vale** para este novo valor e foi removido da cobranca.`
        : updated.couponId !== null
          ? `\nO cupom \`${updated.couponCodeSnapshot ?? ''}\` foi mantido nos termos originais da cobranca.`
          : '';

    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(
          `${EMOJIS.EDIT} Valor atualizado. Novo total: **${formatCents(updated.finalAmount)}**.\nQR Code e Copia e Cola regenerados.${note}` +
            staleCardNote(refreshed),
        ),
      ),
    );
  },
};

export const paymentButtons: ButtonHandler[] = [
  couponButton,
  confirmButton,
  discardButton,
  approveButton,
  receiptButton,
  cancelButton,
  manageButton,
  couponRemoveButton,
  amountButton,
];

export const paymentSelects: SelectHandler[] = [couponSelect];

export const paymentModals: ModalHandler[] = [cancelModal, amountModal, receiptModal];
