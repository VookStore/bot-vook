import {
  GuildMember,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';

import {
  deferIfNeeded,
  deferUpdateIfNeeded,
  editReplyV2,
  replyWarning,
  updateV2,
} from '../../components/reply';
import { COLORS, EMOJIS } from '../../constants/branding';
import { ACCOUNT_ACTION, NAMESPACE, requireArg } from '../../constants/customIds';
import { PermissionError, ValidationError } from '../../core/errors';
import { assertCanManagePaymentAccounts } from '../../core/permissions/PermissionService';
import {
  ACCOUNT_FIELD,
  buildAccountList,
  buildAccountMenu,
  buildAccountModal,
  buildAccountSelectPanel,
  buildAccountSummary,
  parseKeyTypeAndExpiration,
} from '../../modules/payments/builders/PaymentAccountBuilders';
import {
  MAX_ACCOUNTS_PER_GUILD,
  createAccountFromInput,
  deleteAccount,
  getAccountById,
  getAccounts,
  normalizeAccountInput,
  toggleAccount,
  updateAccountFromInput,
  type PaymentAccountInput,
} from '../../modules/payments/services/PaymentAccountService';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';

/**
 * Componentes do painel de contas PIX.
 *
 * REGRAS APLICADAS EM TODOS OS HANDLERS:
 *  - o customId nunca autoriza nada: `assertCanManagePaymentAccounts` roda de novo
 *    e a conta e reconferida no banco antes de qualquer escrita;
 *  - toda resposta e efemera (a tela expoe dados do recebedor);
 *  - toda escrita invalida o cache (feito dentro do PaymentAccountService).
 */

type AccountInteraction = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

interface AdminContext {
  guildId: string;
  actorId: string;
}

/** Revalida guild + permissao de administracao a cada interacao. */
function requireAdminContext(interaction: AccountInteraction): AdminContext {
  const { member, guildId } = interaction;

  if (guildId === null || !(member instanceof GuildMember)) {
    throw new PermissionError('Interacao de conta PIX fora de uma guild em cache.', {
      userMessage: 'Esta acao so pode ser usada dentro do servidor.',
    });
  }

  assertCanManagePaymentAccounts(member);
  return { guildId, actorId: member.id };
}

function requireSelectedAccountId(interaction: AnySelectMenuInteraction): string {
  if (!interaction.isStringSelectMenu()) {
    throw new ValidationError('Select de conta PIX com tipo inesperado.', {
      userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
    });
  }

  const value = interaction.values[0];
  if (value === undefined || value.length === 0) {
    throw new ValidationError('Select de conta PIX sem valor.', {
      userMessage: 'Selecione uma conta para continuar.',
    });
  }
  return value;
}

/** Le os cinco campos do modal e monta a entrada do service. */
function readAccountModal(interaction: ModalSubmitInteraction): PaymentAccountInput {
  const { pixKeyType, defaultExpirationMinutes } = parseKeyTypeAndExpiration(
    interaction.fields.getTextInputValue(ACCOUNT_FIELD.TYPE_EXPIRATION),
  );

  return {
    name: interaction.fields.getTextInputValue(ACCOUNT_FIELD.NAME),
    receiverName: interaction.fields.getTextInputValue(ACCOUNT_FIELD.RECEIVER),
    pixKey: interaction.fields.getTextInputValue(ACCOUNT_FIELD.PIX_KEY),
    city: interaction.fields.getTextInputValue(ACCOUNT_FIELD.CITY),
    pixKeyType,
    defaultExpirationMinutes,
  };
}

/** Aviso quando a loja fica sem nenhuma conta apta a receber. */
async function noActiveAccountWarning(guildId: string): Promise<string[]> {
  const remaining = (await getAccounts(guildId)).filter(
    (account) => account.enabled && account.deletedAt === null,
  );
  if (remaining.length > 0) return [];
  return [
    'Nenhuma conta ativa restante: novas cobrancas PIX ficarao indisponiveis ate ativar uma conta.',
  ];
}

// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------

const createButton: ButtonHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.CREATE,
  async handle(interaction) {
    const { guildId } = requireAdminContext(interaction);

    const accounts = await getAccounts(guildId);
    if (accounts.length >= MAX_ACCOUNTS_PER_GUILD) {
      await replyWarning(
        interaction,
        `Este servidor ja possui ${MAX_ACCOUNTS_PER_GUILD} contas PIX. Exclua uma antes de cadastrar outra.`,
      );
      return;
    }

    // showModal precisa ser a primeira resposta: nada de defer aqui.
    await interaction.showModal(buildAccountModal('create'));
  },
};

const editButton: ButtonHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.EDIT,
  async handle(interaction) {
    const { guildId } = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);

    const accounts = await getAccounts(guildId);
    await updateV2(
      interaction,
      buildAccountSelectPanel(accounts, ACCOUNT_ACTION.EDIT_SELECT, {
        prompt: `${EMOJIS.EDIT} Escolha a conta que voce quer editar.`,
      }),
    );
  },
};

