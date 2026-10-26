import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, editReplyV2 } from '../../components/reply';
import { assertCanManageCoupons } from '../../core/permissions/PermissionService';
import { buildCouponMenu } from '../../modules/coupons/builders/CouponBuilders';
import { getCoupons } from '../../modules/coupons/services/CouponService';
import { ValidationError } from '../../core/errors';
import type { SlashCommandDefinition } from '../../types';

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

export const cupomCommand: SlashCommandDefinition = {
  builder: new SlashCommandBuilder()
    .setName('cupom')
    .setDescription('Gerencia os cupons de desconto da Vook Store.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName(SUBCOMMAND_MANAGE)
        .setDescription('Abre o painel de cupons (criar, editar, ativar, excluir e listar).'),
    ),

  guildOnly: true,

  async execute(interaction) {
    assertCanManageCoupons(interaction.member);

    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== SUBCOMMAND_MANAGE) {
      throw new ValidationError(`Subcomando de cupom desconhecido: ${subcommand}`, {
        userMessage: 'Este subcomando nao existe. Use `/cupom gerenciar`.',
        context: { guildId: interaction.guildId, userId: interaction.user.id },
      });
    }

    await deferIfNeeded(interaction, { ephemeral: true });

    const coupons = await getCoupons(interaction.guildId);
    await editReplyV2(interaction, buildCouponMenu(coupons));
  },
};
