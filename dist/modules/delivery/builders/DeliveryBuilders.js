"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELIVERY_FIELD = void 0;
exports.buildDeliveryModal = buildDeliveryModal;
exports.buildDeliverySummary = buildDeliverySummary;
exports.readDeliveryNote = readDeliveryNote;
exports.buildDeliveryCard = buildDeliveryCard;
exports.buildDeliveryDm = buildDeliveryDm;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const time_1 = require("../../../utils/time");
const product_1 = require("../validators/product");
/**
 * Entrega do produto no ticket (Components V2).
 *
 * Duas pecas: o FORMULARIO que o comando `/entregar` abre e o CARTAO que sai
 * com o arquivo. O cartao tem duas versoes — a do ticket e a da DM — porque o
 * que cada uma pode carregar e diferente: na DM o teto de anexo do bot e sempre
 * o padrao de 20 MiB (o impulso do servidor nao vale la), entao ha caso em que
 * o arquivo vai no ticket e a DM leva so o aviso e o caminho de volta.
 */
/** customIds dos campos do formulario. */
exports.DELIVERY_FIELD = {
    CUSTOMER: 'cliente',
    FILE: 'arquivo',
    NOTE: 'observacoes',
};
// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------
function label(title, description) {
    const built = new discord_js_1.LabelBuilder().setLabel((0, sanitize_1.truncate)(title, limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL));
    if (description !== undefined)
        built.setDescription((0, sanitize_1.truncate)(description, 100));
    return built;
}
/**
 * Formulario da entrega.
 *
 * TRES campos, e os dois primeiros sao o pedido inteiro: quem recebe e o que
 * ele recebe. O terceiro existe por causa do formato — pacote costuma ter senha
 * ou ordem de instalacao, e sem lugar para isso a equipe mandaria uma segunda
 * mensagem solta que o cliente perde ao rolar a conversa.
 *
 * O CLIENTE E UM SELECT DE USUARIO, nao um campo de texto: o cartao menciona a
 * pessoa e a DM precisa de um id de verdade. Digitar o nome daria um texto que
 * nao aponta para ninguem.
 *
 * Sem `setDefaultUsers`: o dono do ticket vai na DESCRICAO do rotulo. Pre-marcar
 * no select dependeria de o Discord aceitar `default_values` dentro de modal, o
 * que nao esta documentado — e um 400 aqui nao mostraria formulario nenhum.
 *
 * Todo em `LabelBuilder`: e o unico formato que aceita select e upload no mesmo
 * modal (mesma regra do formulario de ticket e do de lobos).
 */
function buildDeliveryModal(data) {
    const customerSelect = new discord_js_1.UserSelectMenuBuilder()
        .setCustomId(exports.DELIVERY_FIELD.CUSTOMER)
        .setPlaceholder((0, sanitize_1.truncate)('Selecione quem recebe o produto', limits_1.DISCORD_LIMITS.SELECT_PLACEHOLDER))
        .setMinValues(1)
        .setMaxValues(1);
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.DELIVERY, customIds_1.DELIVERY_ACTION.SEND_MODAL))
        .setTitle((0, sanitize_1.truncate)(`Entregar produto — ${data.ticketLabel}`, limits_1.DISCORD_LIMITS.MODAL_TITLE))
        .addLabelComponents(label('Cliente', data.ownerHint === null
        ? 'Quem vai receber o arquivo e a mensagem direta.'
        : `Cliente deste atendimento: ${data.ownerHint}`).setUserSelectMenuComponent(customerSelect), label('Arquivo do produto', `${(0, product_1.describeProductFormats)()}, até ${(0, product_1.describeProductMaxSize)(data.maxBytes)}.`).setFileUploadComponent(new discord_js_1.FileUploadBuilder()
        .setCustomId(exports.DELIVERY_FIELD.FILE)
        .setMinValues(1)
        // UM arquivo por entrega: o cartao e a entrega daquele pacote, e dois
        // anexos na mesma mensagem tornam ambiguo o que foi entregue.
        .setMaxValues(1)
        .setRequired(true)), label('Observações', 'Opcional. Senha do arquivo, ordem de instalação...').setTextInputComponent(new discord_js_1.TextInputBuilder()
        .setCustomId(exports.DELIVERY_FIELD.NOTE)
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(limits_1.BUSINESS_LIMITS.DELIVERY_NOTE_MAX)
        .setPlaceholder((0, sanitize_1.truncate)('Ex.: a senha do arquivo é vook2026', limits_1.DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER))));
}
/**
 * A linha da DM.
 *
 * TRES resultados, nao dois: "sem o arquivo" nao quer dizer "esta no ticket".
 * Com o arquivo hospedado ele nao e anexo em lugar nenhum — a DM leva o botao
 * de download —, e dizer a equipe que a DM aponta para o ticket a faria
 * explicar errado ao cliente.
 */
