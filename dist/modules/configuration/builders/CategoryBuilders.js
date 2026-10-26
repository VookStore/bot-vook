"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BACK_TARGET = exports.MOVE_DIRECTION = exports.CATEGORY_FIELD = void 0;
exports.normalizeCategoryEmoji = normalizeCategoryEmoji;
exports.buildCategoryMenu = buildCategoryMenu;
exports.buildCategorySelectMenu = buildCategorySelectMenu;
exports.buildCategoryPickerPanel = buildCategoryPickerPanel;
exports.buildCategoryModal = buildCategoryModal;
exports.buildDestinationPanel = buildDestinationPanel;
exports.buildDestinationEditPanel = buildDestinationEditPanel;
exports.buildTeamPanel = buildTeamPanel;
exports.buildTeamEditPanel = buildTeamEditPanel;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const v2_1 = require("../../../components/v2");
const errors_1 = require("../../../core/errors");
const sanitize_1 = require("../../../utils/sanitize");
/**
 * Paineis administrativos de categorias, destinos e equipes (Components V2).
 *
 * Segue o padrao visual do painel publico (TicketPanelBuilder):
 * cabecalho -> descricao -> separador -> conteudo -> separador -> controles.
 *
 * Este arquivo NAO acessa banco nem cache: recebe tudo pronto por parametro.
 * API verificada contra @discordjs/builders 1.14.1 (discord.js 14.27.0).
 */
/** Orcamento de texto da listagem, deixando folga para cabecalho e rodape. */
const LIST_TEXT_BUDGET = 2400;
/**
 * Um Container aceita no maximo 10 componentes filhos (Discord API).
 * Estourar esse numero devolve 400 Invalid Form Body e o painel some.
 */
const CONTAINER_COMPONENTS_MAX = 10;
/** Ids dos campos do modal de categoria (lidos por `ModalSubmitFields#fields`). */
exports.CATEGORY_FIELD = {
    NAME: 'name',
    IDENTIFIER: 'identifier',
    DESCRIPTION: 'description',
    EMOJI: 'emoji',
};
/** Direcao aceita pelo select de reordenacao (`category:move-select:<direcao>`). */
exports.MOVE_DIRECTION = {
    UP: customIds_1.CATEGORY_ACTION.MOVE_UP,
    DOWN: customIds_1.CATEGORY_ACTION.MOVE_DOWN,
};
/** Origem para a qual o botao "Voltar" deve retornar. */
exports.BACK_TARGET = {
    DESTINATION: 'dest',
    TEAM: 'team',
};
const CUSTOM_EMOJI_PATTERN = /^<a?:[A-Za-z0-9_]{2,32}:\d{15,25}>$/u;
/**
 * UM unico emoji unicode: bandeira (par de regional indicators), keycap, ou
 * pictograma com modificador de tom/VS16 e sequencias ZWJ.
 *
 * Precisa ser exatamente um: `setEmoji('🛒🛒')` serializa `{"name":"🛒🛒"}`,
 * que a API recusa igual a qualquer outro texto.
 */
const UNICODE_EMOJI_PATTERN = new RegExp('^(?:' +
    '\\p{RI}\\p{RI}' + // bandeiras: 🇧🇷
    '|[#*0-9]\\uFE0F?\\u20E3' + // keycaps: 1️⃣
    '|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?' +
    '(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*' + // 🧑‍💻
    ')$', 'u');
/** Teto de tamanho do campo emoji (igual ao `setMaxLength` do modal). */
const EMOJI_INPUT_MAX = 64;
/**
 * Emoji aceito em `setEmoji`: custom no formato oficial ou pictograma unicode.
 *
 * IMPORTANTE: `setEmoji('carrinho')` nao lanca — serializa `{"name":"carrinho"}`
 * e o 400 so aparece quando a mensagem e enviada, inclusive no painel PUBLICO
 * (TicketPanelBuilder envia `category.emoji` direto). Por isso a validacao
 * acontece na entrada (modal) e nao apenas na exibicao.
 */
