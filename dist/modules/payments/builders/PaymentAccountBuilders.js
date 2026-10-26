"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_FIELD = void 0;
exports.maskPixKey = maskPixKey;
exports.buildAccountBackButton = buildAccountBackButton;
exports.buildAccountMenu = buildAccountMenu;
exports.buildAccountList = buildAccountList;
exports.buildAccountSelect = buildAccountSelect;
exports.buildAccountSelectPanel = buildAccountSelectPanel;
exports.buildAccountSummary = buildAccountSummary;
exports.buildAccountModal = buildAccountModal;
exports.parseKeyTypeAndExpiration = parseKeyTypeAndExpiration;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const v2_1 = require("../../../components/v2");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const sanitize_1 = require("../../../utils/sanitize");
const PaymentAccountService_1 = require("../services/PaymentAccountService");
const PixKeyValidator_1 = require("../validators/PixKeyValidator");
const PixPayloadService_1 = require("../services/PixPayloadService");
/** Ids dos campos dentro do modal (nao sao roteados: valem so dentro do form). */
exports.ACCOUNT_FIELD = {
    NAME: 'name',
    RECEIVER: 'receiver',
    PIX_KEY: 'pix-key',
    CITY: 'city',
    TYPE_EXPIRATION: 'type-expiration',
};
/**
 * Orcamento de texto da listagem. Fica abaixo do teto de uma mensagem V2 para
 * sobrar espaco ao cabecalho, aos rodapes e ao botao de retorno.
 */
const LIST_TEXT_BUDGET = Math.floor(limits_1.DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL * 0.75);
const MASK_CHAR = '•';
const MASK_VISIBLE_CHARS = 4;
/** Teto de marcadores para nao gerar uma linha gigante com UUID. */
const MASK_MAX_HIDDEN = 12;
/**
 * Versao segura da chave PIX para exibicao em painel.
 * Mostra apenas os ultimos caracteres; e-mail vira `a***@dominio`.
 */
