"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cupomCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const CouponBuilders_1 = require("../../modules/coupons/builders/CouponBuilders");
const CouponService_1 = require("../../modules/coupons/services/CouponService");
const errors_1 = require("../../core/errors");
/**
 * `/cupom gerenciar` — painel administrativo de cupons.
 *
 * Cupom e ferramenta INTERNA: o cliente nunca ve este comando nem digita codigo.
 * Quem aplica o desconto e o vendedor, na cobranca PIX.
 *
 * A permissao padrao (`ManageGuild`) esconde o comando de quem nao e
 * administrador, mas a autorizacao real e sempre revalidada no `execute` —
 * permissao de comando no Discord e apenas visual.
 */
const SUBCOMMAND_MANAGE = 'gerenciar';
exports.cupomCommand = {
    builder: new discord_js_1.SlashCommandBuilder()
        .setName('cupom')
        .setDescription('Gerencia os cupons de desconto da Vook Store.')
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
        .addSubcommand((subcommand) => subcommand
        .setName(SUBCOMMAND_MANAGE)
        .setDescription('Abre o painel de cupons (criar, editar, ativar, excluir e listar).')),
    guildOnly: true,
    async execute(interaction) {
        (0, PermissionService_1.assertCanManageCoupons)(interaction.member);
        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== SUBCOMMAND_MANAGE) {
            throw new errors_1.ValidationError(`Subcomando de cupom desconhecido: ${subcommand}`, {
                userMessage: 'Este subcomando nao existe. Use `/cupom gerenciar`.',
                context: { guildId: interaction.guildId, userId: interaction.user.id },
            });
        }
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const coupons = await (0, CouponService_1.getCoupons)(interaction.guildId);
        await (0, reply_1.editReplyV2)(interaction, (0, CouponBuilders_1.buildCouponMenu)(coupons));
    },
};
//# sourceMappingURL=cupom.js.map