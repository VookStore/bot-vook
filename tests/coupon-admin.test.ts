import { describe, expect, it } from 'vitest';
import { ComponentType } from 'discord.js';
import type { Coupon } from '@prisma/client';

import {
  COUPON_FIELD,
  buildCouponList,
  buildCouponMenu,
  buildCouponModal,
  buildCouponSelect,
  buildCouponSelectPanel,
  describeCouponTerms,
  formatCouponRulesInput,
  formatCouponValidityInput,
  formatCouponValueInput,
  parseCouponRulesInput,
  parseCouponValidityInput,
  parseCouponValueInput,
} from '../src/modules/coupons/builders/CouponBuilders';
import { COUPON_ACTION, NAMESPACE, buildCustomId } from '../src/constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../src/constants/limits';
import { ValidationError } from '../src/core/errors';

/**
 * Testes da camada administrativa de cupons.
 *
 * O foco sao os parsers do formulario (entrada humana -> inteiros em centavos e
 * datas reais) e a montagem dos componentes, que sao as partes puras e onde um
 * erro silencioso viraria dinheiro errado ou payload rejeitado pelo Discord.
 */

const GUILD_ID = '111111111111111111';

function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'cpn_teste',
    guildId: GUILD_ID,
    code: 'VOOK20',
    description: null,
    type: 'PERCENTAGE',
    value: 2000,
    minimumAmount: null,
    maximumDiscount: null,
    maxUses: null,
    maxUsesPerCustomer: null,
    startsAt: null,
    expiresAt: null,
    enabled: true,
    createdById: null,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('parseCouponValueInput', () => {
  it('interpreta percentual em base 100', () => {
    expect(parseCouponValueInput('20%')).toEqual({ type: 'PERCENTAGE', value: 2000 });
    expect(parseCouponValueInput(' 12,5 % ')).toEqual({ type: 'PERCENTAGE', value: 1250 });
  });

  it('interpreta valor fixo em centavos', () => {
    expect(parseCouponValueInput('R$ 50,00')).toEqual({ type: 'FIXED_AMOUNT', value: 5000 });
    expect(parseCouponValueInput('50')).toEqual({ type: 'FIXED_AMOUNT', value: 5000 });
    expect(parseCouponValueInput('1.250,50')).toEqual({ type: 'FIXED_AMOUNT', value: 125050 });
  });

  it('recusa campo vazio, percentual acima de 100 e texto invalido', () => {
    expect(() => parseCouponValueInput('   ')).toThrow(ValidationError);
    expect(() => parseCouponValueInput('150%')).toThrow(ValidationError);
    expect(() => parseCouponValueInput('vinte reais')).toThrow(ValidationError);
  });
});

describe('parseCouponRulesInput', () => {
  it('le todas as chaves no formato documentado', () => {
    expect(parseCouponRulesInput('min=100,00 | teto=50,00 | usos=100 | porcliente=1')).toEqual({
      minimumAmount: 10000,
      maximumDiscount: 5000,
      maxUses: 100,
      maxUsesPerCustomer: 1,
    });
  });

  it('campo vazio remove todas as regras', () => {
    expect(parseCouponRulesInput('   ')).toEqual({
      minimumAmount: null,
      maximumDiscount: null,
      maxUses: null,
      maxUsesPerCustomer: null,
    });
  });

  it('aceita acento, caixa alta, espacos e separadores alternativos', () => {
    expect(parseCouponRulesInput('MÍNIMO = 30,00 ; Usos Por Cliente = 2')).toEqual({
      minimumAmount: 3000,
      maximumDiscount: null,
      maxUses: null,
      maxUsesPerCustomer: 2,
    });
  });

  it('trata "-" como remocao do limite', () => {
    expect(parseCouponRulesInput('usos=-')).toEqual({
      minimumAmount: null,
      maximumDiscount: null,
      maxUses: null,
      maxUsesPerCustomer: null,
    });
  });

  it('recusa chave desconhecida, repetida, sem "=" ou com quantidade invalida', () => {
    expect(() => parseCouponRulesInput('desconto=10')).toThrow(ValidationError);
    expect(() => parseCouponRulesInput('usos=1 | usos=2')).toThrow(ValidationError);
    expect(() => parseCouponRulesInput('usos 10')).toThrow(ValidationError);
    expect(() => parseCouponRulesInput('usos=abc')).toThrow(ValidationError);
    expect(() => parseCouponRulesInput('usos=0')).toThrow(ValidationError);
  });
});

