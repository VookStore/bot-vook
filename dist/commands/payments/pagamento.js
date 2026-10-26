"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pagamentoCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const limits_1 = require("../../constants/limits");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const money_1 = require("../../utils/money");
const sanitize_1 = require("../../utils/sanitize");
const PaymentBuilders_1 = require("../../modules/payments/builders/PaymentBuilders");
const PaymentDraftService_1 = require("../../modules/payments/services/PaymentDraftService");
const PaymentAccountService_1 = require("../../modules/payments/services/PaymentAccountService");
/**
 * /pagamento criar — o VENDEDOR gera a cobranca para o cliente.
 *
 * O cliente nunca cria cobranca nem escolhe cupom: o cupom e selecionado pela
 * equipe no painel de confirmacao exibido por este comando.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('pagamento')
    .setDescription('Cobrancas PIX da Vook Store')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageMessages)
    .addSubcommand((subcommand) => subcommand
    .setName('criar')
    .setDescription('Gera uma cobranca PIX para um cliente')
    .addUserOption((option) => option.setName('cliente').setDescription('Cliente que ira pagar').setRequired(true))
    .addStringOption((option) => option
    .setName('valor')
    .setDescription('Valor da cobranca. Ex.: 250,00')
    .setRequired(true)
    .setMaxLength(20))
    .addStringOption((option) => option
    .setName('descricao')
    .setDescription('Produto ou servico cobrado')
    .setRequired(true)
    .setMaxLength(limits_1.BUSINESS_LIMITS.PAYMENT_DESCRIPTION_MAX))
    .addStringOption((option) => option
    .setName('conta')
    .setDescription('Conta PIX que recebera o valor (padrao: primeira conta ativa)')
    .setRequired(false)
    .setAutocomplete(true)));
async function execute(interaction) {
    await (0, PermissionService_1.assertCanCreatePayments)(interaction.member);
    const customer = interaction.options.getUser('cliente', true);
    if (customer.bot) {
        throw new errors_1.ValidationError('Cliente e um bot.', {
            userMessage: 'Nao e possivel gerar cobranca para um bot.',
        });
    }
    const amountCents = (0, money_1.parsePaymentAmount)(interaction.options.getString('valor', true));
    const description = (0, sanitize_1.sanitizeConfigText)(interaction.options.getString('descricao', true), limits_1.BUSINESS_LIMITS.PAYMENT_DESCRIPTION_MAX);
    if (description.length === 0) {
        throw new errors_1.ValidationError('Descricao vazia apos sanitizacao.', {
            userMessage: 'Informe uma descricao valida para a cobranca.',
        });
    }
    const requestedAccountId = interaction.options.getString('conta');
    const account = requestedAccountId !== null
        ? await (0, PaymentAccountService_1.getAccountById)(interaction.guildId, requestedAccountId)
        : await (0, PaymentAccountService_1.getDefaultAccount)(interaction.guildId);
    if (account === null || account.deletedAt !== null || !account.enabled) {
        throw new errors_1.ConfigurationError('Nenhuma conta PIX utilizavel.', {
            userMessage: 'Nenhuma conta PIX ativa foi encontrada. Cadastre uma em `/config-pagamento gerenciar`.',
        });
    }
    if (interaction.channelId === null) {
        throw new errors_1.ValidationError('Comando sem canal.', {
            userMessage: 'Nao foi possivel identificar o canal desta cobranca.',
        });
    }
    const draft = (0, PaymentDraftService_1.createDraft)({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        createdById: interaction.user.id,
        customerId: customer.id,
        accountId: account.id,
        description,
        amountCents,
    });
    await (0, reply_1.replyV2)(interaction, (0, PaymentBuilders_1.buildChargeDraftPanel)({
        draftId: draft.id,
        customerId: customer.id,
        description,
        account,
        pricing: { originalAmount: amountCents, discountAmount: 0, finalAmount: amountCents },
        couponCode: null,
        expirationMinutes: account.defaultExpirationMinutes,
    }), { ephemeral: true });
}
/**
 * Autocomplete da opcao `conta`.
 *
 * Revalida a permissao igual ao `execute`: o autocomplete e uma interacao
 * separada, e `setDefaultMemberPermissions` e apenas visual (a permissao real
 * e cargo de equipe / ManageGuild). Sem esta checagem qualquer membro que
 * enxergasse o comando lia a lista de contas PIX da loja.
 *
 * O rotulo tambem NAO expoe mais o `receiverName` (nome civil do titular da
 * conta): ele so aparece em painel efemero de admin.
 */
async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'conta') {
        await interaction.respond([]);
        return;
    }
    if (!(await (0, PermissionService_1.canCreatePayments)(interaction.member))) {
        await interaction.respond([]);
        return;
    }
    const query = focused.value.toLowerCase().trim();
    const accounts = await (0, PaymentAccountService_1.getEnabledAccounts)(interaction.guildId);
    const choices = accounts
        .filter((account) => query.length === 0 ||
        account.name.toLowerCase().includes(query) ||
        account.identifier.toLowerCase().includes(query))
        .slice(0, limits_1.DISCORD_LIMITS.AUTOCOMPLETE_CHOICES)
        .map((account) => ({
        name: (0, sanitize_1.truncate)(`${account.name} (${account.identifier})`, 100),
        value: account.id,
    }));
    await interaction.respond(choices);
}
exports.pagamentoCommand = {
    builder,
    guildOnly: true,
    execute,
    autocomplete,
};
//# sourceMappingURL=pagamento.js.map