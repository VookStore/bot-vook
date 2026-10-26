import { Collection } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Desconto automatico de booster.
 *
 * E a unica automacao do bot que muda QUANTO a loja cobra. Os testes cobrem
 * menos "o desconto entra" e mais as quatro situacoes em que ele NAO pode
 * entrar — cada uma delas, se falhar, e dinheiro perdido ou uma promessa
 * publica quebrada.
 */

const getGuildConfig = vi.fn();
const priceOrder = vi.fn();
const updateOrderPricing = vi.fn();
const recordOrderAudit = vi.fn();
const packCount = vi.fn();

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]) => getGuildConfig(...args),
}));

vi.mock('../src/modules/catalog/services/OrderService', () => ({
  priceOrder: (...args: unknown[]) => priceOrder(...args),
}));

vi.mock('../src/modules/catalog/repositories/OrderRepository', () => ({
  updateOrderPricing: (...args: unknown[]) => updateOrderPricing(...args),
}));

vi.mock('../src/modules/catalog/repositories/CatalogAuditRepository', () => ({
  recordOrderAudit: (...args: unknown[]) => recordOrderAudit(...args),
}));

vi.mock('../src/core/database/prisma', () => ({
  getPrisma: () => ({ catalogPack: { count: (...args: unknown[]) => packCount(...args) } }),
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  applyBoosterDiscount,
  boosterCouponFor,
} from '../src/modules/booster/services/BoosterDiscountService';

const ROLE_1 = '1400000000000000001';
const ROLE_2 = '1400000000000000002';
const COUPON_1 = 'cupom-5';
const COUPON_2 = 'cupom-10';

function config(overrides: Record<string, unknown> = {}) {
  return {
    boosterRoleId: ROLE_1,
    boosterCouponId: COUPON_1,
    boosterTier2RoleId: ROLE_2,
    boosterTier2CouponId: COUPON_2,
    ...overrides,
  } as never;
}

function member(roleIds: string[]) {
  return {
    roles: { cache: new Collection(roleIds.map((id) => [id, { id }])) },
  } as never;
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    guildId: 'g1',
    customerId: 'u1',
    subtotalAmount: 10_000,
    couponId: null,
    items: [{ packId: 'p1' }],
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue(config());
  packCount.mockResolvedValue(0);
  updateOrderPricing.mockResolvedValue(true);
  recordOrderAudit.mockResolvedValue(undefined);
  priceOrder.mockResolvedValue({
    discountAmount: 500,
    finalAmount: 9_500,
    couponId: COUPON_1,
    couponCodeSnapshot: 'BOOSTER5',
    couponTypeSnapshot: 'PERCENTAGE',
    couponValueSnapshot: 500,
  });
});

describe('boosterCouponFor', () => {
  it('da o cupom do degrau 1 a quem tem so o cargo 1', () => {
    expect(boosterCouponFor(member([ROLE_1]), config())).toBe(COUPON_1);
  });

  /*
   * Quem tem os dois cargos merece o maior. Na ordem inversa o membro de dois
   * boosts receberia 5% — e reclamaria, com razao, do que o anuncio prometeu.
   */
  it('da o cupom maior a quem tem os dois cargos', () => {
    expect(boosterCouponFor(member([ROLE_1, ROLE_2]), config())).toBe(COUPON_2);
  });

  it('nao da nada a quem nao tem cargo de booster', () => {
    expect(boosterCouponFor(member([]), config())).toBeNull();
  });

  /*
   * Meia configuracao nao vale. Cargo sem cupom nao tem quanto descontar; cupom
   * sem cargo nao tem em quem aplicar. Nos dois casos o certo e nao fazer nada,
   * e nunca adivinhar o lado que falta.
   */
  it('ignora o degrau com cargo mas sem cupom', () => {
    const meio = config({ boosterTier2CouponId: null });
    expect(boosterCouponFor(member([ROLE_1, ROLE_2]), meio)).toBe(COUPON_1);
  });

  it('nao aplica nada quando o degrau 1 esta sem cupom', () => {
    const meio = config({ boosterCouponId: null, boosterTier2RoleId: null, boosterTier2CouponId: null });
    expect(boosterCouponFor(member([ROLE_1]), meio)).toBeNull();
  });
});

describe('applyBoosterDiscount', () => {
  it('aplica o desconto do degrau do cliente', async () => {
    const result = await applyBoosterDiscount(member([ROLE_1]), order());

    expect(result.applied).toBe(true);
    expect(result.discountAmount).toBe(500);
    expect(priceOrder).toHaveBeenCalledWith('g1', 'u1', 10_000, COUPON_1);
  });

  it('nao faz nada quando a automacao esta desligada', async () => {
    getGuildConfig.mockResolvedValue(
      config({ boosterRoleId: null, boosterCouponId: null, boosterTier2RoleId: null, boosterTier2CouponId: null }),
    );

    const result = await applyBoosterDiscount(member([ROLE_1]), order());

    expect(result).toEqual({ applied: false, reason: 'desligado' });
    expect(updateOrderPricing).not.toHaveBeenCalled();
  });

  it('nao aplica a quem nao e booster', async () => {
    const result = await applyBoosterDiscount(member([]), order());

    expect(result.reason).toBe('nao-e-booster');
    expect(updateOrderPricing).not.toHaveBeenCalled();
  });

  /*
   * A EQUIPE MANDA. Um cupom lancado a mao pode ser fruto de negociacao e valer
   * mais que o de booster; sobrescreve-lo seria a automacao desfazendo uma
   * decisao humana sobre dinheiro.
   */
  it('nunca troca um cupom que a equipe ja aplicou', async () => {
    const result = await applyBoosterDiscount(member([ROLE_1]), order({ couponId: 'outro' }));

    expect(result.reason).toBe('ja-tem-cupom');
    expect(updateOrderPricing).not.toHaveBeenCalled();
  });

  /*
   * A PROMESSA PUBLICA. O anuncio diz que nao vale para PEDs, roupas e props.
   * Cupom nao filtra por categoria, entao basta UM item nao elegivel para a
   * automacao ficar de fora — descontar seria a loja quebrando o que anunciou.
   */
  it('nao desconta quando ha item de categoria excluida', async () => {
    packCount.mockResolvedValue(1);

    const result = await applyBoosterDiscount(
      member([ROLE_1]),
      order({ items: [{ packId: 'p1' }, { packId: 'ped' }] }),
    );

    expect(result.reason).toBe('categoria-excluida');
    expect(updateOrderPricing).not.toHaveBeenCalled();
  });

  it('desconta quando todos os itens sao elegiveis', async () => {
    packCount.mockResolvedValue(0);

    const result = await applyBoosterDiscount(
      member([ROLE_1]),
      order({ items: [{ packId: 'p1' }, { packId: 'p2' }] }),
    );

    expect(result.applied).toBe(true);
  });

  it('nao desconta pedido sem itens', async () => {
    const result = await applyBoosterDiscount(member([ROLE_1]), order({ items: [] }));

    expect(result.reason).toBe('sem-itens');
    expect(updateOrderPricing).not.toHaveBeenCalled();
  });

  /*
   * O cupom vencido, esgotado ou abaixo do valor minimo faz `priceOrder`
   * lancar. A venda NAO pode cair junto: o pedido segue com preco cheio, que era
   * o comportamento antes desta automacao existir.
   */
  it('deixa a venda seguir com preco cheio quando o cupom nao vale mais', async () => {
    priceOrder.mockRejectedValue(new Error('cupom expirado'));

    const result = await applyBoosterDiscount(member([ROLE_1]), order());

    expect(result.applied).toBe(false);
    expect(updateOrderPricing).not.toHaveBeenCalled();
  });

  it('nao derruba a venda quando o banco falha', async () => {
    getGuildConfig.mockRejectedValue(new Error('banco fora'));

    await expect(applyBoosterDiscount(member([ROLE_1]), order())).resolves.toEqual({
      applied: false,
      reason: 'cupom-invalido',
    });
  });

  /*
   * Auditoria SEM autor: quem aplicou foi o sistema. Registrar o cliente ou um
   * atendente faria o historico do pedido mentir sobre quem decidiu o desconto.
   */
  it('audita a aplicacao sem inventar um autor', async () => {
    await applyBoosterDiscount(member([ROLE_1]), order());

    expect(recordOrderAudit).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', performedById: null }),
    );
  });

  it('nao audita quando o pedido mudou de estado no meio', async () => {
    updateOrderPricing.mockResolvedValue(false);

    const result = await applyBoosterDiscount(member([ROLE_1]), order());

    expect(result.applied).toBe(false);
    expect(recordOrderAudit).not.toHaveBeenCalled();
  });
});
