"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_TEXT_LIMITS = exports.IMAGE_FIELD_SEPARATOR = exports.CHANNEL_LABEL = exports.CONFIG_LIMIT_RANGES = exports.LIMITS_FIELD = exports.VISUAL_FIELD = exports.CONFIG_CHANNEL_KEYS = void 0;
exports.buildConfigMenu = buildConfigMenu;
exports.buildChannelsPanel = buildChannelsPanel;
exports.buildAutoRolePanel = buildAutoRolePanel;
exports.buildVisualPanel = buildVisualPanel;
exports.buildVisualModal = buildVisualModal;
exports.buildLimitsPanel = buildLimitsPanel;
exports.buildLimitsModal = buildLimitsModal;
const discord_js_1 = require("discord.js");
const v2_1 = require("../../../components/v2");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const sanitize_1 = require("../../../utils/sanitize");
/**
 * Paineis de configuracao geral da guild (Components V2).
 *
 * Segue o padrao visual do painel publico de atendimento:
 * cabecalho -> blocos de estado separados -> controles no rodape.
 *
 * LIMITE RESPEITADO: um Container aceita no maximo 10 componentes filhos e uma
 * mensagem aceita no maximo 5 action rows. Por isso os blocos de estado sao
 * agrupados em poucos TextDisplay em vez de um componente por secao.
 *
 * Nenhum builder daqui concede permissao: quem trata a interacao revalida
 * `assertCanManageSystem` antes de qualquer leitura ou escrita.
 */
// ---------------------------------------------------------------------------
// Contratos compartilhados com os handlers
// ---------------------------------------------------------------------------
/** Chaves aceitas no customId do select de canais. */
exports.CONFIG_CHANNEL_KEYS = ['panel', 'log', 'welcome', 'review'];
/** customIds dos campos do modal de textos/visual. */
exports.VISUAL_FIELD = {
    STORE_NAME: 'store-name',
    PANEL_TITLE: 'panel-title',
    PANEL_DESCRIPTION: 'panel-description',
    PANEL_NOTICE: 'panel-notice',
    IMAGES: 'panel-images',
};
/** customIds dos campos do modal de limites. */
exports.LIMITS_FIELD = {
    MAX_PER_USER: 'max-user',
    MAX_GUILD: 'max-guild',
    CREATE_COOLDOWN: 'cooldown-create',
    NOTIFY_COOLDOWN: 'cooldown-notify',
    RENAME_COOLDOWN: 'cooldown-rename',
};
/** Intervalos aceitos nos limites (usados na validacao e nas dicas do painel). */
exports.CONFIG_LIMIT_RANGES = {
    MAX_TICKETS_PER_USER: { min: 1, max: 10 },
    MAX_TICKETS_GUILD: { min: 1, max: 10_000 },
    COOLDOWN_SECONDS: { min: 0, max: 3600 },
};
/** Rotulos exibidos ao usuario para cada canal configuravel. */
exports.CHANNEL_LABEL = {
    panel: 'Canal do painel publico',
    log: 'Canal de logs de tickets',
    welcome: 'Canal de boas-vindas',
    review: 'Canal de avaliacoes',
};
/** Separador das tres URLs no campo unico de imagens do modal visual. */
exports.IMAGE_FIELD_SEPARATOR = ' | ';
/** Tamanhos maximos aceitos nos textos configuraveis. */
exports.CONFIG_TEXT_LIMITS = {
    STORE_NAME: 60,
    PANEL_TITLE: 200,
    PANEL_DESCRIPTION: 1200,
    PANEL_NOTICE: 1000,
    /**
     * O campo de imagens carrega TRES URLs de uma vez, cada uma podendo chegar ao
     * teto de `IMAGE_URL_MAX`. O numero e DERIVADO por necessidade: o `TextInput`
     * do Discord recusa `value` maior que `max_length`, entao `modalInput` trunca
     * o preenchimento para nao tomar 400. Com um teto curto, quem abrisse o modal
     * so para trocar o nome da loja salvaria a terceira URL cortada — o banner do
     * ticket sumia sem nenhum aviso.
     */
    IMAGES: limits_1.BUSINESS_LIMITS.IMAGE_URL_MAX * 3 + exports.IMAGE_FIELD_SEPARATOR.length * 2,
};
// ---------------------------------------------------------------------------
// Formatacao de estado
// ---------------------------------------------------------------------------
const NOT_CONFIGURED = 'Nao configurado';
/**
 * Prefixo de subtitulo usado dentro de um bloco de texto agrupado.
 * Equivale ao helper `subheading`, mas sem gastar um componente do container.
 */