function maskPixKey(key, type) {
    const raw = String(key ?? '').trim();
    if (raw.length === 0)
        return MASK_CHAR.repeat(MASK_VISIBLE_CHARS);
    if (type === client_1.PixKeyType.EMAIL) {
        const at = raw.lastIndexOf('@');
        if (at > 0 && at < raw.length - 1) {
            const local = raw.slice(0, at);
            const domain = raw.slice(at + 1);
            const head = local.length > 1 ? local.slice(0, 1) : '';
            return `${head}***@${domain}`;
        }
    }
    if (raw.length <= MASK_VISIBLE_CHARS)
        return MASK_CHAR.repeat(raw.length);
    const hidden = Math.min(MASK_MAX_HIDDEN, raw.length - MASK_VISIBLE_CHARS);
    return `${MASK_CHAR.repeat(hidden)}${raw.slice(-MASK_VISIBLE_CHARS)}`;
}
function isUsable(account) {
    return account.enabled && account.deletedAt === null;
}
function statusLabel(account) {
    return isUsable(account) ? `${branding_1.EMOJIS.ENABLE} Ativa` : `${branding_1.EMOJIS.DISABLE} Inativa`;
}
function accountButton(action, label, style, emoji, disabled) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ACCOUNT, action))
        .setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.BUTTON_LABEL))
        .setStyle(style)
        .setEmoji(emoji)
        .setDisabled(disabled);
}
/** Botao de retorno ao menu principal de contas. */
function buildAccountBackButton() {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ACCOUNT, customIds_1.ACCOUNT_ACTION.BACK))
        .setLabel('Voltar')
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setEmoji('↩️');
}
// ---------------------------------------------------------------------------
// Menu principal
// ---------------------------------------------------------------------------
/** Painel administrativo das contas PIX. Resposta sempre efemera. */
function buildAccountMenu(accounts) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.PAYMENT_ACCOUNTS);
    root.addTextDisplayComponents((0, v2_1.text)('Cadastre aqui as contas que recebem os pagamentos PIX da Vook Store.\n' +
        'A chave completa nunca aparece em painel publico — nas listagens ela e exibida mascarada.'));
    root.addSeparatorComponents((0, v2_1.separator)());
    const active = accounts.filter(isUsable);
    const preferred = active[0];
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Contas cadastradas', String(accounts.length)],
        ['Contas ativas', String(active.length)],
        [
            'Conta padrao',
            preferred === undefined
                ? 'Nenhuma conta ativa'
                : `${preferred.name} (\`${preferred.identifier}\`)`,
        ],
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    const empty = accounts.length === 0;
    root.addActionRowComponents((0, v2_1.buttonRow)(accountButton(customIds_1.ACCOUNT_ACTION.CREATE, 'Criar', discord_js_1.ButtonStyle.Secondary, branding_1.EMOJIS.ADD, false), accountButton(customIds_1.ACCOUNT_ACTION.EDIT, 'Editar', discord_js_1.ButtonStyle.Secondary, branding_1.EMOJIS.EDIT, empty), accountButton(customIds_1.ACCOUNT_ACTION.TOGGLE, 'Ativar/Desativar', discord_js_1.ButtonStyle.Secondary, branding_1.EMOJIS.ENABLE, empty), accountButton(customIds_1.ACCOUNT_ACTION.DELETE, 'Excluir', discord_js_1.ButtonStyle.Secondary, branding_1.EMOJIS.DELETE, empty), accountButton(customIds_1.ACCOUNT_ACTION.LIST, 'Listar', discord_js_1.ButtonStyle.Secondary, branding_1.EMOJIS.LIST, empty)));
    if (empty) {
        root.addTextDisplayComponents((0, v2_1.footerNote)('Nenhuma conta cadastrada. Use "Criar" para registrar a primeira.'));
    }
    else if (active.length === 0) {
        root.addTextDisplayComponents((0, v2_1.footerNote)('Todas as contas estao inativas: nenhuma cobranca PIX podera ser gerada.'));
    }
    return root;
}
// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------
/** Listagem detalhada com a chave PIX MASCARADA. Resposta sempre efemera. */
function buildAccountList(accounts) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, branding_1.TITLES.PAYMENT_ACCOUNTS);
    if (accounts.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhuma conta PIX cadastrada neste servidor.'));
        root.addActionRowComponents((0, v2_1.buttonRow)(buildAccountBackButton()));
        return root;
    }
    // O limite de texto de uma mensagem V2 e somado entre todos os TextDisplay:
    // paramos de acrescentar contas antes de estourar, em vez de tomar 400 da API.
    const blocks = [];
    let used = 0;
    for (const account of accounts) {
        const lines = [
            `**${account.name}** \`${account.identifier}\` — ${statusLabel(account)}`,
            `${(0, PixKeyValidator_1.describePixKeyType)(account.pixKeyType)}: \`${maskPixKey(account.pixKey, account.pixKeyType)}\``,
            `${account.receiverName} — ${account.city} · expira em ${account.defaultExpirationMinutes} min`,
        ];
        if (account.description !== null && account.description.length > 0) {
            lines.push(`-# ${account.description}`);
        }
        const block = lines.join('\n');
        if (blocks.length > 0 && used + block.length > LIST_TEXT_BUDGET)
            break;
        blocks.push((0, sanitize_1.truncate)(block, LIST_TEXT_BUDGET));
        used += block.length + 2;
    }
    root.addTextDisplayComponents((0, v2_1.text)(blocks.join('\n\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    if (accounts.length > blocks.length) {
        root.addTextDisplayComponents((0, v2_1.footerNote)(`Exibindo ${blocks.length} de ${accounts.length} contas cadastradas.`));
    }
    root.addTextDisplayComponents((0, v2_1.footerNote)('Chaves exibidas de forma parcial. Abra "Editar" para conferir a chave completa.'));
    root.addActionRowComponents((0, v2_1.buttonRow)(buildAccountBackButton()));
    return root;
}
// ---------------------------------------------------------------------------
// Selecao
// ---------------------------------------------------------------------------
/** Select de contas para uma acao especifica (editar, ativar, excluir). */
function buildAccountSelect(accounts, action) {
    const menu = new discord_js_1.StringSelectMenuBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ACCOUNT, action))
        .setPlaceholder('Selecionar conta PIX')
        .setMinValues(1)
        .setMaxValues(1);
    const options = accounts.slice(0, limits_1.DISCORD_LIMITS.SELECT_OPTIONS).map((account) => new discord_js_1.StringSelectMenuOptionBuilder()
        .setLabel((0, sanitize_1.truncate)(account.name, limits_1.DISCORD_LIMITS.SELECT_LABEL))
        .setValue(account.id)
        .setDescription((0, sanitize_1.truncate)(`${account.identifier} • ${isUsable(account) ? 'ativa' : 'inativa'} • ${(0, PixKeyValidator_1.describePixKeyType)(account.pixKeyType)}`, limits_1.DISCORD_LIMITS.SELECT_DESCRIPTION))
        .setEmoji(isUsable(account) ? branding_1.EMOJIS.ENABLE : branding_1.EMOJIS.DISABLE));
    menu.addOptions(options);
    return menu;
}
/**
 * Painel que apresenta o select de contas para a acao escolhida.
 * Quando nao ha conta, exibe aviso em vez de um select vazio (a API recusaria).
 */
