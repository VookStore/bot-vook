"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configPagamentoCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const PaymentAccountBuilders_1 = require("../../modules/payments/builders/PaymentAccountBuilders");
const PaymentAccountService_1 = require("../../modules/payments/services/PaymentAccountService");
/**
 * /config-pagamento gerenciar
 *
 * Painel administrativo das contas PIX da Vook Store.
 * A resposta e SEMPRE efemera: a tela lista dados do recebedor, e nenhuma
 * informacao de conta pode ficar visivel no canal.
 */
const SUBCOMMAND_MANAGE = 'gerenciar';
exports.configPagamentoCommand = {
    builder: new discord_js_1.SlashCommandBuilder()
        .setName('config-pagamento')
        .setDescription('Gerencia as contas PIX que recebem os pagamentos da Vook Store.')
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
        .addSubcommand((subcommand) => subcommand
        .setName(SUBCOMMAND_MANAGE)
        .setDescription('Abre o painel de contas PIX (resposta privada).')),
    guildOnly: true,
    async execute(interaction) {
        // O default_member_permissions e apenas visual: a permissao real e conferida aqui.
        (0, PermissionService_1.assertCanManagePaymentAccounts)(interaction.member);
        if (interaction.options.getSubcommand() !== SUBCOMMAND_MANAGE) {
            await (0, reply_1.replyError)(interaction, 'Subcomando desconhecido. Use `/config-pagamento gerenciar`.');
            return;
        }
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const accounts = await (0, PaymentAccountService_1.getAccounts)(interaction.guildId);
        await (0, reply_1.editReplyV2)(interaction, (0, PaymentAccountBuilders_1.buildAccountMenu)(accounts));
    },
};
//# sourceMappingURL=configPagamento.js.map