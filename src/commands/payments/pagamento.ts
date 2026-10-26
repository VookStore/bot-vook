import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';

import { replyV2 } from '../../components/reply';
import { DISCORD_LIMITS, BUSINESS_LIMITS } from '../../constants/limits';
import { ConfigurationError, ValidationError } from '../../core/errors';
import {
  assertCanCreatePayments,
  canCreatePayments,
} from '../../core/permissions/PermissionService';
import { parsePaymentAmount } from '../../utils/money';
import { sanitizeConfigText, truncate } from '../../utils/sanitize';
import { buildChargeDraftPanel } from '../../modules/payments/builders/PaymentBuilders';
import { createDraft } from '../../modules/payments/services/PaymentDraftService';
import {
  getAccountById,
  getDefaultAccount,
  getEnabledAccounts,
} from '../../modules/payments/services/PaymentAccountService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * /pagamento criar — o VENDEDOR gera a cobranca para o cliente.
 *
 * O cliente nunca cria cobranca nem escolhe cupom: o cupom e selecionado pela
 * equipe no painel de confirmacao exibido por este comando.
 */

const builder = new SlashCommandBuilder()
  .setName('pagamento')
  .setDescription('Cobrancas PIX da Vook Store')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('criar')
      .setDescription('Gera uma cobranca PIX para um cliente')
      .addUserOption((option) =>
        option.setName('cliente').setDescription('Cliente que ira pagar').setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('valor')
          .setDescription('Valor da cobranca. Ex.: 250,00')
          .setRequired(true)
          .setMaxLength(20),
      )
      .addStringOption((option) =>
        option
          .setName('descricao')
          .setDescription('Produto ou servico cobrado')
          .setRequired(true)
          .setMaxLength(BUSINESS_LIMITS.PAYMENT_DESCRIPTION_MAX),
      )
      .addStringOption((option) =>
        option
          .setName('conta')
          .setDescription('Conta PIX que recebera o valor (padrao: primeira conta ativa)')
          .setRequired(false)
          .setAutocomplete(true),
      ),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  await assertCanCreatePayments(interaction.member);

  const customer = interaction.options.getUser('cliente', true);
  if (customer.bot) {
    throw new ValidationError('Cliente e um bot.', {
      userMessage: 'Nao e possivel gerar cobranca para um bot.',
    });
  }

  const amountCents = parsePaymentAmount(interaction.options.getString('valor', true));

  const description = sanitizeConfigText(
    interaction.options.getString('descricao', true),
    BUSINESS_LIMITS.PAYMENT_DESCRIPTION_MAX,
  );
  if (description.length === 0) {
    throw new ValidationError('Descricao vazia apos sanitizacao.', {
      userMessage: 'Informe uma descricao valida para a cobranca.',
    });
  }

  const requestedAccountId = interaction.options.getString('conta');
  const account =
    requestedAccountId !== null
      ? await getAccountById(interaction.guildId, requestedAccountId)
      : await getDefaultAccount(interaction.guildId);

  if (account === null || account.deletedAt !== null || !account.enabled) {
    throw new ConfigurationError('Nenhuma conta PIX utilizavel.', {
      userMessage:
        'Nenhuma conta PIX ativa foi encontrada. Cadastre uma em `/config-pagamento gerenciar`.',
    });
  }

  if (interaction.channelId === null) {
    throw new ValidationError('Comando sem canal.', {
      userMessage: 'Nao foi possivel identificar o canal desta cobranca.',
    });
  }

  const draft = createDraft({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    createdById: interaction.user.id,
    customerId: customer.id,
    accountId: account.id,
    description,
    amountCents,
  });

  await replyV2(
    interaction,
    buildChargeDraftPanel({
      draftId: draft.id,
      customerId: customer.id,
      description,
      account,
      pricing: { originalAmount: amountCents, discountAmount: 0, finalAmount: amountCents },
      couponCode: null,
      expirationMinutes: account.defaultExpirationMinutes,
    }),
    { ephemeral: true },
  );
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
async function autocomplete(interaction: AutocompleteInteraction<'cached'>): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'conta') {
    await interaction.respond([]);
    return;
  }

  if (!(await canCreatePayments(interaction.member))) {
    await interaction.respond([]);
    return;
  }

  const query = focused.value.toLowerCase().trim();
  const accounts = await getEnabledAccounts(interaction.guildId);

  const choices = accounts
    .filter(
      (account) =>
        query.length === 0 ||
        account.name.toLowerCase().includes(query) ||
        account.identifier.toLowerCase().includes(query),
    )
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_CHOICES)
    .map((account) => ({
      name: truncate(`${account.name} (${account.identifier})`, 100),
      value: account.id,
    }));

  await interaction.respond(choices);
}

export const pagamentoCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
  autocomplete,
};