function normalizeCategoryEmoji(raw) {
    if (raw === null)
        return null;
    const value = raw.trim();
    if (value.length === 0 || value.length > EMOJI_INPUT_MAX)
        return null;
    if (CUSTOM_EMOJI_PATTERN.test(value))
        return value;
    if (UNICODE_EMOJI_PATTERN.test(value))
        return value;
    return null;
}
function selectEmoji(raw) {
    return normalizeCategoryEmoji(raw) ?? undefined;
}
/** Emoji exibido no texto do painel (cai para o icone padrao de ticket). */
function displayEmoji(raw) {
    const value = selectEmoji(raw);
    return value ?? branding_1.EMOJIS.TICKET;
}
/** Junta blocos respeitando o limite de texto do Components V2. */
function joinWithBudget(entries, budget = LIST_TEXT_BUDGET) {
    const lines = [];
    let used = 0;
    for (const [index, entry] of entries.entries()) {
        if (used + entry.length > budget) {
            lines.push(`-# … e mais ${entries.length - index} categoria(s) nao exibida(s) aqui.`);
            break;
        }
        lines.push(entry);
        used += entry.length + 2;
    }
    return lines.join('\n\n');
}
function statusLabel(category) {
    return category.enabled ? `${branding_1.EMOJIS.ENABLE} Ativa` : `${branding_1.EMOJIS.DISABLE} Inativa`;
}
/**
 * Bloco de abertura: aviso da ultima acao (quando houver) + texto de contexto,
 * sempre em UM unico TextDisplay.
 *
 * O aviso NAO pode virar componente proprio com separador: isso somava 2 filhos
 * ao Container e o painel de categorias passava de 10 (limite do Discord),
 * quebrando exatamente o caso mais comum — o retorno de qualquer acao.
 */
function intro(notice, body) {
    const cleaned = notice === undefined ? '' : (0, sanitize_1.truncate)(notice.trim(), 400);
    return (0, v2_1.text)(cleaned.length > 0 ? `${cleaned}\n\n${body}` : body);
}
/**
 * Fecha o painel garantindo o teto de componentes do Container.
 * Falha aqui e um bug de montagem: melhor estourar no handler (que responde com
 * mensagem tratada) do que receber 400 da API com o painel em branco.
 */
function sealed(root) {
    if (root.components.length > CONTAINER_COMPONENTS_MAX) {
        throw new errors_1.ValidationError(`Painel com ${root.components.length} componentes excede o limite de ${CONTAINER_COMPONENTS_MAX} do Container.`, { userMessage: 'Nao foi possivel montar este painel. Avise a administracao.' });
    }
    return root;
}
function backButton(target) {
    const customId = target === undefined
        ? (0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.BACK)
        : (0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.BACK, target);
    return new discord_js_1.ButtonBuilder()
        .setCustomId(customId)
        .setLabel('Voltar')
        .setEmoji('↩️')
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/**
 * Painel principal: lista as categorias com posicao, emoji, nome, identificador,
 * status e se ja possuem destino e equipe configurados.
 */
function buildCategoryMenu(categories, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.CATEGORIES);
    root.addTextDisplayComponents(intro(options.notice, 'Cada categoria e um setor de atendimento exibido no painel publico da loja. ' +
        'A ordem abaixo e a mesma que o cliente ve no menu de abertura de ticket.'));
    root.addSeparatorComponents((0, v2_1.separator)());
    if (categories.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.DISABLE} **Nenhuma categoria cadastrada.**\n` +
            `Use ${branding_1.EMOJIS.ADD} **Criar** para cadastrar o primeiro setor de atendimento.`));
    }
    else {
        const entries = categories.map((category, index) => {
            const teamCount = options.teamRoleCounts?.get(category.id) ?? 0;
            const destination = category.destinationChannelId === null ? 'sem destino' : `destino <#${category.destinationChannelId}>`;
            const team = teamCount === 0 ? 'sem equipe' : `equipe ${teamCount} cargo(s)`;
            return (`**${index + 1}. ${displayEmoji(category.emoji)} ${(0, sanitize_1.truncate)(category.name, 60)}** — ${statusLabel(category)}\n` +
                `-# \`${category.identifier}\` • ${destination} • ${team}`);
        });
        root.addTextDisplayComponents((0, v2_1.text)(joinWithBudget(entries)));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    const empty = categories.length === 0;
    const full = categories.length >= limits_1.BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD;
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.CREATE))
        .setLabel('Criar')
        .setEmoji(branding_1.EMOJIS.ADD)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(full), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.EDIT))
        .setLabel('Editar')
        .setEmoji(branding_1.EMOJIS.EDIT)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(empty), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.MOVE_UP))
        .setLabel('Subir')
        .setEmoji(branding_1.EMOJIS.UP)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(categories.length < 2), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.MOVE_DOWN))
        .setLabel('Descer')
        .setEmoji(branding_1.EMOJIS.DOWN)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(categories.length < 2)));
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.TOGGLE))
        .setLabel('Ativar / Desativar')
        .setEmoji(branding_1.EMOJIS.ENABLE)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(empty), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.DELETE))
        .setLabel('Excluir')
        .setEmoji(branding_1.EMOJIS.DELETE)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(empty)));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`${categories.length}/${limits_1.BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD} categorias • ` +
        'a exclusao e reversivel: os tickets historicos sao preservados.'));
    return sealed(root);
}
/**
 * Select com as categorias da guild.
 * O valor de cada opcao e o id da categoria — que continua sendo revalidado no
 * banco a cada acao (customId nunca e autorizacao).
 */
