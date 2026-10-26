"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDiscount = calculateDiscount;
exports.checkCouponEligibility = checkCouponEligibility;
exports.assertCouponEligible = assertCouponEligible;
exports.describeCouponValue = describeCouponValue;
exports.describeCoupon = describeCoupon;
exports.summarizeCouponLimits = summarizeCouponLimits;
const errors_1 = require("../../../core/errors");
const money_1 = require("../../../utils/money");
const time_1 = require("../../../utils/time");
/**
 * Motor de cupons: calculo e validacao.
 *
 * Logica 100% pura (sem banco, sem Discord, sem relogio interno) para que o
 * resultado seja deterministico e auditavel.
 *
 * REGRAS FINANCEIRAS:
 *  - Todo valor monetario e inteiro em centavos. Nunca usar float.
 *  - Cupom PERCENTAGE guarda base 100 (2000 = 20,00%), logo o divisor e
 *    PERCENT_SCALE (10000).
 *  - O DESCONTO e arredondado sempre para baixo (Math.floor): a fracao de
 *    centavo fica com a loja, ou seja, o cliente paga no maximo R$ 0,01 a mais
 *    que o percentual exato. Nunca se cria desconto do nada.
 *  - O desconto nunca ultrapassa o valor original; o total nunca fica negativo.
 *  - Todo numero vindo do banco e normalizado antes de entrar na conta: um
 *    campo corrompido (NaN, Infinity, negativo, fracionario) nunca pode
 *    contaminar um valor monetario nem afrouxar um limite.
 */
/** Motivos tecnicos estaveis (log/metricas). O texto do usuario vai em `userMessage`. */
const REASON = {
    GUILD_MISMATCH: 'guild_mismatch',
    COUPON_DELETED: 'coupon_deleted',
    COUPON_DISABLED: 'coupon_disabled',
    COUPON_NOT_STARTED: 'coupon_not_started',
    COUPON_EXPIRED: 'coupon_expired',
    COUPON_PERIOD_INVALID: 'coupon_period_invalid',
    MINIMUM_AMOUNT_NOT_REACHED: 'minimum_amount_not_reached',
    MAX_USES_REACHED: 'max_uses_reached',
    MAX_USES_PER_CUSTOMER_REACHED: 'max_uses_per_customer_reached',
    NO_EFFECTIVE_DISCOUNT: 'no_effective_discount',
    ZEROES_TOTAL: 'zeroes_total',
};
/** Texto exibido quando as datas do cupom estao corrompidas no banco. */
const PERIODO_INVALIDO_MENSAGEM = 'Este cupom possui um periodo de validade invalido. Avise um administrador.';
/** Motivos que representam limite de uso (viram CouponUsageLimitError). */
const USAGE_LIMIT_REASONS = new Set([
    REASON.MAX_USES_REACHED,
    REASON.MAX_USES_PER_CUSTOMER_REACHED,
]);
/** Garante que o valor da compra e um inteiro positivo em centavos. */
function assertValidAmount(amountCents) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new errors_1.ValidationError(`Valor invalido para calculo de cupom: ${String(amountCents)}`, {
            userMessage: 'O valor da compra precisa ser maior que zero.',
            context: { amountCents },
        });
    }
}
/** Garante que um contador de usos e um inteiro nao negativo. */
function assertValidUsageCount(campo, value) {
    if (!Number.isInteger(value) || value < 0) {
        throw new errors_1.ValidationError(`Contador de usos invalido (${campo}): ${String(value)}`, {
            userMessage: 'Nao foi possivel validar este cupom agora. Tente novamente.',
            context: { campo, value },
        });
    }
}
/**
 * Instante em milissegundos, ou `null` quando a data e corrompida.
 *
 * `new Date('lixo').getTime()` e NaN e QUALQUER comparacao com NaN e falsa, o
 * que faria uma data invalida passar despercebida por `<` e `>` (cupom
 * expirado seria aceito). Por isso a data invalida vira `null` explicito.
 */
