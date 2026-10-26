"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPanelForTicket = buildPanelForTicket;
exports.sendInternalPanel = sendInternalPanel;
exports.refreshInternalPanel = refreshInternalPanel;
exports.refreshInternalPanelById = refreshInternalPanelById;
exports.refreshInternalPanelByChannel = refreshInternalPanelByChannel;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../../components/reply");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const TicketInternalPanelBuilder_1 = require("../builders/TicketInternalPanelBuilder");
const TicketParticipantRepository_1 = require("../repositories/TicketParticipantRepository");
const TicketRepository_1 = require("../repositories/TicketRepository");
const OrderRepository_1 = require("../../catalog/repositories/OrderRepository");
const CustomerRepository_1 = require("../../catalog/repositories/CustomerRepository");
const OrderService_1 = require("../../catalog/services/OrderService");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const TicketConfigService_1 = require("./TicketConfigService");
const TicketChannelService_1 = require("./TicketChannelService");
/**
 * Renderizacao e atualizacao do painel interno do ticket.
 *
 * A posicao na fila e sempre RECALCULADA a partir do banco no momento em que o
 * painel e montado — nao existe coluna `queuePosition` para ficar desatualizada.
 * O mesmo vale para os pedidos do atendimento.
 */
const logger = (0, Logger_1.createLogger)('ticket:view');
/**
 * Quantos pedidos cabem na linha do painel.
 *
 * O bloco vai dentro de `boxedField`, que corta em 200 caracteres. Cada entrada
 * gasta ~32 (`VK-000185 — Aguardando pagamento`), entao cinco entram com folga
 * e a sexta comecaria a ser cortada no meio.
 */