function buildCategorySelectMenu(categories, action, placeholder, options = {}) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(options.namespace ?? customIds_1.NAMESPACE.CATEGORY, action, ...(options.args ?? [])))
        .setPlaceholder((0, sanitize_1.truncate)(placeholder, limits_1.DISCORD_LIMITS.SELECT_PLACEHOLDER))
        .setMinValues(1)
        .setMaxValues(1);
    const choices = categories.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((category, index) => {
        const option = new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel((0, sanitize_1.truncate)(`${index + 1}. ${category.name}`, limits_1.DISCORD_LIMITS.SELECT_LABEL))
            .setValue(category.id)
            .setDescription((0, sanitize_1.truncate)(`${category.identifier} • ${category.enabled ? 'ativa' : 'inativa'}`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION));
        const emoji = selectEmoji(category.emoji);
        if (emoji !== undefined)
            option.setEmoji(emoji);
        return option;
    });
    menu.addOptions(choices);
    return menu;
}
/** Painel de escolha usado por editar, mover, ativar/desativar e excluir. */
function buildCategoryPickerPanel(options) {
    const root = (0, v2_1.container)(options.accent ?? branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, options.title);
    root.addTextDisplayComponents((0, v2_1.text)(options.description));
    root.addSeparatorComponents((0, v2_1.separator)());
    if (options.categories.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.DISABLE} **Nenhuma categoria disponivel para esta acao.**`));
    }
    else {
        root.addActionRowComponents((0, v2_1.selectRow)(buildCategorySelectMenu(options.categories, options.action, options.placeholder, {
            args: options.args ?? [],
        })));
    }
    root.addActionRowComponents((0, v2_1.buttonRow)(backButton()));
    if (options.note !== undefined) {
        root.addTextDisplayComponents((0, v2_1.footerNote)(options.note));
    }
    if (options.categories.length > limits_1.DISCORD_LIMITS.SELECT_OPTIONS) {
        root.addTextDisplayComponents((0, v2_1.footerNote)(`Exibindo as primeiras ${limits_1.DISCORD_LIMITS.SELECT_OPTIONS} de ${options.categories.length} categorias.`));
    }
    return sealed(root);
}
// ---------------------------------------------------------------------------
// Modal de categoria
// ---------------------------------------------------------------------------
function labeled(label, description, input) {
    const builder = new discord_js_1.LabelBuilder().setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL));
    if (description !== null)
        builder.setDescription((0, sanitize_1.truncate)(description, 100));
    return builder.setTextInputComponent(input);
}
function categoryFields(current) {
    const nameInput = new discord_js_1.TextInputBuilder()
        .setCustomId(exports.CATEGORY_FIELD.NAME)
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(limits_1.BUSINESS_LIMITS.CATEGORY_NAME_MAX)
        .setPlaceholder('Ex.: Compras');
    const identifierInput = new discord_js_1.TextInputBuilder()
        .setCustomId(exports.CATEGORY_FIELD.IDENTIFIER)
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder('Ex.: compras (deixe vazio para gerar do nome)');
    const descriptionInput = new discord_js_1.TextInputBuilder()
        .setCustomId(exports.CATEGORY_FIELD.DESCRIPTION)
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(limits_1.BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX)
        .setPlaceholder('Texto curto exibido no menu do cliente.');
    const emojiInput = new discord_js_1.TextInputBuilder()
        .setCustomId(exports.CATEGORY_FIELD.EMOJI)
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(64)
        .setPlaceholder('Ex.: 🛒 ou <:vook:123456789012345678>');
    if (current !== null) {
        nameInput.setValue((0, sanitize_1.truncate)(current.name, limits_1.BUSINESS_LIMITS.CATEGORY_NAME_MAX));
        identifierInput.setValue((0, sanitize_1.truncate)(current.identifier, 40));
        if (current.description !== null && current.description.length > 0) {
            descriptionInput.setValue((0, sanitize_1.truncate)(current.description, limits_1.BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX));
        }
        if (current.emoji !== null && current.emoji.length > 0) {
            emojiInput.setValue((0, sanitize_1.truncate)(current.emoji, 64));
        }
    }
    return [
        labeled('Nome', 'Nome exibido ao cliente no menu de atendimento.', nameInput),
        labeled('Identificador', 'Chave tecnica unica. Gerada do nome se vazia.', identifierInput),
        labeled('Descricao', 'Opcional. Aparece abaixo do nome no menu.', descriptionInput),
        labeled('Emoji', 'Opcional. Um emoji unicode ou emoji do servidor.', emojiInput),
    ];
}
/**
 * Modal de criacao/edicao de categoria.
 * No modo `edit` a categoria e obrigatoria: o id vai no customId do modal e e
 * revalidado no submit.
 */
function buildCategoryModal(mode, category = null) {
    if (mode === 'edit') {
        if (category === null) {
            throw new errors_1.ValidationError('Categoria ausente ao montar o modal de edicao.', {
                userMessage: 'Categoria nao encontrada. Atualize o painel e tente novamente.',
            });
        }
        return new discord_js_1.ModalBuilder()
            .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.EDIT_MODAL, category.id))
            .setTitle('VOOK STORE — EDITAR CATEGORIA')
            .addLabelComponents(categoryFields(category));
    }
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATEGORY, customIds_1.CATEGORY_ACTION.CREATE_MODAL))
        .setTitle('VOOK STORE — NOVA CATEGORIA')
        .addLabelComponents(categoryFields(null));
}
// ---------------------------------------------------------------------------
// Destinos (categoria fisica do Discord)
// ---------------------------------------------------------------------------
/** Descreve o destino atual da categoria, sinalizando canais removidos. */
function destinationLabel(category, guild) {
    if (category.destinationChannelId === null)
        return `${branding_1.EMOJIS.PENDING} destino nao definido`;
    const channel = guild.channels.cache.get(category.destinationChannelId);
    if (channel === undefined) {
        return `${branding_1.EMOJIS.DISABLE} canal removido ou inacessivel (\`${category.destinationChannelId}\`)`;
    }
    if (channel.type !== discord_js_1.ChannelType.GuildText) {
        return `${branding_1.EMOJIS.DISABLE} <#${channel.id}> nao e uma categoria do Discord`;
    }
    return `${branding_1.EMOJIS.ENABLE} <#${channel.id}>`;
}
/** Painel raiz de destinos: onde os canais de cada categoria serao criados. */
function buildDestinationPanel(categories, guild, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.DESTINATIONS);
    root.addTextDisplayComponents(intro(options.notice, `${branding_1.EMOJIS.CHANNELS} O destino e a **categoria do Discord** onde os canais de ticket ` +
        'daquele setor serao criados. Sem destino, o canal e criado na raiz do servidor.'));
    root.addSeparatorComponents((0, v2_1.separator)());
    if (categories.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.DISABLE} **Nenhuma categoria cadastrada.**\n` +
            'Cadastre uma categoria em `/ticket-categorias gerenciar` antes de definir destinos.'));
        return sealed(root);
    }
    const entries = categories.map((category, index) => `**${index + 1}. ${displayEmoji(category.emoji)} ${(0, sanitize_1.truncate)(category.name, 60)}**\n` +
        `-# ${destinationLabel(category, guild)}`);
    root.addTextDisplayComponents((0, v2_1.text)(joinWithBudget(entries)));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.selectRow)(buildCategorySelectMenu(categories, customIds_1.DESTINATION_ACTION.SELECT_CATEGORY, 'Selecionar categoria para configurar o destino', { namespace: customIds_1.NAMESPACE.DESTINATION })));
    root.addTextDisplayComponents((0, v2_1.footerNote)('O bot precisa da permissao Gerenciar Canais na categoria escolhida.'));
    return sealed(root);
}
/** Painel de edicao do destino de UMA categoria. */
function buildDestinationEditPanel(category, guild, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.DESTINATIONS);
    root.addTextDisplayComponents(intro(options.notice, `**Categoria**\n${displayEmoji(category.emoji)} ${(0, sanitize_1.truncate)(category.name, 60)} (\`${category.identifier}\`)\n\n` +
        `**Destino atual**\n${destinationLabel(category, guild)}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    const channelSelect = new discord_js_1.ChannelSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.DESTINATION, customIds_1.DESTINATION_ACTION.SELECT_CHANNEL, category.id))
        .setPlaceholder('Selecionar o canal onde os tickets viram topicos')
        .addChannelTypes(discord_js_1.ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1);
    const current = category.destinationChannelId === null
        ? undefined
        : guild.channels.cache.get(category.destinationChannelId);
    if (current !== undefined && current.type === discord_js_1.ChannelType.GuildText) {
        channelSelect.setDefaultChannels(current.id);
    }
    root.addActionRowComponents((0, v2_1.selectRow)(channelSelect));
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.DESTINATION, customIds_1.DESTINATION_ACTION.CLEAR, category.id))
        .setLabel('Limpar destino')
        .setEmoji(branding_1.EMOJIS.REMOVE)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(category.destinationChannelId === null), backButton(exports.BACK_TARGET.DESTINATION)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Cada ticket vira um TOPICO PRIVADO neste canal. Tickets ja abertos continuam ' +
        'onde estao; a mudanca vale para os proximos.'));
    return sealed(root);
}
// ---------------------------------------------------------------------------
// Equipes (cargos responsaveis por categoria)
// ---------------------------------------------------------------------------
function teamLabel(roleIds) {
    if (roleIds.length === 0)
        return `${branding_1.EMOJIS.PENDING} nenhum cargo definido`;
    const shown = roleIds
        .slice(0, limits_1.BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY)
        .map((roleId) => `<@&${roleId}>`)
        .join(' ');
    return `${branding_1.EMOJIS.ENABLE} ${shown}`;
}
/** Painel raiz de equipes: quais cargos atendem cada categoria. */
function buildTeamPanel(categories, roleIdsByCategory, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.TEAM);
    root.addTextDisplayComponents(intro(options.notice, `${branding_1.EMOJIS.ROLE} A equipe de uma categoria e quem pode assumir, administrar e encerrar ` +
        'os atendimentos daquele setor — e quem recebe acesso ao canal do ticket.'));
    root.addSeparatorComponents((0, v2_1.separator)());
    if (categories.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.DISABLE} **Nenhuma categoria cadastrada.**\n` +
            'Cadastre uma categoria em `/ticket-categorias gerenciar` antes de definir equipes.'));
        return sealed(root);
    }
    const entries = categories.map((category, index) => `**${index + 1}. ${displayEmoji(category.emoji)} ${(0, sanitize_1.truncate)(category.name, 60)}**\n` +
        `-# ${teamLabel(roleIdsByCategory.get(category.id) ?? [])}`);
    root.addTextDisplayComponents((0, v2_1.text)(joinWithBudget(entries)));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.selectRow)(buildCategorySelectMenu(categories, customIds_1.TEAM_ACTION.SELECT_CATEGORY, 'Selecionar categoria para configurar a equipe', { namespace: customIds_1.NAMESPACE.TEAM })));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Ate ${limits_1.BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY} cargos por categoria • ` +
        'administradores do servidor sempre tem acesso.'));
    return sealed(root);
}
/** Painel de edicao da equipe de UMA categoria. */
function buildTeamEditPanel(category, roleIds, options = {}) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.TEAM);
    root.addTextDisplayComponents(intro(options.notice, `**Categoria**\n${displayEmoji(category.emoji)} ${(0, sanitize_1.truncate)(category.name, 60)} (\`${category.identifier}\`)\n\n` +
        `**Equipe atual**\n${teamLabel(roleIds)}`));
    root.addSeparatorComponents((0, v2_1.separator)());
    const roleSelect = new discord_js_1.RoleSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TEAM, customIds_1.TEAM_ACTION.SELECT_ROLES, category.id))
        .setPlaceholder('Selecionar os cargos responsaveis por esta categoria')
        .setMinValues(0)
        .setMaxValues(limits_1.BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY);
    const defaults = roleIds.slice(0, limits_1.BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY);
    if (defaults.length > 0)
        roleSelect.setDefaultRoles(defaults);
    root.addActionRowComponents((0, v2_1.selectRow)(roleSelect));
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TEAM, customIds_1.TEAM_ACTION.CLEAR, category.id))
        .setLabel('Limpar equipe')
        .setEmoji(branding_1.EMOJIS.REMOVE)
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(roleIds.length === 0), backButton(exports.BACK_TARGET.TEAM)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Selecionar nenhum cargo remove toda a equipe desta categoria.'));
    return sealed(root);
}
//# sourceMappingURL=CategoryBuilders.js.map