const SUBHEADING_PREFIX = '### ';
function onOff(enabled) {
    return enabled ? `${branding_1.EMOJIS.ENABLE} Ativado` : `${branding_1.EMOJIS.DISABLE} Desativado`;
}
/** Menciona o canal ou avisa que ele nao existe mais no servidor. */
function channelState(guild, channelId) {
    if (channelId === null || channelId.length === 0)
        return NOT_CONFIGURED;
    if (!guild.channels.cache.has(channelId))
        return `<#${channelId}> — canal indisponivel`;
    return `<#${channelId}>`;
}
function roleState(guild, roleId) {
    if (roleId === null || roleId.length === 0)
        return NOT_CONFIGURED;
    if (!guild.roles.cache.has(roleId))
        return `<@&${roleId}> — cargo removido`;
    return `<@&${roleId}>`;
}
function textState(value, max = 90) {
    if (value === null || value.trim().length === 0)
        return NOT_CONFIGURED;
    return (0, sanitize_1.truncate)(value.replace(/\n+/g, ' ').trim(), max);
}
function urlState(value) {
    if (value === null || value.length === 0)
        return NOT_CONFIGURED;
    if (!(0, sanitize_1.isSafeImageUrl)(value))
        return 'URL invalida (sera ignorada)';
    return (0, sanitize_1.truncate)(value, 90);
}
function seconds(value) {
    return `${value}s`;
}
// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------
function configButton(action, label, emoji, style = discord_js_1.ButtonStyle.Secondary) {
    const button = new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CONFIG, action))
        .setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.BUTTON_LABEL))
        .setStyle(style);
    if (emoji !== null)
        button.setEmoji({ name: emoji });
    return button;
}
function backButton() {
    return configButton(customIds_1.CONFIG_ACTION.BACK, 'Voltar', null, discord_js_1.ButtonStyle.Secondary);
}
// ---------------------------------------------------------------------------
// Menu principal
// ---------------------------------------------------------------------------
/**
 * Menu principal: mostra o estado completo da configuracao da guild e leva
 * para cada sub-painel.
 */
