import { randomUUID } from 'node:crypto';

import {
  PaymentAuditAction,
  PaymentSource,
  PaymentStatus,
  type CouponType,
  type Payment,
} from '@prisma/client';
import type { Guild, GuildMember } from 'discord.js';


import { BUSINESS_LIMITS } from '../../../constants/limits';
import { emitPaymentEvent } from '../../../core/events/PaymentEvents';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import { getPrisma } from '../../../core/database/prisma';
import {
  CouponInvalidError,
  CouponNotFoundError,
  CouponUsageLimitError,
  PaymentNotFoundError,
  PaymentStateError,
  ValidationError,
} from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { formatCents } from '../../../utils/money';
import { calculateDiscount } from '../../coupons/services/CouponCalculator';
import { confirmCouponUsage, validateCouponForPayment } from '../../coupons/services/CouponService';
import type { CouponLike } from '../../coupons/types/coupon';
import { recordPaymentAudit } from '../../audit/repositories/AuditRepository';
import { getAccountById } from './PaymentAccountService';
import { buildPixPayload } from './PixPayloadService';
import {
  approvePaymentAtomic,
  cancelPaymentAtomic,
  expirePaymentAtomic,
  findPaymentById,
  findPaymentWithAccount,
  updatePendingPayment,
  type PaymentWithAccount,
} from '../repositories/PaymentRepository';

/**
 * Cobrancas PIX.
 *
 * REGRAS COMERCIAIS:
 *  - Quem cria e gerencia a cobranca e o vendedor/equipe. O cliente nunca
 *    escolhe nem aplica cupom.
 *  - O cupom aplicado e fotografado (snapshot) no pagamento: alterar o cupom
 *    depois NAO muda cobrancas antigas.
 *  - O uso do cupom so e contabilizado quando o pagamento e APROVADO, dentro da
 *    mesma transacao que muda o status.
 *  - "Aprovar" e uma confirmacao MANUAL da equipe. Nao existe integracao
 *    bancaria: nada aqui afirma que o banco confirmou o pagamento.
 */

const logger = createLogger('payment');

/** txid do BR Code (campo 62-05): ate 25 caracteres alfanumericos. */
function buildTxid(paymentId: string): string {
  return paymentId.replace(/[^A-Za-z0-9]/g, '').slice(0, BUSINESS_LIMITS.PIX_TXID_MAX);
}

function newPaymentId(): string {
  return randomUUID().replace(/-/g, '');
}

export interface PaymentPricing {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  couponId: string | null;
  couponCodeSnapshot: string | null;
  couponTypeSnapshot: Payment['couponTypeSnapshot'];
  couponValueSnapshot: number | null;
}

/** Valida o valor BRUTO informado pela equipe. */
function assertChargeableAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < BUSINESS_LIMITS.PAYMENT_MIN_CENTS) {
    throw new ValidationError(`Valor invalido: ${String(amountCents)}`, {
      userMessage: `O valor precisa ser de no minimo ${formatCents(BUSINESS_LIMITS.PAYMENT_MIN_CENTS)}.`,
    });
  }
  if (amountCents > BUSINESS_LIMITS.PAYMENT_MAX_CENTS) {
    throw new ValidationError(`Valor acima do teto: ${String(amountCents)}`, {
      userMessage: `O valor maximo permitido e ${formatCents(BUSINESS_LIMITS.PAYMENT_MAX_CENTS)}.`,
    });
  }
}

/**
 * Valida o valor FINAL (ja com desconto).
 *
 * O BR Code nao aceita valor zero (`buildPixPayload` lanca), entao um cupom que
 * zera o total precisa ser recusado AQUI, com uma mensagem que aponta para o
 * cupom — e nao la embaixo, com "o valor da cobranca precisa ser maior que
 * zero", que nao diz ao vendedor o que fazer.
 */