function dmLine(data) {
    if (data.dmSent) {
        if (data.dmHadFile)
            return 'Cópia enviada na DM do cliente, com o arquivo.';
        if (data.hosted)
            return 'Cópia enviada na DM do cliente, com o botão de download.';
        return 'DM enviada sem o arquivo (grande demais para mensagem direta): ela aponta para o ticket.';
    }
    return data.dmFailure === 'erro'
        ? '⚠️ A DM falhou por erro técnico (não é DM fechada). O arquivo está no ticket — vale avisar o cliente por lá.'
        : '⚠️ A DM não foi entregue (cliente com mensagens diretas fechadas). O arquivo está no ticket.';
}
/**
 * O que a equipe le depois de entregar.
 *
 * Denso de proposito: ela precisa saber, num olhar, se sobrou tarefa. Uma DM
 * que nao saiu ou um pedido que nao virou ENTREGUE nao sao erros do envio — sao
 * coisas que ficaram para tras, e esconde-las faria o "entregue" mentir.
 */
function buildDeliverySummary(data) {
    const lines = [dmLine(data)];
    if (data.orderLabel === null) {
        /*
         * Pedido pago de OUTRA pessoa no mesmo atendimento e o sinal mais provavel
         * de que o cliente errado foi selecionado no formulario — e o arquivo ja
         * saiu. Dizer "nada a marcar" aqui esconderia exatamente isso.
         */
        lines.push(data.foreignOrder === null
            ? 'Nenhum pedido pago estava ligado a este atendimento — nada a marcar.'
            : `⚠️ Nenhum pedido pago deste cliente, mas ${data.foreignOrder.label} neste atendimento é de ` +
                `${(0, discord_1.userMention)(data.foreignOrder.customerId)}. Confira se a entrega foi para a pessoa certa.`);
    }
    else if (data.orderMarked) {
        lines.push(`Pedido ${data.orderLabel} marcado como entregue.`);
    }
    else {
        lines.push(`⚠️ Pedido ${data.orderLabel} NÃO foi marcado: ${data.orderWarning ?? 'motivo desconhecido'}`);
    }
    lines.push(data.ticketMoved
        ? 'Ticket movido para os concluídos: fica arquivado até o cliente confirmar o recebimento.'
        : '⚠️ O ticket continua na lista de ativos: o canal de concluídos não está configurado ou não respondeu (`/demandas canais`).');
    if (data.hosted) {
        lines.push('O arquivo não cabia como anexo e foi hospedado: o cartão leva um botão de download.');
    }
    if (data.reviewChannelMissing) {
        lines.push('Sem canal de avaliações configurado, o convite para avaliar não entrou no cartão.');
    }
    return lines.join('\n');
}
/**
 * Limpeza da observacao.
 *
 * O texto vai para o cartao que o cliente le e para a DM dele: mencao
 * neutralizada (alem do `allowedMentions` do envio), controles e invisiveis
 * fora, repeticao de spam colapsada. O markdown de LAYOUT e escapado so na
 * renderizacao — guardar cru mantem o limite contado em caracteres digitados.
 */
function readDeliveryNote(raw) {
    const lines = (0, sanitize_1.collapseRepeats)((0, sanitize_1.sanitizeMentions)((0, sanitize_1.stripUnsafeChars)(raw)))
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .slice(0, limits_1.BUSINESS_LIMITS.DELIVERY_NOTE_MAX_LINES);
    if (lines.length === 0)
        return null;
    return (0, sanitize_1.truncate)(lines.join('\n'), limits_1.BUSINESS_LIMITS.DELIVERY_NOTE_MAX);
}
function detailLines(data) {
    const lines = [
        `${branding_1.EMOJIS.PACKAGE} **Arquivo:** \`${(0, sanitize_1.escapeMarkdownLayout)(data.fileName)}\` (${data.fileSize})`,
        `${branding_1.EMOJIS.TICKET} **Atendimento:** \`${data.ticketLabel}\``,
    ];
    if (data.orderLabel !== null) {
        lines.push(`${branding_1.EMOJIS.RECEIPT} **Pedido:** \`${data.orderLabel}\``);
    }
    lines.push(`${branding_1.EMOJIS.ROLE} **Entregue por:** ${(0, discord_1.userMention)(data.staffId)} • ${(0, time_1.discordTimestamp)(data.deliveredAt, 'f')}`);
    return lines.join('\n');
}
/**
 * Observacao da equipe, como citacao.
 *
 * Cada linha ganha `> ` porque `>>>` transformaria em citacao tudo que viesse
 * depois, inclusive o rodape.
 */
