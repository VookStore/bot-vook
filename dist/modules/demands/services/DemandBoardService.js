"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishDemandDone = publishDemandDone;
exports.publishDemand = publishDemand;
exports.refreshDemandCards = refreshDemandCards;
exports.announceDemandStarted = announceDemandStarted;
exports.publishDemandById = publishDemandById;
exports.refreshDemandById = refreshDemandById;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const reply_1 = require("../../../components/reply");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const TicketRepository_1 = require("../../tickets/repositories/TicketRepository");
const TicketInternalPanelBuilder_1 = require("../../tickets/builders/TicketInternalPanelBuilder");
const OrderRepository_1 = require("../../catalog/repositories/OrderRepository");
const DeliveryEstimateService_1 = require("../../catalog/services/DeliveryEstimateService");
const OrderNotificationService_1 = require("../../catalog/services/OrderNotificationService");
const OrderService_1 = require("../../catalog/services/OrderService");
const DemandBuilders_1 = require("../builders/DemandBuilders");
/**
 * Quadro de demandas.
 *
 * DOIS CANAIS, PAPEIS DIFERENTES. O quadro recebe o cartao de toda demanda
 * paga e o mantem atualizado ate o fim — ele conta o que entrou. O canal de
 * iniciadas recebe uma copia quando a producao comeca — ele conta o que esta
 * em producao agora. O cartao do quadro NAO some quando a demanda inicia;
 * passa a dizer quem pegou.
 *
 * NADA AQUI PODE DERRUBAR UMA OPERACAO COMERCIAL. Publicar, reescrever e
 * avisar sao best-effort: canal apagado, permissao faltando ou DM fechada viram
 * WARN e `false`. O pedido ja mudou de estado no banco quando estas funcoes
 * rodam — deixar um erro de mensagem desfazer isso seria trocar o registro
 * pelo enfeite.
 */
const logger = (0, Logger_1.createLogger)('demand:board');
/** Canal configurado, conferido no momento do uso. Null desliga o quadro. */
async function resolveBoardChannel(guild, channelId, role) {
    if (channelId === null || channelId.length === 0)
        return null;
    const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
    if (!(0, discord_1.isSendableTextChannel)(channel)) {
        logger.warn('Canal do quadro de demandas indisponivel.', {
            guildId: guild.id,
            channelId,
            role,
        });
        return null;
    }
    return channel;
}
/**
 * Monta o que o cartao mostra.
 *
 * O TICKET E BUSCADO AQUI porque e o unico jeito de o cartao levar ao
 * atendimento com numero: `order.channelId` guarda o canal de origem da compra,
 * e so o banco de tickets sabe se aquele canal e um atendimento e qual e o
 * numero dele.
 */