function assertChargeableFinalAmount(finalAmount: number, couponCode: string | null): void {
  if (finalAmount >= BUSINESS_LIMITS.PAYMENT_MIN_CENTS) return;

  const codigo = couponCode !== null && couponCode.length > 0 ? ` \`${couponCode}\`` : '';
  throw new ValidationError(`Total final invalido apos desconto: ${String(finalAmount)}`, {
    userMessage:
      `O cupom${codigo} zera o total desta compra, e uma cobranca PIX nao pode ser de ` +
      `${formatCents(0)}. Remova o cupom ou use um de valor menor.`,
  });
}

/** Calcula o preco final validando o cupom (quando houver) no momento atual. */
export async function priceCharge(params: {
  guildId: string;
  customerId: string;
  amountCents: number;
  couponId: string | null;
}): Promise<PaymentPricing> {
  assertChargeableAmount(params.amountCents);

  if (params.couponId === null) {
    return {
      originalAmount: params.amountCents,
      discountAmount: 0,
      finalAmount: params.amountCents,
      couponId: null,
      couponCodeSnapshot: null,
      couponTypeSnapshot: null,
      couponValueSnapshot: null,
    };
  }

  const { coupon, discount } = await validateCouponForPayment(
    params.guildId,
    params.couponId,
    params.amountCents,
    params.customerId,
  );

  assertChargeableFinalAmount(discount.finalAmount, coupon.code);

  return {
    originalAmount: discount.originalAmount,
    discountAmount: discount.discountAmount,
    finalAmount: discount.finalAmount,
    couponId: coupon.id,
    couponCodeSnapshot: coupon.code,
    couponTypeSnapshot: coupon.type,
    couponValueSnapshot: coupon.value,
  };
}

/**
 * Reprecifica uma cobranca pendente respeitando o SNAPSHOT do cupom.
 *
 * Regra do arquivo (linha 37): "alterar o cupom depois NAO muda cobrancas
 * antigas". Se a reprecificacao MANTEM o mesmo cupom (alterar valor, por
 * exemplo), os termos usados sao os fotografados na emissao — nao os termos
 * vivos do banco. Sem isso um admin que editasse VOOK20 de 20% para 50%
 * mudaria, sozinho, o desconto de uma cobranca ja emitida.
 *
 * Trocar ou aplicar OUTRO cupom e uma decisao nova e deliberada da equipe:
 * ai sim vale o cupom vivo, com toda a revalidacao.
 */
async function repriceWithSnapshot(
  payment: PaymentWithAccount,
  amountCents: number,
  couponId: string | null,
): Promise<PaymentPricing> {
  const keepsSameCoupon =
    couponId !== null &&
    couponId === payment.couponId &&
    payment.couponTypeSnapshot !== null &&
    payment.couponValueSnapshot !== null;

  if (!keepsSameCoupon) {
    return priceCharge({
      guildId: payment.guildId,
      customerId: payment.customerId,
      amountCents,
      couponId,
    });
  }

  assertChargeableAmount(amountCents);

  const snapshot: CouponLike = {
    id: payment.couponId as string,
    guildId: payment.guildId,
    code: payment.couponCodeSnapshot ?? '',
    type: payment.couponTypeSnapshot as CouponType,
    value: payment.couponValueSnapshot as number,
    // Os limites de elegibilidade (minimo, validade, usos) NAO fazem parte do
    // preco: eles ja foram conferidos quando a cobranca foi emitida.
    minimumAmount: null,
    maximumDiscount: null,
    maxUses: null,
    maxUsesPerCustomer: null,
    startsAt: null,
    expiresAt: null,
    enabled: true,
    deletedAt: null,
  };

  const discount = calculateDiscount(snapshot, amountCents);
  assertChargeableFinalAmount(discount.finalAmount, payment.couponCodeSnapshot);

  return {
    originalAmount: discount.originalAmount,
    discountAmount: discount.discountAmount,
    finalAmount: discount.finalAmount,
    couponId: payment.couponId,
    couponCodeSnapshot: payment.couponCodeSnapshot,
    couponTypeSnapshot: payment.couponTypeSnapshot,
    couponValueSnapshot: payment.couponValueSnapshot,
  };
}

