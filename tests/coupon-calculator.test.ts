import { describe, expect, it } from 'vitest';
import { CouponType } from '@prisma/client';

import {
  assertCouponEligible,
  calculateDiscount,
  checkCouponEligibility,
  describeCoupon,
  describeCouponValue,
  summarizeCouponLimits,
} from '../src/modules/coupons/services/CouponCalculator';
import type {
  CouponEligibilityContext,
  CouponLike,
} from '../src/modules/coupons/types/coupon';
import { CouponInvalidError, CouponUsageLimitError, ValidationError } from '../src/core/errors';
import { formatDateTimeBR } from '../src/utils/time';

const GUILD_ID = '111111111111111111';
const AGORA = new Date('2026-08-22T15:00:00.000Z');

function makeCoupon(overrides: Partial<CouponLike> = {}): CouponLike {
  return {
    id: 'cpn_teste',
    guildId: GUILD_ID,
    code: 'VOOK20',
    type: CouponType.PERCENTAGE,
    value: 2000, // 20,00%
    minimumAmount: null,
    maximumDiscount: null,
    maxUses: null,
    maxUsesPerCustomer: null,
    startsAt: null,
    expiresAt: null,
    enabled: true,
    deletedAt: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<CouponEligibilityContext> = {}): CouponEligibilityContext {
  return {
    guildId: GUILD_ID,
    amountCents: 25_000,
    now: AGORA,
    totalUses: 0,
    customerUses: 0,
    ...overrides,
  };
}

describe('calculateDiscount — percentual', () => {
  it('aplica 20% sobre R$ 250,00 resultando em R$ 50,00 de desconto e R$ 200,00 de total', () => {
    const cupom = makeCoupon({ type: CouponType.PERCENTAGE, value: 2000 });

    const resultado = calculateDiscount(cupom, 25_000);

    expect(resultado).toEqual({
      originalAmount: 25_000,
      discountAmount: 5_000,
      finalAmount: 20_000,
    });
  });

  it('arredonda para baixo: 10,5% de R$ 99,99 gera exatamente 1049 centavos', () => {
    const cupom = makeCoupon({ type: CouponType.PERCENTAGE, value: 1050 });

    const resultado = calculateDiscount(cupom, 9_999);

    // floor(9999 * 1050 / 10000) = floor(1049,895) = 1049
    expect(resultado.discountAmount).toBe(1_049);
    expect(resultado.finalAmount).toBe(8_950);
    expect(Number.isInteger(resultado.discountAmount)).toBe(true);
  });

  it('nao produz residuo de ponto flutuante em percentuais quebrados', () => {
    const cupom = makeCoupon({ type: CouponType.PERCENTAGE, value: 3333 }); // 33,33%

    expect(calculateDiscount(cupom, 10_000).discountAmount).toBe(3_333);
    expect(calculateDiscount(cupom, 7).discountAmount).toBe(2); // floor(2,3331)
  });

  it('cupom de 100% zera o total', () => {
    const cupom = makeCoupon({ type: CouponType.PERCENTAGE, value: 10_000 });

    const resultado = calculateDiscount(cupom, 25_000);

    expect(resultado.discountAmount).toBe(25_000);
    expect(resultado.finalAmount).toBe(0);
  });

  it('respeita o teto de desconto (maximumDiscount)', () => {
    const cupom = makeCoupon({
      type: CouponType.PERCENTAGE,
      value: 2000, // 20% de R$ 1.000,00 seriam R$ 200,00
      maximumDiscount: 5_000, // teto de R$ 50,00
    });

    const resultado = calculateDiscount(cupom, 100_000);

    expect(resultado.discountAmount).toBe(5_000);
    expect(resultado.finalAmount).toBe(95_000);
  });
});

describe('calculateDiscount — valor fixo', () => {
  it('desconta o valor fixo em centavos', () => {
    const cupom = makeCoupon({ type: CouponType.FIXED_AMOUNT, value: 5_000, code: 'VOOK50' });

    const resultado = calculateDiscount(cupom, 25_000);

    expect(resultado.discountAmount).toBe(5_000);
    expect(resultado.finalAmount).toBe(20_000);
  });

  it('desconto maior que o valor original zera o total sem ficar negativo', () => {
    const cupom = makeCoupon({ type: CouponType.FIXED_AMOUNT, value: 90_000, code: 'VOOK900' });

    const resultado = calculateDiscount(cupom, 25_000);

    expect(resultado.discountAmount).toBe(25_000);
    expect(resultado.finalAmount).toBe(0);
    expect(resultado.finalAmount).toBeGreaterThanOrEqual(0);
  });
});

describe('calculateDiscount — entradas invalidas', () => {
  it('rejeita valores nao inteiros, zero ou negativos', () => {
    const cupom = makeCoupon();

    expect(() => calculateDiscount(cupom, 0)).toThrow(ValidationError);
    expect(() => calculateDiscount(cupom, -100)).toThrow(ValidationError);
    expect(() => calculateDiscount(cupom, 12.5)).toThrow(ValidationError);
    expect(() => calculateDiscount(cupom, Number.NaN)).toThrow(ValidationError);
    expect(() => calculateDiscount(cupom, Number.POSITIVE_INFINITY)).toThrow(ValidationError);
  });

  it('nunca produz NaN quando maximumDiscount vem corrompido do banco', () => {
    // Math.max(0, NaN) e NaN: um teto corrompido contaminava discountAmount e
    // finalAmount, levando um NaN direto para a cobranca.
    const corrompido = calculateDiscount(makeCoupon({ maximumDiscount: Number.NaN }), 25_000);

    expect(Number.isInteger(corrompido.discountAmount)).toBe(true);
    expect(Number.isInteger(corrompido.finalAmount)).toBe(true);
    expect(corrompido.discountAmount).toBe(0);
    expect(corrompido.finalAmount).toBe(25_000);
  });

  it('teto negativo ou infinito nao gera desconto negativo nem total negativo', () => {
    const negativo = calculateDiscount(makeCoupon({ maximumDiscount: -500 }), 25_000);
    expect(negativo).toEqual({ originalAmount: 25_000, discountAmount: 0, finalAmount: 25_000 });

    // Infinito tambem e dado corrompido: o motor bloqueia o desconto em vez de
    // tratar como "sem teto" (dado corrompido nunca pode liberar dinheiro).
    const infinito = calculateDiscount(
      makeCoupon({ maximumDiscount: Number.POSITIVE_INFINITY }),
      25_000,
    );
    expect(infinito).toEqual({ originalAmount: 25_000, discountAmount: 0, finalAmount: 25_000 });

    const valorCorrompido = calculateDiscount(makeCoupon({ value: Number.NaN }), 25_000);
    expect(valorCorrompido.discountAmount).toBe(0);
    expect(valorCorrompido.finalAmount).toBe(25_000);
  });

  it('expoe userMessage seguro ao usuario', () => {
    const cupom = makeCoupon();

    try {
      calculateDiscount(cupom, 0);
      expect.unreachable('deveria ter lancado ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).userMessage).toBe(
        'O valor da compra precisa ser maior que zero.',
      );
    }
  });
});

describe('checkCouponEligibility', () => {
  it('aprova o caminho feliz', () => {
    expect(checkCouponEligibility(makeCoupon(), makeContext())).toEqual({ ok: true });
  });

  it('rejeita cupom de outra guild antes de qualquer outra checagem', () => {
    const cupom = makeCoupon({
      guildId: '999999999999999999',
      enabled: false,
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const resultado = checkCouponEligibility(cupom, makeContext());

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.reason).toBe('guild_mismatch');
    expect(resultado.userMessage).toBe('Este cupom nao pertence a este servidor.');
  });

  it('rejeita cupom deletado', () => {
    const cupom = makeCoupon({ deletedAt: new Date('2026-08-01T00:00:00.000Z') });

    const resultado = checkCouponEligibility(cupom, makeContext());

    expect(resultado).toEqual({
      ok: false,
      reason: 'coupon_deleted',
      userMessage: 'Este cupom nao esta mais disponivel.',
    });
  });

  it('rejeita cupom desabilitado', () => {
    const resultado = checkCouponEligibility(makeCoupon({ enabled: false }), makeContext());

    expect(resultado).toEqual({
      ok: false,
      reason: 'coupon_disabled',
      userMessage: 'Este cupom esta desativado no momento.',
    });
  });

  it('rejeita cupom que ainda nao comecou e aceita exatamente no instante de inicio', () => {
    const cupom = makeCoupon({ startsAt: new Date('2026-08-23T00:00:00.000Z') });

    const antes = checkCouponEligibility(cupom, makeContext());
    expect(antes.ok).toBe(false);
    if (!antes.ok) {
      expect(antes.reason).toBe('coupon_not_started');
      expect(antes.userMessage).toContain('ainda nao e valido');
    }

    const noInstante = checkCouponEligibility(
      cupom,
      makeContext({ now: new Date('2026-08-23T00:00:00.000Z') }),
    );
    expect(noInstante).toEqual({ ok: true });
  });

  it('rejeita cupom expirado e aceita exatamente no instante de expiracao', () => {
    const cupom = makeCoupon({ expiresAt: new Date('2026-08-22T14:59:59.999Z') });

    const depois = checkCouponEligibility(cupom, makeContext());
    expect(depois.ok).toBe(false);
    if (!depois.ok) {
      expect(depois.reason).toBe('coupon_expired');
      expect(depois.userMessage).toContain('expirou em');
    }

    const noLimite = checkCouponEligibility(
      cupom,
      makeContext({ now: new Date('2026-08-22T14:59:59.999Z') }),
    );
    expect(noLimite).toEqual({ ok: true });
  });

  it('bloqueia abaixo do valor minimo e permite quando o valor e igual ao minimo', () => {
    const cupom = makeCoupon({ minimumAmount: 25_000 });

    const abaixo = checkCouponEligibility(cupom, makeContext({ amountCents: 24_999 }));
    expect(abaixo.ok).toBe(false);
    if (!abaixo.ok) {
      expect(abaixo.reason).toBe('minimum_amount_not_reached');
      expect(abaixo.userMessage).toBe(
        'Este cupom vale apenas para compras a partir de R$ 250,00.',
      );
    }

    expect(checkCouponEligibility(cupom, makeContext({ amountCents: 25_000 }))).toEqual({
      ok: true,
    });
  });

  it('bloqueia quando o limite global de usos foi atingido', () => {
    const cupom = makeCoupon({ maxUses: 10 });

    expect(checkCouponEligibility(cupom, makeContext({ totalUses: 9 }))).toEqual({ ok: true });
    expect(checkCouponEligibility(cupom, makeContext({ totalUses: 10 }))).toEqual({
      ok: false,
      reason: 'max_uses_reached',
      userMessage: 'Este cupom atingiu o limite total de usos.',
    });
  });

  it('bloqueia quando o limite por cliente foi atingido', () => {
    const cupom = makeCoupon({ maxUsesPerCustomer: 1 });

    expect(checkCouponEligibility(cupom, makeContext({ customerUses: 0 }))).toEqual({ ok: true });
    expect(checkCouponEligibility(cupom, makeContext({ customerUses: 1 }))).toEqual({
      ok: false,
      reason: 'max_uses_per_customer_reached',
      userMessage: 'Voce ja utilizou este cupom o numero maximo de vezes permitido.',
    });
  });

  it('rejeita quando o desconto calculado e zero', () => {
    // 0,01% de R$ 1,00 arredonda para 0 centavo.
    const cupomMinusculo = makeCoupon({ type: CouponType.PERCENTAGE, value: 1 });
    const semEfeito = checkCouponEligibility(cupomMinusculo, makeContext({ amountCents: 100 }));

    expect(semEfeito).toEqual({
      ok: false,
      reason: 'no_effective_discount',
      userMessage: 'Este cupom nao gera desconto para este valor de compra.',
    });

    // Teto zerado tambem anula o desconto.
    const cupomComTetoZero = makeCoupon({ maximumDiscount: 0 });
    const tetoZero = checkCouponEligibility(cupomComTetoZero, makeContext());
    expect(tetoZero.ok).toBe(false);
    if (!tetoZero.ok) expect(tetoZero.reason).toBe('no_effective_discount');
  });

  it('lanca ValidationError quando o valor do contexto e invalido', () => {
    expect(() => checkCouponEligibility(makeCoupon(), makeContext({ amountCents: 0 }))).toThrow(
      ValidationError,
    );
  });

  it('lanca ValidationError quando os contadores de uso do contexto sao invalidos', () => {
    expect(() => checkCouponEligibility(makeCoupon(), makeContext({ totalUses: -1 }))).toThrow(
      ValidationError,
    );
    expect(() =>
      checkCouponEligibility(makeCoupon(), makeContext({ customerUses: Number.NaN })),
    ).toThrow(ValidationError);
  });

  it('lanca ValidationError quando `now` e uma data invalida em vez de aceitar o cupom', () => {
    // Toda comparacao com NaN e falsa: um `now` invalido fazia as checagens de
    // periodo passarem em silencio e um cupom expirado ser aprovado.
    const expirado = makeCoupon({ expiresAt: new Date('2020-01-01T00:00:00.000Z') });

    expect(() =>
      checkCouponEligibility(expirado, makeContext({ now: new Date('data-invalida') })),
    ).toThrow(ValidationError);
  });

  it('bloqueia cupom com datas corrompidas em vez de trata-lo como eterno', () => {
    const semFim = makeCoupon({ expiresAt: new Date('nao-e-data') });
    const resultadoFim = checkCouponEligibility(semFim, makeContext());

    expect(resultadoFim).toEqual({
      ok: false,
      reason: 'coupon_period_invalid',
      userMessage: 'Este cupom possui um periodo de validade invalido. Avise um administrador.',
    });

    const semInicio = makeCoupon({ startsAt: new Date('nao-e-data') });
    const resultadoInicio = checkCouponEligibility(semInicio, makeContext());
    expect(resultadoInicio.ok).toBe(false);
    if (!resultadoInicio.ok) expect(resultadoInicio.reason).toBe('coupon_period_invalid');
  });

  it('limites de uso corrompidos bloqueiam em vez de liberar usos infinitos', () => {
    const maxUsesCorrompido = makeCoupon({ maxUses: Number.NaN });
    const porTotal = checkCouponEligibility(maxUsesCorrompido, makeContext({ totalUses: 0 }));
    expect(porTotal.ok).toBe(false);
    if (!porTotal.ok) expect(porTotal.reason).toBe('max_uses_reached');

    const porCliente = checkCouponEligibility(
      makeCoupon({ maxUsesPerCustomer: Number.NaN }),
      makeContext({ customerUses: 0 }),
    );
    expect(porCliente.ok).toBe(false);
    if (!porCliente.ok) expect(porCliente.reason).toBe('max_uses_per_customer_reached');
  });
});

describe('assertCouponEligible', () => {
  it('nao lanca no caminho feliz', () => {
    expect(() => assertCouponEligible(makeCoupon(), makeContext())).not.toThrow();
  });

  it('lanca CouponUsageLimitError quando maxUses foi atingido', () => {
    const cupom = makeCoupon({ maxUses: 3 });

    try {
      assertCouponEligible(cupom, makeContext({ totalUses: 3 }));
      expect.unreachable('deveria ter lancado CouponUsageLimitError');
    } catch (error) {
      expect(error).toBeInstanceOf(CouponUsageLimitError);
      const typed = error as CouponUsageLimitError;
      expect(typed.code).toBe('COUPON_USAGE_LIMIT');
      expect(typed.userMessage).toBe('Este cupom atingiu o limite total de usos.');
      expect(typed.message).toContain('max_uses_reached');
      expect(typed.context['couponCode']).toBe('VOOK20');
    }
  });

  it('lanca CouponUsageLimitError quando maxUsesPerCustomer foi atingido', () => {
    const cupom = makeCoupon({ maxUsesPerCustomer: 2 });

    try {
      assertCouponEligible(cupom, makeContext({ customerUses: 2 }));
      expect.unreachable('deveria ter lancado CouponUsageLimitError');
    } catch (error) {
      expect(error).toBeInstanceOf(CouponUsageLimitError);
      expect((error as CouponUsageLimitError).userMessage).toBe(
        'Voce ja utilizou este cupom o numero maximo de vezes permitido.',
      );
    }
  });

  it('lanca CouponInvalidError para bloqueios que nao sao de limite de uso', () => {
    const desabilitado = makeCoupon({ enabled: false });
    expect(() => assertCouponEligible(desabilitado, makeContext())).toThrow(CouponInvalidError);

    const expirado = makeCoupon({ expiresAt: new Date('2026-01-01T00:00:00.000Z') });
    expect(() => assertCouponEligible(expirado, makeContext())).toThrow(CouponInvalidError);

    const abaixoDoMinimo = makeCoupon({ minimumAmount: 50_000 });
    try {
      assertCouponEligible(abaixoDoMinimo, makeContext());
      expect.unreachable('deveria ter lancado CouponInvalidError');
    } catch (error) {
      expect(error).toBeInstanceOf(CouponInvalidError);
      const typed = error as CouponInvalidError;
      expect(typed.code).toBe('COUPON_INVALID');
      expect(typed.userMessage).toBe(
        'Este cupom vale apenas para compras a partir de R$ 500,00.',
      );
    }
  });

  it('nao e um CouponUsageLimitError quando o motivo e outro', () => {
    const outraGuild = makeCoupon({ guildId: '222222222222222222' });

    expect(() => assertCouponEligible(outraGuild, makeContext())).toThrow(CouponInvalidError);
    expect(() => assertCouponEligible(outraGuild, makeContext())).not.toThrow(
      CouponUsageLimitError,
    );
  });
});

describe('descricoes legiveis', () => {
  it('describeCouponValue formata percentual e valor fixo', () => {
    expect(describeCouponValue(makeCoupon({ type: CouponType.PERCENTAGE, value: 2000 }))).toBe(
      '20%',
    );
    expect(describeCouponValue(makeCoupon({ type: CouponType.PERCENTAGE, value: 1050 }))).toBe(
      '10,5%',
    );
    expect(describeCouponValue(makeCoupon({ type: CouponType.PERCENTAGE, value: 10_000 }))).toBe(
      '100%',
    );
    expect(describeCouponValue(makeCoupon({ type: CouponType.FIXED_AMOUNT, value: 5_000 }))).toBe(
      'R$ 50,00',
    );
    expect(
      describeCouponValue(makeCoupon({ type: CouponType.FIXED_AMOUNT, value: 123_456 })),
    ).toBe('R$ 1.234,56');
  });

  it('describeCoupon junta codigo e valor com travessao', () => {
    expect(describeCoupon(makeCoupon())).toBe('VOOK20 — 20%');
    expect(
      describeCoupon(makeCoupon({ code: 'FIXO10', type: CouponType.FIXED_AMOUNT, value: 1_000 })),
    ).toBe('FIXO10 — R$ 10,00');
  });

  it('summarizeCouponLimits retorna lista vazia quando nao ha restricoes', () => {
    expect(summarizeCouponLimits(makeCoupon())).toEqual([]);
  });

  it('summarizeCouponLimits descreve todas as restricoes na ordem esperada', () => {
    const startsAt = new Date('2026-08-01T03:00:00.000Z');
    const expiresAt = new Date('2026-09-01T02:59:59.000Z');
    const cupom = makeCoupon({
      startsAt,
      expiresAt,
      minimumAmount: 10_000,
      maximumDiscount: 5_000,
      maxUses: 100,
      maxUsesPerCustomer: 1,
    });

    expect(summarizeCouponLimits(cupom)).toEqual([
      `Valido a partir de ${formatDateTimeBR(startsAt)}`,
      `Valido ate ${formatDateTimeBR(expiresAt)}`,
      'Valor minimo da compra: R$ 100,00',
      'Desconto maximo: R$ 50,00',
      'Limite de 100 usos no total',
      'Limite de 1 uso por cliente',
    ]);
  });

  it('summarizeCouponLimits ignora minimo e teto iguais a zero', () => {
    expect(summarizeCouponLimits(makeCoupon({ minimumAmount: 0, maximumDiscount: 0 }))).toEqual(
      [],
    );
  });
});
