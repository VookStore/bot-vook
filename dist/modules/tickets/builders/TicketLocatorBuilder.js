"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELIVERED_LOCATOR_BUTTON_LABEL = exports.LOCATOR_BUTTON_LABEL = void 0;
exports.buildLocatorButton = buildLocatorButton;
exports.buildTicketLocatorPanel = buildTicketLocatorPanel;
exports.buildDeliveredLocatorButton = buildDeliveredLocatorButton;
exports.buildDeliveredLocatorPanel = buildDeliveredLocatorPanel;
exports.buildLocatorResult = buildLocatorResult;
exports.isRecoverableRejoinError = isRecoverableRejoinError;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const TicketInternalPanelBuilder_1 = require("./TicketInternalPanelBuilder");
/**
 * Painel "Localizar meu ticket", publicado no canal de destino da categoria.
 *
 * POR QUE ELE EXISTE. Com o ticket virando TOPICO PRIVADO, ele nao aparece mais
 * como um canal na barra lateral: some da lista quando o cliente sai do topico,
 * quando o Discord esconde topicos inativos, ou quando ele simplesmente rola a
 * lista para longe. Antes, com um canal por ticket, achar era trivial. O painel
 * devolve esse caminho — e e por isso que ele mora justamente no canal onde os
 * topicos vivem.
 *
 * O QUE ELE FAZ ALEM DE LISTAR. O clique reinsere o cliente no topico. O modo
 * de falha real nao e "nao sei o link", e sim "sai do topico e nao consigo
 * voltar" — um link para topico privado nao readmite ninguem sozinho.
 */
/** Rotulo do botao publicado no canal de destino. */
exports.LOCATOR_BUTTON_LABEL = 'Localizar meu ticket';
function buildLocatorButton(categoryId) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.LOCATE, categoryId))
        .setLabel(exports.LOCATOR_BUTTON_LABEL)
        .setEmoji(branding_1.EMOJIS.SEARCH)
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/**
 * O painel fixo do canal.
 *
 * Mesma anatomia do painel publico de abertura (banner, chamada, botao,
 * assinatura) de proposito: sao duas telas do mesmo sistema, e o cliente que
 * reconhece uma reconhece a outra.
 */
function buildTicketLocatorPanel(config, category) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    if ((0, sanitize_1.isSafeImageUrl)(config.panelBannerUrl)) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([config.panelBannerUrl], config.storeName));
        root.addSeparatorComponents((0, v2_1.separator)());
    }
    root.addTextDisplayComponents((0, v2_1.text)(`### ${branding_1.EMOJIS.SEARCH} Localizar Ticket\n\n` +
        'Nao consegue encontrar seu atendimento?\n' +
        `Toque no botao abaixo para ver seus tickets abertos em **${category.name}** — ` +
        'e voltar para dentro deles.'));
    root.addActionRowComponents((0, v2_1.buttonRow)(buildLocatorButton(category.id)));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Equipe ${config.storeName}`));
    return root;
}
// ---------------------------------------------------------------------------
// Canal de entregas
// ---------------------------------------------------------------------------
exports.DELIVERED_LOCATOR_BUTTON_LABEL = 'Localizar minha entrega';
function buildDeliveredLocatorButton() {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.LOCATE_DELIVERED))
        .setLabel(exports.DELIVERED_LOCATOR_BUTTON_LABEL)
        .setEmoji(branding_1.EMOJIS.SEARCH)
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/**
 * O painel fixo do canal de entregas.
 *
 * POR QUE ELE EXISTE. Na entrega, o topico do ticket e arquivado — sai da lista
 * lateral sem fechar —, e o cliente que fecha a DM ou rola o servidor perde o
 * caminho de volta. E justamente la dentro que ele baixa o arquivo, tira duvida
 * e confirma o recebimento. Este canal so aparece para quem tem entrega
 * pendente, e o painel devolve o caminho.
 *
 * Mesma anatomia do localizador das categorias: o cliente que conhece um
 * reconhece o outro.
 */
function buildDeliveredLocatorPanel(config) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    if ((0, sanitize_1.isSafeImageUrl)(config.panelBannerUrl)) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([config.panelBannerUrl], config.storeName));
        root.addSeparatorComponents((0, v2_1.separator)());
    }
    root.addTextDisplayComponents((0, v2_1.text)(`### ${branding_1.EMOJIS.PACKAGE} Seu pedido foi entregue?\n\n` +
        'Toque no botão abaixo para voltar ao atendimento da sua entrega — é lá que você ' +
        'baixa o arquivo, tira dúvidas e **confirma o recebimento**.'));
    root.addActionRowComponents((0, v2_1.buttonRow)(buildDeliveredLocatorButton()));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Este canal fica visível enquanto você tiver uma entrega para confirmar. Equipe ${config.storeName}`));
    return root;
}
function statusLine(entry) {
    if (!entry.reachable) {
        return `${branding_1.EMOJIS.DISABLE} conversa indisponivel — avise a equipe`;
    }
    // Entregue vem antes de "em atendimento": e a unica coisa que falta ao
    // cliente fazer, e o botao de confirmar esta la dentro.
    //
    // `instanceof Date`, e nao `!== null`: "entregue" e TER uma data de entrega.
    // Um ticket montado pela metade (projecao parcial, cache antigo) traz o campo
    // `undefined`, e `undefined !== null` o faria aparecer como entregue.
    if (entry.ticket.deliveredAt instanceof Date) {
        return `${branding_1.EMOJIS.PACKAGE} produto entregue — confirme o recebimento no ticket`;
    }
    if (entry.ticket.claimedById !== null) {
        return `${branding_1.EMOJIS.CLAIM} em atendimento`;
    }
    return entry.queuePosition > 0
        ? `${branding_1.EMOJIS.QUEUE} na fila, posicao #${entry.queuePosition}`
        : `${branding_1.EMOJIS.QUEUE} aguardando atendimento`;
}
/**
 * Resposta efemera do clique.
 *
 * Um botao de LINK por ticket, ate o teto de uma linha. Link nao gera
 * interacao: a mensagem efemera some sozinha e o botao continua valendo
 * enquanto ela estiver na tela.
 */
