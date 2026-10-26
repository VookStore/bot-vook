"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueInfo = getQueueInfo;
exports.getQueueOverview = getQueueOverview;
exports.getGuildQueueSize = getGuildQueueSize;
exports.refreshQueueHead = refreshQueueHead;
const limits_1 = require("../../../constants/limits");
const Logger_1 = require("../../../core/logger/Logger");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TicketConfigService_1 = require("./TicketConfigService");
const TicketViewService_1 = require("./TicketViewService");
/**
 * Fila de atendimento.
 *
 * A fila e SEMPRE derivada dos tickets reais: status OPEN, sem responsavel,
 * agrupados por (guild, categoria) e ordenados por prioridade e numero.
 * Nao existe coluna de posicao para dessincronizar.
 *
 * Desempenho: a mudanca da fila NAO reescreve dezenas de mensagens. Apenas os
 * primeiros tickets (QUEUE_PANEL_REFRESH_BATCH) tem o painel atualizado, e o
 * cliente sempre pode usar o botao "Atualizar" para ver a posicao exata.
 */
const logger = (0, Logger_1.createLogger)('ticket:queue');
async function getQueueInfo(ticket) {
    const [position, total] = await Promise.all([
        (0, TicketRepository_1.getQueuePosition)(ticket),
        (0, TicketRepository_1.countQueue)(ticket.guildId, ticket.categoryId),
    ]);
    return { position, ahead: position > 0 ? position - 1 : 0, total };
}
/** Panorama da fila por categoria (status e diagnostico). */
async function getQueueOverview(guildId) {
    const categories = await (0, TicketConfigService_1.getCategories)(guildId);
    const entries = [];
    for (const category of categories) {
        if (category.deletedAt !== null)
            continue;
        const waiting = await (0, TicketRepository_1.countQueue)(guildId, category.id);
        const tickets = waiting > 0
            ? (await (0, TicketRepository_1.listQueue)(guildId, category.id, limits_1.BUSINESS_LIMITS.QUEUE_PREVIEW_SIZE)).map((ticket) => ticket.ticketNumber)
            : [];
        entries.push({
            categoryId: category.id,
            categoryName: category.name,
            waiting,
            tickets,
        });
    }
    return entries;
}
async function getGuildQueueSize(guildId) {
    return (0, TicketRepository_1.countQueueByGuild)(guildId);
}
/**
 * Atualiza o painel dos primeiros tickets da fila apos uma mudanca relevante
 * (criacao ou claim). Limitado a um lote pequeno para nao gerar rajada de
 * chamadas a API do Discord.
 */
async function refreshQueueHead(guild, categoryId, options = {}) {
    const limit = options.limit ?? limits_1.BUSINESS_LIMITS.QUEUE_PANEL_REFRESH_BATCH;
    if (limit <= 0)
        return 0;
    const head = await (0, TicketRepository_1.listQueue)(guild.id, categoryId, limit);
    let updated = 0;
    for (const ticket of head) {
        if (ticket.id === options.skipTicketId)
            continue;
        try {
            if (await (0, TicketViewService_1.refreshInternalPanel)(guild, ticket))
                updated += 1;
        }
        catch (error) {
            // Atualizar painel e melhoria de UX: nunca deve derrubar o fluxo principal.
            logger.warn('Falha ao atualizar painel da fila.', {
                guildId: guild.id,
                entityType: 'ticket',
                entityId: ticket.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return updated;
}
//# sourceMappingURL=TicketQueueService.js.map