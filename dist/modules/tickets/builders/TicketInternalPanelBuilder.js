"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTicketNumber = formatTicketNumber;
exports.hasCustomerHistory = hasCustomerHistory;
exports.describeCustomer = describeCustomer;
exports.buildInternalPanel = buildInternalPanel;
exports.buildAdminPanel = buildAdminPanel;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const v2_1 = require("../../../components/v2");
const sanitize_1 = require("../../../utils/sanitize");
const discord_1 = require("../../../utils/discord");
const money_1 = require("../../../utils/money");
const time_1 = require("../../../utils/time");
/**
 * URL de imagem pronta para entrar no payload, ou null.
 *
 * `isSafeImageUrl(x) ? x : null` valida um texto e envia OUTRO: a validacao
 * roda sobre a forma normalizada e o payload recebe o valor cru, entao
 * `" https://cdn/x.png "` passa e chega a API com os espacos. Aqui o valor
 * enviado e exatamente o valor validado.
 *
 * `attachment://` tambem cai fora: o sanitizador o aceita porque o bot usa
 * esse esquema para anexos que ele mesmo manda (QR code, transcript), mas esta
 * mensagem nao carrega anexo nenhum. Com ele no payload o Discord responde 400
 * e derruba a criacao do ticket e todo refresh de painel; sem ele, o pior caso
 * e um painel sem imagem.
 */
function panelImageUrl(input) {
    let url;
    try {
        url = (0, sanitize_1.sanitizeImageUrl)(input);
    }
    catch {
        return null;
    }
    return url === null || url.startsWith('attachment://') ? null : url;
}
/** Numero do ticket formatado: 153 -> "#0153". */
function formatTicketNumber(ticketNumber) {
    return `#${String(ticketNumber).padStart(4, '0')}`;
}
/**
 * Prepara um valor para ir DENTRO de um bloco de codigo.
 *
 * Sem isso, um assunto contendo ``` fecharia o bloco e o resto do texto
 * (inclusive markdown do usuario) passaria a ser interpretado — quebra de
 * layout e, com um pouco de criatividade, spoofing do painel. A crase e
 * substituida por um sosia visual que nao tem significado em markdown.
 */