function noteBlock(note) {
    const quoted = note
        .split('\n')
        .map((line) => `> ${(0, sanitize_1.escapeMarkdownLayout)(line)}`)
        .join('\n');
    return `${branding_1.EMOJIS.INFO} **Observações da equipe**\n${quoted}`;
}
/** Download direto; so existe quando o arquivo foi hospedado. */
function downloadButton(data) {
    if (!data.hosted)
        return null;
    return new discord_js_1.ButtonBuilder()
        .setStyle(discord_js_1.ButtonStyle.Link)
        .setLabel('Baixar arquivo')
        .setEmoji(branding_1.EMOJIS.PACKAGE)
        .setURL(data.fileUrl);
}
/**
 * Convite para avaliar. SO existe com canal configurado.
 *
 * Um `ButtonStyle.Link` exige URL valida — sem canal nao ha URL para colocar —,
 * e mandar o cliente para a raiz do servidor sob o rotulo "Avaliar atendimento"
 * seria pior que nao convidar.
 */
function reviewButton(data) {
    if (data.reviewChannelId === null)
        return null;
    return new discord_js_1.ButtonBuilder()
        .setStyle(discord_js_1.ButtonStyle.Link)
        .setLabel('Avaliar atendimento')
        .setEmoji(branding_1.EMOJIS.REVIEW)
        .setURL((0, discord_1.channelUrl)(data.guildId, data.reviewChannelId));
}
/**
 * "Confirmar recebimento": o cliente encerra o atendimento.
 *
 * E o que fecha o ticket depois de uma entrega — a equipe arquiva o topico na
 * entrega, mas so o cliente diz que recebeu. Secondary como todo botao da loja
 * (politica visual), e so no cartao do TICKET: na DM nao ha guild, e confirmar
 * fora do atendimento esconderia da equipe que ele foi concluido.
 *
 * Quem pode clicar e conferido no handler, pelo banco — o botao fica visivel
 * para a equipe tambem.
 */
function confirmButton(data) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.DELIVERY, customIds_1.DELIVERY_ACTION.CONFIRM, data.ticketId))
        .setLabel('Confirmar recebimento')
        .setEmoji(branding_1.EMOJIS.APPROVE)
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/** Caminho de volta ao atendimento; so faz sentido fora do proprio ticket. */
function ticketButton(guildId, channelId) {
    return new discord_js_1.ButtonBuilder()
        .setStyle(discord_js_1.ButtonStyle.Link)
        .setLabel('Ir ao atendimento')
        .setEmoji(branding_1.EMOJIS.TICKET)
        .setURL((0, discord_1.channelUrl)(guildId, channelId));
}
function present(buttons) {
    return buttons.filter((button) => button !== null);
}
/** Acrescenta o arquivo: componente quando e anexo, nada quando e link. */
function addFile(root, data) {
    if (data.hosted)
        return;
    root.addFileComponents(new discord_js_1.FileBuilder().setURL(data.fileUrl));
}
/**
 * O cartao publicado DENTRO do ticket.
 *
 * O arquivo e o conteudo; o resto responde as perguntas de quem recebe: o que
 * e isso, de qual pedido veio, quem entregou e quando. O agradecimento vem
 * primeiro porque e a ultima coisa que a loja diz nesta venda.
 *
 * Quando o arquivo nao coube como anexo, ele vira BOTAO de download em vez de
 * componente de arquivo — o componente de arquivo do Discord so sabe apontar
 * para `attachment://`.
 */