/** True quando o erro e "o cupom nao serve", e nao uma falha de infraestrutura. */
function isCouponRejection(error: unknown): boolean {
  return (
    error instanceof CouponInvalidError ||
    error instanceof CouponUsageLimitError ||
    error instanceof CouponNotFoundError
  );
}

/**
 * Origem da cobranca.
 *
 * `/pagamento criar` nao informa nada e cai no padrao MANUAL_COMMAND; o
 * catalogo informa CATALOG_ORDER + o id do pedido. E so rastreabilidade: a
 * regra financeira e identica nos dois caminhos.
 */
export interface ChargeSource {
  type: PaymentSource;
  id: string;
}

export interface CreateChargeParams {
  guild: Guild;
  createdBy: GuildMember;
  customerId: string;
  accountId: string;
  description: string;
  amountCents: number;
  couponId: string | null;
  channelId: string | null;
  source?: ChargeSource;
}

/** Cria a cobranca ja com payload PIX valido para o valor FINAL. */
export async function createCharge(params: CreateChargeParams): Promise<PaymentWithAccount> {
  const account = await getAccountById(params.guild.id, params.accountId);
  if (account === null || account.deletedAt !== null) {
    throw new ValidationError(`Conta PIX inexistente: ${params.accountId}`, {
      userMessage: 'Esta conta PIX nao existe mais. Selecione outra conta.',
    });
  }
  if (!account.enabled) {
    throw new ValidationError(`Conta PIX desabilitada: ${account.id}`, {
      userMessage: 'Esta conta PIX esta desativada. Selecione outra conta.',
    });
  }

  const pricing = await priceCharge({
    guildId: params.guild.id,
    customerId: params.customerId,
    amountCents: params.amountCents,
    couponId: params.couponId,
  });

  const paymentId = newPaymentId();
  const pixPayload = buildPixPayload({
    pixKey: account.pixKey,
    receiverName: account.receiverName,
    city: account.city,
    amountCents: pricing.finalAmount,
    txid: buildTxid(paymentId),
    description: params.description,
  });

  const expiresAt = new Date(Date.now() + account.defaultExpirationMinutes * 60_000);

  await getPrisma().payment.create({
    data: {
      id: paymentId,
      guildId: params.guild.id,
      customerId: params.customerId,
      createdById: params.createdBy.id,
      accountId: account.id,
      description: params.description,
      originalAmount: pricing.originalAmount,
      discountAmount: pricing.discountAmount,
      finalAmount: pricing.finalAmount,
      couponId: pricing.couponId,
      couponCodeSnapshot: pricing.couponCodeSnapshot,
      couponTypeSnapshot: pricing.couponTypeSnapshot,
      couponValueSnapshot: pricing.couponValueSnapshot,
      pixPayload,
      expiresAt,
      channelId: params.channelId,
      sourceType: params.source?.type ?? PaymentSource.MANUAL_COMMAND,
      sourceId: params.source?.id ?? null,
      status: PaymentStatus.PENDING,
    },
  });

  await recordPaymentAudit({
    guildId: params.guild.id,
    paymentId,
    action: PaymentAuditAction.CREATED,
    actorId: params.createdBy.id,
    newValue: formatCents(pricing.finalAmount),
    metadata: {
      customerId: params.customerId,
      accountId: account.id,
      originalAmount: pricing.originalAmount,
      discountAmount: pricing.discountAmount,
      couponCode: pricing.couponCodeSnapshot,
    },
  });

  if (pricing.couponId !== null) {
    await recordPaymentAudit({
      guildId: params.guild.id,
      paymentId,
      action: PaymentAuditAction.COUPON_APPLIED,
      actorId: params.createdBy.id,
      newValue: pricing.couponCodeSnapshot,
    });
  }

  logger.info('Cobranca PIX criada.', {
    guildId: params.guild.id,
    userId: params.createdBy.id,
    entityType: 'payment',
    entityId: paymentId,
    finalAmount: pricing.finalAmount,
    coupon: pricing.couponCodeSnapshot,
  });

  const created = await findPaymentWithAccount(paymentId);
  if (created === null) {
    throw new PaymentNotFoundError(paymentId, {
      userMessage: 'A cobranca foi criada mas nao pode ser carregada. Tente novamente.',
    });
  }
  return created;
}

