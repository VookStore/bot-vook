"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WOLF_FIELD = void 0;
exports.buildWolfPanel = buildWolfPanel;
exports.buildWolfModal = buildWolfModal;
exports.readWolfSubmission = readWolfSubmission;
exports.buildWolfPortfolioPost = buildWolfPortfolioPost;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const v2_1 = require("../../../components/v2");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const wolves_1 = require("../data/wolves");
const render_1 = require("../validators/render");
/**
 * Portfolio de lobos (Components V2).
 *
 * Tres pecas: o PAINEL que fica no canal da equipe, o FORMULARIO que o botao
 * abre e o POST que sai no canal do portfolio. O post e V2 como o resto da loja
 * — tabela de precos, booster, catalogo —, e nao embed classico: a galeria V2
 * mostra o render na largura inteira da mensagem, que e o motivo do post
 * existir.
 */
/** customIds dos campos do formulario. */
exports.WOLF_FIELD = {
    CUSTOMER: 'cliente',
    KIND: 'tipo',
    RENDER: 'render',
    PERSONALIZATION: 'personalizacao',
    ADDITIONAL: 'adicional',
};
function kindsSentence() {
    const labels = wolves_1.WOLF_KINDS.map((kind) => kind.label);
    if (labels.length <= 1)
        return labels.join('');
    return `${labels.slice(0, -1).join(', ')} ou ${labels[labels.length - 1] ?? ''}`;
}
/**
 * Painel fixo no canal da equipe.
 *
 * Diz ANTES do clique o que o formulario vai pedir. O modal do Discord nao
 * guarda nada se o envio falhar, entao quem abre o formulario sem o render
 * exportado perde o que digitou — a lista aqui e o que evita isso.
 *
 * Sem canal de portfolio o botao sai DESLIGADO, com o motivo escrito. Um botao
 * clicavel que so sabe responder "nao configurado" ensina a equipe a ignorar o
 * painel.
 */
function buildWolfPanel(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, `${wolves_1.WOLF_EMOJI.LOBO} ${branding_1.TITLES.WOLF_PANEL}`, {
        subtitle: '-# Publique no portfólio um lobo criado pela loja.',
    });
    const destination = data.portfolioChannelId !== null
        ? 'Toque em **Criar anúncio**, preencha o formulário e envie o render — ' +
            `o post sai direto em ${(0, discord_1.channelMention)(data.portfolioChannelId)}.`
        : `${branding_1.EMOJIS.PENDING} **O canal do portfólio ainda não foi definido.**\n` +
            'Um administrador precisa rodar `/lobos portfolio` — até lá o botão fica desligado.';
    root.addTextDisplayComponents((0, v2_1.text)(`${destination}\n\n` +
        '**O formulário pede**\n' +
        `${wolves_1.WOLF_EMOJI.LOBO} **Lobo** — ${kindsSentence()}\n` +
        `${branding_1.EMOJIS.ROLE} **Cliente** — nome de quem encomendou\n` +
        `${branding_1.EMOJIS.IMAGE} **Render** — ${(0, render_1.describeRenderFormats)()}, até ${(0, render_1.describeRenderMaxSize)(data.maxRenderBytes)}\n` +
        `${wolves_1.WOLF_EMOJI.PERSONALIZACAO} **Personalização** — opcional\n` +
        `${wolves_1.WOLF_EMOJI.ADICIONAL} **Adicional** — opcional`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.WOLF, customIds_1.WOLF_ACTION.CREATE))
        .setLabel('Criar anúncio')
        // Unicode de proposito: emoji personalizado em COMPONENTE que o bot nao
        // alcance faz o Discord recusar o painel inteiro (ver `data/wolves`).
        .setEmoji(branding_1.EMOJIS.WOLF)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(data.portfolioChannelId === null)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Somente a equipe da loja publica. O render é reenviado pelo bot, ' +
        'então o post não perde a imagem com o tempo.'));
    return root;
}
// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------
function label(title, description) {
    const built = new discord_js_1.LabelBuilder().setLabel((0, sanitize_1.truncate)(title, limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL));
    if (description !== undefined)
        built.setDescription((0, sanitize_1.truncate)(description, 100));
    return built;
}
function detailInput(customId, placeholder) {
    return new discord_js_1.TextInputBuilder()
        .setCustomId(customId)
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(limits_1.BUSINESS_LIMITS.WOLF_DETAIL_MAX)
        .setPlaceholder((0, sanitize_1.truncate)(placeholder, limits_1.DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));
}
/**
 * Formulario do lobo.
 *
 * CINCO campos, que e o teto de um modal do Discord — e cabem exatos: os tres
 * pedidos (cliente, tipo, render) mais os dois detalhes que o post mostra com
 * emoji proprio (personalizacao e adicional).
 *
 * Todo em `LabelBuilder`: e o unico formato que aceita select e upload no
 * mesmo modal (mesma regra do formulario de ticket).
 */
