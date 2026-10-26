import { Prisma, type Coupon, type CouponType, type CouponUsage } from '@prisma/client';

import {
  getPrisma,
  type DatabaseClient,
  type TransactionClient,
} from '../../../core/database/prisma';

/**
 * Persistencia de cupons.
 *
 * REGRAS DESTE ARQUIVO
 *  - Exclusao e SEMPRE soft delete (`deletedAt`): pagamentos historicos apontam
 *    para o cupom e o par (guildId, code) e UNIQUE incluindo registros
 *    excluidos. Recriar um codigo existente REVIVE o registro, preservando o id,
 *    os usos e a trilha de auditoria.
 *  - Uso de cupom (`CouponUsage`) so existe para pagamento APROVADO. O campo
 *    `paymentId` e UNIQUE, o que impede contabilizar o mesmo pagamento duas vezes.
 *  - Nenhuma regra de negocio mora aqui: validacao e elegibilidade ficam no
 *    CouponCalculator e no CouponService.
 */

export interface CreateCouponInput {
  guildId: string;
  code: string;
  type: CouponType;
  /** PERCENTAGE: base 100 (2000 = 20,00%). FIXED_AMOUNT: centavos. */
  value: number;
  description?: string | null;
  minimumAmount?: number | null;
  maximumDiscount?: number | null;
  maxUses?: number | null;
  maxUsesPerCustomer?: number | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  enabled?: boolean;
  createdById?: string | null;
}

export interface CreateCouponUsageInput {
  guildId: string;
  couponId: string;
  paymentId: string;
  customerId: string;
  /** Desconto efetivamente concedido, em centavos. */
  discountAmount: number;
}

/**
 * Cupons vivos da guild (nunca retorna soft-deleted).
 * Ordena ativos primeiro e depois por codigo, que e a ordem esperada no painel.
 */
export async function listCoupons(
  guildId: string,
  options: { includeDisabled?: boolean } = {},
  db: DatabaseClient = getPrisma(),
): Promise<Coupon[]> {
  return db.coupon.findMany({
    where: {
      guildId,
      deletedAt: null,
      ...(options.includeDisabled === true ? {} : { enabled: true }),
    },
    orderBy: [{ enabled: 'desc' }, { code: 'asc' }],
  });
}

export async function findCouponById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<Coupon | null> {
  return db.coupon.findUnique({ where: { id } });
}

/**
 * Busca pelo codigo INCLUINDO registros soft-deleted.
 * E o que permite reviver um cupom antigo em vez de esbarrar no UNIQUE.
 */
export async function findCouponByCode(
  guildId: string,
  code: string,
  db: DatabaseClient = getPrisma(),
): Promise<Coupon | null> {
  return db.coupon.findUnique({ where: { guildId_code: { guildId, code } } });
}

/**
 * Cria o cupom. Se o codigo ja existir na guild (inclusive excluido), o registro
 * e revivido com os novos termos: mesmo id, mesmo historico, `deletedAt` limpo.
 *
 * `createdById` so e gravado na criacao — reviver nao reescreve quem criou.
 */
export async function createCoupon(
  input: CreateCouponInput,
  db: DatabaseClient = getPrisma(),
): Promise<Coupon> {
  const terms = {
    type: input.type,
    value: input.value,
    description: input.description ?? null,
    minimumAmount: input.minimumAmount ?? null,
    maximumDiscount: input.maximumDiscount ?? null,
    maxUses: input.maxUses ?? null,
    maxUsesPerCustomer: input.maxUsesPerCustomer ?? null,
    startsAt: input.startsAt ?? null,
    expiresAt: input.expiresAt ?? null,
    enabled: input.enabled ?? true,
    deletedAt: null,
  };

  return db.coupon.upsert({
    where: { guildId_code: { guildId: input.guildId, code: input.code } },
    create: {
      guildId: input.guildId,
      code: input.code,
      createdById: input.createdById ?? null,
      ...terms,
    },
    update: terms,
  });
}

export async function updateCoupon(
  id: string,
  data: Prisma.CouponUncheckedUpdateInput,
  db: DatabaseClient = getPrisma(),
): Promise<Coupon> {
  return db.coupon.update({ where: { id }, data });
}

export async function setCouponEnabled(
  id: string,
  enabled: boolean,
  db: DatabaseClient = getPrisma(),
): Promise<Coupon> {
  return db.coupon.update({ where: { id }, data: { enabled } });
}

/** Soft delete: o cupom some do painel mas continua ligado ao historico. */
export async function softDeleteCoupon(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<Coupon> {
  return db.coupon.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false },
  });
}

export async function countCouponUses(
  couponId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.couponUsage.count({ where: { couponId } });
}

export async function countCouponUsesByCustomer(
  couponId: string,
  customerId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.couponUsage.count({ where: { couponId, customerId } });
}

/**
 * Total de usos de cada cupom da guild em UMA consulta agregada.
 * Existe para o painel administrativo nao disparar um COUNT por cupom.
 */
export async function countUsesByCoupon(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<Map<string, number>> {
  const rows = await db.couponUsage.groupBy({
    by: ['couponId'],
    where: { guildId },
    _count: { _all: true },
  });

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.couponId, row._count._all);
  }
  return totals;
}

/**
 * Uso ja registrado para este pagamento (ou null).
 * Usado ANTES de inserir dentro da transacao: no Postgres uma violacao de UNIQUE
 * aborta a transacao inteira, entao a checagem previa e o que garante
 * idempotencia sem derrubar a aprovacao do pagamento.
 */
export async function findCouponUsageByPayment(
  paymentId: string,
  db: DatabaseClient = getPrisma(),
): Promise<CouponUsage | null> {
  return db.couponUsage.findUnique({ where: { paymentId } });
}

export async function createCouponUsage(
  params: CreateCouponUsageInput,
  db: DatabaseClient = getPrisma(),
): Promise<CouponUsage> {
  return db.couponUsage.create({
    data: {
      guildId: params.guildId,
      couponId: params.couponId,
      paymentId: params.paymentId,
      customerId: params.customerId,
      discountAmount: params.discountAmount,
    },
  });
}

/**
 * `SELECT ... FOR UPDATE` na linha do cupom.
 *
 * Serializa aprovacoes concorrentes: duas aprovacoes simultaneas do mesmo cupom
 * ficam em fila no banco, de modo que a segunda so reconta os usos depois que a
 * primeira gravou o dela. Sem isso, dois vendedores aprovando ao mesmo tempo
 * poderiam furar `maxUses`.
 *
 * O id vai como PARAMETRO (`Prisma.sql`), nunca concatenado na string.
 */
export async function lockCouponRow(tx: TransactionClient, couponId: string): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "coupons" WHERE "id" = ${couponId} FOR UPDATE`,
  );
}
