"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCoupons = getCoupons;
exports.invalidateCoupons = invalidateCoupons;
exports.getCouponById = getCouponById;
exports.getCouponUsageTotals = getCouponUsageTotals;
exports.buildEligibilityContext = buildEligibilityContext;
exports.listSelectableCoupons = listSelectableCoupons;
exports.validateCouponForPayment = validateCouponForPayment;
exports.confirmCouponUsage = confirmCouponUsage;
exports.createCouponFromInput = createCouponFromInput;
exports.updateCouponFields = updateCouponFields;
exports.toggleCoupon = toggleCoupon;
exports.deleteCoupon = deleteCoupon;
const CacheService_1 = require("../../../core/cache/CacheService");
const limits_1 = require("../../../constants/limits");
const money_1 = require("../../../utils/money");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const CouponRepository_1 = require("../repositories/CouponRepository");
const CouponCalculator_1 = require("./CouponCalculator");
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
const logger = (0, Logger_1.createLogger)('coupons');
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
async function getCoupons(guildId) {
    return CacheService_1.cache.getOrLoad(CacheService_1.CACHE_NAMESPACE.COUPONS, guildId, () => (0, CouponRepository_1.listCoupons)(guildId, { includeDisabled: true }), limits_1.CACHE_TTL.COUPONS_MS);
}
function invalidateCoupons(guildId) {
    CacheService_1.cache.delete(CacheService_1.CACHE_NAMESPACE.COUPONS, guildId);
}
/**
 * Cupom da guild pelo id. Usa o cache e, em caso de miss, confirma no banco
 * (o cupom pode ter sido criado por outro processo).
 */