function buildDeliveryCard(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, `${branding_1.EMOJIS.DELIVER} ${branding_1.TITLES.DELIVERY}`, {
        subtitle: `-# Sua compra na ${(0, sanitize_1.escapeMarkdownLayout)(data.storeName)}, entregue.`,
    });
    root.addTextDisplayComponents((0, v2_1.text)(`${(0, discord_1.userMention)(data.customerId)}, seu produto está aqui! ` +
        'Agradecemos a confiança — foi um prazer atender você.\n\n' +
        detailLines(data)));
    // A observacao dispensa separador proprio: ela ja e um bloco de citacao, e o
    // separador so gastaria um dos 10 filhos do Container.
    if (data.note !== null)
        root.addTextDisplayComponents((0, v2_1.text)(noteBlock(data.note)));
    root.addSeparatorComponents((0, v2_1.separator)());
    addFile(root, data);
    // Baixar vem antes de confirmar: confirma-se o que ja se conferiu.
    root.addActionRowComponents((0, v2_1.buttonRow)(...present([downloadButton(data), confirmButton(data), reviewButton(data)])));
    root.addTextDisplayComponents((0, v2_1.footerNote)((data.hosted
        ? 'Baixe o arquivo pelo botão acima e guarde uma cópia. '
        : 'Guarde uma cópia do arquivo. ') +
        'Deu tudo certo? Toque em **Confirmar recebimento** — se algo der errado, responda aqui antes.'));
    /*
     * Pior caso dos 10 filhos do Container: titulo, subtitulo e separador (3),
     * texto (4), observacao (5), separador (6), arquivo (7), botoes (8) e rodape
     * (9). Uma folga de um filho, de proposito — quem acrescentar um bloco aqui
     * ainda cabe, e o limite do Discord e recusa da mensagem inteira.
     */
    return root;
}
/**
 * A mesma entrega, na DM do cliente.
 *
 * Existe porque o ticket e um topico privado que o cliente perde de vista assim
 * que sai do servidor — e porque ele fecha, e o topico e arquivado. A DM e a
 * copia que fica com ele.
 *
 * Quando o arquivo ficou so no ticket (acima do teto de anexo em DM), o cartao
 * DIZ isso e o botao leva ao atendimento. O silencio seria pior: o cliente
 * leria que o produto esta ali sem nada anexado.
 */
function buildDeliveryDm(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, `${branding_1.EMOJIS.DELIVER} ${branding_1.TITLES.DELIVERY}`, {
        subtitle: `-# Sua compra na ${(0, sanitize_1.escapeMarkdownLayout)(data.storeName)} foi entregue.`,
    });
    /*
     * TRES casos, nao dois.
     *
     * Sem anexo na DM nao significa "esta no ticket": quando o arquivo foi
     * HOSPEDADO, ele nao e anexo em lugar nenhum — esta no botao de download
     * desta propria mensagem. Mandar o cliente ao ticket nesse caso o faria
     * procurar um anexo que nao existe la.
     *
     * O agradecimento vem ANTES da logistica: "o arquivo e grande demais... foi
     * um prazer atender voce" le-se como desculpa, nao como entrega.
     */
    const whereIsIt = data.fileAttached
        ? 'Seu produto está anexado nesta mensagem.'
        : data.hosted
            ? 'Baixe o seu produto pelo botão abaixo.'
            : `O arquivo é grande demais para a mensagem direta e ficou no seu atendimento \`${data.ticketLabel}\` — abra pelo botão abaixo.`;
    root.addTextDisplayComponents((0, v2_1.text)(`Olá, ${(0, discord_1.userMention)(data.customerId)}! Agradecemos a confiança — ` +
        `foi um prazer atender você. ${whereIsIt}\n\n` +
        detailLines(data)));
    if (data.note !== null)
        root.addTextDisplayComponents((0, v2_1.text)(noteBlock(data.note)));
    root.addSeparatorComponents((0, v2_1.separator)());
    if (data.fileAttached)
        addFile(root, data);
    /*
     * O DOWNLOAD VEM PRIMEIRO quando existe: nesse caso ele e o motivo da
     * mensagem, e o atendimento vira o lugar de tirar duvida. Sem download, o
     * botao do atendimento assume a frente — e por ele que o cliente chega ao
     * arquivo que ficou no ticket.
     */
    root.addActionRowComponents((0, v2_1.buttonRow)(...present([
        downloadButton(data),
        ticketButton(data.guildId, data.ticketChannelId),
        reviewButton(data),
    ])));
    // A confirmacao e no TICKET, nao aqui: e la que a equipe ve que o
    // atendimento foi concluido.
    root.addTextDisplayComponents((0, v2_1.footerNote)('Conferiu o arquivo? Confirme o recebimento no seu atendimento. ' +
        `A ${(0, sanitize_1.escapeMarkdownLayout)(data.storeName)} agradece a preferência.`));
    return root;
}
//# sourceMappingURL=DeliveryBuilders.js.map