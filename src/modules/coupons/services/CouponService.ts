import type { Coupon, CouponType } from '@prisma/client';

import { CACHE_NAMESPACE, cache } from '../../../core/cache/CacheService';
import { BUSINESS_LIMITS, CACHE_TTL } from '../../../constants/limits';
import { PERCENT_SCALE } from '../../../utils/money';
import {
  CouponInvalidError,
  CouponNotFoundError,
  CouponUsageLimitError,
  ValidationError,
} from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import type { TransactionClient } from '../../../core/database/prisma';
import { recordCouponAudit } from '../../audit/repositories/AuditRepository';
import {
  countCouponUses,
  countCouponUsesByCustomer,
  countUsesByCoupon,
  createCoupon,
  createCouponUsage,
  findCouponByCode,
  findCouponById,
  findCouponUsageByPayment,
  listCoupons,
  lockCouponRow,
  setCouponEnabled,
  softDeleteCoupon,
  updateCoupon,
} from '../repositories/CouponRepository';
import {
  assertCouponEligible,
  calculateDiscount,
  checkCouponEligibility,
  describeCoupon,
} from './CouponCalculator';
import type { CouponEligibilityContext, DiscountBreakdown } from '../types/coupon';

/**
 * Servico de cupons.
 *
 * CONTEXTO DE NEGOCIO: cupom e ferramenta INTERNA da equipe. O cliente nunca
 * digita, escolhe nem aplica cupom — quem seleciona e o vendedor, durante a
 * criacao/gerenciamento da cobranca PIX.
 *
 * FLUXO DO DESCONTO
 *  1. `listSelectableCoupons` mostra ao vendedor apenas o que e elegivel agora.
 *  2. `validateCouponForPayment` confere de novo no momento de aplicar (leitura
 *     fresca do banco, nunca do cache — e dinheiro).
 *  3. `confirmCouponUsage` e a UNICA funcao que contabiliza uso, chamada apenas
 *     quando o pagamento e APROVADO, dentro da transacao da aprovacao e sob
 *     `SELECT ... FOR UPDATE`.
 *
 * Cache: leitura de painel usa `CACHE_NAMESPACE.COUPONS` (key = guildId).
 * Toda escrita invalida o cache DEPOIS do commit — nunca antes.
 */

const logger = createLogger('coupons');

/** Teto defensivo para limites de uso vindos do formulario. */
const MAX_USES_CEILING = 1_000_000;

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Todos os cupons vivos da guild (ativos e desativados), cacheados.
 * O painel administrativo precisa ver os desativados; quem filtra por
 * elegibilidade e o motor de calculo.
 */
export async function getCoupons(guildId: string): Promise<Coupon[]> {
  return cache.getOrLoad(
    CACHE_NAMESPACE.COUPONS,
    guildId,
    () => listCoupons(guildId, { includeDisabled: true }),
    CACHE_TTL.COUPONS_MS,
  );
}

export function invalidateCoupons(guildId: string): void {
  cache.delete(CACHE_NAMESPACE.COUPONS, guildId);
}

/**
 * Cupom da guild pelo id. Usa o cache e, em caso de miss, confirma no banco
 * (o cupom pode ter sido criado por outro processo).
 */
export async function getCouponById(guildId: string, couponId: string): Promise<Coupon | null> {
  const cached = (await getCoupons(guildId)).find((coupon) => coupon.id === couponId);
  if (cached !== undefined) return cached;

  const coupon = await findCouponById(couponId);
  if (coupon === null || coupon.guildId !== guildId || coupon.deletedAt !== null) return null;
  invalidateCoupons(guildId);
  return coupon;
}

/** Total de usos por cupom da guild (uma consulta agregada) para o painel. */
export async function getCouponUsageTotals(guildId: string): Promise<Map<string, number>> {
  return countUsesByCoupon(guildId);
}

/** Contexto real de elegibilidade: usos totais e usos deste cliente. */
export async function buildEligibilityContext(
  coupon: Coupon,
  amountCents: number,
  customerId: string,
): Promise<CouponEligibilityContext> {
  const [totalUses, customerUses] = await Promise.all([
    countCouponUses(coupon.id),
    countCouponUsesByCustomer(coupon.id, customerId),
  ]);

  return {
    guildId: coupon.guildId,
    amountCents,
    now: new Date(),
    totalUses,
    customerUses,
  };
}

