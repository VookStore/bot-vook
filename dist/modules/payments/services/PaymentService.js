"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.priceCharge = priceCharge;
exports.createCharge = createCharge;
exports.loadPayment = loadPayment;
exports.describeStatus = describeStatus;
exports.linkedOrderId = linkedOrderId;
exports.approvePayment = approvePayment;
exports.cancelPayment = cancelPayment;
exports.changePaymentCoupon = changePaymentCoupon;
exports.changePaymentAmount = changePaymentAmount;
exports.expirePayment = expirePayment;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const PaymentEvents_1 = require("../../../core/events/PaymentEvents");
const LockService_1 = require("../../../core/locks/LockService");
const prisma_1 = require("../../../core/database/prisma");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const money_1 = require("../../../utils/money");
const CouponCalculator_1 = require("../../coupons/services/CouponCalculator");
const CouponService_1 = require("../../coupons/services/CouponService");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const PaymentAccountService_1 = require("./PaymentAccountService");
const PixPayloadService_1 = require("./PixPayloadService");
const PaymentRepository_1 = require("../repositories/PaymentRepository");
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
const logger = (0, Logger_1.createLogger)('payment');
/** txid do BR Code (campo 62-05): ate 25 caracteres alfanumericos. */
function buildTxid(paymentId) {
    return paymentId.replace(/[^A-Za-z0-9]/g, '').slice(0, limits_1.BUSINESS_LIMITS.PIX_TXID_MAX);
}
function newPaymentId() {
    return (0, node_crypto_1.randomUUID)().replace(/-/g, '');
}
/** Valida o valor BRUTO informado pela equipe. */
function assertChargeableAmount(amountCents) {
    if (!Number.isInteger(amountCents) || amountCents < limits_1.BUSINESS_LIMITS.PAYMENT_MIN_CENTS) {
        throw new errors_1.ValidationError(`Valor invalido: ${String(amountCents)}`, {
            userMessage: `O valor precisa ser de no minimo ${(0, money_1.formatCents)(limits_1.BUSINESS_LIMITS.PAYMENT_MIN_CENTS)}.`,
        });
    }
    if (amountCents > limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS) {
        throw new errors_1.ValidationError(`Valor acima do teto: ${String(amountCents)}`, {
            userMessage: `O valor maximo permitido e ${(0, money_1.formatCents)(limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS)}.`,
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
function assertChargeableFinalAmount(finalAmount, couponCode) {
    if (finalAmount >= limits_1.BUSINESS_LIMITS.PAYMENT_MIN_CENTS)
        return;
    const codigo = couponCode !== null && couponCode.length > 0 ? ` \`${couponCode}\`` : '';
    throw new errors_1.ValidationError(`Total final invalido apos desconto: ${String(finalAmount)}`, {
        userMessage: `O cupom${codigo} zera o total desta compra, e uma cobranca PIX nao pode ser de ` +
            `${(0, money_1.formatCents)(0)}. Remova o cupom ou use um de valor menor.`,
    });
}
/** Calcula o preco final validando o cupom (quando houver) no momento atual. */
async function priceCharge(params) {
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
    const { coupon, discount } = await (0, CouponService_1.validateCouponForPayment)(params.guildId, params.couponId, params.amountCents, params.customerId);
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
async function repriceWithSnapshot(payment, amountCents, couponId) {
    const keepsSameCoupon = couponId !== null &&
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
    const snapshot = {
        id: payment.couponId,
        guildId: payment.guildId,
        code: payment.couponCodeSnapshot ?? '',
        type: payment.couponTypeSnapshot,
        value: payment.couponValueSnapshot,
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
    const discount = (0, CouponCalculator_1.calculateDiscount)(snapshot, amountCents);
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
function isCouponRejection(error) {
    return (error instanceof errors_1.CouponInvalidError ||
        error instanceof errors_1.CouponUsageLimitError ||
        error instanceof errors_1.CouponNotFoundError);
}
/** Cria a cobranca ja com payload PIX valido para o valor FINAL. */
async function createCharge(params) {
    const account = await (0, PaymentAccountService_1.getAccountById)(params.guild.id, params.accountId);
    if (account === null || account.deletedAt !== null) {
        throw new errors_1.ValidationError(`Conta PIX inexistente: ${params.accountId}`, {
            userMessage: 'Esta conta PIX nao existe mais. Selecione outra conta.',
        });
    }
    if (!account.enabled) {
        throw new errors_1.ValidationError(`Conta PIX desabilitada: ${account.id}`, {
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
    const pixPayload = (0, PixPayloadService_1.buildPixPayload)({
        pixKey: account.pixKey,
        receiverName: account.receiverName,
        city: account.city,
        amountCents: pricing.finalAmount,
        txid: buildTxid(paymentId),
        description: params.description,
    });
    const expiresAt = new Date(Date.now() + account.defaultExpirationMinutes * 60_000);
    await (0, prisma_1.getPrisma)().payment.create({
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
            sourceType: params.source?.type ?? client_1.PaymentSource.MANUAL_COMMAND,
            sourceId: params.source?.id ?? null,
            status: client_1.PaymentStatus.PENDING,
        },
    });
    await (0, AuditRepository_1.recordPaymentAudit)({
        guildId: params.guild.id,
        paymentId,
        action: client_1.PaymentAuditAction.CREATED,
        actorId: params.createdBy.id,
        newValue: (0, money_1.formatCents)(pricing.finalAmount),
        metadata: {
            customerId: params.customerId,
            accountId: account.id,
            originalAmount: pricing.originalAmount,
            discountAmount: pricing.discountAmount,
            couponCode: pricing.couponCodeSnapshot,
        },
    });
    if (pricing.couponId !== null) {
        await (0, AuditRepository_1.recordPaymentAudit)({
            guildId: params.guild.id,
            paymentId,
            action: client_1.PaymentAuditAction.COUPON_APPLIED,
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
    const created = await (0, PaymentRepository_1.findPaymentWithAccount)(paymentId);
    if (created === null) {
        throw new errors_1.PaymentNotFoundError(paymentId, {
            userMessage: 'A cobranca foi criada mas nao pode ser carregada. Tente novamente.',
        });
    }
    return created;
}
/** Carrega a cobranca garantindo que ela pertence a guild. */
async function loadPayment(guildId, paymentId) {
    const payment = await (0, PaymentRepository_1.findPaymentWithAccount)(paymentId);
    if (payment === null || payment.guildId !== guildId) {
        throw new errors_1.PaymentNotFoundError(paymentId);
    }
    return payment;
}
function assertPending(payment) {
    if (payment.status !== client_1.PaymentStatus.PENDING) {
        throw new errors_1.PaymentStateError(`Pagamento nao esta pendente: ${payment.status}`, {
            userMessage: `Esta cobranca esta com status "${describeStatus(payment.status)}" e nao pode mais ser alterada.`,
        });
    }
}
function describeStatus(status) {
    switch (status) {
        case client_1.PaymentStatus.PENDING:
            return 'Aguardando pagamento';
        case client_1.PaymentStatus.APPROVED:
            return 'Aprovado pela equipe';
        case client_1.PaymentStatus.CANCELLED:
            return 'Cancelado';
        case client_1.PaymentStatus.EXPIRED:
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
function linkedOrderId(payment) {
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
async function approvePayment(guildId, staff, paymentId) {
    const approved = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PAYMENT_ACTION, paymentId, async () => {
        const payment = await loadPayment(guildId, paymentId);
        assertPending(payment);
        await (0, prisma_1.getPrisma)().$transaction(async (tx) => {
            const won = await (0, PaymentRepository_1.approvePaymentAtomic)(paymentId, staff.id, tx);
            if (!won) {
                throw new errors_1.PaymentStateError('Aprovacao concorrente detectada.', {
                    userMessage: 'Esta cobranca ja foi processada por outra pessoa.',
                });
            }
            if (payment.couponId !== null) {
                await (0, CouponService_1.confirmCouponUsage)(tx, {
                    guildId,
                    couponId: payment.couponId,
                    paymentId,
                    customerId: payment.customerId,
                    discountAmount: payment.discountAmount,
                });
            }
        });
        await (0, AuditRepository_1.recordPaymentAudit)({
            guildId,
            paymentId,
            action: client_1.PaymentAuditAction.APPROVED,
            actorId: staff.id,
            oldValue: client_1.PaymentStatus.PENDING,
            newValue: client_1.PaymentStatus.APPROVED,
            metadata: { finalAmount: payment.finalAmount, coupon: payment.couponCodeSnapshot },
        });
        logger.info('Cobranca aprovada manualmente pela equipe.', {
            guildId,
            userId: staff.id,
            entityType: 'payment',
            entityId: paymentId,
        });
        const updated = await (0, PaymentRepository_1.findPaymentById)(paymentId);
        return updated ?? payment;
    }, { userMessage: 'Esta cobranca ja esta sendo processada.' });
    /*
     * Anuncio FORA do lock: um ouvinte (ex.: sincronizacao do pedido) pode
     * precisar tocar o mesmo pagamento, e os locks nao sao reentrantes.
     * Falha de ouvinte nao invalida a aprovacao, que ja esta commitada.
     */
    await (0, PaymentEvents_1.emitPaymentEvent)('approved', { payment: approved, actorId: staff.id });
    return approved;
}
async function cancelPayment(guildId, staff, paymentId, reason) {
    const cancelled = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PAYMENT_ACTION, paymentId, async () => {
        const payment = await loadPayment(guildId, paymentId);
        assertPending(payment);
        const applied = await (0, PaymentRepository_1.cancelPaymentAtomic)(paymentId, staff.id, reason);
        if (!applied) {
            throw new errors_1.PaymentStateError('Cancelamento concorrente detectado.', {
                userMessage: 'Esta cobranca ja foi processada por outra pessoa.',
            });
        }
        await (0, AuditRepository_1.recordPaymentAudit)({
            guildId,
            paymentId,
            action: client_1.PaymentAuditAction.CANCELLED,
            actorId: staff.id,
            oldValue: client_1.PaymentStatus.PENDING,
            newValue: client_1.PaymentStatus.CANCELLED,
            metadata: { reason },
        });
        logger.info('Cobranca cancelada.', {
            guildId,
            userId: staff.id,
            entityType: 'payment',
            entityId: paymentId,
        });
        const updated = await (0, PaymentRepository_1.findPaymentById)(paymentId);
        return updated ?? payment;
    }, { userMessage: 'Esta cobranca ja esta sendo processada.' });
    await (0, PaymentEvents_1.emitPaymentEvent)('cancelled', { payment: cancelled, actorId: staff.id });
    return cancelled;
}
/**
 * Recalcula a cobranca pendente (troca/remocao de cupom ou novo valor).
 * SEMPRE regenera o payload PIX: nunca fica um QR antigo com valor diferente.
 */
async function repricePending(params) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PAYMENT_ACTION, params.paymentId, async () => {
        const payment = await loadPayment(params.guildId, params.paymentId);
        assertPending(payment);
        // Conta PIX morta nao pode receber um BR Code novo. `createCharge` ja
        // bloqueia isso na criacao; sem a mesma checagem aqui, reprecificar uma
        // cobranca antiga emitia um QR apontando para uma conta excluida.
        if (payment.account.deletedAt !== null) {
            throw new errors_1.ValidationError(`Conta PIX excluida: ${payment.account.id}`, {
                userMessage: 'A conta PIX desta cobranca foi excluida. Cancele esta cobranca e gere uma nova.',
            });
        }
        if (!payment.account.enabled) {
            throw new errors_1.ValidationError(`Conta PIX desabilitada: ${payment.account.id}`, {
                userMessage: 'A conta PIX desta cobranca esta desativada. Cancele esta cobranca e gere uma nova.',
            });
        }
        const originalAmount = params.amountCents ?? payment.originalAmount;
        const pricing = await repriceWithSnapshot(payment, originalAmount, params.couponId);
        const pixPayload = (0, PixPayloadService_1.buildPixPayload)({
            pixKey: payment.account.pixKey,
            receiverName: payment.account.receiverName,
            city: payment.account.city,
            amountCents: pricing.finalAmount,
            txid: buildTxid(payment.id),
            description: payment.description,
        });
        const updated = await (0, PaymentRepository_1.updatePendingPayment)(params.paymentId, {
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
            throw new errors_1.PaymentStateError('Cobranca deixou de estar pendente.', {
                userMessage: 'Esta cobranca ja foi processada por outra pessoa.',
            });
        }
        await (0, AuditRepository_1.recordPaymentAudit)({
            guildId: params.guildId,
            paymentId: params.paymentId,
            action: params.action,
            actorId: params.staff.id,
            oldValue: `${(0, money_1.formatCents)(payment.finalAmount)}${payment.couponCodeSnapshot !== null ? ` (${payment.couponCodeSnapshot})` : ''}`,
            newValue: `${(0, money_1.formatCents)(updated.finalAmount)}${updated.couponCodeSnapshot !== null ? ` (${updated.couponCodeSnapshot})` : ''}`,
        });
        return updated;
    }, { userMessage: 'Esta cobranca ja esta sendo processada.' });
}
async function changePaymentCoupon(guildId, staff, paymentId, couponId) {
    const current = await loadPayment(guildId, paymentId);
    const action = couponId === null
        ? client_1.PaymentAuditAction.COUPON_REMOVED
        : current.couponId === null
            ? client_1.PaymentAuditAction.COUPON_APPLIED
            : client_1.PaymentAuditAction.COUPON_CHANGED;
    return repricePending({ guildId, staff, paymentId, couponId, action });
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
async function changePaymentAmount(guildId, staff, paymentId, amountCents) {
    const current = await loadPayment(guildId, paymentId);
    if (current.couponId === null) {
        const payment = await repricePending({
            guildId,
            staff,
            paymentId,
            amountCents,
            couponId: null,
            action: client_1.PaymentAuditAction.AMOUNT_CHANGED,
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
            action: client_1.PaymentAuditAction.AMOUNT_CHANGED,
        });
        return { payment, droppedCoupon: null };
    }
    catch (error) {
        if (!isCouponRejection(error))
            throw error;
        const payment = await repricePending({
            guildId,
            staff,
            paymentId,
            amountCents,
            couponId: null,
            action: client_1.PaymentAuditAction.AMOUNT_CHANGED,
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
async function expirePayment(payment) {
    const expired = await (0, PaymentRepository_1.expirePaymentAtomic)(payment.id);
    if (!expired)
        return false;
    await (0, AuditRepository_1.recordPaymentAudit)({
        guildId: payment.guildId,
        paymentId: payment.id,
        action: client_1.PaymentAuditAction.EXPIRED,
        oldValue: client_1.PaymentStatus.PENDING,
        newValue: client_1.PaymentStatus.EXPIRED,
    });
    const updated = await (0, PaymentRepository_1.findPaymentById)(payment.id);
    await (0, PaymentEvents_1.emitPaymentEvent)('expired', {
        payment: updated ?? { ...payment, status: client_1.PaymentStatus.EXPIRED },
        actorId: null,
    });
    return true;
}
//# sourceMappingURL=PaymentService.js.map