const PANEL_ORDER_LIMIT = 5;
/** Pedidos abertos no canal do ticket, prontos para virar texto no painel. */
async function orderRefsFor(ticket) {
    if (ticket.channelId === null)
        return [];
    // Falha de leitura NAO derruba o painel: perder a linha dos pedidos e muito
    // menos grave que o ticket ficar sem painel nenhum.
    const orders = await (0, OrderRepository_1.listOrdersByChannel)(ticket.guildId, ticket.channelId, PANEL_ORDER_LIMIT).catch((error) => {
        logger.warn('Nao foi possivel listar os pedidos do atendimento.', {
            guildId: ticket.guildId,
            entityType: 'ticket',
            entityId: ticket.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return [];
    });
    return orders.map((order) => `${(0, OrderService_1.formatOrderNumber)(order.orderNumber)} — ${(0, OrderService_1.describeOrderStatus)(order.status)}`);
}
/**
 * Historico comercial do dono do ticket.
 *
 * MELHOR-ESFORCO. E informacao de apoio para a equipe: uma falha de consulta
 * devolve `null` e o bloco some, em vez de impedir o painel — que e a UNICA
 * mensagem da abertura, entao derruba-lo derruba o atendimento inteiro.
 */
async function customerSummaryFor(ticket) {
    try {
        return await (0, CustomerRepository_1.getCustomerSummary)(ticket.guildId, ticket.ownerId);
    }
    catch (error) {
        logger.warn('Nao foi possivel carregar o historico do cliente.', {
            guildId: ticket.guildId,
            entityType: 'ticket',
            entityId: ticket.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
/**
 * Nome de quem assumiu o ticket, para o campo "Responsavel" do painel.
 *
 * Resolvido AQUI e nao no builder porque o builder e puro: recebe dados e
 * devolve componentes, sem tocar na API do Discord. Falha de rede vira
 * `null` — o painel tem um texto de fallback e nao vale derrubar a renderizacao
 * inteira por um nome.
 */
async function claimedByNameFor(guild, ticket) {
    if (guild === undefined || ticket.claimedById === null)
        return null;
    const member = await (0, discord_1.fetchMemberSafe)(guild, ticket.claimedById).catch(() => null);
    return member === null ? null : (0, discord_1.displayNameOf)(member, ticket.claimedById);
}
/**
 * Monta o painel interno com os dados atuais do ticket.
 *
 * A `guild` e opcional so por compatibilidade com chamadas antigas; sem ela o
 * campo "Responsavel" cai no id. Todos os chamadores atuais passam uma.
 */
async function buildPanelForTicket(ticket, guild) {
    const [category, participants, queuePosition, config, teamRoleIds, orderRefs, claimedByName, customer,] = await Promise.all([
        (0, TicketConfigService_1.getCategoryById)(ticket.guildId, ticket.categoryId),
        (0, TicketParticipantRepository_1.listActiveParticipants)(ticket.id),
        (0, TicketRepository_1.getQueuePosition)(ticket),
        (0, GuildConfigService_1.getGuildConfig)(ticket.guildId),
        (0, TicketConfigService_1.getTeamRoleIds)(ticket.categoryId),
        orderRefsFor(ticket),
        claimedByNameFor(guild, ticket),
        customerSummaryFor(ticket),
    ]);
    return (0, TicketInternalPanelBuilder_1.buildInternalPanel)({
        ticket,
        categoryName: category?.name ?? 'Categoria removida',
        queuePosition,
        participantIds: participants.map((participant) => participant.userId),
        claimedByName,
        orderRefs,
        customer,
        thumbnailUrl: config.panelThumbnailUrl,
        // Banner proprio do ticket; sem ele, reaproveita o do painel publico.
        bannerUrl: config.ticketBannerUrl ?? config.panelBannerUrl,
        storeName: config.storeName,
        teamRoleIds,
    });
}
/** Envia o painel interno no canal e guarda o id da mensagem. */
/**
 * Publica o painel no canal do ticket.
 *
 * E o UNICO envio da abertura: nao existe mais mensagem separada de
 * boas-vindas. Por isso e aqui que o ping acontece — `allowedMentions` libera o
 * cliente e os cargos da equipe, ambos ja mencionados no texto do painel.
 */
async function sendInternalPanel(channel, ticket) {
    const [panel, teamRoleIds] = await Promise.all([
        buildPanelForTicket(ticket, channel.guild),
        (0, TicketConfigService_1.getTeamRoleIds)(ticket.categoryId),
    ]);
    const message = await (0, reply_1.sendV2)(channel, panel, {
        allowedMentions: { parse: [], users: [ticket.ownerId], roles: [...teamRoleIds] },
    });
    await (0, TicketRepository_1.setPanelMessageId)(ticket.id, message.id);
    return message;
}
/**
 * Atualiza o painel interno ja publicado.
 * Retorna false (sem lancar) quando canal/mensagem nao existem mais.
 */
async function refreshInternalPanel(guild, ticket) {
    if (ticket.channelId === null || ticket.panelMessageId === null)
        return false;
    const channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, ticket.channelId);
    if (channel === null)
        return false;
    try {
        const message = await channel.messages.fetch(ticket.panelMessageId);
        const panel = await buildPanelForTicket(ticket, guild);
        await message.edit({
            components: [panel],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            allowedMentions: discord_1.NO_MENTIONS,
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error)) {
            logger.debug('Painel interno nao encontrado para atualizacao.', {
                guildId: guild.id,
                entityType: 'ticket',
                entityId: ticket.id,
            });
            return false;
        }
        throw error;
    }
}
/** Recarrega o ticket do banco e atualiza o painel. */
async function refreshInternalPanelById(guild, ticketId) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null)
        return false;
    return refreshInternalPanel(guild, ticket);
}
/**
 * Atualiza o painel do ticket dono deste canal, se houver um.
 *
 * Quem gera cobranca sabe o canal, nao o ticket — e a cobranca pode muito bem
 * ter sido criada num canal comum. Devolver false silenciosamente e o
 * comportamento certo: nao existir ticket ali nao e erro.
 */
async function refreshInternalPanelByChannel(guild, channelId) {
    const ticket = await (0, TicketRepository_1.findTicketByChannelId)(channelId);
    if (ticket === null)
        return false;
    return refreshInternalPanel(guild, ticket);
}
//# sourceMappingURL=TicketViewService.js.map