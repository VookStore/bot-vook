"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.announceTicketDelivered = announceTicketDelivered;
exports.refreshTicketDoneCard = refreshTicketDoneCard;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const reply_1 = require("../../../components/reply");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const OrderRepository_1 = require("../../catalog/repositories/OrderRepository");
const OrderService_1 = require("../../catalog/services/OrderService");
const TicketDoneBuilder_1 = require("../builders/TicketDoneBuilder");
const TicketInternalPanelBuilder_1 = require("../builders/TicketInternalPanelBuilder");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TicketConfigService_1 = require("./TicketConfigService");
const TicketChannelService_1 = require("./TicketChannelService");
/**
 * Canal de concluidos: o lugar dos atendimentos ENTREGUES.
 *
 * O pedido era mover o topico para la, e o Discord nao move topico. Entao, na
 * entrega, o topico e ARQUIVADO — sai da lista de ativos sem fechar — e um
 * cartao no canal de concluidos aponta para ele. Quando o ticket fecha (pelo
 * cliente confirmando, ou pela equipe), o mesmo cartao e reescrito.
 *
 * NADA AQUI LANCA. Quando estas funcoes rodam, o produto ja foi entregue ou o
 * ticket ja fechou no banco: um cartao que nao sai nao pode desfazer isso.
 */
const logger = (0, Logger_1.createLogger)('ticket:done');
/** Status de pedido que contam como "entregue" para o cartao. */
const DELIVERED_STATUSES = [client_1.OrderStatus.DELIVERED, client_1.OrderStatus.COMPLETED];
/**
 * Numero do pedido entregue neste atendimento, quando houver.
 *
 * Vem de `listOrdersByChannel` porque o cartao e reconstruido do banco a cada
 * vez: o pedido mais recente ja entregue e o que esta entrega fechou.
 */
async function deliveredOrderLabel(guildId, channelId) {
    if (channelId === null)
        return null;
    const pedidos = await (0, OrderRepository_1.listOrdersByChannel)(guildId, channelId);
    const entregue = [...pedidos].reverse().find((pedido) => DELIVERED_STATUSES.includes(pedido.status));
    return entregue === undefined ? null : (0, OrderService_1.formatOrderNumber)(entregue.orderNumber);
}
async function toCardData(guild, ticket) {
    const [category, orderLabel] = await Promise.all([
        (0, TicketConfigService_1.getCategoryById)(guild.id, ticket.categoryId),
        deliveredOrderLabel(guild.id, ticket.channelId),
    ]);
    const closed = ticket.status === client_1.TicketStatus.CLOSED;
    const state = !closed ? 'aguardando' : ticket.closedById === ticket.ownerId ? 'cliente' : 'equipe';
    return {
        guildId: guild.id,
        ticketChannelId: ticket.channelId,
        ticketLabel: (0, TicketInternalPanelBuilder_1.formatTicketNumber)(ticket.ticketNumber),
        categoryName: category?.name ?? 'Categoria removida',
        customerId: ticket.ownerId,
        staffId: ticket.claimedById,
        deliveredById: ticket.deliveredById,
        deliveredAt: ticket.deliveredAt,
        orderLabel,
        state,
        closedById: ticket.closedById,
        closedAt: ticket.closedAt,
        transcriptUrl: ticket.transcriptUrl,
    };
}
/**
 * Reescreve o cartao ja publicado. Mensagem apagada limpa a referencia em vez
 * de virar erro a cada mudanca de estado, para sempre.
 */
async function rewriteCard(guild, ticket) {
    if (ticket.doneCardChannelId === null || ticket.doneCardMessageId === null)
        return false;
    const channel = await (0, discord_1.fetchChannelSafe)(guild, ticket.doneCardChannelId);
    if (!(0, discord_1.isSendableTextChannel)(channel))
        return false;
    try {
        const message = await channel.messages.fetch(ticket.doneCardMessageId);
        await message.edit({
            components: [(0, TicketDoneBuilder_1.buildTicketDoneCard)(await toCardData(guild, ticket))],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            allowedMentions: discord_1.NO_MENTIONS,
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error)) {
            await (0, TicketRepository_1.setTicketDoneCard)(ticket.id, null, null).catch(() => undefined);
            return false;
        }
        logger.warn('Falha ao reescrever o cartao do ticket entregue.', {
            guildId: guild.id,
            entityType: 'ticket',
            entityId: ticket.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/**
 * O produto foi entregue: cartao no canal de concluidos, topico arquivado.
 *
 * O ARQUIVAMENTO DEPENDE DO CARTAO. Sem canal de concluidos configurado — ou se
 * a publicacao falhar —, o topico fica onde esta: arquivar sem o cartao faria o
 * atendimento sumir da lista de ativos sem nada apontando para ele, e um ticket
 * aberto que ninguem acha e o pior resultado possivel.
 *
 * Arquivar NAO FECHA. O ticket continua aberto no banco, o cliente continua
 * podendo escrever (e a mensagem dele reabre o topico sozinha) e so fecha
 * quando ele confirma o recebimento ou a equipe encerra.
 *
 * Idempotente: entregar duas vezes no mesmo ticket reescreve o cartao.
 */
async function announceTicketDelivered(guild, ticket) {
    try {
        let carded = await rewriteCard(guild, ticket);
        if (!carded) {
            const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
            const channel = await (0, discord_1.fetchChannelSafe)(guild, config.ticketDoneChannelId);
            if ((0, discord_1.isSendableTextChannel)(channel)) {
                const message = await (0, reply_1.sendV2)(channel, (0, TicketDoneBuilder_1.buildTicketDoneCard)(await toCardData(guild, ticket)));
                await (0, TicketRepository_1.setTicketDoneCard)(ticket.id, channel.id, message.id);
                carded = true;
            }
            else if (config.ticketDoneChannelId !== null) {
                logger.warn('Canal de concluidos indisponivel.', {
                    guildId: guild.id,
                    channelId: config.ticketDoneChannelId,
                });
            }
        }
        if (!carded)
            return { carded: false, archived: false };
        const conversation = await (0, TicketChannelService_1.resolveTicketChannel)(guild, ticket.channelId);
        if (conversation === null || !(0, TicketChannelService_1.isTicketThread)(conversation) || conversation.archived === true) {
            // Canal legado nao arquiva; topico ja arquivado nao precisa.
            return { carded, archived: conversation !== null && (0, TicketChannelService_1.isTicketThread)(conversation) };
        }
        await conversation.setArchived(true, `Ticket #${ticket.ticketNumber}: produto entregue`);
        return { carded, archived: true };
    }
    catch (error) {
        logger.warn('Falha ao mover o ticket entregue para concluidos.', {
            guildId: guild.id,
            entityType: 'ticket',
            entityId: ticket.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return { carded: false, archived: false };
    }
}
/**
 * Reescreve o cartao depois de o ticket mudar (fechamento, principalmente).
 *
 * Chamado do fechamento para QUALQUER ticket: ticket que nunca foi entregue nao
 * tem cartao, e a funcao sai sem tocar no Discord.
 */
async function refreshTicketDoneCard(guild, ticket) {
    try {
        await rewriteCard(guild, ticket);
    }
    catch (error) {
        logger.warn('Falha ao atualizar o cartao do ticket entregue.', {
            guildId: guild.id,
            entityType: 'ticket',
            entityId: ticket.id,
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}
//# sourceMappingURL=TicketDoneService.js.map