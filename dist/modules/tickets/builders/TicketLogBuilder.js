"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCloseLog = buildCloseLog;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const v2_1 = require("../../../components/v2");
const money_1 = require("../../../utils/money");
const time_1 = require("../../../utils/time");
const discord_1 = require("../../../utils/discord");
const TicketInternalPanelBuilder_1 = require("./TicketInternalPanelBuilder");
/** Registro de encerramento enviado ao canal de logs, com o transcript anexado. */
function buildCloseLog(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.NEUTRAL);
    (0, v2_1.addHeader)(root, branding_1.TITLES.TICKET_LOG);
    /*
     * UMA LINHA POR DADO.
     *
     * A versao anterior usava `fields()`: rotulo numa linha, valor na seguinte,
     * linha em branco entre cada um. Onze dados viravam trinta e tres linhas, e a
     * equipe rolava a tela inteira para achar o motivo do encerramento. Aqui cada
     * dado ocupa uma linha e os relacionados dividem a mesma.
     */
    root.addTextDisplayComponents((0, v2_1.text)([
        `**Ticket** \`${(0, TicketInternalPanelBuilder_1.formatTicketNumber)(data.ticketNumber)}\`  •  **Categoria** ${data.categoryName}`,
        `**Cliente** ${(0, discord_1.userMention)(data.ownerId)}  •  **Responsavel** ${data.staffId !== null ? (0, discord_1.userMention)(data.staffId) : 'nao atribuido'}`,
        `**Assunto** ${data.subject}`,
    ].join('\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    /*
     * As tres datas viram UMA linha. Separadas, "Criado", "Finalizado" e
     * "Duracao" gastavam nove linhas para dizer uma coisa so: quanto tempo o
     * atendimento levou.
     */
    const detalhes = [
        `${branding_1.EMOJIS.LOCK} **Encerrado por** ${(0, discord_1.userMention)(data.closedById)}  •  ` +
            `**Duracao** ${(0, money_1.formatDuration)(data.durationMs)}`,
        `-# Aberto ${(0, time_1.discordTimestamp)(data.openedAt, 'f')} · finalizado ${(0, time_1.discordTimestamp)(data.closedAt, 'f')}`,
        `-# Motivo: ${data.closeReason ?? 'nenhum informado.'}`,
    ];
    if (data.participantIds.length > 0) {
        detalhes.push(`-# Participantes: ${data.participantIds.map(discord_1.userMention).join(', ')}`);
    }
    root.addTextDisplayComponents((0, v2_1.text)(detalhes.join('\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    /*
     * O link e melhor que o anexo e por isso vem antes dele no texto: o anexo e
     * cortado pela metade quando passa dos 20 MiB do Discord, enquanto a versao
     * hospedada guarda a conversa inteira. O anexo continua indo junto como copia
     * de seguranca, para o historico nao depender de um servico externo.
     */
    if (data.transcriptUrl !== undefined) {
        root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
            .setStyle(discord_js_1.ButtonStyle.Link)
            .setLabel('Abrir transcript completo')
            .setEmoji(branding_1.EMOJIS.LIST)
            .setURL(data.transcriptUrl)));
    }
    root.addTextDisplayComponents((0, v2_1.footerNote)(data.transcriptUrl === undefined
        ? `${data.messageCount} mensagem(ns) registrada(s) no transcript anexo.`
        : `${data.messageCount} mensagem(ns). O anexo pode vir reduzido; o link traz tudo.`));
    return root;
}
//# sourceMappingURL=TicketLogBuilder.js.map