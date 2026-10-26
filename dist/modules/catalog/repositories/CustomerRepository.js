"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomerSummary = getCustomerSummary;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../../core/database/prisma");
/**
 * Historico comercial de um cliente, resumido.
 *
 * Existe para a equipe saber COM QUEM esta falando no momento em que abre o
 * ticket. Antes o painel mostrava apenas os pedidos daquele canal, entao um
 * cliente de dez compras e um que nunca comprou chegavam identicos na tela — e
 * eram atendidos igual.
 *
 * UMA CONSULTA AGREGADA, nao uma lista. O painel precisa de quatro numeros, e
 * carregar todos os pedidos do cliente para soma-los em JavaScript custaria
 * caro justo no caminho da abertura do ticket, que ja segura um lock.
 */
/** Pedidos que contam como venda concretizada. */
const PAID_STATUSES = [
    client_1.OrderStatus.PAID,
    client_1.OrderStatus.IN_PROGRESS,
    client_1.OrderStatus.DELIVERED,
    client_1.OrderStatus.COMPLETED,
];
/** Pedidos ainda em andamento. */
const OPEN_STATUSES = [
    client_1.OrderStatus.PENDING,
    client_1.OrderStatus.AWAITING_PAYMENT,
    client_1.OrderStatus.PAID,
    client_1.OrderStatus.IN_PROGRESS,
    client_1.OrderStatus.DELIVERED,
];
async function getCustomerSummary(guildId, customerId, db = (0, prisma_1.getPrisma)()) {
    const [paid, open, last, cart] = await Promise.all([
        /*
         * `finalAmount` e nao `subtotalAmount`: o que interessa e quanto o cliente
         * REALMENTE pagou, ja com cupom aplicado. Somar o subtotal inflaria o
         * historico de quem so comprou com desconto.
         */
        db.order.aggregate({
            where: { guildId, customerId, status: { in: [...PAID_STATUSES] } },
            _count: { _all: true },
            _sum: { finalAmount: true },
        }),
        db.order.count({
            where: { guildId, customerId, status: { in: [...OPEN_STATUSES] } },
        }),
        db.order.findFirst({
            where: { guildId, customerId, status: { in: [...PAID_STATUSES] } },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        }),
        db.cartItem.count({
            where: { cart: { guildId, customerId, status: client_1.CartStatus.ACTIVE } },
        }),
    ]);
    return {
        paidOrders: paid._count._all,
        spentCents: paid._sum.finalAmount ?? 0,
        openOrders: open,
        lastPurchaseAt: last?.createdAt ?? null,
        cartItems: cart,
    };
}
//# sourceMappingURL=CustomerRepository.js.map