function buildAccountSelectPanel(accounts, action, options) {
    const root = (0, v2_1.container)(options.accentColor ?? branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.PAYMENT_ACCOUNTS);
    if (accounts.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhuma conta PIX cadastrada neste servidor.'));
        root.addActionRowComponents((0, v2_1.buttonRow)(buildAccountBackButton()));
        return root;
    }
    root.addTextDisplayComponents((0, v2_1.text)(options.prompt));
    root.addActionRowComponents((0, v2_1.selectRow)(buildAccountSelect(accounts, action)));
    root.addActionRowComponents((0, v2_1.buttonRow)(buildAccountBackButton()));
    if (accounts.length > limits_1.DISCORD_LIMITS.SELECT_OPTIONS) {
        root.addTextDisplayComponents((0, v2_1.footerNote)(`Exibindo as primeiras ${limits_1.DISCORD_LIMITS.SELECT_OPTIONS} contas de ${accounts.length}.`));
    }
    return root;
}
/** Resumo de uma conta apos criacao/edicao (efemero, chave mascarada). */
function buildAccountSummary(account, options) {
    const root = (0, v2_1.container)(options.accentColor ?? branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, branding_1.TITLES.PAYMENT_ACCOUNTS);
    root.addTextDisplayComponents((0, v2_1.text)(options.headline));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Conta', `${account.name} (\`${account.identifier}\`)`],
        ['Situacao', statusLabel(account)],
        [
            'Chave PIX',
            `${(0, PixKeyValidator_1.describePixKeyType)(account.pixKeyType)} · \`${maskPixKey(account.pixKey, account.pixKeyType)}\``,
        ],
        ['Recebedor', `${account.receiverName} — ${account.city}`],
        ['Expiracao padrao', `${account.defaultExpirationMinutes} minutos`],
    ])));
    const warnings = options.warnings ?? [];
    if (warnings.length > 0) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.PENDING} **Ajustes aplicados**\n${warnings.map((w) => `• ${w}`).join('\n')}`));
    }
    root.addActionRowComponents((0, v2_1.buttonRow)(buildAccountBackButton()));
    return root;
}
function textField(customId, label, description, configure) {
    return new discord_js_1.LabelBuilder()
        .setLabel((0, sanitize_1.truncate)(label, limits_1.DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setDescription((0, sanitize_1.truncate)(description, limits_1.DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER))
        .setTextInputComponent(configure(new discord_js_1.TextInputBuilder()
        .setCustomId(customId)
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)));
}
/** Texto do campo combinado "tipo | minutos" exibido na edicao. */
function typeExpirationValue(account) {
    return `${account.pixKeyType} | ${account.defaultExpirationMinutes}`;
}
/**
 * Formulario de cadastro/edicao da conta PIX.
 *
 * O modal tem no maximo 5 campos, entao o tipo da chave e a expiracao dividem
 * um unico campo no formato "EMAIL | 30" (ver `parseKeyTypeAndExpiration`).
 */
function buildAccountModal(mode, account) {
    let customId;
    if (mode === 'edit') {
        if (account === undefined) {
            throw new errors_1.ValidationError('Modal de edicao exige a conta de origem.', {
                userMessage: 'Nao foi possivel abrir o formulario. Atualize o painel e tente novamente.',
            });
        }
        customId = (0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ACCOUNT, customIds_1.ACCOUNT_ACTION.EDIT_MODAL, account.id);
    }
    else {
        customId = (0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.ACCOUNT, customIds_1.ACCOUNT_ACTION.CREATE_MODAL);
    }
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId(customId)
        .setTitle((0, sanitize_1.truncate)(mode === 'edit' ? 'Editar conta PIX' : 'Nova conta PIX', limits_1.DISCORD_LIMITS.MODAL_TITLE));
    modal.addLabelComponents(textField(exports.ACCOUNT_FIELD.NAME, 'Nome de exibicao', 'Como a conta aparece para a equipe.', (input) => {
        input.setPlaceholder('Conta principal').setMaxLength(PaymentAccountService_1.ACCOUNT_NAME_MAX).setMinLength(2);
        if (account !== undefined)
            input.setValue(account.name);
        return input;
    }), textField(exports.ACCOUNT_FIELD.RECEIVER, 'Nome do recebedor', `Sem acento, MAIUSCULO, ate ${limits_1.BUSINESS_LIMITS.PIX_RECEIVER_NAME_MAX} caracteres.`, (input) => {
        input.setPlaceholder('VOOK STORE LTDA').setMaxLength(80);
        if (account !== undefined)
            input.setValue(account.receiverName);
        return input;
    }), textField(exports.ACCOUNT_FIELD.PIX_KEY, 'Chave PIX', 'CPF, CNPJ, e-mail, telefone ou aleatoria.', (input) => {
        input.setPlaceholder('pagamentos@vookstore.com').setMaxLength(120);
        if (account !== undefined)
            input.setValue(account.pixKey);
        return input;
    }), textField(exports.ACCOUNT_FIELD.CITY, 'Cidade', `Sem acento, MAIUSCULO, ate ${limits_1.BUSINESS_LIMITS.PIX_CITY_MAX} caracteres.`, (input) => {
        input.setPlaceholder('SAO PAULO').setMaxLength(60);
        if (account !== undefined)
            input.setValue(account.city);
        return input;
    }), textField(exports.ACCOUNT_FIELD.TYPE_EXPIRATION, 'Tipo da chave e expiracao', `Ex.: EMAIL | 30 (minutos entre ${PaymentAccountService_1.EXPIRATION_MIN_MINUTES} e ${PaymentAccountService_1.EXPIRATION_MAX_MINUTES}).`, (input) => {
        input.setPlaceholder('EMAIL | 30').setMaxLength(40);
        input.setValue(account !== undefined
            ? typeExpirationValue(account)
            : `EMAIL | ${PaymentAccountService_1.DEFAULT_EXPIRATION_MINUTES}`);
        return input;
    }));
    return modal;
}
// ---------------------------------------------------------------------------
// Leitura do campo combinado "tipo | minutos"
// ---------------------------------------------------------------------------
/** Sinonimos aceitos no campo de tipo (o usuario pode digitar em portugues). */
const PIX_KEY_TYPE_ALIASES = new Map([
    ['CPF', client_1.PixKeyType.CPF],
    ['CNPJ', client_1.PixKeyType.CNPJ],
    ['EMAIL', client_1.PixKeyType.EMAIL],
    ['MAIL', client_1.PixKeyType.EMAIL],
    ['PHONE', client_1.PixKeyType.PHONE],
    ['TEL', client_1.PixKeyType.PHONE],
    ['TELEFONE', client_1.PixKeyType.PHONE],
    ['CELULAR', client_1.PixKeyType.PHONE],
    ['RANDOM', client_1.PixKeyType.RANDOM],
    ['ALEATORIA', client_1.PixKeyType.RANDOM],
    ['ALEATORIO', client_1.PixKeyType.RANDOM],
    ['CHAVEALEATORIA', client_1.PixKeyType.RANDOM],
    ['UUID', client_1.PixKeyType.RANDOM],
]);
/** Folga para ler o rotulo do tipo antes de normalizar (cabe em "chave aleatoria"). */
const TYPE_TOKEN_SCAN_LIMIT = 40;
/**
 * Interpreta "EMAIL | 30", "email/30", "telefone 45" ou apenas "CPF".
 * Sem os minutos, assume a expiracao padrao — a faixa valida e conferida
 * depois, no PaymentAccountService.
 */
function parseKeyTypeAndExpiration(raw) {
    const cleaned = String(raw ?? '').trim();
    let parts = cleaned
        .split(/[|/,;]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const single = parts.length === 1 ? parts[0] : undefined;
    if (single !== undefined) {
        parts = single.split(/\s+/).filter((part) => part.length > 0);
    }
    // O rotulo do tipo pode ocupar mais de um token ("chave aleatoria"); os
    // minutos sao o primeiro token que contem digito. Sem isso, um rotulo
    // composto separado por espaco nunca chegaria a tabela de sinonimos.
    const minutesIndex = parts.findIndex((part) => /[0-9]/.test(part));
    const typeParts = minutesIndex === -1 ? parts : parts.slice(0, minutesIndex);
    const typeToken = (0, PixPayloadService_1.normalizePixText)(typeParts.join(' '), TYPE_TOKEN_SCAN_LIMIT)
        .toUpperCase()
        .replace(/[^A-Z]/g, '');
    const pixKeyType = PIX_KEY_TYPE_ALIASES.get(typeToken);
    if (pixKeyType === undefined) {
        throw new errors_1.ValidationError(`Tipo de chave PIX nao reconhecido: "${cleaned}"`, {
            userMessage: 'Tipo de chave invalido. Use CPF, CNPJ, EMAIL, PHONE ou RANDOM — ' +
                'por exemplo: `EMAIL | 30`.',
        });
    }
    const minutesToken = minutesIndex === -1 ? '' : (parts[minutesIndex] ?? '').replace(/[^0-9]/g, '');
    const minutes = minutesToken.length > 0 ? Number.parseInt(minutesToken, 10) : PaymentAccountService_1.DEFAULT_EXPIRATION_MINUTES;
    return { pixKeyType, defaultExpirationMinutes: minutes };
}
//# sourceMappingURL=PaymentAccountBuilders.js.map