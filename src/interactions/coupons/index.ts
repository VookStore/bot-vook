import {
  GuildMember,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type RepliableInteraction,
} from 'discord.js';

import { COLORS } from '../../constants/branding';
import { COUPON_ACTION, NAMESPACE, requireArg } from '../../constants/customIds';
import { BUSINESS_LIMITS } from '../../constants/limits';
import {
  deferIfNeeded,
  deferUpdateIfNeeded,
  editReplyV2,
  replyError,
  updateV2,
} from '../../components/reply';
import { PermissionError, ValidationError } from '../../core/errors';
import { LOCK_NAMESPACE, locks } from '../../core/locks/LockService';
import { assertCanManageCoupons } from '../../core/permissions/PermissionService';
import { sanitizeConfigText, sanitizeCouponCode } from '../../utils/sanitize';
import {
  COUPON_FIELD,
  buildCouponList,
  buildCouponMenu,
  buildCouponModal,
  buildCouponSelectPanel,
  describeCouponTerms,
  parseCouponRulesInput,
  parseCouponValidityInput,
  parseCouponValueInput,
} from '../../modules/coupons/builders/CouponBuilders';
import {
  createCouponFromInput,
  deleteCoupon,
  getCouponById,
  getCouponUsageTotals,
  getCoupons,
  toggleCoupon,
  updateCouponFields,
  type CouponTermsInput,
} from '../../modules/coupons/services/CouponService';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';

/**
 * Handlers do painel administrativo de cupons.
 *
 * REGRAS APLICADAS EM TODOS OS HANDLERS
 *  - O customId nao autoriza nada: cada acao revalida `assertCanManageCoupons`
 *    com o membro real e reconfere o cupom no banco antes de escrever.
 *  - Toda escrita roda sob `LOCK_NAMESPACE.COUPON_ADMIN` com chave por guild,
 *    o que impede duplo clique e edicoes simultaneas do mesmo painel.
 *  - Auditoria e invalidacao de cache ficam no CouponService, que e quem grava.
 *  - Nenhum componente do painel fica sem handler.
 */

const LOCK_BUSY_MESSAGE =
  'Outra alteracao de cupom esta em andamento neste servidor. Aguarde alguns segundos.';

/**
 * Membro real da guild com permissao de cupons.
 * O router ja garante contexto de guild; esta checagem fecha o tipo e vale como
 * segunda camada caso o handler seja chamado de outro caminho.
 */
function requireCouponAdmin(interaction: RepliableInteraction): GuildMember {
  const { member } = interaction;
  if (!(member instanceof GuildMember)) {
    throw new PermissionError('Interacao de cupom fora de uma guild em cache.', {
      userMessage: 'Esta acao so pode ser usada dentro do servidor.',
      context: { userId: interaction.user.id, guildId: interaction.guildId },
    });
  }
  assertCanManageCoupons(member);
  return member;
}

/** Valor selecionado em um select de cupom. */
function readSelectedCouponId(interaction: AnySelectMenuInteraction): string {
  if (!interaction.isStringSelectMenu()) {
    throw new ValidationError('Select de cupom com tipo inesperado.', {
      userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
    });
  }
  const value = interaction.values[0];
  if (value === undefined || value.length === 0) {
    throw new ValidationError('Select de cupom sem valor.', {
      userMessage: 'Nenhum cupom foi selecionado. Tente novamente.',
    });
  }
  return value;
}

/**
 * Campo opcional do modal.
 * Um input opcional nao preenchido pode nem vir no payload; nesse caso vale
 * como texto vazio em vez de derrubar o envio do formulario.
 */
function optionalFieldValue(interaction: ModalSubmitInteraction, customId: string): string {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return '';
  }
}

