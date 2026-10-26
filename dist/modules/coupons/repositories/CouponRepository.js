"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCoupons = listCoupons;
exports.findCouponById = findCouponById;
exports.findCouponByCode = findCouponByCode;
exports.createCoupon = createCoupon;
exports.updateCoupon = updateCoupon;
exports.setCouponEnabled = setCouponEnabled;
exports.softDeleteCoupon = softDeleteCoupon;
exports.countCouponUses = countCouponUses;
exports.countCouponUsesByCustomer = countCouponUsesByCustomer;
exports.countUsesByCoupon = countUsesByCoupon;
exports.findCouponUsageByPayment = findCouponUsageByPayment;
exports.createCouponUsage = createCouponUsage;
exports.lockCouponRow = lockCouponRow;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../../core/database/prisma");
/**
 * Cupons vivos da guild (nunca retorna soft-deleted).
 * Ordena ativos primeiro e depois por codigo, que e a ordem esperada no painel.
 */
async function listCoupons(guildId, options = {}, db = (0, prisma_1.getPrisma)()) {
    return db.coupon.findMany({
        where: {
            guildId,
            deletedAt: null,
            ...(options.includeDisabled === true ? {} : { enabled: true }),
        },
        orderBy: [{ enabled: 'desc' }, { code: 'asc' }],
    });
}
async function findCouponById(id, db = (0, prisma_1.getPrisma)()) {
    return db.coupon.findUnique({ where: { id } });
}
/**
 * Busca pelo codigo INCLUINDO registros soft-deleted.
 * E o que permite reviver um cupom antigo em vez de esbarrar no UNIQUE.
 */
async function findCouponByCode(guildId, code, db = (0, prisma_1.getPrisma)()) {
    return db.coupon.findUnique({ where: { guildId_code: { guildId, code } } });
}
/**
 * Cria o cupom. Se o codigo ja existir na guild (inclusive excluido), o registro
 * e revivido com os novos termos: mesmo id, mesmo historico, `deletedAt` limpo.
 *
 * `createdById` so e gravado na criacao — reviver nao reescreve quem criou.
 */
async function createCoupon(input, db = (0, prisma_1.getPrisma)()) {
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
async function updateCoupon(id, data, db = (0, prisma_1.getPrisma)()) {
    return db.coupon.update({ where: { id }, data });
}
async function setCouponEnabled(id, enabled, db = (0, prisma_1.getPrisma)()) {
    return db.coupon.update({ where: { id }, data: { enabled } });
}
/** Soft delete: o cupom some do painel mas continua ligado ao historico. */
async function softDeleteCoupon(id, db = (0, prisma_1.getPrisma)()) {
    return db.coupon.update({
        where: { id },
        data: { deletedAt: new Date(), enabled: false },
    });
}
async function countCouponUses(couponId, db = (0, prisma_1.getPrisma)()) {
    return db.couponUsage.count({ where: { couponId } });
}
async function countCouponUsesByCustomer(couponId, customerId, db = (0, prisma_1.getPrisma)()) {
    return db.couponUsage.count({ where: { couponId, customerId } });
}
/**
 * Total de usos de cada cupom da guild em UMA consulta agregada.
 * Existe para o painel administrativo nao disparar um COUNT por cupom.
 */
async function countUsesByCoupon(guildId, db = (0, prisma_1.getPrisma)()) {
    const rows = await db.couponUsage.groupBy({
        by: ['couponId'],
        where: { guildId },
        _count: { _all: true },
    });
    const totals = new Map();
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
async function findCouponUsageByPayment(paymentId, db = (0, prisma_1.getPrisma)()) {
    return db.couponUsage.findUnique({ where: { paymentId } });
}
async function createCouponUsage(params, db = (0, prisma_1.getPrisma)()) {
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
async function lockCouponRow(tx, couponId) {
    await tx.$queryRaw(client_1.Prisma.sql `SELECT "id" FROM "coupons" WHERE "id" = ${couponId} FOR UPDATE`);
}
//# sourceMappingURL=CouponRepository.js.map