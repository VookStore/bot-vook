"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_SELECT_PLACEHOLDER = exports.TICKET_FIELD = void 0;
exports.buildCategorySelect = buildCategorySelect;
exports.buildTicketCreateModal = buildTicketCreateModal;
exports.buildTicketCloseModal = buildTicketCloseModal;
exports.buildTicketRenameModal = buildTicketRenameModal;
exports.buildAddMemberSelect = buildAddMemberSelect;
exports.buildTransferSelect = buildTransferSelect;
exports.buildRemoveMemberSelect = buildRemoveMemberSelect;
const discord_js_1 = require("discord.js");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const sanitize_1 = require("../../../utils/sanitize");
const CategoryBuilders_1 = require("../../configuration/builders/CategoryBuilders");
/** Modais e seletores do fluxo de tickets. */
/**
 * Ids dos CAMPOS do formulario de abertura.
 *
 * Nao sao customIds de roteamento: campo de modal nao passa pelo router. Usar
 * `ticket:algo` aqui daria a entender, erradamente, que existe um handler
 * escutando — e o roteador nunca veria esses ids.
 */
exports.TICKET_FIELD = {
    SUBJECT: 'subject',
    CATEGORY: 'category',
};
/** Texto do seletor de categorias dentro do formulario. */
exports.CATEGORY_SELECT_PLACEHOLDER = 'Faca uma selecao';
/**
 * Emoji de categoria valido para o select (unicode simples ou emoji custom).
 *
 * Reusa a MESMA validacao da escrita (`normalizeCategoryEmoji`). Aceitar
 * qualquer string aqui era arriscado: `setEmoji('carrinho')` nao lanca,
 * serializa `{"name":"carrinho"}` e derruba a mensagem inteira com 400 — antes
 * o painel publico, agora o proprio formulario. A unica barreira era a
 * normalizacao no modal de cadastro, entao qualquer linha vinda de migracao,
 * seed ou SQL manual quebrava a abertura de ticket.
 */
function parseEmoji(raw) {
    return (0, CategoryBuilders_1.normalizeCategoryEmoji)(raw) ?? undefined;
}
/**
 * Seletor de categorias.
 *
 * Vive DENTRO do formulario de abertura, e nao mais no painel publico: o
 * cliente escolhe motivo e categoria na mesma tela, num envio so. Antes eram
 * dois passos — escolher a categoria no painel e depois digitar o assunto num
 * modal — e quem desistia no meio deixava a interacao pendurada.
 */
function buildCategorySelect(categories) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(exports.TICKET_FIELD.CATEGORY)
        .setPlaceholder((0, sanitize_1.truncate)(exports.CATEGORY_SELECT_PLACEHOLDER, limits_1.DISCORD_LIMITS.SELECT_PLACEHOLDER))
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(categories.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((category) => {
        const option = new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel((0, sanitize_1.truncate)(category.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
            .setValue(category.id);
        if (category.description !== null && category.description.length > 0) {
            option.setDescription((0, sanitize_1.truncate)(category.description, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION));
        }
        const emoji = parseEmoji(category.emoji);
        if (emoji !== undefined)
            option.setEmoji(emoji);
        return option;
    }));
    return menu;
}
/**
 * Formulario de abertura: motivo do contato + categoria, num envio so.
 *
 * O modal usa `LabelBuilder` nos DOIS campos porque a estrutura nao se mistura:
 * um modal e todo em `ActionRow` (so aceita texto) ou todo em `Label` (aceita
 * select e upload). Como a categoria virou select, o campo de texto teve de vir
 * junto para o formato novo.
 *
 * Lanca quando nao ha categoria: um select sem opcao e recusado com 400 pelo
 * Discord, e o erro apareceria como "algo deu errado" no clique do cliente.
 */
function buildTicketCreateModal(categories) {
    if (categories.length === 0) {
        throw new errors_1.ValidationError('Formulario de ticket sem categoria disponivel.', {
            userMessage: 'Nenhuma categoria de atendimento esta disponivel no momento. Tente novamente mais tarde.',
        });
    }
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.CREATE_MODAL))
        .setTitle((0, sanitize_1.truncate)('Abrir um ticket', limits_1.DISCORD_LIMITS.MODAL_TITLE))
        .addLabelComponents(new discord_js_1.LabelBuilder()
        .setLabel((0, sanitize_1.truncate)('Qual e o motivo do seu contato?', limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setTextInputComponent(new discord_js_1.TextInputBuilder()
        .setCustomId(exports.TICKET_FIELD.SUBJECT)
        .setPlaceholder((0, sanitize_1.truncate)('Escreva com detalhes o motivo pelo qual voce esta abrindo este ticket...', limits_1.DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER))
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(limits_1.BUSINESS_LIMITS.TICKET_SUBJECT_MIN)
        .setMaxLength(limits_1.BUSINESS_LIMITS.TICKET_SUBJECT_MAX)), new discord_js_1.LabelBuilder()
        .setLabel((0, sanitize_1.truncate)('Escolha uma categoria', limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setStringSelectMenuComponent(buildCategorySelect(categories)));
}
/** Modal de encerramento: resumo/motivo (opcional). */
function buildTicketCloseModal(ticketId, ticketNumber) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.CLOSE_MODAL, ticketId))
        .setTitle((0, sanitize_1.truncate)(`Finalizar #${String(ticketNumber).padStart(4, '0')}`, limits_1.DISCORD_LIMITS.MODAL_TITLE));
    const reason = new discord_js_1.TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Resumo / motivo do encerramento')
        .setPlaceholder('Opcional. Sera registrado no log e enviado ao cliente.')
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(limits_1.BUSINESS_LIMITS.CLOSE_REASON_MAX);
    modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(reason));
    return modal;
}
/** Modal de renomeacao do canal. */
function buildTicketRenameModal(ticketId, currentName) {
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.RENAME_MODAL, ticketId))
        .setTitle('Renomear canal');
    const name = new discord_js_1.TextInputBuilder()
        .setCustomId('name')
        .setLabel('Novo nome do canal')
        .setPlaceholder('Sera convertido para o formato do Discord (a-z, 0-9 e hifen).')
        .setValue((0, sanitize_1.truncate)(currentName, 90))
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(limits_1.DISCORD_LIMITS.CHANNEL_NAME);
    modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(name));
    return modal;
}
/** Seletor de usuario para adicionar participante. */
function buildAddMemberSelect(ticketId) {
    return new discord_js_1.UserSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.ADD_MEMBER_SELECT, ticketId))
        .setPlaceholder('Selecione o membro que tera acesso')
        .setMinValues(1)
        .setMaxValues(1);
}
/** Seletor de usuario para transferir o atendimento. */
function buildTransferSelect(ticketId) {
    return new discord_js_1.UserSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.TRANSFER_SELECT, ticketId))
        .setPlaceholder('Selecione o novo responsavel')
        .setMinValues(1)
        .setMaxValues(1);
}
/** Seletor dos participantes atuais para remocao. */
function buildRemoveMemberSelect(ticketId, participants) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.REMOVE_MEMBER_SELECT, ticketId))
        .setPlaceholder('Selecione quem sera removido')
        .setMinValues(1)
        .setMaxValues(1);
    menu.addOptions(participants.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((participant) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(participant.label, limits_1.DISCORD_LIMITS.SELECT_LABEL))
        .setValue(participant.id)));
    return menu;
}
//# sourceMappingURL=TicketModalBuilder.js.map