/** Carrega a cobranca garantindo que ela pertence a guild. */
export async function loadPayment(
  guildId: string,
  paymentId: string,
): Promise<PaymentWithAccount> {
  const payment = await findPaymentWithAccount(paymentId);
  if (payment === null || payment.guildId !== guildId) {
    throw new PaymentNotFoundError(paymentId);
  }
  return payment;
}

function assertPending(payment: Payment): void {
  if (payment.status !== PaymentStatus.PENDING) {
    throw new PaymentStateError(`Pagamento nao esta pendente: ${payment.status}`, {
      userMessage: `Esta cobranca esta com status "${describeStatus(payment.status)}" e nao pode mais ser alterada.`,
    });
  }
}

export function describeStatus(status: PaymentStatus): string {
  switch (status) {
    case PaymentStatus.PENDING:
      return 'Aguardando pagamento';
    case PaymentStatus.APPROVED:
      return 'Aprovado pela equipe';
    case PaymentStatus.CANCELLED:
      return 'Cancelado';
    case PaymentStatus.EXPIRED:
      return 'Expirado';
    default:
      return String(status);
  }
}

/**
 * Pedido a que esta cobranca pertence.
 *
 * `sourceType` responde DE ONDE a cobranca veio (catalogo ou comando manual);
 * `sourceId` responde QUAL pedido ela cobra. Sao perguntas diferentes, e so a
 * segunda importa aqui — desde que a venda avulsa tambem passou a abrir pedido,
 * as duas origens preenchem `sourceId`.
 *
 * Ainda pode ser `null`: cobrancas emitidas antes dessa mudanca nasceram sem
 * pedido e continuam sem. Quem depende deste valor (o botao de comprovante)
 * simplesmente nao aparece nelas, em vez de quebrar.
 */
export function linkedOrderId(payment: Payment): string | null {
  const orderId = payment.sourceId;
  return orderId === null || orderId.length === 0 ? null : orderId;
}

/**
 * Aprovacao MANUAL pela equipe.
 *
 * Tudo acontece em UMA transacao: mudar o status, confirmar o uso do cupom
 * (com bloqueio da linha do cupom) e registrar auditoria. Se o limite do cupom
 * estourar por concorrencia, a transacao inteira e desfeita e o pagamento
 * continua pendente.
 */
export async function approvePayment(
  guildId: string,
  staff: GuildMember,
  paymentId: string,
): Promise<Payment> {
  const approved = await locks.withLock(
    LOCK_NAMESPACE.PAYMENT_ACTION,
    paymentId,
    async () => {
      const payment = await loadPayment(guildId, paymentId);
      assertPending(payment);

      await getPrisma().$transaction(async (tx) => {
        const won = await approvePaymentAtomic(paymentId, staff.id, tx);
        if (!won) {
          throw new PaymentStateError('Aprovacao concorrente detectada.', {
            userMessage: 'Esta cobranca ja foi processada por outra pessoa.',
          });
        }

        if (payment.couponId !== null) {
          await confirmCouponUsage(tx, {
            guildId,
            couponId: payment.couponId,
            paymentId,
            customerId: payment.customerId,
            discountAmount: payment.discountAmount,
          });
        }
      });

      await recordPaymentAudit({
        guildId,
        paymentId,
        action: PaymentAuditAction.APPROVED,
        actorId: staff.id,
        oldValue: PaymentStatus.PENDING,
        newValue: PaymentStatus.APPROVED,
        metadata: { finalAmount: payment.finalAmount, coupon: payment.couponCodeSnapshot },
      });

      logger.info('Cobranca aprovada manualmente pela equipe.', {
        guildId,
        userId: staff.id,
        entityType: 'payment',
        entityId: paymentId,
      });

      const updated = await findPaymentById(paymentId);
      return updated ?? payment;
    },
    { userMessage: 'Esta cobranca ja esta sendo processada.' },
  );

  /*
   * Anuncio FORA do lock: um ouvinte (ex.: sincronizacao do pedido) pode
   * precisar tocar o mesmo pagamento, e os locks nao sao reentrantes.
   * Falha de ouvinte nao invalida a aprovacao, que ja esta commitada.
   */
  await emitPaymentEvent('approved', { payment: approved, actorId: staff.id });
  return approved;
}

