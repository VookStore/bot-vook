"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEphemeralSource = isEphemeralSource;
exports.beginPanel = beginPanel;
exports.showPanel = showPanel;
exports.requireGuildContext = requireGuildContext;
exports.readSelectedValue = readSelectedValue;
exports.optionalField = optionalField;
exports.parsePage = parsePage;
exports.parseIndex = parseIndex;
exports.paginate = paginate;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
/** True quando o componente clicado vive em uma mensagem efemera. */
function isEphemeralSource(interaction) {
    return interaction.message.flags.has(discord_js_1.MessageFlags.Ephemeral);
}
/**
 * Prepara a resposta: atualiza a mensagem efemera atual ou abre uma nova
 * resposta privada quando o clique veio de um painel publico.
 */
async function beginPanel(interaction) {
    if (isEphemeralSource(interaction)) {
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        return;
    }
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
}
/**
 * Entrega o painel (funciona depois de `beginPanel` nos dois caminhos).
 * `files` serve para paineis que carregam imagem — o QR do pedido, por exemplo.
 */
async function showPanel(interaction, root, options = {}) {
    await (0, reply_1.editReplyV2)(interaction, root, options.files === undefined ? {} : { files: options.files });
}
function requireGuildContext(interaction) {
    const { guild, member } = interaction;
    if (guild === null || !(member instanceof discord_js_1.GuildMember)) {
        throw new errors_1.PermissionError('Interacao de catalogo fora de uma guild em cache.', {
            userMessage: 'Esta acao so pode ser usada dentro do servidor.',
            context: { userId: interaction.user.id, guildId: interaction.guildId },
        });
    }
    return { guild, member };
}
/** Valor selecionado em um select de texto. */
function readSelectedValue(interaction) {
    if (!interaction.isStringSelectMenu()) {
        throw new errors_1.ValidationError('Select com tipo inesperado.', {
            userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
        });
    }
    const value = interaction.values[0];
    if (value === undefined || value.length === 0) {
        throw new errors_1.ValidationError('Select sem valor.', {
            userMessage: 'Nenhuma opcao foi selecionada. Tente novamente.',
        });
    }
    return value;
}
/**
 * Campo opcional de modal.
 * Um input opcional em branco pode nem vir no payload; nesse caso vale como
 * texto vazio, em vez de derrubar o envio do formulario inteiro.
 */
function optionalField(interaction, customId) {
    try {
        return interaction.fields.getTextInputValue(customId);
    }
    catch {
        return '';
    }
}
/** Numero de pagina vindo do customId (1 quando ausente ou invalido). */
function parsePage(raw) {
    const page = Number.parseInt(raw ?? '1', 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
}
/** Indice de imagem vindo do customId (0 quando ausente ou invalido). */
function parseIndex(raw) {
    const index = Number.parseInt(raw ?? '0', 10);
    return Number.isFinite(index) ? index : 0;
}
/** Recorta uma pagina de uma lista ja ordenada. */
function paginate(items, page, size) {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const safePage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
    const start = (safePage - 1) * size;
    return { items: items.slice(start, start + size), page: safePage, totalPages, total };
}
//# sourceMappingURL=shared.js.map