"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketDoneCard = buildTicketDoneCard;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const v2_1 = require("../../../components/v2");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const time_1 = require("../../../utils/time");
function detailLines(data) {
    const linhas = [
        `${branding_1.EMOJIS.TICKET} **Ticket:** \`${data.ticketLabel}\`  •  ${branding_1.EMOJIS.TICKET_FOLDER} ${(0, sanitize_1.escapeMarkdownLayout)(data.categoryName)}`,
        `${branding_1.EMOJIS.ROLE} **Cliente:** ${(0, discord_1.userMention)(data.customerId)}`,
    ];
    if (data.staffId !== null) {
        linhas.push(`${branding_1.EMOJIS.CLAIM} **Atendente:** ${(0, discord_1.userMention)(data.staffId)}`);
    }
    if (data.orderLabel !== null) {
        linhas.push(`${branding_1.EMOJIS.RECEIPT} **Pedido:** \`${data.orderLabel}\``);
    }
    if (data.deliveredAt !== null) {
        const por = data.deliveredById === null ? '' : ` por ${(0, discord_1.userMention)(data.deliveredById)}`;
        linhas.push(`${branding_1.EMOJIS.DELIVER} **Entregue${por}** • ${(0, time_1.discordTimestamp)(data.deliveredAt, 'f')}`);
    }
    return linhas.join('\n');
}
function statusBlock(data) {
    if (data.state === 'aguardando') {
        return (`${branding_1.EMOJIS.PACKAGE} **Aguardando o cliente confirmar o recebimento.**\n` +
            '-# O ticket saiu da lista de ativos, mas continua aberto: se o cliente responder, ele volta sozinho.');
    }
    const quando = data.closedAt === null ? '' : ` ${(0, time_1.discordTimestamp)(data.closedAt, 'R')}`;
    if (data.state === 'cliente') {
        return `${branding_1.EMOJIS.APPROVE} **Concluído pelo cliente**${quando} — recebimento confirmado.`;
    }
    const quem = data.closedById === null ? '' : ` por ${(0, discord_1.userMention)(data.closedById)}`;
    return (`${branding_1.EMOJIS.LOCK} **Encerrado pela equipe**${quem}${quando}.\n` +
        '-# O cliente não chegou a confirmar o recebimento.');
}
function subtitle(data) {
    if (data.state === 'aguardando')
        return '-# Produto entregue, esperando o cliente.';
    return '-# Atendimento concluído.';
}
/**
 * Botoes de link, e so de link: o cartao nao opera nada.
 *
 * O topico continua abrindo depois de fechado (arquivado e trancado, so
 * leitura), entao o atalho segue util como historico. O transcript entra
 * quando existe — e a versao que sobrevive mesmo se o topico for apagado.
 */
function buttons(data) {
    const lista = [];
    if (data.ticketChannelId !== null) {
        lista.push(new discord_js_1.ButtonBuilder()
            .setStyle(discord_js_1.ButtonStyle.Link)
            .setLabel(`Abrir ticket ${data.ticketLabel}`)
            .setEmoji(branding_1.EMOJIS.TICKET)
            .setURL((0, discord_1.channelUrl)(data.guildId, data.ticketChannelId)));
    }
    if (data.state !== 'aguardando' && data.transcriptUrl !== null) {
        lista.push(new discord_js_1.ButtonBuilder()
            .setStyle(discord_js_1.ButtonStyle.Link)
            .setLabel('Ver transcript')
            .setEmoji(branding_1.EMOJIS.LIST)
            .setURL(data.transcriptUrl));
    }
    return lista;
}
function buildTicketDoneCard(data) {
    const root = (0, v2_1.container)(data.state === 'aguardando' ? branding_1.COLORS.INFO : branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, `${branding_1.EMOJIS.APPROVE} ${branding_1.TITLES.TICKET_DONE}`, { subtitle: subtitle(data) });
    root.addTextDisplayComponents((0, v2_1.text)(detailLines(data)));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(statusBlock(data)));
    const lista = buttons(data);
    if (lista.length > 0) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)(...lista));
    }
    root.addTextDisplayComponents((0, v2_1.footerNote)('Este cartão acompanha o atendimento até o fim e fica como registro.'));
    /*
     * Pior caso dos 10 filhos do Container: titulo, subtitulo e separador (3),
     * dados (4), separador (5), estado (6), separador (7), botoes (8) e rodape (9).
     */
    return root;
}
//# sourceMappingURL=TicketDoneBuilder.js.map