export async function cancelPayment(
  guildId: string,
  staff: GuildMember,
  paymentId: string,
  reason: string | null,
): Promise<Payment> {
  const cancelled = await locks.withLock(
    LOCK_NAMESPACE.PAYMENT_ACTION,
    paymentId,
    async () => {
      const payment = await loadPayment(guildId, paymentId);
      assertPending(payment);

      const applied = await cancelPaymentAtomic(paymentId, staff.id, reason);
      if (!applied) {
        throw new PaymentStateError('Cancelamento concorrente detectado.', {
          userMessage: 'Esta cobranca ja foi processada por outra pessoa.',
        });
      }

      await recordPaymentAudit({
        guildId,
        paymentId,
        action: PaymentAuditAction.CANCELLED,
        actorId: staff.id,
        oldValue: PaymentStatus.PENDING,
        newValue: PaymentStatus.CANCELLED,
        metadata: { reason },
      });

      logger.info('Cobranca cancelada.', {
        guildId,
        userId: staff.id,
        entityType: 'payment',
        entityId: paymentId,
      });

      const updated = await findPaymentById(paymentId);
      return updated ?? payment;
    },
    { userMessage: 'Esta cobranca ja esta sendo processada.' },
  );

  await emitPaymentEvent('cancelled', { payment: cancelled, actorId: staff.id });
  return cancelled;
}

/**
 * Recalcula a cobranca pendente (troca/remocao de cupom ou novo valor).
 * SEMPRE regenera o payload PIX: nunca fica um QR antigo com valor diferente.
 */
async function repricePending(params: {
  guildId: string;
  staff: GuildMember;
  paymentId: string;
  amountCents?: number;
  couponId: string | null;
  action: PaymentAuditAction;
}): Promise<Payment> {
  return locks.withLock(
    LOCK_NAMESPACE.PAYMENT_ACTION,
    params.paymentId,
    async () => {
      const payment = await loadPayment(params.guildId, params.paymentId);
      assertPending(payment);

      // Conta PIX morta nao pode receber um BR Code novo. `createCharge` ja
      // bloqueia isso na criacao; sem a mesma checagem aqui, reprecificar uma
      // cobranca antiga emitia um QR apontando para uma conta excluida.
      if (payment.account.deletedAt !== null) {
        throw new ValidationError(`Conta PIX excluida: ${payment.account.id}`, {
          userMessage:
            'A conta PIX desta cobranca foi excluida. Cancele esta cobranca e gere uma nova.',
        });
      }
      if (!payment.account.enabled) {
        throw new ValidationError(`Conta PIX desabilitada: ${payment.account.id}`, {
          userMessage:
            'A conta PIX desta cobranca esta desativada. Cancele esta cobranca e gere uma nova.',
        });
      }

      const originalAmount = params.amountCents ?? payment.originalAmount;

      const pricing = await repriceWithSnapshot(payment, originalAmount, params.couponId);

      const pixPayload = buildPixPayload({
        pixKey: payment.account.pixKey,
        receiverName: payment.account.receiverName,
        city: payment.account.city,
        amountCents: pricing.finalAmount,
        txid: buildTxid(payment.id),
        description: payment.description,
      });

      const updated = await updatePendingPayment(params.paymentId, {
        originalAmount: pricing.originalAmount,
        discountAmount: pricing.discountAmount,
        finalAmount: pricing.finalAmount,
        couponId: pricing.couponId,
        couponCodeSnapshot: pricing.couponCodeSnapshot,
        couponTypeSnapshot: pricing.couponTypeSnapshot,
        couponValueSnapshot: pricing.couponValueSnapshot,
        pixPayload,
      });

      if (updated === null) {
        throw new PaymentStateError('Cobranca deixou de estar pendente.', {
          userMessage: 'Esta cobranca ja foi processada por outra pessoa.',
        });
      }

      await recordPaymentAudit({
        guildId: params.guildId,
        paymentId: params.paymentId,
        action: params.action,
        actorId: params.staff.id,
        oldValue: `${formatCents(payment.finalAmount)}${payment.couponCodeSnapshot !== null ? ` (${payment.couponCodeSnapshot})` : ''}`,
        newValue: `${formatCents(updated.finalAmount)}${updated.couponCodeSnapshot !== null ? ` (${updated.couponCodeSnapshot})` : ''}`,
      });

      return updated;
    },
    { userMessage: 'Esta cobranca ja esta sendo processada.' },
  );
}