function codeSafe(value, max = 200) {
    const cleaned = value
        .replace(/`/g, 'ˋ')
        // Todo terminador de linha, nao so LF e CRLF: um CR solitario sobrevivia a
        // `/\r?\n/` e ia cru para o payload. Nao chega a abrir o bloco (fechar
        // exige crase, e nenhuma sobra), mas o contrato desta funcao e devolver
        // UMA linha limpa — e ela e a ultima defesa antes do markdown.
        .replace(/[\r\n\u2028\u2029]+/g, ' ')
        .trim();
    return (0, sanitize_1.truncate)(cleaned.length > 0 ? cleaned : '—', max);
}
/** Campo rotulado com o valor dentro de um bloco de codigo. */
function boxedField(icon, label, value) {
    return `${icon} **${label}:**\n\`\`\`\n${codeSafe(value)}\n\`\`\``;
}
/**
 * True quando ha algo que valha uma linha no painel.
 *
 * Cliente novo — sem compra, sem pedido aberto, sem carrinho — nao gera bloco:
 * "0 pedidos · R$ 0,00" ocuparia espaco para nao informar nada, e esse e o caso
 * mais comum de todos.
 */
function hasCustomerHistory(customer) {
    return customer.paidOrders > 0 || customer.openOrders > 0 || customer.cartItems > 0;
}
/**
 * Resumo do cliente em UMA linha.
 *
 * Cada parte so entra quando tem valor: um cliente sem carrinho nao merece
 * "carrinho: 0", e um pedido aberto e informacao acionavel enquanto zero nao e.
 */
function describeCustomer(customer) {
    const partes = [];
    if (customer.paidOrders > 0) {
        const plural = customer.paidOrders === 1 ? 'compra' : 'compras';
        partes.push(`${customer.paidOrders} ${plural} · ${(0, money_1.formatCents)(customer.spentCents)}`);
    }
    else {
        partes.push('nunca comprou');
    }
    if (customer.lastPurchaseAt !== null) {
        partes.push(`ultima em ${(0, time_1.formatDateBR)(customer.lastPurchaseAt)}`);
    }
    if (customer.openOrders > 0) {
        partes.push(`${customer.openOrders} pedido(s) em aberto`);
    }
    if (customer.cartItems > 0) {
        partes.push(`${customer.cartItems} item(ns) no carrinho`);
    }
    return partes.join(' · ');
}
/**
 * Texto do campo "Responsavel".
 *
 * Prefere o nome resolvido; sem ele, cai no id em vez de fingir que ninguem
 * assumiu — o ticket ESTA atribuido, e esconder isso e pior que mostrar o id.
 */
function responsibleLabel(data) {
    const { claimedById } = data.ticket;
    if (claimedById === null)
        return 'Nao atribuido';
    const name = data.claimedByName;
    return name === null || name === undefined || name.trim().length === 0
        ? `Atendente ${claimedById}`
        : name;
}
function statusLabel(ticket, queuePosition) {
    switch (ticket.status) {
        case client_1.TicketStatus.CREATING:
            return branding_1.STATUS_LABEL.CREATING;
        case client_1.TicketStatus.OPEN:
            return queuePosition > 0
                ? `${branding_1.STATUS_LABEL.WAITING} — ${queuePosition}o na fila`
                : branding_1.STATUS_LABEL.WAITING;
        case client_1.TicketStatus.CLAIMED:
            return branding_1.STATUS_LABEL.IN_PROGRESS;
        case client_1.TicketStatus.CLOSING:
            return branding_1.STATUS_LABEL.CLOSING;
        case client_1.TicketStatus.CLOSED:
            return branding_1.STATUS_LABEL.CLOSED;
        case client_1.TicketStatus.ORPHANED:
            return branding_1.STATUS_LABEL.ORPHANED;
        default:
            return branding_1.STATUS_LABEL.WAITING;
    }
}
function accentFor(ticket) {
    switch (ticket.status) {
        case client_1.TicketStatus.CLAIMED:
            return branding_1.COLORS.SUCCESS;
        case client_1.TicketStatus.CLOSING:
        case client_1.TicketStatus.CLOSED:
            return branding_1.COLORS.NEUTRAL;
        case client_1.TicketStatus.ORPHANED:
            return branding_1.COLORS.DANGER;
        default:
            return branding_1.COLORS.WARNING;
    }
}
/**
 * Painel interno do ticket (mensagem fixa no canal do atendimento).
 *
 * Layout: cabecalho com a logo -> dados em blocos rotulados -> banner ->
 * botoes. Os botoes usam o id do ticket no customId, entao continuam validos
 * depois de qualquer restart.
 *
 * Orcamento de componentes (limite 10 por container), MEDIDO no pior caso:
 * cabecalho(2) + separador(1) + dados(1) + separador(1) + banner(1) +
 * separador(1) + action row(1) = 8, sobrando dois.
 *
 * O cabecalho custa DOIS componentes quando nao ha logo — titulo e saudacao
 * viram dois TextDisplay em vez de uma Section unica —, entao o arranjo mais
 * caro e justamente "sem logo, com banner", e nao o painel completo.
 * `tests/ticket-internal-panel.test.ts` fixa esse 8: quem adicionar um bloco
 * novo ve o teste quebrar, e nao um 400 no canal do cliente.
 */
function buildInternalPanel(data) {
    const { ticket } = data;
    const root = (0, v2_1.container)(accentFor(ticket));
    const heading = `## ${branding_1.EMOJIS.TICKET_FOLDER} ${branding_1.TITLES.TICKET_INTERNAL}`;
    const greeting = `Ola ${(0, discord_1.userMention)(ticket.ownerId)}, seja bem-vindo ao seu ticket.\n` +
        'Aqui voce podera falar diretamente com a nossa equipe, que ja esta ciente ' +
        'da sua abertura e ira esclarecer suas duvidas o mais rapido possivel.\n' +
        'Basta aguardar e ja sera atendido.';
    const thumbnailUrl = panelImageUrl(data.thumbnailUrl);
    if (thumbnailUrl !== null) {
        root.addSectionComponents((0, v2_1.sectionWithThumbnail)([heading, greeting], thumbnailUrl, data.storeName ?? 'Vook Store'));
    }
    else {
        root.addTextDisplayComponents((0, v2_1.text)(heading), (0, v2_1.text)(greeting));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    const blocks = [
        boxedField('📂', 'Categoria do Atendimento', data.categoryName),
        boxedField('🎫', 'ID do Ticket', formatTicketNumber(ticket.ticketNumber)),
        boxedField('💬', 'Assunto do Ticket', ticket.subject),
        boxedField('📌', 'Status', statusLabel(ticket, data.queuePosition)),
        boxedField('👤', 'Responsavel', responsibleLabel(data)),
    ];
    if (data.participantIds.length > 0) {
        blocks.push(boxedField('👥', 'Participantes adicionais', `${data.participantIds.length} membro(s) com acesso`));
    }
    /*
     * Pedidos do atendimento.
     *
     * Toda cobranca gerada aqui dentro abre um pedido, e e por este numero que a
     * equipe acha a venda depois — no painel comercial, no comprovante e no
     * historico do cliente. Sem a linha, o numero so existia na mensagem da
     * cobranca, que some canal acima.
     *
     * NAO custa componente: entra no mesmo TextDisplay dos outros blocos, entao o
     * orcamento medido de 8 filhos continua valendo.
     */
    const orderRefs = data.orderRefs ?? [];
    if (orderRefs.length > 0) {
        blocks.push(boxedField('🧾', 'Pedidos deste atendimento', orderRefs.join(' | ')));
    }
    /*
     * Historico do cliente.
     *
     * Diz COM QUEM a equipe esta falando antes da primeira mensagem. Ate aqui o
     * painel so mostrava os pedidos DESTE canal, entao quem comprou dez vezes e
     * quem nunca comprou chegavam identicos na tela.
     *
     * So aparece para quem tem historico: um bloco dizendo "0 pedidos · R$ 0,00"
     * ocuparia espaco para informar nada, e o caso comum e justamente o cliente
     * novo. Tambem NAO custa componente — entra no mesmo TextDisplay.
     */
    const customer = data.customer;
    if (customer !== undefined && customer !== null && hasCustomerHistory(customer)) {
        blocks.push(boxedField('👛', 'Historico do cliente', describeCustomer(customer)));
    }
    root.addTextDisplayComponents((0, v2_1.text)(blocks.join('\n')));
    const bannerUrl = panelImageUrl(data.bannerUrl);
    if (bannerUrl !== null) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([bannerUrl], data.storeName ?? 'Vook Store'));
    }
    /*
     * Ping da equipe no rodape.
     *
     * Antes existia uma segunda mensagem so para isso. Ao remove-la o ping teve
     * de vir para ca: mensagem V2 nao aceita o campo `content` (a flag
     * IsComponentsV2 faz a API recusar), entao a mencao precisa estar dentro de
     * um TextDisplay para notificar de verdade.
     */
    const equipe = (data.teamRoleIds ?? []).filter((roleId) => roleId.length > 0);
    if (equipe.length > 0) {
        root.addTextDisplayComponents((0, v2_1.text)(`-# ${equipe.map((roleId) => `<@&${roleId}>`).join(' ')}`));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(...buildPanelButtons(ticket)));
    return root;
}
function buildPanelButtons(ticket) {
    const finished = ticket.status === client_1.TicketStatus.CLOSED ||
        ticket.status === client_1.TicketStatus.CLOSING ||
        ticket.status === client_1.TicketStatus.ORPHANED;
    const claimed = ticket.claimedById !== null;
    return [
        new discord_js_1.ButtonBuilder()
            .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.CLAIM, ticket.id))
            .setLabel(claimed ? 'Ticket Assumido' : 'Assumir Ticket')
            .setEmoji(claimed ? branding_1.EMOJIS.APPROVE : branding_1.EMOJIS.CLAIM)
            .setStyle(discord_js_1.ButtonStyle.Secondary)
            .setDisabled(finished || claimed),
        new discord_js_1.ButtonBuilder()
            .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.REFRESH, ticket.id))
            .setLabel('Atualizar')
            .setEmoji(branding_1.EMOJIS.REFRESH)
            .setStyle(discord_js_1.ButtonStyle.Secondary)
            .setDisabled(finished),
        new discord_js_1.ButtonBuilder()
            .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.ADMIN, ticket.id))
            .setLabel('Painel Admin')
            .setEmoji(branding_1.EMOJIS.LOCK)
            .setStyle(discord_js_1.ButtonStyle.Secondary)
            .setDisabled(finished),
        new discord_js_1.ButtonBuilder()
            .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.CLOSE, ticket.id))
            .setLabel('Finalizar Ticket')
            .setEmoji(branding_1.EMOJIS.CLOSE)
            .setStyle(discord_js_1.ButtonStyle.Secondary)
            .setDisabled(finished),
    ];
}
/**
 * Rotulo da prioridade, para a equipe.
 *
 * So aparece no painel ADMINISTRATIVO, nunca no painel do canal. Quem decide
 * qual ticket pegar e a equipe, entao e ali que o sinal e acionavel; mostrar
 * "Prioridade: Normal" para o cliente so convidaria a pergunta de por que o
 * dele nao e mais alta.
 */