function toTimestamp(date) {
    const ms = date instanceof Date ? date.getTime() : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
}
/** Valida o instante de referencia: `now` corrompido e erro de programacao. */
function assertValidNow(now) {
    const ms = toTimestamp(now);
    if (ms === null) {
        throw new errors_1.ValidationError('Instante de referencia invalido na validacao de cupom.', {
            userMessage: 'Nao foi possivel validar este cupom agora. Tente novamente.',
        });
    }
    return ms;
}
/** Normaliza campos numericos vindos do banco para inteiro nao negativo. */
function toNonNegativeInt(value) {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
/**
 * Mesma normalizacao para campos opcionais: `null` continua "sem limite", mas
 * um numero corrompido vira 0 (limite mais restritivo) em vez de escapar da
 * comparacao. NaN nunca pode chegar a um valor monetario nem anular um teto.
 */
function toNullableNonNegativeInt(value) {
    return value === null ? null : toNonNegativeInt(value);
}
/** Desconto bruto, antes do teto e dos limites de seguranca. */
function rawDiscount(coupon, originalAmount) {
    const value = toNonNegativeInt(coupon.value);
    switch (coupon.type) {
        case 'PERCENTAGE':
            // value 2000 = 20,00% -> originalAmount * 2000 / 10000
            return Math.floor((originalAmount * value) / money_1.PERCENT_SCALE);
        case 'FIXED_AMOUNT':
            return value;
        default: {
            const naoSuportado = coupon.type;
            throw new errors_1.ValidationError(`Tipo de cupom nao suportado: ${String(naoSuportado)}`, {
                userMessage: 'Este cupom possui uma configuracao invalida. Avise um administrador.',
                context: { couponId: coupon.id, type: String(naoSuportado) },
            });
        }
    }
}
/** Pluralizacao simples em pt-BR ("1 uso" / "3 usos"). */
function pluralize(quantidade, singular, plural) {
    return quantidade === 1 ? `${quantidade} ${singular}` : `${quantidade} ${plural}`;
}
function reject(reason, userMessage) {
    return { ok: false, reason, userMessage };
}
/**
 * Calcula o desconto de um cupom sobre um valor em centavos.
 *
 * @throws ValidationError se `originalAmount` nao for inteiro positivo, ou se o
 *         `type` do cupom nao for suportado (dado corrompido no banco).
 */
function calculateDiscount(coupon, originalAmount) {
    assertValidAmount(originalAmount);
    let discountAmount = rawDiscount(coupon, originalAmount);
    // Teto de desconto (principal uso: cupons percentuais em compras grandes).
    const teto = toNullableNonNegativeInt(coupon.maximumDiscount);
    if (teto !== null) {
        discountAmount = Math.min(discountAmount, teto);
    }
    // Travas de seguranca: nunca descontar mais que o total, nunca valor negativo.
    // `toNonNegativeInt` (e nao `Math.max(0, x)`) porque `Math.max(0, NaN)` e NaN
    // e um NaN aqui contaminaria `finalAmount` — e a cobranca do cliente.
    discountAmount = Math.min(discountAmount, originalAmount);
    discountAmount = toNonNegativeInt(discountAmount);
    return {
        originalAmount,
        discountAmount,
        finalAmount: originalAmount - discountAmount,
    };
}
/**
 * Verifica, na ordem definida pelo negocio, se o cupom pode ser aplicado.
 *
 * O contexto vem da camada de servico: `amountCents`, `now`, `totalUses` e
 * `customerUses` invalidos sao erro de programacao e levantam ValidationError
 * (nao viram "motivo de recusa" exibivel). Ja os campos do cupom vem do banco e
 * sao normalizados — dado corrompido bloqueia, nunca libera.
 */
function checkCouponEligibility(coupon, context) {
    assertValidAmount(context.amountCents);
    assertValidUsageCount('totalUses', context.totalUses);
    assertValidUsageCount('customerUses', context.customerUses);
    const agora = assertValidNow(context.now);
    // 1. Cupom precisa pertencer ao servidor da compra.
    if (coupon.guildId !== context.guildId) {
        return reject(REASON.GUILD_MISMATCH, 'Este cupom nao pertence a este servidor.');
    }
    // 2. Cupom removido (soft delete).
    if (coupon.deletedAt !== null) {
        return reject(REASON.COUPON_DELETED, 'Este cupom nao esta mais disponivel.');
    }
    // 3. Cupom desativado temporariamente.
    if (!coupon.enabled) {
        return reject(REASON.COUPON_DISABLED, 'Este cupom esta desativado no momento.');
    }
    // 4. Ainda nao entrou em vigor. Data corrompida bloqueia (nunca libera).
    if (coupon.startsAt !== null) {
        const inicio = toTimestamp(coupon.startsAt);
        if (inicio === null) {
            return reject(REASON.COUPON_PERIOD_INVALID, PERIODO_INVALIDO_MENSAGEM);
        }
        if (agora < inicio) {
            return reject(REASON.COUPON_NOT_STARTED, `Este cupom ainda nao e valido. Ele passa a valer em ${(0, time_1.formatDateTimeBR)(coupon.startsAt)}.`);
        }
    }
    // 5. Expirado. Data corrompida bloqueia (nunca vira cupom eterno).
    if (coupon.expiresAt !== null) {
        const fim = toTimestamp(coupon.expiresAt);
        if (fim === null) {
            return reject(REASON.COUPON_PERIOD_INVALID, PERIODO_INVALIDO_MENSAGEM);
        }
        if (agora > fim) {
            return reject(REASON.COUPON_EXPIRED, `Este cupom expirou em ${(0, time_1.formatDateTimeBR)(coupon.expiresAt)}.`);
        }
    }
    // 6. Valor minimo da compra.
    const minimo = toNullableNonNegativeInt(coupon.minimumAmount);
    if (minimo !== null && context.amountCents < minimo) {
        return reject(REASON.MINIMUM_AMOUNT_NOT_REACHED, `Este cupom vale apenas para compras a partir de ${(0, money_1.formatCents)(minimo)}.`);
    }
    // 7. Limite global de usos.
    const maxUses = toNullableNonNegativeInt(coupon.maxUses);
    if (maxUses !== null && context.totalUses >= maxUses) {
        return reject(REASON.MAX_USES_REACHED, 'Este cupom atingiu o limite total de usos.');
    }
    // 8. Limite de usos por cliente.
    const maxUsesPerCustomer = toNullableNonNegativeInt(coupon.maxUsesPerCustomer);
    if (maxUsesPerCustomer !== null && context.customerUses >= maxUsesPerCustomer) {
        return reject(REASON.MAX_USES_PER_CUSTOMER_REACHED, 'Voce ja utilizou este cupom o numero maximo de vezes permitido.');
    }
    // 9. Precisa gerar desconto real neste valor.
    const { discountAmount, finalAmount } = calculateDiscount(coupon, context.amountCents);
    if (discountAmount <= 0) {
        return reject(REASON.NO_EFFECTIVE_DISCOUNT, 'Este cupom nao gera desconto para este valor de compra.');
    }
    // 10. O que sobra precisa ser cobravel: um BR Code PIX nao aceita valor zero.
    // Sem esta etapa o cupom aparecia no select com "Total R$ 0,00", o vendedor
    // clicava em "Gerar Cobranca" e so entao levava um erro generico.
    if (finalAmount <= 0) {
        return reject(REASON.ZEROES_TOTAL, 'Este cupom zera o total da compra, e uma cobranca PIX nao pode ser de R$ 0,00.');
    }
    return { ok: true };
}
/**
 * Versao imperativa de {@link checkCouponEligibility}.
 *
 * @throws CouponUsageLimitError quando o bloqueio e de limite de uso.
 * @throws CouponInvalidError nos demais bloqueios.
 */
function assertCouponEligible(coupon, context) {
    const result = checkCouponEligibility(coupon, context);
    if (result.ok)
        return;
    const errorContext = {
        couponId: coupon.id,
        couponCode: coupon.code,
        guildId: context.guildId,
        amountCents: context.amountCents,
        reason: result.reason,
    };
    const technicalMessage = `Cupom ${coupon.code} inelegivel: ${result.reason}`;
    if (USAGE_LIMIT_REASONS.has(result.reason)) {
        throw new errors_1.CouponUsageLimitError(technicalMessage, {
            userMessage: result.userMessage,
            context: errorContext,
        });
    }
    throw new errors_1.CouponInvalidError(technicalMessage, {
        userMessage: result.userMessage,
        context: errorContext,
    });
}
/** Valor do cupom em texto: PERCENTAGE 2000 -> "20%"; FIXED_AMOUNT 5000 -> "R$ 50,00". */
function describeCouponValue(coupon) {
    const value = toNonNegativeInt(coupon.value);
    switch (coupon.type) {
        case 'PERCENTAGE':
            return (0, money_1.formatPercent)(value);
        case 'FIXED_AMOUNT':
            return (0, money_1.formatCents)(value);
        default: {
            const naoSuportado = coupon.type;
            throw new errors_1.ValidationError(`Tipo de cupom nao suportado: ${String(naoSuportado)}`, {
                userMessage: 'Este cupom possui uma configuracao invalida. Avise um administrador.',
                context: { couponId: coupon.id, type: String(naoSuportado) },
            });
        }
    }
}
/** Rotulo curto do cupom: "VOOK20 — 20%". */
function describeCoupon(coupon) {
    return `${coupon.code} — ${describeCouponValue(coupon)}`;
}
/** Lista legivel das restricoes do cupom. Vazia quando nao ha nenhuma. */
function summarizeCouponLimits(coupon) {
    const linhas = [];
    // Datas corrompidas sao omitidas: melhor nao mostrar a linha do que exibir
    // "Invalid Date" para o cliente.
    if (coupon.startsAt !== null && toTimestamp(coupon.startsAt) !== null) {
        linhas.push(`Valido a partir de ${(0, time_1.formatDateTimeBR)(coupon.startsAt)}`);
    }
    if (coupon.expiresAt !== null && toTimestamp(coupon.expiresAt) !== null) {
        linhas.push(`Valido ate ${(0, time_1.formatDateTimeBR)(coupon.expiresAt)}`);
    }
    const minimo = toNullableNonNegativeInt(coupon.minimumAmount);
    if (minimo !== null && minimo > 0) {
        linhas.push(`Valor minimo da compra: ${(0, money_1.formatCents)(minimo)}`);
    }
    const teto = toNullableNonNegativeInt(coupon.maximumDiscount);
    if (teto !== null && teto > 0) {
        linhas.push(`Desconto maximo: ${(0, money_1.formatCents)(teto)}`);
    }
    const maxUses = toNullableNonNegativeInt(coupon.maxUses);
    if (maxUses !== null) {
        linhas.push(`Limite de ${pluralize(maxUses, 'uso', 'usos')} no total`);
    }
    const maxUsesPerCustomer = toNullableNonNegativeInt(coupon.maxUsesPerCustomer);
    if (maxUsesPerCustomer !== null) {
        linhas.push(`Limite de ${pluralize(maxUsesPerCustomer, 'uso', 'usos')} por cliente`);
    }
    return linhas;
}
//# sourceMappingURL=CouponCalculator.js.map