describe('parseCouponValidityInput', () => {
  it('interpreta o periodo completo no fuso de Brasilia', () => {
    const { startsAt, expiresAt } = parseCouponValidityInput('01/09/2026 - 30/09/2026');
    expect(startsAt?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(expiresAt?.toISOString()).toBe('2026-10-01T02:59:59.999Z');
  });

  it('aceita apenas o fim e apenas o inicio', () => {
    expect(parseCouponValidityInput('- 30/09/2026').startsAt).toBeNull();
    expect(parseCouponValidityInput('- 30/09/2026').expiresAt).not.toBeNull();
    expect(parseCouponValidityInput('01/09/2026 -').expiresAt).toBeNull();
    expect(parseCouponValidityInput('01/09/2026 -').startsAt).not.toBeNull();
  });

  it('campo vazio remove o prazo', () => {
    expect(parseCouponValidityInput('')).toEqual({ startsAt: null, expiresAt: null });
  });

  it('recusa data inexistente, periodo invertido e formato sem separador', () => {
    expect(() => parseCouponValidityInput('31/02/2026 - 01/03/2026')).toThrow(ValidationError);
    expect(() => parseCouponValidityInput('30/09/2026 - 01/09/2026')).toThrow(ValidationError);
    expect(() => parseCouponValidityInput('01/09/2026')).toThrow(ValidationError);
    expect(() => parseCouponValidityInput('01-09-2026 - 30/09/2026')).toThrow(ValidationError);
  });
});

describe('formatadores do formulario', () => {
  it('fazem round-trip com os parsers', () => {
    const coupon = makeCoupon({
      type: 'FIXED_AMOUNT',
      value: 5000,
      minimumAmount: 10000,
      maximumDiscount: 2500,
      maxUses: 100,
      maxUsesPerCustomer: 1,
      startsAt: new Date('2026-09-01T03:00:00.000Z'),
      expiresAt: new Date('2026-10-01T02:59:59.999Z'),
    });

    expect(formatCouponValueInput(coupon)).toBe('R$ 50,00');
    expect(parseCouponValueInput(formatCouponValueInput(coupon))).toEqual({
      type: 'FIXED_AMOUNT',
      value: 5000,
    });

    expect(formatCouponRulesInput(coupon)).toBe('min=100,00 | teto=25,00 | usos=100 | porcliente=1');
    expect(parseCouponRulesInput(formatCouponRulesInput(coupon))).toEqual({
      minimumAmount: 10000,
      maximumDiscount: 2500,
      maxUses: 100,
      maxUsesPerCustomer: 1,
    });

    expect(formatCouponValidityInput(coupon)).toBe('01/09/2026 - 30/09/2026');
    expect(parseCouponValidityInput(formatCouponValidityInput(coupon))).toEqual({
      startsAt: coupon.startsAt,
      expiresAt: coupon.expiresAt,
    });
  });

  it('renderiza percentual sem casas desnecessarias', () => {
    expect(formatCouponValueInput(makeCoupon({ value: 2000 }))).toBe('20%');
    expect(formatCouponValueInput(makeCoupon({ value: 1250 }))).toBe('12,5%');
  });

  it('descreve os termos de forma curta', () => {
    expect(
      describeCouponTerms({
        code: 'VOOK20',
        type: 'PERCENTAGE',
        value: 2000,
        description: null,
        minimumAmount: 10000,
        maximumDiscount: null,
        maxUses: 100,
        maxUsesPerCustomer: null,
        startsAt: null,
        expiresAt: null,
      }),
    ).toBe('20% · min 100,00 · 100 usos');
  });
});

describe('componentes do painel', () => {
  it('monta o menu com os cinco botoes esperados', () => {
    const json = buildCouponMenu([makeCoupon()]).toJSON();
    const rows = json.components.filter((component) => component.type === ComponentType.ActionRow);
    const buttons = rows.flatMap((row) => row.components);

    expect(buttons).toHaveLength(5);
    expect(buttons.map((button) => ('custom_id' in button ? button.custom_id : ''))).toEqual([
      buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.CREATE),
      buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.EDIT),
      buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.TOGGLE),
      buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.DELETE),
      buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.LIST),
    ]);
  });

  it('exibe aviso quando a lista esta vazia e nunca deixa o painel sem voltar', () => {
    const json = buildCouponList([]).toJSON();
    const rows = json.components.filter((component) => component.type === ComponentType.ActionRow);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(json)).toContain(buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.BACK));
  });

  it('limita o select a 25 opcoes', () => {
    const coupons = Array.from({ length: 40 }, (_unused, index) =>
      makeCoupon({ id: `cpn_${index}`, code: `VOOK${index}` }),
    );
    const menu = buildCouponSelect(coupons, COUPON_ACTION.EDIT_SELECT).toJSON();

    expect(menu.options).toHaveLength(DISCORD_LIMITS.SELECT_OPTIONS);
    expect(menu.custom_id).toBe(buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.EDIT_SELECT));
  });

  it('avisa quando ha mais cupons do que cabem no select', () => {
    const coupons = Array.from({ length: 30 }, (_unused, index) =>
      makeCoupon({ id: `cpn_${index}`, code: `VOOK${index}` }),
    );
    const json = buildCouponSelectPanel(coupons, COUPON_ACTION.DELETE_SELECT, {
      title: 'VOOK STORE — EXCLUIR CUPOM',
      instruction: 'Escolha o cupom.',
    }).toJSON();

    expect(JSON.stringify(json)).toContain('primeiros 25 cupons de 30');
  });

  it('corta a listagem por orcamento de texto, nunca por contagem fixa', () => {
    // Cupom "pesado": descricao no limite + todas as restricoes preenchidas.
    // Com corte por contagem fixa este cenario estourava o teto de texto da
    // mensagem V2 e o painel "Listar" morria antes de chegar ao Discord.
    const coupons = Array.from({ length: 40 }, (_unused, index) =>
      makeCoupon({
        id: `cpn_${index}`,
        code: `VOOKPROMOCAOLONGA${index}`,
        description: 'D'.repeat(BUSINESS_LIMITS.COUPON_DESCRIPTION_MAX),
        minimumAmount: BUSINESS_LIMITS.PAYMENT_MAX_CENTS,
        maximumDiscount: BUSINESS_LIMITS.PAYMENT_MAX_CENTS,
        maxUses: 1_000_000,
        maxUsesPerCustomer: 1_000_000,
        startsAt: new Date('2026-09-01T03:00:00.000Z'),
        expiresAt: new Date('2026-10-01T02:59:59.999Z'),
      }),
    );

    const json = buildCouponList(coupons, new Map()).toJSON();
    const total = json.components
      .filter((component) => component.type === ComponentType.TextDisplay)
      .reduce((sum, component) => sum + component.content.length, 0);

    expect(total).toBeLessThanOrEqual(DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL);
    expect(JSON.stringify(json)).toContain('de 40 cupons cadastrados');
  });

  it('mostra zero usos quando o mapa de usos e fornecido', () => {
    const coupon = makeCoupon({ maxUses: 100 });

    // Mapa vazio significa "nenhum uso registrado", nao "sem dado".
    expect(JSON.stringify(buildCouponList([coupon], new Map()).toJSON())).toContain(
      'Usos confirmados: 0',
    );
    // Sem mapa a linha some por completo, em vez de mentir um numero.
    expect(JSON.stringify(buildCouponList([coupon]).toJSON())).not.toContain('Usos confirmados');
  });
});