const PRIORITY_LABEL = {
    [client_1.TicketPriority.NORMAL]: 'Normal',
    [client_1.TicketPriority.HIGH]: 'Alta — parado na fila',
    [client_1.TicketPriority.URGENT]: 'Urgente — parado na fila ha bastante tempo',
    [client_1.TicketPriority.VIP]: 'VIP — cliente com pedido em aberto',
};
/** Bloco "• Titulo" + descricao curta, no estilo do painel de referencia. */
function adminItem(title, description) {
    return `• **${title}**\n-# ${description}`;
}
/**
 * Painel administrativo do ticket.
 *
 * Devolve DOIS containers porque um container aceita no maximo 10 filhos, e as
 * seis acoes juntas passam disso. Contagem MEDIDA no pior caso (sem logo, que
 * gasta dois TextDisplay no lugar de uma Section):
 *
 *   membros = cabecalho(2) + separador(1) + 3 x [titulo + controle](6) = 9
 *   canal   = 3 sections com botao                                     = 3
 *
 * Num container so seriam 12. Separado, o maior fica em 9 de 10 — sobra UM
 * componente, entao uma setima acao pede um terceiro container, nao mais uma
 * linha no de membros. A mensagem suporta: sao 2 de 10 componentes de topo,
 * 25 de 40 no total e 3 de 5 action rows.
 */