function buildWolfModal(maxRenderBytes) {
    const kindSelect = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(exports.WOLF_FIELD.KIND)
        .setPlaceholder((0, sanitize_1.truncate)(kindsSentence(), limits_1.DISCORD_LIMITS.SELECT_PLACEHOLDER))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(wolves_1.WOLF_KINDS.map((kind) => new discord_js_1.StringSelectMenuOptionBuilder().setValue(kind.value).setLabel(kind.label)));
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.WOLF, customIds_1.WOLF_ACTION.CREATE_MODAL))
        .setTitle((0, sanitize_1.truncate)('Novo lobo no portfólio', limits_1.DISCORD_LIMITS.MODAL_TITLE))
        .addLabelComponents(label('Nome do cliente').setTextInputComponent(new discord_js_1.TextInputBuilder()
        .setCustomId(exports.WOLF_FIELD.CUSTOMER)
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(limits_1.BUSINESS_LIMITS.WOLF_CUSTOMER_MAX)
        .setPlaceholder('Como o cliente vai aparecer no post')), label('Lobo').setStringSelectMenuComponent(kindSelect), label('Render do lobo', `${(0, render_1.describeRenderFormats)()}, até ${(0, render_1.describeRenderMaxSize)(maxRenderBytes)}.`).setFileUploadComponent(new discord_js_1.FileUploadBuilder()
        .setCustomId(exports.WOLF_FIELD.RENDER)
        .setMinValues(1)
        // UM render por post: e a imagem de capa, e o post e dele.
        .setMaxValues(1)
        .setRequired(true)), label('Personalização', 'Opcional. Uma por linha.').setTextInputComponent(detailInput(exports.WOLF_FIELD.PERSONALIZATION, 'Ex.: com runas')), label('Adicional', 'Opcional. Um por linha.').setTextInputComponent(detailInput(exports.WOLF_FIELD.ADDITIONAL, 'Ex.: 2 acessórios')));
}
/**
 * Limpeza comum: o texto sai num canal PUBLICO assinado pela loja.
 *
 * Mencao neutralizada (alem do `allowedMentions` do envio), controles e
 * invisiveis fora, repeticao de spam colapsada. O markdown de LAYOUT e escapado
 * so na renderizacao — guardar cru mantem o limite contado em caracteres
 * digitados.
 */
