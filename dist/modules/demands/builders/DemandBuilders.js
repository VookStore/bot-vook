"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDemandCard = buildDemandCard;
exports.buildDemandStartedCard = buildDemandStartedCard;
exports.buildDemandDoneCard = buildDemandDoneCard;
exports.buildDemandStartedDm = buildDemandStartedDm;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const branding_1 = require("../../../constants/branding");
const limits_1 = require("../../../constants/limits");
const customIds_1 = require("../../../constants/customIds");
const v2_1 = require("../../../components/v2");
const discord_1 = require("../../../utils/discord");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
const time_1 = require("../../../utils/time");
const ITEM_MAX = 6;
function demandButton(action, emoji, label, orderId) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ORDER, action, orderId))
        .setEmoji(emoji)
        .setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.BUTTON_LABEL))
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/**
 * O que produzir.
 *
 * Lista de itens quando a venda veio do catalogo; a descricao da cobranca
 * quando veio do balcao. Um dos dois sempre existe — se nao existisse, a
 * demanda nao teria conteudo.
 */
function whatToBuild(data) {
    if (data.items.length > 0) {
        const linhas = data.items
            .slice(0, ITEM_MAX)
            .map((item) => `• ${(0, sanitize_1.escapeMarkdownLayout)(item.name)}` +
            (item.quantity > 1 ? ` ×${item.quantity}` : '') +
            ` — ${(0, money_1.formatCents)(item.priceCents)}`);
        if (data.items.length > ITEM_MAX) {
            linhas.push(`-# e mais ${data.items.length - ITEM_MAX} item(ns) — abra o pedido para ver.`);
        }
        return `${branding_1.EMOJIS.PACKAGE} **O que produzir**\n${linhas.join('\n')}`;
    }
    if (data.description !== null && data.description.length > 0) {
        return `${branding_1.EMOJIS.PACKAGE} **O que produzir**\n> ${(0, sanitize_1.escapeMarkdownLayout)(data.description)}`;
    }
    return `${branding_1.EMOJIS.PACKAGE} **O que produzir**\n> -# Sem descrição — abra o pedido para ver a cobrança.`;
}
function ownerLine(data) {
    return data.assignedToId === null
        ? `${branding_1.EMOJIS.PENDING} **Responsável:** livre na fila`
        : `${branding_1.EMOJIS.CLAIM} **Responsável:** ${(0, discord_1.userMention)(data.assignedToId)}`;
}
function dueLine(data) {
    if (data.dueAt === null)
        return null;
    const rotulo = data.overdue ? '**Previsão (atrasado)**' : '**Previsão de entrega**';
    return `${branding_1.EMOJIS.QUEUE} ${rotulo}: ${(0, time_1.discordTimestamp)(data.dueAt, 'D')}`;
}
/**
 * Botao que leva a conversa com o cliente.
 *
 * O rotulo muda porque o destino muda: a venda de balcao nasce DENTRO do
 * ticket, e ai o botao leva ao atendimento com numero e tudo; a compra pelo
 * catalogo nasce no canal da loja, e prometer "atendimento" ali seria mentira.
 */
function ticketButton(data) {
    if (data.ticketChannelId === null)
        return null;
    return new discord_js_1.ButtonBuilder()
        .setStyle(discord_js_1.ButtonStyle.Link)
        .setLabel(data.ticketLabel === null ? 'Ir ao canal da compra' : `Ticket ${data.ticketLabel}`)
        .setEmoji(branding_1.EMOJIS.TICKET)
        .setURL((0, discord_1.channelUrl)(data.guildId, data.ticketChannelId));
}
/**
 * Botoes do estado ATUAL, e so eles.
 *
 * Um botao que so sabe responder "essa transicao nao vale agora" ensina a
 * equipe a ignorar o cartao. A ordem poe na frente a acao que o estado pede:
 * pago espera comecar, em producao espera entregar, entregue espera concluir.
 */