/** Le e valida os cinco campos do formulario de cupom. */
function readCouponTerms(interaction: ModalSubmitInteraction): CouponTermsInput {
  const code = sanitizeCouponCode(interaction.fields.getTextInputValue(COUPON_FIELD.CODE));
  const { type, value } = parseCouponValueInput(
    interaction.fields.getTextInputValue(COUPON_FIELD.VALUE),
  );

  const description = sanitizeConfigText(
    optionalFieldValue(interaction, COUPON_FIELD.DESCRIPTION),
    BUSINESS_LIMITS.COUPON_DESCRIPTION_MAX,
  );
  const rules = parseCouponRulesInput(optionalFieldValue(interaction, COUPON_FIELD.RULES));
  const validity = parseCouponValidityInput(optionalFieldValue(interaction, COUPON_FIELD.VALIDITY));

  if (validity.expiresAt !== null && validity.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError('Validade final ja passou.', {
      userMessage: 'A data final da validade ja passou. Informe uma data futura.',
    });
  }

  return {
    code,
    type,
    value,
    description: description.length > 0 ? description : null,
    minimumAmount: rules.minimumAmount,
    maximumDiscount: rules.maximumDiscount,
    maxUses: rules.maxUses,
    maxUsesPerCustomer: rules.maxUsesPerCustomer,
    startsAt: validity.startsAt,
    expiresAt: validity.expiresAt,
  };
}

/** Reexibe o menu principal (ja atualizado) com o resultado da acao no topo. */
async function refreshMenu(
  interaction: ButtonInteraction | AnySelectMenuInteraction,
  guildId: string,
  notice?: string,
): Promise<void> {
  const coupons = await getCoupons(guildId);
  await updateV2(
    interaction,
    buildCouponMenu(coupons, notice === undefined ? {} : { notice }),
  );
}

/** Abre um painel de selecao (editar / alternar / excluir). */
async function openSelectPanel(
  interaction: ButtonInteraction,
  action: string,
  options: { title: string; instruction: string; accent?: number },
): Promise<void> {
  const member = requireCouponAdmin(interaction);
  await deferUpdateIfNeeded(interaction);

  const coupons = await getCoupons(member.guild.id);
  if (coupons.length === 0) {
    await updateV2(
      interaction,
      buildCouponMenu(coupons, {
        notice: '⚠️ **Nenhum cupom cadastrado.** Use "Criar Cupom" para comecar.',
      }),
    );
    return;
  }

  await updateV2(interaction, buildCouponSelectPanel(coupons, action, options));
}

// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------

const createButton: ButtonHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.CREATE,
  async handle(interaction) {
    requireCouponAdmin(interaction);
    // `showModal` precisa ser a PRIMEIRA resposta da interacao: nada de defer.
    await interaction.showModal(buildCouponModal('create'));
  },
};

const editButton: ButtonHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.EDIT,
  async handle(interaction) {
    await openSelectPanel(interaction, COUPON_ACTION.EDIT_SELECT, {
      title: 'VOOK STORE — EDITAR CUPOM',
      instruction: 'Escolha o cupom que voce quer alterar. O formulario abre ja preenchido.',
    });
  },
};

const toggleButton: ButtonHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.TOGGLE,
  async handle(interaction) {
    await openSelectPanel(interaction, COUPON_ACTION.TOGGLE_SELECT, {
      title: 'VOOK STORE — ATIVAR / DESATIVAR',
      instruction:
        'Escolha o cupom para alternar o estado. Cupom desativado nao aparece para o ' +
        'vendedor na cobranca, mas continua cadastrado.',
    });
  },
};

const deleteButton: ButtonHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.DELETE,
  async handle(interaction) {
    await openSelectPanel(interaction, COUPON_ACTION.DELETE_SELECT, {
      title: 'VOOK STORE — EXCLUIR CUPOM',
      instruction:
        'Escolha o cupom a excluir. A exclusao preserva o historico dos pagamentos ja ' +
        'emitidos, e criar o mesmo codigo de novo restaura o cupom.',
      accent: COLORS.DANGER,
    });
  },
};

const listButton: ButtonHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.LIST,
  async handle(interaction) {
    const member = requireCouponAdmin(interaction);
    await deferUpdateIfNeeded(interaction);

    const guildId = member.guild.id;
    const [coupons, usageTotals] = await Promise.all([
      getCoupons(guildId),
      getCouponUsageTotals(guildId),
    ]);

    await updateV2(interaction, buildCouponList(coupons, usageTotals));
  },
};