function buildLocatorResult(guildId, categoryName, entries, 
/**
 * Frase de "nao achei nada". O padrao fala do painel de abertura, que e o
 * caminho certo no canal de uma categoria; no canal de entregas o cliente sem
 * entrega pendente nao precisa abrir ticket nenhum.
 */
options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    if (entries.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)(options.emptyMessage ??
            `${branding_1.EMOJIS.SEARCH} **Nenhum ticket aberto em ${categoryName}.**\n` +
                'Use o painel de atendimento para abrir um novo — assim que ele existir, ' +
                'este botao traz voce de volta para dentro dele.'));
        return root;
    }
    const shown = entries.slice(0, limits_1.DISCORD_LIMITS.BUTTONS_PER_ROW);
    root.addTextDisplayComponents((0, v2_1.text)(shown
        .map((entry) => {
        const numero = (0, TicketInternalPanelBuilder_1.formatTicketNumber)(entry.ticket.ticketNumber);
        const assunto = (0, sanitize_1.truncate)(entry.ticket.subject.replace(/\s+/g, ' ').trim(), 120);
        const readmitido = entry.rejoined ? '\n-# Voce foi readicionado a este topico.' : '';
        return `**${numero}** — ${statusLine(entry)}\n-# ${assunto}${readmitido}`;
    })
        .join('\n\n')));
    const links = shown
        .filter((entry) => entry.reachable && entry.ticket.channelId !== null)
        .map((entry) => new discord_js_1.ButtonBuilder()
        .setStyle(discord_js_1.ButtonStyle.Link)
        .setLabel((0, sanitize_1.truncate)((0, TicketInternalPanelBuilder_1.formatTicketNumber)(entry.ticket.ticketNumber), limits_1.DISCORD_LIMITS.BUTTON_LABEL))
        .setURL((0, discord_1.channelUrl)(guildId, entry.ticket.channelId)));
    if (links.length > 0) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addActionRowComponents((0, v2_1.buttonRow)(...links));
    }
    if (entries.length > shown.length) {
        root.addTextDisplayComponents((0, v2_1.footerNote)(`Exibindo ${shown.length} de ${entries.length} atendimentos abertos.`));
    }
    return root;
}
/**
 * Falha de readmissao que NAO deve derrubar a tela.
 *
 * Sem permissao para adicionar membro, o cliente ainda ve a lista e o link — e
 * o link funciona se ele nunca chegou a sair do topico. Perder a tela inteira
 * por causa da readmissao seria trocar um problema parcial por um total.
 */
function isRecoverableRejoinError(error) {
    return (0, discord_1.isMissingAccessError)(error);
}
//# sourceMappingURL=TicketLocatorBuilder.js.map