function clean(raw) {
    return (0, sanitize_1.collapseRepeats)((0, sanitize_1.sanitizeMentions)((0, sanitize_1.stripUnsafeChars)(raw)));
}
function cleanDetail(raw) {
    const lines = clean(raw)
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .slice(0, limits_1.BUSINESS_LIMITS.WOLF_DETAIL_MAX_LINES);
    if (lines.length === 0)
        return null;
    return (0, sanitize_1.truncate)(lines.join('\n'), limits_1.BUSINESS_LIMITS.WOLF_DETAIL_MAX);
}
function readWolfSubmission(values) {
    const customer = (0, sanitize_1.truncate)(clean(values.customer).replace(/\s+/g, ' ').trim(), limits_1.BUSINESS_LIMITS.WOLF_CUSTOMER_MAX);
    // So pontuacao, ou so emoji, nao e nome: o post diria "Cliente: !!!".
    if (!/[\p{L}\p{N}]/u.test(customer)) {
        throw new errors_1.ValidationError('Nome de cliente vazio no portfolio.', {
            userMessage: 'Informe o nome do cliente como ele deve aparecer no post.',
        });
    }
    const kind = values.kind ?? '';
    if (!(0, wolves_1.isWolfKind)(kind)) {
        throw new errors_1.ValidationError(`Tipo de lobo desconhecido: ${kind}`, {
            userMessage: `Escolha o tipo do lobo: ${kindsSentence()}.`,
        });
    }
    return {
        customer,
        kind,
        personalization: cleanDetail(values.personalization),
        additional: cleanDetail(values.additional),
    };
}
/**
 * Um detalhe do lobo.
 *
 * Uma linha fica na propria linha do rotulo; varias viram citacao embaixo dele.
 * Espremer varios itens numa linha so esconde a lista — e cada item e uma
 * escolha que o cliente fez e que o proximo cliente pode pedir.
 */
function detailBlock(emoji, title, value) {
    if (value === null)
        return null;
    const lines = value.split('\n').map((line) => (0, sanitize_1.escapeMarkdownLayout)(line));
    if (lines.length === 1)
        return `${emoji} **${title}:** ${lines[0] ?? ''}`;
    return `${emoji} **${title}:**\n${lines.map((line) => `> ${line}`).join('\n')}`;
}
/**
 * O post publicado no portfolio.
 *
 * O render e o conteudo; o resto responde as perguntas de quem ve o render:
 * que lobo e esse, de quem, o que ele tem de especial e como pedir um igual.
 * Por isso os detalhes opcionais somem quando vazios — "Personalizacao:
 * nenhuma" ocuparia uma linha para dizer nada — e o convite para abrir ticket
 * esta sempre la.
 *
 * NAO leva preco. Post de portfolio fica no canal para sempre e ninguem o
 * reescreve; um "a partir de" gravado aqui viraria compromisso comercial que
 * envelhece a cada reajuste da tabela.
 */
function buildWolfPortfolioPost(data) {
    const { submission } = data;
    const kind = (0, wolves_1.wolfKindLabel)(submission.kind);
    const customer = (0, sanitize_1.escapeMarkdownLayout)(submission.customer);
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, `${wolves_1.WOLF_EMOJI.LOBO} ${branding_1.TITLES.WOLF_PORTFOLIO}`, {
        subtitle: `-# Lobo criado sob encomenda pela ${(0, sanitize_1.escapeMarkdownLayout)(data.storeName)}.`,
    });
    root.addMediaGalleryComponents((0, v2_1.mediaGallery)([data.imageUrl], `${kind} de ${submission.customer}`));
    const lines = [
        `${wolves_1.WOLF_EMOJI.LOBO} **Lobo:** ${kind}`,
        `${branding_1.EMOJIS.ROLE} **Cliente:** ${customer}`,
        detailBlock(wolves_1.WOLF_EMOJI.PERSONALIZACAO, 'Personalização', submission.personalization),
        detailBlock(wolves_1.WOLF_EMOJI.ADICIONAL, 'Adicional', submission.additional),
    ].filter((line) => line !== null);
    root.addTextDisplayComponents((0, v2_1.text)(lines.join('\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    const where = data.ticketChannelId !== null
        ? `Abra um ticket em ${(0, discord_1.channelMention)(data.ticketChannelId)}`
        : 'Abra um ticket no atendimento da loja';
    root.addTextDisplayComponents((0, v2_1.text)(`${wolves_1.WOLF_EMOJI.TICKET} **Quer um lobo assim?**\n` +
        `${where} — todo lobo da ${(0, sanitize_1.escapeMarkdownLayout)(data.storeName)} é feito sob encomenda.`));
    return root;
}
//# sourceMappingURL=WolfBuilders.js.map