function buildConfigMenu(config, guild) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    // 8 componentes: cabecalho, separador, texto, separador, texto, separador,
    // linha de botoes e rodape.
    (0, v2_1.addHeader)(root, branding_1.TITLES.CONFIG, {
        thumbnailUrl: (0, sanitize_1.isSafeImageUrl)(config.panelThumbnailUrl) ? config.panelThumbnailUrl : null,
    });
    root.addTextDisplayComponents((0, v2_1.text)([
        (0, v2_1.field)('Nome visual da loja', config.storeName),
        `${SUBHEADING_PREFIX}${branding_1.EMOJIS.CHANNELS} Canais`,
        (0, v2_1.fields)([
            [exports.CHANNEL_LABEL.panel, channelState(guild, config.ticketPanelChannelId)],
            [exports.CHANNEL_LABEL.log, channelState(guild, config.ticketLogChannelId)],
            [exports.CHANNEL_LABEL.welcome, channelState(guild, config.welcomeChannelId)],
            [exports.CHANNEL_LABEL.review, channelState(guild, config.reviewChannelId)],
        ]),
    ].join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)([
        `${SUBHEADING_PREFIX}${branding_1.EMOJIS.ROLE} Entrada de membros`,
        (0, v2_1.fields)([
            ['Auto-role', `${onOff(config.autoRoleEnabled)}\n${roleState(guild, config.autoRoleId)}`],
            ['Mensagem de boas-vindas', onOff(config.welcomeEnabled)],
        ]),
        `${SUBHEADING_PREFIX}${branding_1.EMOJIS.ADMIN} Limites e cooldowns`,
        (0, v2_1.fields)([
            ['Tickets abertos por usuario', String(config.maxOpenTicketsPerUser)],
            ['Tickets abertos no servidor', String(config.maxOpenTicketsGuild)],
            ['Cooldown de criacao', seconds(config.ticketCreateCooldownSeconds)],
            ['Cooldown de notificacao', seconds(config.clientNotifyCooldownSeconds)],
            ['Cooldown de renomear', seconds(config.renameCooldownSeconds)],
        ]),
    ].join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(configButton(customIds_1.CONFIG_ACTION.CHANNELS, 'Canais', branding_1.EMOJIS.CHANNELS), configButton(customIds_1.CONFIG_ACTION.AUTOROLE, 'Auto-Role', branding_1.EMOJIS.ROLE), configButton(customIds_1.CONFIG_ACTION.VISUAL, 'Visual', branding_1.EMOJIS.VISUAL), configButton(customIds_1.CONFIG_ACTION.LIMITS, 'Limites', branding_1.EMOJIS.ADMIN), configButton(customIds_1.CONFIG_ACTION.REFRESH_PANEL, 'Atualizar Painel', branding_1.EMOJIS.REFRESH, discord_js_1.ButtonStyle.Secondary)));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Configuracao de ${(0, sanitize_1.sanitizeConfigText)(guild.name, 60)} — vale apenas para este servidor.`));
    return root;
}
// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------
function channelSelect(key, guild, currentId) {
    const menu = new discord_js_1.ChannelSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CONFIG, customIds_1.CONFIG_ACTION.CHANNEL_SELECT, key))
        .setPlaceholder((0, sanitize_1.truncate)(exports.CHANNEL_LABEL[key], limits_1.DISCORD_LIMITS.SELECT_PLACEHOLDER))
        .addChannelTypes(discord_js_1.ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1);
    // So marca o padrao quando o canal ainda existe: a API recusa IDs invalidos.
    if (currentId !== null && currentId.length > 0 && guild.channels.cache.has(currentId)) {
        menu.setDefaultChannels(currentId);
    }
    return menu;
}
/**
 * Painel de canais: um select por canal (4 linhas) + a linha de botoes.
 * Sao exatamente 5 action rows — o maximo permitido em uma mensagem.
 */
function buildChannelsPanel(config, guild) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    // 9 componentes: cabecalho, separador, texto, 4 selects, botoes e rodape.
    (0, v2_1.addHeader)(root, branding_1.TITLES.CONFIG);
    root.addTextDisplayComponents((0, v2_1.text)([
        `${SUBHEADING_PREFIX}${branding_1.EMOJIS.CHANNELS} Canais do sistema`,
        (0, v2_1.bullets)([
            `${exports.CHANNEL_LABEL.panel}: ${channelState(guild, config.ticketPanelChannelId)}`,
            `${exports.CHANNEL_LABEL.log}: ${channelState(guild, config.ticketLogChannelId)}`,
            `${exports.CHANNEL_LABEL.welcome}: ${channelState(guild, config.welcomeChannelId)}`,
            `${exports.CHANNEL_LABEL.review}: ${channelState(guild, config.reviewChannelId)}`,
        ]),
        'O painel publico recebe a central de atendimento; os logs guardam cada ticket finalizado; boas-vindas e avaliacoes publicam as mensagens automaticas.',
    ].join('\n\n')));
    root.addActionRowComponents((0, v2_1.selectRow)(channelSelect('panel', guild, config.ticketPanelChannelId)));
    root.addActionRowComponents((0, v2_1.selectRow)(channelSelect('log', guild, config.ticketLogChannelId)));
    root.addActionRowComponents((0, v2_1.selectRow)(channelSelect('welcome', guild, config.welcomeChannelId)));
    root.addActionRowComponents((0, v2_1.selectRow)(channelSelect('review', guild, config.reviewChannelId)));
    root.addActionRowComponents((0, v2_1.buttonRow)(backButton()));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Selecione nenhum canal (desmarcando o atual) para limpar a configuracao.'));
    return root;
}
// ---------------------------------------------------------------------------
// Auto-role e boas-vindas
// ---------------------------------------------------------------------------
/** Painel de auto-role: select de cargo + interruptores de auto-role e boas-vindas. */
function buildAutoRolePanel(config, guild) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    // 7 componentes: cabecalho, separador, texto, separador, select, botoes e rodape.
    (0, v2_1.addHeader)(root, branding_1.TITLES.CONFIG);
    root.addTextDisplayComponents((0, v2_1.text)([
        `${SUBHEADING_PREFIX}${branding_1.EMOJIS.ROLE} Auto-role e boas-vindas`,
        (0, v2_1.fields)([
            ['Cargo automatico', roleState(guild, config.autoRoleId)],
            ['Auto-role', onOff(config.autoRoleEnabled)],
            ['Mensagem de boas-vindas', onOff(config.welcomeEnabled)],
            [exports.CHANNEL_LABEL.welcome, channelState(guild, config.welcomeChannelId)],
        ]),
    ].join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    const roleSelect = new discord_js_1.RoleSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CONFIG, customIds_1.CONFIG_ACTION.AUTOROLE_SELECT))
        .setPlaceholder('Cargo entregue a quem entrar no servidor')
        .setMinValues(0)
        .setMaxValues(1);
    if (config.autoRoleId !== null &&
        config.autoRoleId.length > 0 &&
        guild.roles.cache.has(config.autoRoleId)) {
        roleSelect.setDefaultRoles(config.autoRoleId);
    }
    root.addActionRowComponents((0, v2_1.selectRow)(roleSelect));
    root.addActionRowComponents((0, v2_1.buttonRow)(configButton(customIds_1.CONFIG_ACTION.AUTOROLE_TOGGLE, config.autoRoleEnabled ? 'Desativar auto-role' : 'Ativar auto-role', config.autoRoleEnabled ? branding_1.EMOJIS.DISABLE : branding_1.EMOJIS.ENABLE, config.autoRoleEnabled ? discord_js_1.ButtonStyle.Secondary : discord_js_1.ButtonStyle.Secondary), configButton(customIds_1.CONFIG_ACTION.WELCOME_TOGGLE, config.welcomeEnabled ? 'Desativar boas-vindas' : 'Ativar boas-vindas', config.welcomeEnabled ? branding_1.EMOJIS.DISABLE : branding_1.EMOJIS.ENABLE, config.welcomeEnabled ? discord_js_1.ButtonStyle.Secondary : discord_js_1.ButtonStyle.Secondary), backButton()));
    root.addTextDisplayComponents((0, v2_1.footerNote)('O cargo precisa estar abaixo do cargo do bot na hierarquia do servidor.'));
    return root;
}
// ---------------------------------------------------------------------------
// Visual (textos e imagens do painel publico)
// ---------------------------------------------------------------------------
/** Painel visual: mostra os textos atuais e abre o modal de edicao. */
function buildVisualPanel(config) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    // 6 componentes: cabecalho, separador, texto, separador, botoes e rodape.
    (0, v2_1.addHeader)(root, branding_1.TITLES.CONFIG);
    root.addTextDisplayComponents((0, v2_1.text)([
        `${SUBHEADING_PREFIX}${branding_1.EMOJIS.VISUAL} Identidade do painel publico`,
        (0, v2_1.fields)([
            ['Nome visual da loja', textState(config.storeName)],
            ['Titulo do painel', textState(config.panelTitle)],
            ['Descricao do painel', textState(config.panelDescription, 200)],
            ['Avisos do painel', textState(config.panelNotice, 200)],
            ['Thumbnail', urlState(config.panelThumbnailUrl)],
            ['Banner', urlState(config.panelBannerUrl)],
        ]),
    ].join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(configButton(customIds_1.CONFIG_ACTION.VISUAL_MODAL, 'Editar textos', branding_1.EMOJIS.EDIT, discord_js_1.ButtonStyle.Secondary), backButton()));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Apos salvar, use "Atualizar Painel" para republicar a central de atendimento.'));
    return root;
}
function modalRow(input) {
    return new discord_js_1.ActionRowBuilder().addComponents(input);
}
function modalInput(params) {
    const input = new discord_js_1.TextInputBuilder()
        .setCustomId(params.customId)
        .setLabel((0, sanitize_1.truncate)(params.label, limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setStyle(params.style)
        .setRequired(params.required)
        .setMaxLength(Math.min(params.maxLength, limits_1.DISCORD_LIMITS.TEXT_INPUT_SHORT_VALUE));
    if (params.placeholder !== undefined) {
        input.setPlaceholder((0, sanitize_1.truncate)(params.placeholder, limits_1.DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));
    }
    if (params.value !== undefined && params.value !== null && params.value.length > 0) {
        input.setValue((0, sanitize_1.truncate)(params.value, params.maxLength));
    }
    return input;
}
/** Modal de textos: nome da loja, titulo, descricao, avisos e as duas imagens. */
function buildVisualModal(config) {
    const partes = [
        config.panelThumbnailUrl ?? '',
        config.panelBannerUrl ?? '',
        config.ticketBannerUrl ?? '',
    ];
    const images = partes.some((parte) => parte.length > 0)
        ? partes.join(exports.IMAGE_FIELD_SEPARATOR)
        : '';
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CONFIG, customIds_1.CONFIG_ACTION.VISUAL_MODAL))
        .setTitle((0, sanitize_1.truncate)('Vook Store — Textos do painel', limits_1.DISCORD_LIMITS.MODAL_TITLE))
        .addComponents(modalRow(modalInput({
        customId: exports.VISUAL_FIELD.STORE_NAME,
        label: 'Nome visual da loja',
        style: discord_js_1.TextInputStyle.Short,
        required: true,
        maxLength: exports.CONFIG_TEXT_LIMITS.STORE_NAME,
        value: config.storeName,
    })), modalRow(modalInput({
        customId: exports.VISUAL_FIELD.PANEL_TITLE,
        label: 'Titulo do painel',
        style: discord_js_1.TextInputStyle.Short,
        required: true,
        maxLength: exports.CONFIG_TEXT_LIMITS.PANEL_TITLE,
        value: config.panelTitle,
    })), modalRow(modalInput({
        customId: exports.VISUAL_FIELD.PANEL_DESCRIPTION,
        label: 'Descricao do painel',
        style: discord_js_1.TextInputStyle.Paragraph,
        required: true,
        maxLength: exports.CONFIG_TEXT_LIMITS.PANEL_DESCRIPTION,
        value: config.panelDescription,
    })), modalRow(modalInput({
        customId: exports.VISUAL_FIELD.PANEL_NOTICE,
        label: 'Avisos do painel',
        style: discord_js_1.TextInputStyle.Paragraph,
        required: false,
        maxLength: exports.CONFIG_TEXT_LIMITS.PANEL_NOTICE,
        value: config.panelNotice,
        placeholder: 'Deixe vazio para nao exibir avisos.',
    })), modalRow(modalInput({
        customId: exports.VISUAL_FIELD.IMAGES,
        label: 'Thumbnail | Banner painel | Banner ticket',
        style: discord_js_1.TextInputStyle.Paragraph,
        required: false,
        maxLength: exports.CONFIG_TEXT_LIMITS.IMAGES,
        value: images,
        placeholder: 'https://.../logo.png | https://.../painel.png | https://.../ticket.gif',
    })));
}
// ---------------------------------------------------------------------------
// Limites e cooldowns
// ---------------------------------------------------------------------------
function rangeHint(range) {
    return `permitido de ${range.min} a ${range.max}`;
}
/** Painel de limites: mostra os valores atuais e abre o modal de edicao. */
function buildLimitsPanel(config) {
    const root = (0, v2_1.container)(branding_1.COLORS.WARNING);
    // 6 componentes: cabecalho, separador, texto, separador, botoes e rodape.
    (0, v2_1.addHeader)(root, branding_1.TITLES.CONFIG);
    root.addTextDisplayComponents((0, v2_1.text)(`${SUBHEADING_PREFIX}${branding_1.EMOJIS.ADMIN} Limites e cooldowns\n\n` +
        (0, v2_1.fields)([
            [
                'Tickets abertos por usuario',
                `${config.maxOpenTicketsPerUser} (${rangeHint(exports.CONFIG_LIMIT_RANGES.MAX_TICKETS_PER_USER)})`,
            ],
            [
                'Tickets abertos no servidor',
                `${config.maxOpenTicketsGuild} (${rangeHint(exports.CONFIG_LIMIT_RANGES.MAX_TICKETS_GUILD)})`,
            ],
            [
                'Cooldown de criacao',
                `${seconds(config.ticketCreateCooldownSeconds)} (${rangeHint(exports.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS)})`,
            ],
            [
                'Cooldown de notificacao',
                `${seconds(config.clientNotifyCooldownSeconds)} (${rangeHint(exports.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS)})`,
            ],
            [
                'Cooldown de renomear',
                `${seconds(config.renameCooldownSeconds)} (${rangeHint(exports.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS)})`,
            ],
        ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(configButton(customIds_1.CONFIG_ACTION.LIMITS_MODAL, 'Editar limites', branding_1.EMOJIS.EDIT, discord_js_1.ButtonStyle.Secondary), backButton()));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Use 0 para desativar um cooldown.'));
    return root;
}
/** Modal de limites: cinco campos numericos inteiros. */
function buildLimitsModal(config) {
    const numberInput = (customId, label, value, range) => modalRow(modalInput({
        customId,
        label,
        style: discord_js_1.TextInputStyle.Short,
        required: true,
        maxLength: 5,
        value: String(value),
        placeholder: `Numero inteiro de ${range.min} a ${range.max}`,
    }));
    return new discord_js_1.ModalBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CONFIG, customIds_1.CONFIG_ACTION.LIMITS_MODAL))
        .setTitle((0, sanitize_1.truncate)('Vook Store — Limites', limits_1.DISCORD_LIMITS.MODAL_TITLE))
        .addComponents(numberInput(exports.LIMITS_FIELD.MAX_PER_USER, 'Max tickets por usuario', config.maxOpenTicketsPerUser, exports.CONFIG_LIMIT_RANGES.MAX_TICKETS_PER_USER), numberInput(exports.LIMITS_FIELD.MAX_GUILD, 'Max tickets no servidor', config.maxOpenTicketsGuild, exports.CONFIG_LIMIT_RANGES.MAX_TICKETS_GUILD), numberInput(exports.LIMITS_FIELD.CREATE_COOLDOWN, 'Cooldown de criacao (s)', config.ticketCreateCooldownSeconds, exports.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS), numberInput(exports.LIMITS_FIELD.NOTIFY_COOLDOWN, 'Cooldown de notificacao (s)', config.clientNotifyCooldownSeconds, exports.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS), numberInput(exports.LIMITS_FIELD.RENAME_COOLDOWN, 'Cooldown de rename (s)', config.renameCooldownSeconds, exports.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS));
}
//# sourceMappingURL=ConfigBuilders.js.map