/** Cupom sem nenhum limite de uso nao precisa de consulta de contadores. */
function hasUsageLimits(coupon: Coupon): boolean {
  return coupon.maxUses !== null || coupon.maxUsesPerCustomer !== null;
}

/**
 * Cupons que o vendedor pode escolher AGORA para este valor e este cliente.
 *
 * Os contadores de uso so sao consultados para cupons que realmente possuem
 * limite — sem limite, o contador nao pode reprovar nada, entao a consulta seria
 * desperdicio. Um cupom com dado corrompido no banco e apenas ignorado da lista
 * (com WARN), nunca derruba a selecao inteira.
 */
export async function listSelectableCoupons(
  guildId: string,
  amountCents: number,
  customerId: string,
): Promise<Array<{ coupon: Coupon; discount: DiscountBreakdown }>> {
  const coupons = await getCoupons(guildId);
  const candidates = coupons.filter((coupon) => coupon.enabled && coupon.deletedAt === null);
  // Um unico instante para toda a lista: evita que dois cupons com a mesma
  // validade caiam em lados diferentes da virada do segundo.
  const now = new Date();

  const evaluated = await Promise.all(
    candidates.map(async (coupon) => {
      try {
        // `now` e sobrescrito de proposito: `buildEligibilityContext` carimba o
        // proprio instante, e sem isso dois cupons com a mesma validade cairiam
        // em lados diferentes da virada do segundo — exatamente o que o
        // instante unico acima existe para evitar.
        const context = hasUsageLimits(coupon)
          ? { ...(await buildEligibilityContext(coupon, amountCents, customerId)), now }
          : {
              guildId: coupon.guildId,
              amountCents,
              now,
              totalUses: 0,
              customerUses: 0,
            };

        if (!checkCouponEligibility(coupon, context).ok) return null;
        return { coupon, discount: calculateDiscount(coupon, amountCents) };
      } catch (error) {
        logger.warn('Cupom ignorado na selecao por dado invalido.', {
          guildId,
          entityType: 'coupon',
          entityId: coupon.id,
          detail: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }),
  );

  return evaluated.filter(
    (item): item is { coupon: Coupon; discount: DiscountBreakdown } => item !== null,
  );
}

/**
 * Valida o cupom no momento de aplicar a cobranca.
 *
 * Le SEMPRE do banco (nao do cache): entre a montagem do menu e o clique o
 * cupom pode ter sido desativado ou excluido, e aqui trata-se de dinheiro.
 *
 * @throws CouponNotFoundError quando o cupom nao existe nesta guild.
 * @throws CouponUsageLimitError quando estourou limite de uso.
 * @throws CouponInvalidError nos demais bloqueios (desativado, expirado, etc).
 */
export async function validateCouponForPayment(
  guildId: string,
  couponId: string,
  amountCents: number,
  customerId: string,
): Promise<{ coupon: Coupon; discount: DiscountBreakdown }> {
  const coupon = await findCouponById(couponId);
  if (coupon === null || coupon.guildId !== guildId) {
    throw new CouponNotFoundError(couponId, {
      userMessage: 'Este cupom nao existe neste servidor.',
      context: { guildId, entityType: 'coupon', entityId: couponId },
    });
  }
  if (coupon.deletedAt !== null) {
    throw new CouponInvalidError(`Cupom ${coupon.code} excluido.`, {
      userMessage: 'Este cupom foi excluido e nao pode mais ser aplicado.',
      context: { guildId, entityType: 'coupon', entityId: coupon.id },
    });
  }

  const context = await buildEligibilityContext(coupon, amountCents, customerId);
  assertCouponEligible(coupon, context);

  return { coupon, discount: calculateDiscount(coupon, amountCents) };
}

// ---------------------------------------------------------------------------
// Uso confirmado (somente na aprovacao do pagamento)
// ---------------------------------------------------------------------------

/** Limite vindo do banco: `null` = sem limite; numero corrompido vira 0 (mais restritivo). */
function normalizeLimit(value: number | null): number | null {
  if (value === null) return null;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Contabiliza o uso do cupom. Chamada SOMENTE quando o pagamento e aprovado e
 * SEMPRE dentro da transacao da aprovacao.
 *
 * Sequencia (a ordem importa):
 *  1. `SELECT ... FOR UPDATE` na linha do cupom — serializa aprovacoes paralelas;
 *  2. recarrega o cupom dentro da transacao (estado pos-lock);
 *  3. reconta usos totais e do cliente dentro da transacao;
 *  4. revalida `maxUses` / `maxUsesPerCustomer`;
 *  5. grava `CouponUsage` (paymentId UNIQUE impede contagem dupla);
 *  6. registra auditoria USED.
 *
 * Aqui NAO se revalida validade/valor minimo: o desconto ja foi acordado com o
 * cliente na criacao da cobranca. O que precisa ser serializado e apenas a
 * disputa por quantidade de usos.
 */
export async function confirmCouponUsage(
  tx: TransactionClient,
  params: {
    guildId: string;
    couponId: string;
    paymentId: string;
    customerId: string;
    discountAmount: number;
  },
): Promise<void> {
  if (!Number.isInteger(params.discountAmount) || params.discountAmount < 0) {
    throw new ValidationError(
      `Desconto invalido ao confirmar uso de cupom: ${String(params.discountAmount)}`,
      {
        userMessage: 'Nao foi possivel registrar o desconto desta cobranca.',
        context: {
          guildId: params.guildId,
          entityType: 'coupon',
          entityId: params.couponId,
        },
      },
    );
  }

  await lockCouponRow(tx, params.couponId);

  const coupon = await findCouponById(params.couponId, tx);
  if (coupon === null || coupon.guildId !== params.guildId) {
    throw new CouponNotFoundError(params.couponId, {
      userMessage: 'O cupom desta cobranca nao foi encontrado.',
      context: {
        guildId: params.guildId,
        entityType: 'coupon',
        entityId: params.couponId,
      },
    });
  }

  // Idempotencia: se este pagamento ja foi contabilizado, nao conta de novo.
  // A checagem vem ANTES do insert porque um UNIQUE violado abortaria a
  // transacao inteira da aprovacao.
  const alreadyCounted = await findCouponUsageByPayment(params.paymentId, tx);
  if (alreadyCounted !== null) {
    logger.warn('Uso de cupom ja registrado para este pagamento; ignorando.', {
      guildId: params.guildId,
      entityType: 'payment',
      entityId: params.paymentId,
      couponId: params.couponId,
    });
    return;
  }

  // Consultas sequenciais: dentro de uma transacao interativa tudo trafega pela
  // mesma conexao, entao paralelizar nao traz ganho e complica o diagnostico.
  const totalUses = await countCouponUses(coupon.id, tx);
  const customerUses = await countCouponUsesByCustomer(coupon.id, params.customerId, tx);

  const maxUses = normalizeLimit(coupon.maxUses);
  if (maxUses !== null && totalUses >= maxUses) {
    throw new CouponUsageLimitError(
      `Cupom ${coupon.code} atingiu o limite total de usos (${totalUses}/${maxUses}).`,
      {
        userMessage: 'Este cupom atingiu o limite total de usos e nao pode mais ser aplicado.',
        context: {
          guildId: params.guildId,
          entityType: 'coupon',
          entityId: coupon.id,
          totalUses,
          maxUses,
        },
      },
    );
  }

  const maxUsesPerCustomer = normalizeLimit(coupon.maxUsesPerCustomer);
  if (maxUsesPerCustomer !== null && customerUses >= maxUsesPerCustomer) {
    throw new CouponUsageLimitError(
      `Cupom ${coupon.code} atingiu o limite por cliente (${customerUses}/${maxUsesPerCustomer}).`,
      {
        userMessage: 'Este cliente ja utilizou este cupom o numero maximo de vezes permitido.',
        context: {
          guildId: params.guildId,
          entityType: 'coupon',
          entityId: coupon.id,
          customerUses,
          maxUsesPerCustomer,
        },
      },
    );
  }

  await createCouponUsage(
    {
      guildId: params.guildId,
      couponId: coupon.id,
      paymentId: params.paymentId,
      customerId: params.customerId,
      discountAmount: params.discountAmount,
    },
    tx,
  );

  await recordCouponAudit(
    {
      guildId: params.guildId,
      couponId: coupon.id,
      action: 'USED',
      actorId: params.customerId,
      paymentId: params.paymentId,
      newValue: String(params.discountAmount),
      metadata: {
        code: coupon.code,
        discountAmount: params.discountAmount,
        totalUsesBefore: totalUses,
      },
    },
    tx,
  );

  logger.info('Uso de cupom confirmado.', {
    guildId: params.guildId,
    entityType: 'coupon',
    entityId: coupon.id,
    code: coupon.code,
    paymentId: params.paymentId,
  });
}

// ---------------------------------------------------------------------------
// Administracao (UI de cupons)
// ---------------------------------------------------------------------------

/** Termos de um cupom vindos do formulario, ja normalizados. */
export interface CouponTermsInput {
  code: string;
  type: CouponType;
  value: number;
  description: string | null;
  minimumAmount: number | null;
  maximumDiscount: number | null;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
}

/**
 * Validacao final antes de gravar.
 *
 * Os parsers do formulario ja barram entrada humana estranha; esta funcao e a
 * ultima linha de defesa do banco (vale para qualquer chamador, inclusive
 * scripts) e garante que nenhum inteiro absurdo vire desconto.
 */
function assertTerms(terms: CouponTermsInput): void {
  const valueCeiling =
    terms.type === 'PERCENTAGE' ? PERCENT_SCALE : BUSINESS_LIMITS.PAYMENT_MAX_CENTS;

  if (!Number.isInteger(terms.value) || terms.value <= 0 || terms.value > valueCeiling) {
    throw new ValidationError(`Valor de cupom invalido: ${String(terms.value)}`, {
      userMessage:
        terms.type === 'PERCENTAGE'
          ? 'O percentual do cupom precisa ficar entre 0,01% e 100%.'
          : 'O valor do cupom precisa ser maior que zero e dentro do limite da loja.',
    });
  }

  const limits: ReadonlyArray<[string, number | null, number]> = [
    ['valor minimo', terms.minimumAmount, BUSINESS_LIMITS.PAYMENT_MAX_CENTS],
    ['teto de desconto', terms.maximumDiscount, BUSINESS_LIMITS.PAYMENT_MAX_CENTS],
    ['limite de usos', terms.maxUses, MAX_USES_CEILING],
    ['limite por cliente', terms.maxUsesPerCustomer, MAX_USES_CEILING],
  ];

  for (const [label, value, ceiling] of limits) {
    if (value === null) continue;
    if (!Number.isInteger(value) || value <= 0 || value > ceiling) {
      throw new ValidationError(`Limite invalido (${label}): ${String(value)}`, {
        userMessage: `O ${label} informado e invalido. Use um numero inteiro positivo.`,
      });
    }
  }

  if (
    terms.startsAt !== null &&
    terms.expiresAt !== null &&
    terms.expiresAt.getTime() <= terms.startsAt.getTime()
  ) {
    throw new ValidationError('Periodo de validade invertido.', {
      userMessage: 'A data final da validade precisa ser posterior a data inicial.',
    });
  }
}

/**
 * Cria (ou revive) um cupom.
 *
 * Se ja existir um cupom ATIVO com o mesmo codigo, a operacao e recusada — nunca
 * se sobrescreve um cupom em uso por engano. Se existir um EXCLUIDO, ele volta
 * com os novos termos, preservando id, usos e auditoria.
 */
export async function createCouponFromInput(
  guildId: string,
  actorId: string,
  terms: CouponTermsInput,
): Promise<{ coupon: Coupon; restored: boolean }> {
  assertTerms(terms);

  const existing = await findCouponByCode(guildId, terms.code);
  if (existing !== null && existing.deletedAt === null) {
    throw new ValidationError(`Codigo de cupom duplicado: ${terms.code}`, {
      userMessage: `Ja existe um cupom com o codigo **${terms.code}**. Use "Editar" para altera-lo.`,
      context: { guildId, entityType: 'coupon', entityId: existing.id },
    });
  }

  const restored = existing !== null;
  const coupon = await createCoupon({
    guildId,
    code: terms.code,
    type: terms.type,
    value: terms.value,
    description: terms.description,
    minimumAmount: terms.minimumAmount,
    maximumDiscount: terms.maximumDiscount,
    maxUses: terms.maxUses,
    maxUsesPerCustomer: terms.maxUsesPerCustomer,
    startsAt: terms.startsAt,
    expiresAt: terms.expiresAt,
    enabled: true,
    createdById: actorId,
  });

  invalidateCoupons(guildId);

  await recordCouponAudit({
    guildId,
    couponId: coupon.id,
    action: restored ? 'RESTORED' : 'CREATED',
    actorId,
    newValue: describeCoupon(coupon),
  });

  logger.info(restored ? 'Cupom restaurado.' : 'Cupom criado.', {
    guildId,
    userId: actorId,
    entityType: 'coupon',
    entityId: coupon.id,
    code: coupon.code,
  });

  return { coupon, restored };
}

/** Cupom vivo desta guild, ou CouponNotFoundError. */
async function requireCoupon(guildId: string, couponId: string): Promise<Coupon> {
  const coupon = await findCouponById(couponId);
  if (coupon === null || coupon.guildId !== guildId || coupon.deletedAt !== null) {
    throw new CouponNotFoundError(couponId, {
      userMessage: 'Este cupom nao existe mais. Atualize o painel e tente novamente.',
      context: { guildId, entityType: 'coupon', entityId: couponId },
    });
  }
  return coupon;
}

/** Substitui todos os termos editaveis do cupom. */
export async function updateCouponFields(
  guildId: string,
  couponId: string,
  actorId: string,
  terms: CouponTermsInput,
): Promise<Coupon> {
  assertTerms(terms);

  const current = await requireCoupon(guildId, couponId);

  if (terms.code !== current.code) {
    const conflict = await findCouponByCode(guildId, terms.code);
    if (conflict !== null && conflict.id !== current.id) {
      throw new ValidationError(`Codigo de cupom em uso: ${terms.code}`, {
        userMessage: `O codigo **${terms.code}** ja pertence a outro cupom.`,
        context: { guildId, entityType: 'coupon', entityId: conflict.id },
      });
    }
  }

  const updated = await updateCoupon(couponId, {
    code: terms.code,
    type: terms.type,
    value: terms.value,
    description: terms.description,
    minimumAmount: terms.minimumAmount,
    maximumDiscount: terms.maximumDiscount,
    maxUses: terms.maxUses,
    maxUsesPerCustomer: terms.maxUsesPerCustomer,
    startsAt: terms.startsAt,
    expiresAt: terms.expiresAt,
  });

  invalidateCoupons(guildId);

  await recordCouponAudit({
    guildId,
    couponId: updated.id,
    action: 'UPDATED',
    actorId,
    oldValue: describeCoupon(current),
    newValue: describeCoupon(updated),
  });

  logger.info('Cupom atualizado.', {
    guildId,
    userId: actorId,
    entityType: 'coupon',
    entityId: updated.id,
    code: updated.code,
  });

  return updated;
}

/** Alterna ativo/desativado. Retorna o registro ja atualizado. */
export async function toggleCoupon(
  guildId: string,
  couponId: string,
  actorId: string,
): Promise<Coupon> {
  const current = await requireCoupon(guildId, couponId);
  const updated = await setCouponEnabled(couponId, !current.enabled);

  invalidateCoupons(guildId);

  await recordCouponAudit({
    guildId,
    couponId: updated.id,
    action: updated.enabled ? 'ENABLED' : 'DISABLED',
    actorId,
    oldValue: current.enabled ? 'enabled' : 'disabled',
    newValue: updated.enabled ? 'enabled' : 'disabled',
  });

  logger.info('Cupom alternado.', {
    guildId,
    userId: actorId,
    entityType: 'coupon',
    entityId: updated.id,
    enabled: updated.enabled,
  });

  return updated;
}

/**
 * Exclusao logica. O cupom sai do painel mas continua ligado aos pagamentos ja
 * emitidos; criar de novo o mesmo codigo o traz de volta com o historico.
 */
export async function deleteCoupon(
  guildId: string,
  couponId: string,
  actorId: string,
): Promise<Coupon> {
  const current = await requireCoupon(guildId, couponId);
  const deleted = await softDeleteCoupon(couponId);

  invalidateCoupons(guildId);

  await recordCouponAudit({
    guildId,
    couponId: deleted.id,
    action: 'DELETED',
    actorId,
    oldValue: describeCoupon(current),
  });

  logger.info('Cupom excluido.', {
    guildId,
    userId: actorId,
    entityType: 'coupon',
    entityId: deleted.id,
    code: deleted.code,
  });

  return deleted;
}
