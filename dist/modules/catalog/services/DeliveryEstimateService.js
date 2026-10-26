"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addBusinessDays = addBusinessDays;
exports.leadTimeForOrder = leadTimeForOrder;
exports.setDeliveryEstimate = setDeliveryEstimate;
exports.dueStatusOf = dueStatusOf;
const prisma_1 = require("../../../core/database/prisma");
const Logger_1 = require("../../../core/logger/Logger");
/**
 * Previsao de entrega dos pedidos.
 *
 * POR QUE EXISTE. Tudo que a loja vende e feito sob encomenda — cabelo, PED,
 * pelucia. Ate aqui o pedido nao carregava prazo nenhum: quem pagou R$ 110 nao
 * sabia quando receberia, e a equipe nao tinha uma fila ordenada por
 * vencimento, so por data de criacao.
 *
 * CONGELADA NO PAGAMENTO, e nao na criacao. Antes de o dinheiro entrar nao ha
 * compromisso nenhum, e a producao nao comecou; um pedido que ficou tres dias
 * aguardando pagamento nao pode nascer com o prazo ja consumido.
 *
 * E UMA DATA, NAO UM PRAZO. Gravada absoluta, de proposito: se a loja mudar o
 * prazo da categoria no mes que vem, quem ja comprou continua com a promessa
 * que recebeu. Recalcular a partir do prazo atual reescreveria o passado.
 *
 * DIAS UTEIS, contados pulando sabado e domingo — que e como uma loja de
 * trabalho sob encomenda de fato opera, e como o cliente le "5 dias".
 */
const logger = (0, Logger_1.createLogger)('catalog:delivery');
/** Soma dias UTEIS a uma data, pulando fim de semana. */
function addBusinessDays(from, days) {
    const result = new Date(from.getTime());
    let restantes = Math.max(0, Math.trunc(days));
    while (restantes > 0) {
        result.setDate(result.getDate() + 1);
        const weekday = result.getDay();
        // 0 = domingo, 6 = sabado.
        if (weekday !== 0 && weekday !== 6)
            restantes -= 1;
    }
    return result;
}
/**
 * Maior prazo entre as categorias dos itens do pedido.
 *
 * O MAIOR, e nao a soma nem a media: os itens sao produzidos em paralelo, e o
 * pedido so fica pronto quando o ultimo fica. Somar prometeria uma data absurda
 * para um carrinho com cinco itens; a media prometeria uma data que o pedido
 * nao cumpre.
 *
 * `null` quando nenhuma categoria envolvida tem prazo definido — nesse caso o
 * pedido fica sem previsao, em vez de receber um numero inventado.
 */
async function leadTimeForOrder(order) {
    const packIds = order.items.map((item) => item.packId);
    if (packIds.length === 0)
        return null;
    const packs = await (0, prisma_1.getPrisma)().catalogPack.findMany({
        where: { id: { in: packIds } },
        select: { category: { select: { leadTimeDays: true } } },
    });
    const prazos = packs.flatMap((pack) => pack.category?.leadTimeDays === null || pack.category?.leadTimeDays === undefined
        ? []
        : [pack.category.leadTimeDays]);
    return prazos.length === 0 ? null : Math.max(...prazos);
}
/**
 * Grava a previsao de entrega do pedido pago.
 *
 * MELHOR-ESFORCO: uma falha aqui nao pode desfazer um pagamento aprovado. O
 * pedido segue sem previsao e a equipe combina o prazo no atendimento, que era
 * o comportamento anterior.
 *
 * Nao sobrescreve uma previsao existente — um pedido reprocessado (nova
 * cobranca sobre o mesmo pedido, por exemplo) mantem a data prometida.
 */
async function setDeliveryEstimate(order, paidAt = new Date()) {
    try {
        if (order.dueAt !== null)
            return order.dueAt;
        const days = await leadTimeForOrder(order);
        if (days === null)
            return null;
        const dueAt = addBusinessDays(paidAt, days);
        await (0, prisma_1.getPrisma)().order.update({ where: { id: order.id }, data: { dueAt } });
        logger.info('Previsao de entrega definida.', {
            guildId: order.guildId,
            entityType: 'order',
            entityId: order.id,
            days,
        });
        return dueAt;
    }
    catch (error) {
        logger.warn('Nao foi possivel calcular a previsao de entrega.', {
            guildId: order.guildId,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
function dueStatusOf(
/*
 * Aceita `undefined` alem de `null` de proposito. Um pedido vindo do Prisma
 * sempre traz `dueAt: null`, mas objeto montado a mao — fixture de teste,
 * projecao parcial, cache antigo — pode simplesmente nao ter o campo. Este
 * valor alimenta o painel do pedido, e derrubar a tela inteira do cliente por
 * causa de uma data ausente seria um preco absurdo por uma linha decorativa.
 */
dueAt, now = new Date()) {
    if (dueAt === null || dueAt === undefined)
        return 'sem-prazo';
    const diff = dueAt.getTime() - now.getTime();
    if (diff < 0)
        return 'atrasado';
    // Menos de 24h restantes conta como "hoje": e o que muda a prioridade de quem
    // esta produzindo.
    return diff <= 24 * 60 * 60 * 1000 ? 'hoje' : 'no-prazo';
}
//# sourceMappingURL=DeliveryEstimateService.js.map