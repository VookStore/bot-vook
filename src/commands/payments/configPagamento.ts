import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, editReplyV2, replyError } from '../../components/reply';
import { assertCanManagePaymentAccounts } from '../../core/permissions/PermissionService';
import { buildAccountMenu } from '../../modules/payments/builders/PaymentAccountBuilders';
import { getAccounts } from '../../modules/payments/services/PaymentAccountService';
import type { SlashCommandDefinition } from '../../types';

/**
 * /config-pagamento gerenciar
 *
 * Painel administrativo das contas PIX da Vook Store.
 * A resposta e SEMPRE efemera: a tela lista dados do recebedor, e nenhuma
 * informacao de conta pode ficar visivel no canal.
 */

const SUBCOMMAND_MANAGE = 'gerenciar';

export const configPagamentoCommand: SlashCommandDefinition = {
  builder: new SlashCommandBuilder()
    .setName('config-pagamento')
    .setDescription('Gerencia as contas PIX que recebem os pagamentos da Vook Store.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName(SUBCOMMAND_MANAGE)
        .setDescription('Abre o painel de contas PIX (resposta privada).'),
    ),
  guildOnly: true,

  async execute(interaction) {
    // O default_member_permissions e apenas visual: a permissao real e conferida aqui.
    assertCanManagePaymentAccounts(interaction.member);

    if (interaction.options.getSubcommand() !== SUBCOMMAND_MANAGE) {
      await replyError(interaction, 'Subcomando desconhecido. Use `/config-pagamento gerenciar`.');
      return;
    }

    await deferIfNeeded(interaction, { ephemeral: true });

    const accounts = await getAccounts(interaction.guildId);
    await editReplyV2(interaction, buildAccountMenu(accounts));
  },
};
