"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPEN_ORDER_STATUSES = void 0;
exports.initialPriorityFor = initialPriorityFor;
exports.escalateStaleTickets = escalateStaleTickets;
const client_1 = require("@prisma/client");
const limits_1 = require("../../../constants/limits");
const Logger_1 = require("../../../core/logger/Logger");
const OrderRepository_1 = require("../../catalog/repositories/OrderRepository");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TicketQueueService_1 = require("./TicketQueueService");
/**
 * Prioridade da fila de atendimento.
 *
 * O campo `Ticket.priority` existe desde o inicio, a fila sempre ordenou por
 * ele (`priority DESC, ticketNumber ASC`) e NADA nunca o definia — todo ticket
 * nascia NORMAL, entao a ordenacao era, na pratica, so por numero. Este modulo
 * e o que faltava: as duas unicas fontes de prioridade do sistema.
 *
 * 1. NA ABERTURA. Quem tem pedido em aberto entra como VIP. E o cliente que ja
 *    pagou ou esta pagando; deixar essa pessoa atras de uma duvida generica e o
 *    tipo de espera que vira reembolso.
 *
 * 2. POR ESPERA. Um job sobe um degrau de cada vez em quem esta parado na fila.
 *    Sem isso, um ticket sem sorte pode ficar para tras indefinidamente quando
 *    a fila anda por numero.
 *
 * NUNCA REBAIXA. Todo caminho aqui so sobe prioridade. Um ticket que virou
 * URGENT por espera nao volta a HIGH se a fila esvaziar — a espera ja
 * aconteceu, e rebaixar significaria fazer a pessoa esperar duas vezes.
 */
const logger = (0, Logger_1.createLogger)('ticket:priority');
/**
 * Pedido "em aberto" para efeito de prioridade.
 *
 * Tudo que nao esta encerrado. DELIVERED entra: o produto saiu, mas enquanto o
 * pedido nao foi concluido ainda ha uma transacao viva — e e exatamente quando
 * aparece reclamacao de entrega.
 */
exports.OPEN_ORDER_STATUSES = [
    client_1.OrderStatus.PENDING,
    client_1.OrderStatus.AWAITING_PAYMENT,
    client_1.OrderStatus.PAID,
    client_1.OrderStatus.IN_PROGRESS,
    client_1.OrderStatus.DELIVERED,
];
/**
 * Prioridade com que o ticket deve nascer.
 *
 * Melhor-esforco: se a consulta falhar, o ticket abre NORMAL. Prioridade e
 * otimizacao de fila, e nenhuma otimizacao vale impedir alguem de pedir ajuda.
 */
async function initialPriorityFor(guildId, userId) {
    try {
        const abertos = await (0, OrderRepository_1.countOrders)(guildId, {
            customerId: userId,
            statuses: exports.OPEN_ORDER_STATUSES,
        });
        return abertos > 0 ? client_1.TicketPriority.VIP : client_1.TicketPriority.NORMAL;
    }
    catch (error) {
        logger.warn('Falha ao calcular a prioridade inicial; assumindo NORMAL.', {
            guildId,
            entityType: 'user',
            entityId: userId,
            detail: error instanceof Error ? error.message : String(error),
        });
        return client_1.TicketPriority.NORMAL;
    }
}
/** Os degraus, do mais alto para o mais baixo. Ordem importa: ver `escalate`. */
const STEPS = [
    {
        from: client_1.TicketPriority.HIGH,
        to: client_1.TicketPriority.URGENT,
        afterMs: limits_1.TICKET_PRIORITY.URGENT_AFTER_MS,
    },
    {
        from: client_1.TicketPriority.NORMAL,
        to: client_1.TicketPriority.HIGH,
        afterMs: limits_1.TICKET_PRIORITY.HIGH_AFTER_MS,
    },
];
/**
 * Sobe a prioridade dos tickets parados na fila.
 *
 * DEGRAUS DO MAIS ALTO PARA O MAIS BAIXO, e um degrau por rodada. Na ordem
 * inversa, um ticket promovido a HIGH nesta mesma passagem ja apareceria na
 * consulta seguinte e subiria a URGENT no mesmo instante — o ticket pularia
 * NORMAL -> URGENT de uma vez, ignorando os 45 minutos.
 *
 * Devolve quantos tickets subiram. O `client` e opcional: sem ele, a promocao
 * acontece no banco e os paineis so refletem a nova posicao na proxima vez que
 * forem redesenhados.
 */
async function escalateStaleTickets(client = null) {
    const agora = Date.now();
    let promovidos = 0;
    // Categorias tocadas, para atualizar os paineis uma vez so no fim.
    const categorias = new Map();
    for (const step of STEPS) {
        const corte = new Date(agora - step.afterMs);
        const candidatos = await (0, TicketRepository_1.listStaleQueuedTickets)(step.from, corte, limits_1.TICKET_PRIORITY.ESCALATION_BATCH);
        for (const ticket of candidatos) {
            // Alguem pode ter assumido o ticket entre a leitura e a escrita.
            if (!(await (0, TicketRepository_1.promoteTicketPriority)(ticket.id, step.to)))
                continue;
            promovidos += 1;
            categorias.set(`${ticket.guildId}:${ticket.categoryId}`, {
                guildId: ticket.guildId,
                categoryId: ticket.categoryId,
            });
            await (0, AuditRepository_1.recordTicketAudit)({
                guildId: ticket.guildId,
                ticketId: ticket.id,
                action: client_1.TicketAuditAction.PRIORITY_CHANGED,
                // Sem `actorId`: quem promoveu foi o proprio sistema, e inventar um
                // autor humano faria a auditoria mentir sobre quem decidiu.
                actorId: null,
                oldValue: step.from,
                newValue: step.to,
                metadata: { motivo: 'espera na fila', minutos: Math.round(step.afterMs / 60_000) },
            });
        }
    }
    if (promovidos === 0)
        return 0;
    logger.info('Prioridades escalonadas por espera.', { count: promovidos });
    /*
     * A posicao na fila mostrada no painel de cada ticket muda quando alguem
     * sobe de prioridade. `refreshQueueHead` ja limita o lote, entao redesenhar
     * a cabeca de cada categoria afetada nao vira rajada na API do Discord.
     */
    if (client !== null) {
        for (const { guildId, categoryId } of categorias.values()) {
            const guild = client.guilds.cache.get(guildId);
            if (guild === undefined)
                continue;
            await (0, TicketQueueService_1.refreshQueueHead)(guild, categoryId).catch(() => undefined);
        }
    }
    return promovidos;
}
//# sourceMappingURL=TicketPriorityService.js.map