async function getCouponById(guildId, couponId) {
    const cached = (await getCoupons(guildId)).find((coupon) => coupon.id === couponId);
    if (cached !== undefined)
        return cached;
    const coupon = await (0, CouponRepository_1.findCouponById)(couponId);
    if (coupon === null || coupon.guildId !== guildId || coupon.deletedAt !== null)
        return null;
    invalidateCoupons(guildId);
    return coupon;
}
/** Total de usos por cupom da guild (uma consulta agregada) para o painel. */
async function getCouponUsageTotals(guildId) {
    return (0, CouponRepository_1.countUsesByCoupon)(guildId);
}
/** Contexto real de elegibilidade: usos totais e usos deste cliente. */
async function buildEligibilityContext(coupon, amountCents, customerId) {
    const [totalUses, customerUses] = await Promise.all([
        (0, CouponRepository_1.countCouponUses)(coupon.id),
        (0, CouponRepository_1.countCouponUsesByCustomer)(coupon.id, customerId),
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
function hasUsageLimits(coupon) {
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
async function listSelectableCoupons(guildId, amountCents, customerId) {
    const coupons = await getCoupons(guildId);
    const candidates = coupons.filter((coupon) => coupon.enabled && coupon.deletedAt === null);
    // Um unico instante para toda a lista: evita que dois cupons com a mesma
    // validade caiam em lados diferentes da virada do segundo.
    const now = new Date();
    const evaluated = await Promise.all(candidates.map(async (coupon) => {
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
            if (!(0, CouponCalculator_1.checkCouponEligibility)(coupon, context).ok)
                return null;
            return { coupon, discount: (0, CouponCalculator_1.calculateDiscount)(coupon, amountCents) };
        }
        catch (error) {
            logger.warn('Cupom ignorado na selecao por dado invalido.', {
                guildId,
                entityType: 'coupon',
                entityId: coupon.id,
                detail: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }));
    return evaluated.filter((item) => item !== null);
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
async function validateCouponForPayment(guildId, couponId, amountCents, customerId) {
    const coupon = await (0, CouponRepository_1.findCouponById)(couponId);
    if (coupon === null || coupon.guildId !== guildId) {
        throw new errors_1.CouponNotFoundError(couponId, {
            userMessage: 'Este cupom nao existe neste servidor.',
            context: { guildId, entityType: 'coupon', entityId: couponId },
        });
    }
    if (coupon.deletedAt !== null) {
        throw new errors_1.CouponInvalidError(`Cupom ${coupon.code} excluido.`, {
            userMessage: 'Este cupom foi excluido e nao pode mais ser aplicado.',
            context: { guildId, entityType: 'coupon', entityId: coupon.id },
        });
    }
    const context = await buildEligibilityContext(coupon, amountCents, customerId);
    (0, CouponCalculator_1.assertCouponEligible)(coupon, context);
    return { coupon, discount: (0, CouponCalculator_1.calculateDiscount)(coupon, amountCents) };
}
// ---------------------------------------------------------------------------
// Uso confirmado (somente na aprovacao do pagamento)
// ---------------------------------------------------------------------------
/** Limite vindo do banco: `null` = sem limite; numero corrompido vira 0 (mais restritivo). */
function normalizeLimit(value) {
    if (value === null)
        return null;
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
async function confirmCouponUsage(tx, params) {
    if (!Number.isInteger(params.discountAmount) || params.discountAmount < 0) {
        throw new errors_1.ValidationError(`Desconto invalido ao confirmar uso de cupom: ${String(params.discountAmount)}`, {
            userMessage: 'Nao foi possivel registrar o desconto desta cobranca.',
            context: {
                guildId: params.guildId,
                entityType: 'coupon',
                entityId: params.couponId,
            },
        });
    }
    await (0, CouponRepository_1.lockCouponRow)(tx, params.couponId);
    const coupon = await (0, CouponRepository_1.findCouponById)(params.couponId, tx);
    if (coupon === null || coupon.guildId !== params.guildId) {
        throw new errors_1.CouponNotFoundError(params.couponId, {
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
    const alreadyCounted = await (0, CouponRepository_1.findCouponUsageByPayment)(params.paymentId, tx);
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
    const totalUses = await (0, CouponRepository_1.countCouponUses)(coupon.id, tx);
    const customerUses = await (0, CouponRepository_1.countCouponUsesByCustomer)(coupon.id, params.customerId, tx);
    const maxUses = normalizeLimit(coupon.maxUses);
    if (maxUses !== null && totalUses >= maxUses) {
        throw new errors_1.CouponUsageLimitError(`Cupom ${coupon.code} atingiu o limite total de usos (${totalUses}/${maxUses}).`, {
            userMessage: 'Este cupom atingiu o limite total de usos e nao pode mais ser aplicado.',
            context: {
                guildId: params.guildId,
                entityType: 'coupon',
                entityId: coupon.id,
                totalUses,
                maxUses,
            },
        });
    }
    const maxUsesPerCustomer = normalizeLimit(coupon.maxUsesPerCustomer);
    if (maxUsesPerCustomer !== null && customerUses >= maxUsesPerCustomer) {
        throw new errors_1.CouponUsageLimitError(`Cupom ${coupon.code} atingiu o limite por cliente (${customerUses}/${maxUsesPerCustomer}).`, {
            userMessage: 'Este cliente ja utilizou este cupom o numero maximo de vezes permitido.',
            context: {
                guildId: params.guildId,
                entityType: 'coupon',
                entityId: coupon.id,
                customerUses,
                maxUsesPerCustomer,
            },
        });
    }
    await (0, CouponRepository_1.createCouponUsage)({
        guildId: params.guildId,
        couponId: coupon.id,
        paymentId: params.paymentId,
        customerId: params.customerId,
        discountAmount: params.discountAmount,
    }, tx);
    await (0, AuditRepository_1.recordCouponAudit)({
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
    }, tx);
    logger.info('Uso de cupom confirmado.', {
        guildId: params.guildId,
        entityType: 'coupon',
        entityId: coupon.id,
        code: coupon.code,
        paymentId: params.paymentId,
    });
}
/**
 * Validacao final antes de gravar.
 *
 * Os parsers do formulario ja barram entrada humana estranha; esta funcao e a
 * ultima linha de defesa do banco (vale para qualquer chamador, inclusive
 * scripts) e garante que nenhum inteiro absurdo vire desconto.
 */
function assertTerms(terms) {
    const valueCeiling = terms.type === 'PERCENTAGE' ? money_1.PERCENT_SCALE : limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS;
    if (!Number.isInteger(terms.value) || terms.value <= 0 || terms.value > valueCeiling) {
        throw new errors_1.ValidationError(`Valor de cupom invalido: ${String(terms.value)}`, {
            userMessage: terms.type === 'PERCENTAGE'
                ? 'O percentual do cupom precisa ficar entre 0,01% e 100%.'
                : 'O valor do cupom precisa ser maior que zero e dentro do limite da loja.',
        });
    }
    const limits = [
        ['valor minimo', terms.minimumAmount, limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS],
        ['teto de desconto', terms.maximumDiscount, limits_1.BUSINESS_LIMITS.PAYMENT_MAX_CENTS],
        ['limite de usos', terms.maxUses, MAX_USES_CEILING],
        ['limite por cliente', terms.maxUsesPerCustomer, MAX_USES_CEILING],
    ];
    for (const [label, value, ceiling] of limits) {
        if (value === null)
            continue;
        if (!Number.isInteger(value) || value <= 0 || value > ceiling) {
            throw new errors_1.ValidationError(`Limite invalido (${label}): ${String(value)}`, {
                userMessage: `O ${label} informado e invalido. Use um numero inteiro positivo.`,
            });
        }
    }
    if (terms.startsAt !== null &&
        terms.expiresAt !== null &&
        terms.expiresAt.getTime() <= terms.startsAt.getTime()) {
        throw new errors_1.ValidationError('Periodo de validade invertido.', {
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
async function createCouponFromInput(guildId, actorId, terms) {
    assertTerms(terms);
    const existing = await (0, CouponRepository_1.findCouponByCode)(guildId, terms.code);
    if (existing !== null && existing.deletedAt === null) {
        throw new errors_1.ValidationError(`Codigo de cupom duplicado: ${terms.code}`, {
            userMessage: `Ja existe um cupom com o codigo **${terms.code}**. Use "Editar" para altera-lo.`,
            context: { guildId, entityType: 'coupon', entityId: existing.id },
        });
    }
    const restored = existing !== null;
    const coupon = await (0, CouponRepository_1.createCoupon)({
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
    await (0, AuditRepository_1.recordCouponAudit)({
        guildId,
        couponId: coupon.id,
        action: restored ? 'RESTORED' : 'CREATED',
        actorId,
        newValue: (0, CouponCalculator_1.describeCoupon)(coupon),
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
async function requireCoupon(guildId, couponId) {
    const coupon = await (0, CouponRepository_1.findCouponById)(couponId);
    if (coupon === null || coupon.guildId !== guildId || coupon.deletedAt !== null) {
        throw new errors_1.CouponNotFoundError(couponId, {
            userMessage: 'Este cupom nao existe mais. Atualize o painel e tente novamente.',
            context: { guildId, entityType: 'coupon', entityId: couponId },
        });
    }
    return coupon;
}
/** Substitui todos os termos editaveis do cupom. */
async function updateCouponFields(guildId, couponId, actorId, terms) {
    assertTerms(terms);
    const current = await requireCoupon(guildId, couponId);
    if (terms.code !== current.code) {
        const conflict = await (0, CouponRepository_1.findCouponByCode)(guildId, terms.code);
        if (conflict !== null && conflict.id !== current.id) {
            throw new errors_1.ValidationError(`Codigo de cupom em uso: ${terms.code}`, {
                userMessage: `O codigo **${terms.code}** ja pertence a outro cupom.`,
                context: { guildId, entityType: 'coupon', entityId: conflict.id },
            });
        }
    }
    const updated = await (0, CouponRepository_1.updateCoupon)(couponId, {
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
    await (0, AuditRepository_1.recordCouponAudit)({
        guildId,
        couponId: updated.id,
        action: 'UPDATED',
        actorId,
        oldValue: (0, CouponCalculator_1.describeCoupon)(current),
        newValue: (0, CouponCalculator_1.describeCoupon)(updated),
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
async function toggleCoupon(guildId, couponId, actorId) {
    const current = await requireCoupon(guildId, couponId);
    const updated = await (0, CouponRepository_1.setCouponEnabled)(couponId, !current.enabled);
    invalidateCoupons(guildId);
    await (0, AuditRepository_1.recordCouponAudit)({
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
async function deleteCoupon(guildId, couponId, actorId) {
    const current = await requireCoupon(guildId, couponId);
    const deleted = await (0, CouponRepository_1.softDeleteCoupon)(couponId);
    invalidateCoupons(guildId);
    await (0, AuditRepository_1.recordCouponAudit)({
        guildId,
        couponId: deleted.id,
        action: 'DELETED',
        actorId,
        oldValue: (0, CouponCalculator_1.describeCoupon)(current),
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
//# sourceMappingURL=CouponService.js.map