describe('buildCouponModal', () => {
  it('cria o formulario de criacao com os cinco campos documentados', () => {
    const json = buildCouponModal('create').toJSON();

    expect(json.custom_id).toBe(buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.CREATE_MODAL));
    expect(json.title).toBe('VOOK STORE — NOVO CUPOM');
    expect(json.components).toHaveLength(5);

    const serialized = JSON.stringify(json);
    for (const field of Object.values(COUPON_FIELD)) {
      expect(serialized).toContain(`"${field}"`);
    }
  });

  it('carrega o cupom atual no formulario de edicao', () => {
    const coupon = makeCoupon({
      id: 'cpn_edicao',
      code: 'BLACKFRIDAY',
      minimumAmount: 10000,
      maxUses: 50,
    });
    const json = buildCouponModal('edit', coupon).toJSON();
    const serialized = JSON.stringify(json);

    expect(json.custom_id).toBe(
      buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.EDIT_MODAL, coupon.id),
    );
    expect(json.title).toBe('VOOK STORE — EDITAR CUPOM');
    expect(serialized).toContain('BLACKFRIDAY');
    expect(serialized).toContain('min=100,00 | usos=50');
  });

  it('recusa modo de edicao sem cupom carregado', () => {
    expect(() => buildCouponModal('edit')).toThrow(ValidationError);
  });
});