async function toCardData(guild, order) {
    const ticket = order.channelId === null ? null : await (0, TicketRepository_1.findTicketByChannelId)(order.channelId);
    return {
        guildId: guild.id,
        orderId: order.id,
        orderLabel: (0, OrderService_1.formatOrderNumber)(order.orderNumber),
        customerId: order.customerId,
        status: order.status,
        statusLabel: (0, OrderService_1.describeOrderStatus)(order.status),
        statusIcon: (0, OrderService_1.orderStatusIcon)(order.status),
        totalCents: order.finalAmount,
        assignedToId: order.assignedToId,
        dueAt: order.dueAt,
        overdue: (0, DeliveryEstimateService_1.dueStatusOf)(order.dueAt) === 'atrasado',
        items: order.items.map((item) => ({
            name: item.nameSnapshot,
            priceCents: item.priceSnapshot,
            quantity: item.quantity,
        })),
        // Venda de balcao nasce sem pack: a descricao da cobranca e a unica coisa
        // que diz o que produzir.
        description: order.payment?.description ?? null,
        ticketChannelId: order.channelId,
        ticketLabel: ticket === null ? null : (0, TicketInternalPanelBuilder_1.formatTicketNumber)(ticket.ticketNumber),
        startedAt: order.status === client_1.OrderStatus.IN_PROGRESS ? order.updatedAt : null,
        deliveredAt: order.deliveredAt,
        completedByCustomer: order.status === client_1.OrderStatus.COMPLETED && order.completedById === order.customerId,
    };
}
/** Estados em que a producao acabou: o arquivo ja saiu. */
function isFinished(status) {
    return status === client_1.OrderStatus.DELIVERED || status === client_1.OrderStatus.COMPLETED;
}
/** Apaga uma mensagem do quadro; mensagem que ja sumiu conta como apagada. */
async function removeMessage(guild, channelId, messageId) {
    const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
    if (!(0, discord_1.isSendableTextChannel)(channel))
        return true;
    try {
        const message = await channel.messages.fetch(messageId);
        await message.delete();
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return true;
        logger.warn('Falha ao apagar o cartao da demanda.', {
            guildId: guild.id,
            channelId,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/**
 * A demanda foi ENTREGUE: o cartao muda de canal.
 *
 * Sai de "iniciadas" — que so mostra o que esta em producao agora — e passa a
 * viver no canal de concluidas. Aqui e MOVER, nao copiar, ao contrario do
 * inicio da producao: la o quadro guarda o historico e "iniciadas" ganha uma
 * copia; aqui o cartao de "iniciadas" ja nao descreve nada que esteja
 * acontecendo.
 *
 * A ORDEM PROTEGE A DEMANDA DE SUMIR: primeiro publica no canal novo, so depois
 * apaga o antigo. Sem canal de concluidas configurado (ou se a publicacao
 * falhar), o cartao de "iniciadas" FICA, reescrito como entregue — melhor
 * um cartao no canal errado do que nenhum.
 */
/**
 * Garante o cartao no canal de concluidas: reescreve o que existe, ou publica.
 *
 * Devolve se o cartao esta la no fim. Mensagem apagada a mao cai para a
 * publicacao de uma nova, em vez de deixar a demanda sem cartao para sempre.
 */
async function ensureDoneCard(guild, order, data) {
    if (order.demandDoneMessageId !== null) {
        const result = await rewrite(guild, order.demandDoneChannelId, order.demandDoneMessageId, (0, DemandBuilders_1.buildDemandDoneCard)(data), () => (0, OrderRepository_1.setDemandDoneMessage)(order.id, null, null));
        // So publica outro se o antigo SUMIU. Falha passageira na edicao deixa o
        // cartao existente onde esta — publicar outro duplicaria a demanda.
        if (result !== 'gone')
            return true;
    }
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const channel = await resolveBoardChannel(guild, config.demandDoneChannelId, 'concluidas');
    if (channel === null)
        return false;
    try {
        const message = await (0, reply_1.sendV2)(channel, (0, DemandBuilders_1.buildDemandDoneCard)(data));
        await (0, OrderRepository_1.setDemandDoneMessage)(order.id, channel.id, message.id);
        return true;
    }
    catch (error) {
        logger.warn('Falha ao publicar a demanda concluida.', {
            guildId: guild.id,
            channelId: channel.id,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/**
 * Publica a demanda DIRETO no canal de concluidas, sem passar pelo quadro.
 *
 * Existe para pedido entregue antes de o quadro existir. Pelo caminho normal ele
 * nunca chegaria la — `refreshDemandCards` so cuida de demanda que o quadro ja
 * conhece, de proposito —, e publicar no quadro agora poria uma venda antiga no
 * fim do canal de demandas como se tivesse acabado de entrar.
 *
 * So para demanda que ja acabou (entregue ou concluida): uma em producao tem
 * lugar no quadro, nao aqui. Idempotente: cartao existente e reescrito.
 */
async function publishDemandDone(guild, order) {
    if (!isFinished(order.status))
        return false;
    return ensureDoneCard(guild, order, await toCardData(guild, order));
}
async function moveToDone(guild, order, data) {
    const hasDoneCard = await ensureDoneCard(guild, order, data);
    if (order.demandStartedChannelId === null || order.demandStartedMessageId === null)
        return;
    if (!hasDoneCard) {
        // Sem destino novo, o cartao de iniciadas e a unica copia viva: fica.
        await rewrite(guild, order.demandStartedChannelId, order.demandStartedMessageId, (0, DemandBuilders_1.buildDemandStartedCard)(data), () => (0, OrderRepository_1.setDemandStartedMessage)(order.id, null, null));
        return;
    }
    if (await removeMessage(guild, order.demandStartedChannelId, order.demandStartedMessageId)) {
        await (0, OrderRepository_1.setDemandStartedMessage)(order.id, null, null);
    }
}
async function rewrite(guild, channelId, messageId, root, forget) {
    if (channelId === null || messageId === null)
        return 'gone';
    const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
    if (!(0, discord_1.isSendableTextChannel)(channel))
        return 'gone';
    try {
        const message = await channel.messages.fetch(messageId);
        await message.edit({
            components: [root],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            allowedMentions: discord_1.NO_MENTIONS,
        });
        return 'ok';
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error)) {
            await forget().catch(() => undefined);
            return 'gone';
        }
        logger.warn('Falha ao reescrever o cartao da demanda.', {
            guildId: guild.id,
            channelId,
            entityType: 'order',
            detail: error instanceof Error ? error.message : String(error),
        });
        return 'failed';
    }
}
/**
 * Publica a demanda no quadro. Chamado quando o pedido e PAGO.
 *
 * Idempotente: cartao ja publicado apenas e reescrito. O pagamento pode ser
 * sincronizado duas vezes (o recovery reprocessa o que ficou pela metade
 * quando o bot caiu), e duas publicacoes deixariam dois cartoes vivos para a
 * mesma demanda — cada um com botoes proprios.
 */
async function publishDemand(guild, order) {
    if (order.demandMessageId !== null) {
        await refreshDemandCards(guild, order);
        return true;
    }
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const channel = await resolveBoardChannel(guild, config.demandChannelId, 'quadro');
    if (channel === null)
        return false;
    try {
        const message = await (0, reply_1.sendV2)(channel, (0, DemandBuilders_1.buildDemandCard)(await toCardData(guild, order)));
        await (0, OrderRepository_1.setDemandMessage)(order.id, channel.id, message.id);
        logger.info('Demanda publicada no quadro.', {
            guildId: guild.id,
            channelId: channel.id,
            entityType: 'order',
            entityId: order.id,
            orderNumber: (0, OrderService_1.formatOrderNumber)(order.orderNumber),
        });
        return true;
    }
    catch (error) {
        logger.warn('Falha ao publicar a demanda no quadro.', {
            guildId: guild.id,
            channelId: channel.id,
            entityType: 'order',
            entityId: order.id,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/**
 * Reescreve os cartoes desta demanda onde quer que eles estejam.
 *
 * Chamado depois de QUALQUER mudanca de estado, venha ela do quadro, do painel
 * efemero do pedido, da fila de producao ou do `/entregar`. Se so os botoes do
 * quadro atualizassem o cartao, uma transicao feita em outra tela deixaria o
 * quadro mentindo — que e exatamente o que um quadro nao pode fazer.
 */
async function refreshDemandCards(guild, order) {
    // So cuida de demanda que o quadro ja conhece. Pedido de antes do quadro que
    // chega agora em "entregue" nao aparece de repente nas concluidas.
    const onBoard = order.demandMessageId !== null ||
        order.demandStartedMessageId !== null ||
        order.demandDoneMessageId !== null;
    if (!onBoard)
        return;
    const data = await toCardData(guild, order);
    await rewrite(guild, order.demandChannelId, order.demandMessageId, (0, DemandBuilders_1.buildDemandCard)(data), () => (0, OrderRepository_1.setDemandMessage)(order.id, null, null));
    if (isFinished(order.status)) {
        await moveToDone(guild, order, data);
        return;
    }
    await rewrite(guild, order.demandStartedChannelId, order.demandStartedMessageId, (0, DemandBuilders_1.buildDemandStartedCard)(data), () => (0, OrderRepository_1.setDemandStartedMessage)(order.id, null, null));
}
/**
 * A producao comecou: publica a copia e avisa o cliente.
 *
 * Idempotente pela mesma razao do `publishDemand`: "pegar a proxima da fila" e
 * "iniciar demanda" chegam aqui pelos dois caminhos, e o cliente nao pode
 * receber duas vezes a mesma novidade.
 */
async function announceDemandStarted(guild, order) {
    if (order.demandStartedMessageId !== null) {
        await refreshDemandCards(guild, order);
        return { announced: false, customerNotified: false };
    }
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const data = await toCardData(guild, order);
    let announced = false;
    const channel = await resolveBoardChannel(guild, config.demandStartedChannelId, 'iniciadas');
    if (channel !== null) {
        try {
            const message = await (0, reply_1.sendV2)(channel, (0, DemandBuilders_1.buildDemandStartedCard)(data));
            await (0, OrderRepository_1.setDemandStartedMessage)(order.id, channel.id, message.id);
            announced = true;
        }
        catch (error) {
            logger.warn('Falha ao publicar a demanda iniciada.', {
                guildId: guild.id,
                channelId: channel.id,
                entityType: 'order',
                entityId: order.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    const customerNotified = await (0, OrderNotificationService_1.trySendDm)(guild, order.customerId, (0, DemandBuilders_1.buildDemandStartedDm)({
        storeName: config.storeName,
        guildId: guild.id,
        customerId: order.customerId,
        orderLabel: data.orderLabel,
        dueAt: data.dueAt,
        overdue: data.overdue,
        assignedToId: data.assignedToId,
        ticketChannelId: data.ticketChannelId,
        ticketLabel: data.ticketLabel,
    }), { guildId: guild.id, entityType: 'order', entityId: order.id });
    // O cartao do quadro passa a dizer que a demanda saiu da fila.
    await rewrite(guild, order.demandChannelId, order.demandMessageId, (0, DemandBuilders_1.buildDemandCard)(data), () => (0, OrderRepository_1.setDemandMessage)(order.id, null, null));
    logger.info('Demanda iniciada.', {
        guildId: guild.id,
        userId: order.assignedToId ?? undefined,
        entityType: 'order',
        entityId: order.id,
        orderNumber: data.orderLabel,
        announced,
        customerNotified,
    });
    return { announced, customerNotified };
}
/**
 * Publica a demanda a partir do id do pedido.
 *
 * E este o atalho que o fluxo de pagamento usa: quem aprova a cobranca tem em
 * maos o pedido sem a cobranca embutida, e o cartao precisa da descricao dela
 * para dizer o que produzir numa venda de balcao.
 *
 * NAO LANCA: a aprovacao do pagamento ja aconteceu quando isto roda.
 */
async function publishDemandById(guild, orderId) {
    try {
        const order = await (0, OrderRepository_1.findOrderById)(orderId);
        if (order === null || order.guildId !== guild.id)
            return false;
        return await publishDemand(guild, order);
    }
    catch (error) {
        logger.warn('Falha ao publicar a demanda apos o pagamento.', {
            guildId: guild.id,
            entityType: 'order',
            entityId: orderId,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/**
 * Releitura + atualizacao, para quem so tem o id.
 *
 * Os handlers de pedido ja recebem o pedido atualizado; este atalho serve a
 * quem muda o estado por outro caminho (o `/entregar`, por exemplo) e nao quer
 * carregar a projecao completa so para atualizar um cartao.
 */
async function refreshDemandById(guild, orderId) {
    const order = await (0, OrderRepository_1.findOrderById)(orderId);
    if (order === null || order.guildId !== guild.id)
        return;
    await refreshDemandCards(guild, order);
}
//# sourceMappingURL=DemandBoardService.js.map