function statusButtons(data) {
    const { orderId } = data;
    if (data.status === client_1.OrderStatus.PAID) {
        return [
            demandButton(customIds_1.ORDER_ACTION.PROGRESS, branding_1.EMOJIS.PREPARING, 'Iniciar demanda', orderId),
            data.assignedToId === null
                ? demandButton(customIds_1.ORDER_ACTION.CLAIM, branding_1.EMOJIS.CLAIM, 'Assumir', orderId)
                : demandButton(customIds_1.ORDER_ACTION.RELEASE, branding_1.EMOJIS.BACK, 'Liberar', orderId),
        ];
    }
    if (data.status === client_1.OrderStatus.IN_PROGRESS) {
        return [
            demandButton(customIds_1.ORDER_ACTION.DELIVER, branding_1.EMOJIS.DELIVER, 'Marcar entregue', orderId),
            data.assignedToId === null
                ? demandButton(customIds_1.ORDER_ACTION.CLAIM, branding_1.EMOJIS.CLAIM, 'Assumir', orderId)
                : demandButton(customIds_1.ORDER_ACTION.RELEASE, branding_1.EMOJIS.BACK, 'Liberar', orderId),
        ];
    }
    if (data.status === client_1.OrderStatus.DELIVERED) {
        return [demandButton(customIds_1.ORDER_ACTION.COMPLETE, branding_1.EMOJIS.APPROVE, 'Concluir', orderId)];
    }
    // Concluida ou cancelada: nao ha transicao a oferecer, so o historico.
    return [];
}
function buildBody(data, root) {
    const linhas = [
        `## ${(0, money_1.formatCents)(data.totalCents)}`,
        `**Pedido** \`${data.orderLabel}\`  •  **Cliente** ${(0, discord_1.userMention)(data.customerId)}`,
        `${data.statusIcon} ${(0, sanitize_1.escapeMarkdownLayout)(data.statusLabel)}`,
        ownerLine(data),
        dueLine(data),
    ].filter((linha) => linha !== null);
    root.addTextDisplayComponents((0, v2_1.text)(linhas.join('\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(whatToBuild(data)));
}
function buildActions(data, root) {
    const botoes = [
        ...statusButtons(data),
        ticketButton(data),
        demandButton(customIds_1.ORDER_ACTION.STAFF, branding_1.EMOJIS.LIST, 'Abrir pedido', data.orderId),
    ].filter((botao) => botao !== null);
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(...botoes.slice(0, limits_1.DISCORD_LIMITS.BUTTONS_PER_ROW)));
}
/**
 * O cartao do QUADRO: nasce quando o pedido e pago e e reescrito a cada
 * mudanca de estado, no mesmo lugar.
 *
 * Ele nao some quando a demanda e iniciada — passa a dizer quem esta cuidando.
 * O quadro conta a historia inteira do que entrou; o canal de iniciadas conta
 * so o que esta em producao agora.
 */
function buildDemandCard(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, `${branding_1.EMOJIS.PACKAGE} ${branding_1.TITLES.DEMAND}`, {
        subtitle: data.status === client_1.OrderStatus.PAID
            ? '-# Pago e aguardando produção.'
            : `-# ${(0, sanitize_1.escapeMarkdownLayout)(data.statusLabel)}.`,
    });
    buildBody(data, root);
    buildActions(data, root);
    root.addTextDisplayComponents((0, v2_1.footerNote)('Somente a equipe da Vook Store consegue operar esta demanda.'));
    /*
     * Pior caso dos 10 filhos do Container: titulo, subtitulo e separador (3),
     * corpo (4), separador (5), o que produzir (6), separador (7), botoes (8) e
     * rodape (9).
     */
    return root;
}
/**
 * A copia publicada quando a producao COMECA.
 *
 * Mesmo conteudo do quadro, com uma diferenca que e o motivo de este canal
 * existir: ele diz QUANDO comecou e QUEM pegou. Quem olha aqui quer saber o que
 * esta em andamento agora, nao o que ja entrou algum dia.
 */
function buildDemandStartedCard(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, `${branding_1.EMOJIS.PREPARING} ${branding_1.TITLES.DEMAND_STARTED}`, {
        subtitle: data.startedAt === null
            ? '-# Produção iniciada.'
            : `-# Produção iniciada ${(0, time_1.discordTimestamp)(data.startedAt, 'R')}.`,
    });
    buildBody(data, root);
    buildActions(data, root);
    root.addTextDisplayComponents((0, v2_1.footerNote)('Este cartão acompanha a demanda até ela ser concluída.'));
    return root;
}
/**
 * O cartao no canal de demandas CONCLUIDAS, publicado na entrega.
 *
 * "Concluida" do ponto de vista da producao: o arquivo saiu, nao ha mais o que
 * fazer. O pedido ainda pode estar ENTREGUE esperando o cliente confirmar — e o
 * subtitulo diz isso, para ninguem achar que a venda fechou quando nao fechou.
 * Quando o cliente confirma, o mesmo cartao e reescrito como concluido.
 */