const backButton: ButtonHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.BACK,
  async handle(interaction) {
    const member = requireCouponAdmin(interaction);
    await deferUpdateIfNeeded(interaction);
    await refreshMenu(interaction, member.guild.id);
  },
};

export const couponButtons: ButtonHandler[] = [
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
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.EDIT_SELECT,
  async handle(interaction) {
    const member = requireCouponAdmin(interaction);
    const couponId = readSelectedCouponId(interaction);

    const coupon = await getCouponById(member.guild.id, couponId);
    if (coupon === null) {
      await replyError(
        interaction,
        'Este cupom nao existe mais. Volte ao painel e atualize a lista.',
      );
      return;
    }

    await interaction.showModal(buildCouponModal('edit', coupon));
  },
};

const toggleSelect: SelectHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.TOGGLE_SELECT,
  async handle(interaction) {
    const member = requireCouponAdmin(interaction);
    const couponId = readSelectedCouponId(interaction);
    await deferUpdateIfNeeded(interaction);

    const guildId = member.guild.id;
    const coupon = await locks.withLock(
      LOCK_NAMESPACE.COUPON_ADMIN,
      guildId,
      () => toggleCoupon(guildId, couponId, member.id),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshMenu(
      interaction,
      guildId,
      coupon.enabled
        ? `✅ Cupom **${coupon.code}** ativado.`
        : `🔴 Cupom **${coupon.code}** desativado.`,
    );
  },
};

const deleteSelect: SelectHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.DELETE_SELECT,
  async handle(interaction) {
    const member = requireCouponAdmin(interaction);
    const couponId = readSelectedCouponId(interaction);
    await deferUpdateIfNeeded(interaction);

    const guildId = member.guild.id;
    const coupon = await locks.withLock(
      LOCK_NAMESPACE.COUPON_ADMIN,
      guildId,
      () => deleteCoupon(guildId, couponId, member.id),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshMenu(
      interaction,
      guildId,
      `🗑️ Cupom **${coupon.code}** excluido. Criar o mesmo codigo de novo restaura o historico.`,
    );
  },
};

export const couponSelects: SelectHandler[] = [editSelect, toggleSelect, deleteSelect];

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

const createModal: ModalHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.CREATE_MODAL,
  async handle(interaction) {
    const member = requireCouponAdmin(interaction);
    const terms = readCouponTerms(interaction);

    await deferIfNeeded(interaction, { ephemeral: true });

    const guildId = member.guild.id;
    const { coupon, restored } = await locks.withLock(
      LOCK_NAMESPACE.COUPON_ADMIN,
      guildId,
      () => createCouponFromInput(guildId, member.id, terms),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    const coupons = await getCoupons(guildId);
    await editReplyV2(
      interaction,
      buildCouponMenu(coupons, {
        notice:
          `✅ Cupom **${coupon.code}** ${restored ? 'restaurado' : 'criado'}.\n` +
          `-# ${describeCouponTerms(terms)}`,
      }),
    );
  },
};

const editModal: ModalHandler = {
  namespace: NAMESPACE.COUPON,
  action: COUPON_ACTION.EDIT_MODAL,
  async handle(interaction, parsed) {
    const member = requireCouponAdmin(interaction);
    const couponId = requireArg(parsed, 0, 'cupom');
    const terms = readCouponTerms(interaction);

    await deferIfNeeded(interaction, { ephemeral: true });

    const guildId = member.guild.id;
    const coupon = await locks.withLock(
      LOCK_NAMESPACE.COUPON_ADMIN,
      guildId,
      () => updateCouponFields(guildId, couponId, member.id, terms),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    const coupons = await getCoupons(guildId);
    await editReplyV2(
      interaction,
      buildCouponMenu(coupons, {
        notice: `✅ Cupom **${coupon.code}** atualizado.\n-# ${describeCouponTerms(terms)}`,
      }),
    );
  },
};

export const couponModals: ModalHandler[] = [createModal, editModal];
