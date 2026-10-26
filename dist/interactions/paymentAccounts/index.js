"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentAccountModals = exports.paymentAccountSelects = exports.paymentAccountButtons = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const PaymentAccountBuilders_1 = require("../../modules/payments/builders/PaymentAccountBuilders");
const PaymentAccountService_1 = require("../../modules/payments/services/PaymentAccountService");
/** Revalida guild + permissao de administracao a cada interacao. */
function requireAdminContext(interaction) {
    const { member, guildId } = interaction;
    if (guildId === null || !(member instanceof discord_js_1.GuildMember)) {
        throw new errors_1.PermissionError('Interacao de conta PIX fora de uma guild em cache.', {
            userMessage: 'Esta acao so pode ser usada dentro do servidor.',
        });
    }
    (0, PermissionService_1.assertCanManagePaymentAccounts)(member);
    return { guildId, actorId: member.id };
}
function requireSelectedAccountId(interaction) {
    if (!interaction.isStringSelectMenu()) {
        throw new errors_1.ValidationError('Select de conta PIX com tipo inesperado.', {
            userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
        });
    }
    const value = interaction.values[0];
    if (value === undefined || value.length === 0) {
        throw new errors_1.ValidationError('Select de conta PIX sem valor.', {
            userMessage: 'Selecione uma conta para continuar.',
        });
    }
    return value;
}
/** Le os cinco campos do modal e monta a entrada do service. */
function readAccountModal(interaction) {
    const { pixKeyType, defaultExpirationMinutes } = (0, PaymentAccountBuilders_1.parseKeyTypeAndExpiration)(interaction.fields.getTextInputValue(PaymentAccountBuilders_1.ACCOUNT_FIELD.TYPE_EXPIRATION));
    return {
        name: interaction.fields.getTextInputValue(PaymentAccountBuilders_1.ACCOUNT_FIELD.NAME),
        receiverName: interaction.fields.getTextInputValue(PaymentAccountBuilders_1.ACCOUNT_FIELD.RECEIVER),
        pixKey: interaction.fields.getTextInputValue(PaymentAccountBuilders_1.ACCOUNT_FIELD.PIX_KEY),
        city: interaction.fields.getTextInputValue(PaymentAccountBuilders_1.ACCOUNT_FIELD.CITY),
        pixKeyType,
        defaultExpirationMinutes,
    };
}
/** Aviso quando a loja fica sem nenhuma conta apta a receber. */
async function noActiveAccountWarning(guildId) {
    const remaining = (await (0, PaymentAccountService_1.getAccounts)(guildId)).filter((account) => account.enabled && account.deletedAt === null);
    if (remaining.length > 0)
        return [];
    return [
        'Nenhuma conta ativa restante: novas cobrancas PIX ficarao indisponiveis ate ativar uma conta.',
    ];
}
// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------
const createButton = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.CREATE,
    async handle(interaction) {
        const { guildId } = requireAdminContext(interaction);
        const accounts = await (0, PaymentAccountService_1.getAccounts)(guildId);
        if (accounts.length >= PaymentAccountService_1.MAX_ACCOUNTS_PER_GUILD) {
            await (0, reply_1.replyWarning)(interaction, `Este servidor ja possui ${PaymentAccountService_1.MAX_ACCOUNTS_PER_GUILD} contas PIX. Exclua uma antes de cadastrar outra.`);
            return;
        }
        // showModal precisa ser a primeira resposta: nada de defer aqui.
        await interaction.showModal((0, PaymentAccountBuilders_1.buildAccountModal)('create'));
    },
};
const editButton = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.EDIT,
    async handle(interaction) {
        const { guildId } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const accounts = await (0, PaymentAccountService_1.getAccounts)(guildId);
        await (0, reply_1.updateV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountSelectPanel)(accounts, customIds_1.ACCOUNT_ACTION.EDIT_SELECT, {
            prompt: `${branding_1.EMOJIS.EDIT} Escolha a conta que voce quer editar.`,
        }));
    },
};
const toggleButton = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.TOGGLE,
    async handle(interaction) {
        const { guildId } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const accounts = await (0, PaymentAccountService_1.getAccounts)(guildId);
        await (0, reply_1.updateV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountSelectPanel)(accounts, customIds_1.ACCOUNT_ACTION.TOGGLE_SELECT, {
            prompt: `${branding_1.EMOJIS.ENABLE} Escolha a conta para ativar ou desativar.`,
        }));
    },
};
const deleteButton = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.DELETE,
    async handle(interaction) {
        const { guildId } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const accounts = await (0, PaymentAccountService_1.getAccounts)(guildId);
        await (0, reply_1.updateV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountSelectPanel)(accounts, customIds_1.ACCOUNT_ACTION.DELETE_SELECT, {
            prompt: `${branding_1.EMOJIS.DELETE} Escolha a conta que sera excluida.\n` +
                'As cobrancas ja emitidas continuam validas — a conta apenas deixa de ser usada.',
            accentColor: branding_1.COLORS.DANGER,
        }));
    },
};
const listButton = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.LIST,
    async handle(interaction) {
        const { guildId } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const accounts = await (0, PaymentAccountService_1.getAccounts)(guildId);
        await (0, reply_1.updateV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountList)(accounts));
    },
};
const backButton = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.BACK,
    async handle(interaction) {
        const { guildId } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const accounts = await (0, PaymentAccountService_1.getAccounts)(guildId);
        await (0, reply_1.updateV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountMenu)(accounts));
    },
};
exports.paymentAccountButtons = [
    createButton,
    editButton,
    toggleButton,
    deleteButton,
    listButton,
    backButton,
];
// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------
const editSelect = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.EDIT_SELECT,
    async handle(interaction) {
        const { guildId } = requireAdminContext(interaction);
        const accountId = requireSelectedAccountId(interaction);
        const account = await (0, PaymentAccountService_1.getAccountById)(guildId, accountId);
        if (account === null) {
            await (0, reply_1.replyWarning)(interaction, 'Esta conta PIX nao existe mais. Atualize o painel.');
            return;
        }
        await interaction.showModal((0, PaymentAccountBuilders_1.buildAccountModal)('edit', account));
    },
};
const toggleSelect = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.TOGGLE_SELECT,
    async handle(interaction) {
        const { guildId, actorId } = requireAdminContext(interaction);
        const accountId = requireSelectedAccountId(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const account = await (0, PaymentAccountService_1.toggleAccount)({ guildId, accountId, actorId });
        const warnings = account.enabled ? [] : await noActiveAccountWarning(guildId);
        await (0, reply_1.updateV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountSummary)(account, {
            headline: account.enabled
                ? `${branding_1.EMOJIS.APPROVE} **Conta PIX ativada.**`
                : `${branding_1.EMOJIS.DISABLE} **Conta PIX desativada.**`,
            accentColor: account.enabled ? branding_1.COLORS.SUCCESS : branding_1.COLORS.WARNING,
            warnings,
        }));
    },
};
const deleteSelect = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.DELETE_SELECT,
    async handle(interaction) {
        const { guildId, actorId } = requireAdminContext(interaction);
        const accountId = requireSelectedAccountId(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const account = await (0, PaymentAccountService_1.deleteAccount)({ guildId, accountId, actorId });
        const warnings = await noActiveAccountWarning(guildId);
        await (0, reply_1.updateV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountSummary)(account, {
            headline: `${branding_1.EMOJIS.DELETE} **Conta PIX excluida.**`,
            accentColor: branding_1.COLORS.DANGER,
            warnings,
        }));
    },
};
exports.paymentAccountSelects = [editSelect, toggleSelect, deleteSelect];
// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
const createModal = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.CREATE_MODAL,
    async handle(interaction) {
        const { guildId, actorId } = requireAdminContext(interaction);
        // Validacao acontece ANTES do defer: erro de digitacao vira resposta direta.
        const input = readAccountModal(interaction);
        const { warnings } = (0, PaymentAccountService_1.normalizeAccountInput)(input);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const account = await (0, PaymentAccountService_1.createAccountFromInput)({ guildId, actorId, input });
        await (0, reply_1.editReplyV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountSummary)(account, {
            headline: `${branding_1.EMOJIS.APPROVE} **Conta PIX cadastrada.**`,
            warnings,
        }));
    },
};
const editModal = {
    namespace: customIds_1.NAMESPACE.ACCOUNT,
    action: customIds_1.ACCOUNT_ACTION.EDIT_MODAL,
    async handle(interaction, parsed) {
        const { guildId, actorId } = requireAdminContext(interaction);
        const accountId = (0, customIds_1.requireArg)(parsed, 0, 'identificador da conta');
        const input = readAccountModal(interaction);
        const { warnings } = (0, PaymentAccountService_1.normalizeAccountInput)(input);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const account = await (0, PaymentAccountService_1.updateAccountFromInput)({ guildId, accountId, actorId, input });
        await (0, reply_1.editReplyV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountSummary)(account, {
            headline: `${branding_1.EMOJIS.APPROVE} **Conta PIX atualizada.**`,
            warnings,
        }));
    },
};
exports.paymentAccountModals = [createModal, editModal];
//# sourceMappingURL=index.js.map