function buildDemandDoneCard(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.SUCCESS);
    const quando = data.deliveredAt === null ? '' : ` ${(0, time_1.discordTimestamp)(data.deliveredAt, 'R')}`;
    const subtitulo = data.status !== client_1.OrderStatus.COMPLETED
        ? `-# Entregue${quando} — aguardando a confirmação do cliente.`
        : data.completedByCustomer
            ? '-# Concluída: o cliente confirmou o recebimento.'
            : '-# Concluída pela equipe.';
    (0, v2_1.addHeader)(root, `${branding_1.EMOJIS.APPROVE} ${branding_1.TITLES.DEMAND_DONE}`, { subtitle: subtitulo });
    buildBody(data, root);
    buildActions(data, root);
    root.addTextDisplayComponents((0, v2_1.footerNote)('Este cartão fica aqui como registro da demanda.'));
    return root;
}
/**
 * DM de "comecamos a produzir".
 *
 * E o unico aviso entre "paguei" e "recebi", e ate aqui esse intervalo era
 * silencio — o cliente pagava e so ouvia falar da loja de novo na entrega.
 * Encomenda demora dias; saber que o trabalho comecou e o que segura a
 * ansiedade (e as mensagens perguntando se esta tudo bem).
 *
 * NAO promete data que a loja nao tenha assumido: a previsao so entra quando
 * ela existe no pedido, e foi congelada no pagamento.
 */
function buildDemandStartedDm(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, `${branding_1.EMOJIS.PREPARING} ${branding_1.TITLES.DEMAND_STARTED}`, {
        subtitle: `-# Seu pedido na ${(0, sanitize_1.escapeMarkdownLayout)(data.storeName)} entrou em produção.`,
    });
    const quem = data.assignedToId === null
        ? 'Nossa equipe'
        : `${(0, discord_1.userMention)(data.assignedToId)}, da nossa equipe,`;
    root.addTextDisplayComponents((0, v2_1.text)(`Olá, ${(0, discord_1.userMention)(data.customerId)}! Boas notícias: ${quem} começou a trabalhar no ` +
        `seu pedido \`${data.orderLabel}\` agora.`));
    const detalhes = [
        `${branding_1.EMOJIS.RECEIPT} **Pedido:** \`${data.orderLabel}\``,
        data.dueAt === null
            ? null
            : `${branding_1.EMOJIS.QUEUE} **${data.overdue ? 'Previsão (atrasada)' : 'Previsão de entrega'}:** ` +
                (0, time_1.discordTimestamp)(data.dueAt, 'D'),
        data.ticketLabel === null
            ? null
            : `${branding_1.EMOJIS.TICKET} **Atendimento:** \`${data.ticketLabel}\``,
    ].filter((linha) => linha !== null);
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(detalhes.join('\n')));
    if (data.ticketChannelId !== null) {
        root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
            .setStyle(discord_js_1.ButtonStyle.Link)
            .setLabel('Ir ao atendimento')
            .setEmoji(branding_1.EMOJIS.TICKET)
            .setURL((0, discord_1.channelUrl)(data.guildId, data.ticketChannelId))));
    }
    root.addTextDisplayComponents((0, v2_1.footerNote)('Qualquer dúvida, é só responder no seu atendimento — a equipe acompanha por lá.'));
    return root;
}
//# sourceMappingURL=DemandBuilders.js.map