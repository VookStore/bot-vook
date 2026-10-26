"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrderReceipt = createOrderReceipt;
exports.listOrderReceipts = listOrderReceipts;
exports.findLatestReceipt = findLatestReceipt;
exports.countOrderReceipts = countOrderReceipts;
const prisma_1 = require("../../../core/database/prisma");
async function createOrderReceipt(input, db = (0, prisma_1.getPrisma)()) {
    return db.orderReceipt.create({ data: input });
}
async function listOrderReceipts(orderId, db = (0, prisma_1.getPrisma)()) {
    return db.orderReceipt.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
}
/** Ultimo comprovante enviado (o painel do cliente mostra o estado dele). */
async function findLatestReceipt(orderId, db = (0, prisma_1.getPrisma)()) {
    return db.orderReceipt.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } });
}
async function countOrderReceipts(orderId, db = (0, prisma_1.getPrisma)()) {
    return db.orderReceipt.count({ where: { orderId } });
}
//# sourceMappingURL=OrderReceiptRepository.js.map