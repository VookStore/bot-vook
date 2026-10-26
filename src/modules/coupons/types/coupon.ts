import type { CouponType } from '@prisma/client';

/**
 * Tipos do motor de cupons.
 *
 * Nenhum tipo aqui depende do Prisma Client em tempo de execucao: o calculo e
 * puro e recebe apenas os campos necessarios, o que permite testar e reutilizar
 * a logica sem banco de dados.
 */

/** Subconjunto do model Coupon necessario para calcular/validar. */
export interface CouponLike {
  id: string;
  guildId: string;
  code: string;
  /** PERCENTAGE: `value` em base 100 (2000 = 20,00%). FIXED_AMOUNT: centavos. */
  type: CouponType;
  value: number;
  minimumAmount: number | null;
  maximumDiscount: number | null;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  enabled: boolean;
  deletedAt: Date | null;
}

/** Resultado do calculo, sempre em centavos inteiros. */
export interface DiscountBreakdown {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
}

/** Estado necessario para decidir se o cupom pode ser aplicado agora. */
export interface CouponEligibilityContext {
  guildId: string;
  amountCents: number;
  now: Date;
  /** Usos confirmados do cupom (todos os clientes). */
  totalUses: number;
  /** Usos confirmados por este cliente. */
  customerUses: number;
}

/** Uniao discriminada: quando `ok` e falso ha sempre um motivo e um texto seguro. */
export type EligibilityResult =
  | { ok: true }
  | { ok: false; reason: string; userMessage: string };