const toggleButton: ButtonHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.TOGGLE,
  async handle(interaction) {
    const { guildId } = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);

    const accounts = await getAccounts(guildId);
    await updateV2(
      interaction,
      buildAccountSelectPanel(accounts, ACCOUNT_ACTION.TOGGLE_SELECT, {
        prompt: `${EMOJIS.ENABLE} Escolha a conta para ativar ou desativar.`,
      }),
    );
  },
};

const deleteButton: ButtonHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.DELETE,
  async handle(interaction) {
    const { guildId } = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);

    const accounts = await getAccounts(guildId);
    await updateV2(
      interaction,
      buildAccountSelectPanel(accounts, ACCOUNT_ACTION.DELETE_SELECT, {
        prompt:
          `${EMOJIS.DELETE} Escolha a conta que sera excluida.\n` +
          'As cobrancas ja emitidas continuam validas — a conta apenas deixa de ser usada.',
        accentColor: COLORS.DANGER,
      }),
    );
  },
};

const listButton: ButtonHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.LIST,
  async handle(interaction) {
    const { guildId } = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);

    const accounts = await getAccounts(guildId);
    await updateV2(interaction, buildAccountList(accounts));
  },
};

const backButton: ButtonHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.BACK,
  async handle(interaction) {
    const { guildId } = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);

    const accounts = await getAccounts(guildId);
    await updateV2(interaction, buildAccountMenu(accounts));
  },
};

export const paymentAccountButtons: ButtonHandler[] = [
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

const editSelect: SelectHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.EDIT_SELECT,
  async handle(interaction) {
    const { guildId } = requireAdminContext(interaction);
    const accountId = requireSelectedAccountId(interaction);

    const account = await getAccountById(guildId, accountId);
    if (account === null) {
      await replyWarning(interaction, 'Esta conta PIX nao existe mais. Atualize o painel.');
      return;
    }

    await interaction.showModal(buildAccountModal('edit', account));
  },
};

const toggleSelect: SelectHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.TOGGLE_SELECT,
  async handle(interaction) {
    const { guildId, actorId } = requireAdminContext(interaction);
    const accountId = requireSelectedAccountId(interaction);

    await deferUpdateIfNeeded(interaction);

    const account = await toggleAccount({ guildId, accountId, actorId });
    const warnings = account.enabled ? [] : await noActiveAccountWarning(guildId);

    await updateV2(
      interaction,
      buildAccountSummary(account, {
        headline: account.enabled
          ? `${EMOJIS.APPROVE} **Conta PIX ativada.**`
          : `${EMOJIS.DISABLE} **Conta PIX desativada.**`,
        accentColor: account.enabled ? COLORS.SUCCESS : COLORS.WARNING,
        warnings,
      }),
    );
  },
};

const deleteSelect: SelectHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.DELETE_SELECT,
  async handle(interaction) {
    const { guildId, actorId } = requireAdminContext(interaction);
    const accountId = requireSelectedAccountId(interaction);

    await deferUpdateIfNeeded(interaction);

    const account = await deleteAccount({ guildId, accountId, actorId });
    const warnings = await noActiveAccountWarning(guildId);

    await updateV2(
      interaction,
      buildAccountSummary(account, {
        headline: `${EMOJIS.DELETE} **Conta PIX excluida.**`,
        accentColor: COLORS.DANGER,
        warnings,
      }),
    );
  },
};

export const paymentAccountSelects: SelectHandler[] = [editSelect, toggleSelect, deleteSelect];

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

const createModal: ModalHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.CREATE_MODAL,
  async handle(interaction) {
    const { guildId, actorId } = requireAdminContext(interaction);

    // Validacao acontece ANTES do defer: erro de digitacao vira resposta direta.
    const input = readAccountModal(interaction);
    const { warnings } = normalizeAccountInput(input);

    await deferIfNeeded(interaction, { ephemeral: true });

    const account = await createAccountFromInput({ guildId, actorId, input });

    await editReplyV2(interaction, buildAccountSummary(account, {
      headline: `${EMOJIS.APPROVE} **Conta PIX cadastrada.**`,
      warnings,
    }));
  },
};

const editModal: ModalHandler = {
  namespace: NAMESPACE.ACCOUNT,
  action: ACCOUNT_ACTION.EDIT_MODAL,
  async handle(interaction, parsed) {
    const { guildId, actorId } = requireAdminContext(interaction);
    const accountId = requireArg(parsed, 0, 'identificador da conta');

    const input = readAccountModal(interaction);
    const { warnings } = normalizeAccountInput(input);

    await deferIfNeeded(interaction, { ephemeral: true });

    const account = await updateAccountFromInput({ guildId, accountId, actorId, input });

    await editReplyV2(interaction, buildAccountSummary(account, {
      headline: `${EMOJIS.APPROVE} **Conta PIX atualizada.**`,
      warnings,
    }));
  },
};

export const paymentAccountModals: ModalHandler[] = [createModal, editModal];