function buildAdminPanel(data) {
    const { ticket } = data;
    // --- Container 1: membros ---
    const membros = (0, v2_1.container)(branding_1.COLORS.INFO);
    const heading = `## ${branding_1.EMOJIS.LOCK} ${branding_1.TITLES.TICKET_ADMIN}`;
    const intro = `Ola ${(0, discord_1.userMention)(data.actorId)}, seja bem-vindo ao painel administrativo do ticket ` +
        // Nome da categoria em trecho de codigo: o valor vem da configuracao e
        // `sanitizeConfigText` nao mexe em markdown, entao cru ele renderizaria
        // `# titulo` e `[texto](link)` dentro do painel. `codeSafe` tira as crases,
        // o que mantem o trecho fechado.
        `${formatTicketNumber(ticket.ticketNumber)} (\`${codeSafe(data.categoryName, 60)}\`).\n` +
        `-# Prioridade na fila: ${PRIORITY_LABEL[ticket.priority]}\n` +
        'Aqui estao todas as opcoes de gerenciamento deste atendimento.';
    const thumbnailUrl = panelImageUrl(data.thumbnailUrl);
    if (thumbnailUrl !== null) {
        membros.addSectionComponents((0, v2_1.sectionWithThumbnail)([heading, intro], thumbnailUrl, data.storeName ?? 'Vook Store'));
    }
    else {
        membros.addTextDisplayComponents((0, v2_1.text)(heading), (0, v2_1.text)(intro));
    }
    membros.addSeparatorComponents((0, v2_1.separator)());
    membros.addTextDisplayComponents((0, v2_1.text)(adminItem('Adicionar Membro', 'Concede acesso a este ticket.')));
    membros.addActionRowComponents((0, v2_1.selectRow)(data.addMemberSelect));
    if (data.removeMemberSelect !== null) {
        membros.addTextDisplayComponents((0, v2_1.text)(adminItem('Remover Membro', 'Retira o acesso de um participante.')));
        membros.addActionRowComponents((0, v2_1.selectRow)(data.removeMemberSelect));
    }
    else {
        membros.addTextDisplayComponents((0, v2_1.text)(adminItem('Remover Membro', 'Nenhum participante adicional neste ticket.')));
    }
    membros.addTextDisplayComponents((0, v2_1.text)(adminItem('Transferir Atendimento', 'Passa o ticket para outro atendente da equipe.')));
    membros.addActionRowComponents((0, v2_1.selectRow)(data.transferSelect));
    // --- Container 2: acoes sobre o canal ---
    const acoes = (0, v2_1.container)(branding_1.COLORS.INFO);
    acoes.addSectionComponents((0, v2_1.sectionWithButton)([adminItem('Renomear Canal', 'Altera o nome do canal deste ticket.')], new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.RENAME, ticket.id))
        .setLabel('Renomear')
        .setEmoji(branding_1.EMOJIS.EDIT)
        .setStyle(discord_js_1.ButtonStyle.Secondary)));
    acoes.addSectionComponents((0, v2_1.sectionWithButton)([adminItem('Notificar Cliente', 'Avisa o autor no canal e por mensagem direta.')], new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.NOTIFY, ticket.id))
        .setLabel('Notificar')
        .setEmoji(branding_1.EMOJIS.NOTIFY)
        .setStyle(discord_js_1.ButtonStyle.Secondary)));
    acoes.addSectionComponents((0, v2_1.sectionWithButton)([adminItem('Finalizar Ticket', 'Inicia o encerramento e gera o transcript.')], new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.CLOSE, ticket.id))
        .setLabel('Finalizar Ticket')
        .setEmoji(branding_1.EMOJIS.CLOSE)
        .setStyle(discord_js_1.ButtonStyle.Secondary)));
    return [membros, acoes];
}
//# sourceMappingURL=TicketInternalPanelBuilder.js.map