export async function changePaymentCoupon(
  guildId: string,
  staff: GuildMember,
  paymentId: string,
  couponId: string | null,
): Promise<Payment> {
  const current = await loadPayment(guildId, paymentId);
  const action =
    couponId === null
      ? PaymentAuditAction.COUPON_REMOVED
      : current.couponId === null
        ? PaymentAuditAction.COUPON_APPLIED
        : PaymentAuditAction.COUPON_CHANGED;

  return repricePending({ guildId, staff, paymentId, couponId, action });
}

export interface ChangeAmountResult {
  payment: Payment;
  /** Codigo do cupom que precisou sair para o novo valor passar (ou `null`). */
  droppedCoupon: string | null;
}

/**
 * Corrige o valor de uma cobranca pendente.
 *
 * Se o cupom aplicado nao valer mais para o NOVO valor (tipicamente um minimo
 * de compra), o cupom sai e o valor e corrigido mesmo assim — antes, a operacao
 * inteira era recusada com "Este cupom vale apenas para compras a partir de
 * R$ X", obrigando o vendedor a remover o cupom a mao para poder consertar o
 * preco. Quem sai perdendo com a recusa e a correcao do preco, nao o cupom.
 */
export async function changePaymentAmount(
  guildId: string,
  staff: GuildMember,
  paymentId: string,
  amountCents: number,
): Promise<ChangeAmountResult> {
  const current = await loadPayment(guildId, paymentId);

  if (current.couponId === null) {
    const payment = await repricePending({
      guildId,
      staff,
      paymentId,
      amountCents,
      couponId: null,
      action: PaymentAuditAction.AMOUNT_CHANGED,
    });
    return { payment, droppedCoupon: null };
  }

  try {
    const payment = await repricePending({
      guildId,
      staff,
      paymentId,
      amountCents,
      couponId: current.couponId,
      action: PaymentAuditAction.AMOUNT_CHANGED,
    });
    return { payment, droppedCoupon: null };
  } catch (error) {
    if (!isCouponRejection(error)) throw error;

    const payment = await repricePending({
      guildId,
      staff,
      paymentId,
      amountCents,
      couponId: null,
      action: PaymentAuditAction.AMOUNT_CHANGED,
    });

    logger.info('Cupom removido para permitir a correcao do valor.', {
      guildId,
      userId: staff.id,
      entityType: 'payment',
      entityId: paymentId,
      coupon: current.couponCodeSnapshot,
    });

    return { payment, droppedCoupon: current.couponCodeSnapshot };
  }
}

/** Marca como expirada (usado pelo scheduler e pelo recovery). */
export async function expirePayment(payment: Payment): Promise<boolean> {
  const expired = await expirePaymentAtomic(payment.id);
  if (!expired) return false;

  await recordPaymentAudit({
    guildId: payment.guildId,
    paymentId: payment.id,
    action: PaymentAuditAction.EXPIRED,
    oldValue: PaymentStatus.PENDING,
    newValue: PaymentStatus.EXPIRED,
  });

  const updated = await findPaymentById(payment.id);
  await emitPaymentEvent('expired', {
    payment: updated ?? { ...payment, status: PaymentStatus.EXPIRED },
    actorId: null,
  });
  return true;
}
