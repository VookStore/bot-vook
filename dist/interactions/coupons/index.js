"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.couponModals = exports.couponSelects = exports.couponButtons = void 0;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const limits_1 = require("../../constants/limits");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const LockService_1 = require("../../core/locks/LockService");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const sanitize_1 = require("../../utils/sanitize");
const CouponBuilders_1 = require("../../modules/coupons/builders/CouponBuilders");
const CouponService_1 = require("../../modules/coupons/services/CouponService");
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
const LOCK_BUSY_MESSAGE = 'Outra alteracao de cupom esta em andamento neste servidor. Aguarde alguns segundos.';
/**
 * Membro real da guild com permissao de cupons.
 * O router ja garante contexto de guild; esta checagem fecha o tipo e vale como
 * segunda camada caso o handler seja chamado de outro caminho.
 */
function requireCouponAdmin(interaction) {
    const { member } = interaction;
    if (!(member instanceof discord_js_1.GuildMember)) {
        throw new errors_1.PermissionError('Interacao de cupom fora de uma guild em cache.', {
            userMessage: 'Esta acao so pode ser usada dentro do servidor.',
            context: { userId: interaction.user.id, guildId: interaction.guildId },
        });
    }
    (0, PermissionService_1.assertCanManageCoupons)(member);
    return member;
}
/** Valor selecionado em um select de cupom. */
function readSelectedCouponId(interaction) {
    if (!interaction.isStringSelectMenu()) {
        throw new errors_1.ValidationError('Select de cupom com tipo inesperado.', {
            userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
        });
    }
    const value = interaction.values[0];
    if (value === undefined || value.length === 0) {
        throw new errors_1.ValidationError('Select de cupom sem valor.', {
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
function optionalFieldValue(interaction, customId) {
    try {
        return interaction.fields.getTextInputValue(customId);
    }
    catch {
        return '';
    }
}
/** Le e valida os cinco campos do formulario de cupom. */
function readCouponTerms(interaction) {
    const code = (0, sanitize_1.sanitizeCouponCode)(interaction.fields.getTextInputValue(CouponBuilders_1.COUPON_FIELD.CODE));
    const { type, value } = (0, CouponBuilders_1.parseCouponValueInput)(interaction.fields.getTextInputValue(CouponBuilders_1.COUPON_FIELD.VALUE));
    const description = (0, sanitize_1.sanitizeConfigText)(optionalFieldValue(interaction, CouponBuilders_1.COUPON_FIELD.DESCRIPTION), limits_1.BUSINESS_LIMITS.COUPON_DESCRIPTION_MAX);
    const rules = (0, CouponBuilders_1.parseCouponRulesInput)(optionalFieldValue(interaction, CouponBuilders_1.COUPON_FIELD.RULES));
    const validity = (0, CouponBuilders_1.parseCouponValidityInput)(optionalFieldValue(interaction, CouponBuilders_1.COUPON_FIELD.VALIDITY));
    if (validity.expiresAt !== null && validity.expiresAt.getTime() <= Date.now()) {
        throw new errors_1.ValidationError('Validade final ja passou.', {
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
async function refreshMenu(interaction, guildId, notice) {
    const coupons = await (0, CouponService_1.getCoupons)(guildId);
    await (0, reply_1.updateV2)(interaction, (0, CouponBuilders_1.buildCouponMenu)(coupons, notice === undefined ? {} : { notice }));
}
/** Abre um painel de selecao (editar / alternar / excluir). */
async function openSelectPanel(interaction, action, options) {
    const member = requireCouponAdmin(interaction);
    await (0, reply_1.deferUpdateIfNeeded)(interaction);
    const coupons = await (0, CouponService_1.getCoupons)(member.guild.id);
    if (coupons.length === 0) {
        await (0, reply_1.updateV2)(interaction, (0, CouponBuilders_1.buildCouponMenu)(coupons, {
            notice: '⚠️ **Nenhum cupom cadastrado.** Use "Criar Cupom" para comecar.',
        }));
        return;
    }
    await (0, reply_1.updateV2)(interaction, (0, CouponBuilders_1.buildCouponSelectPanel)(coupons, action, options));
}
// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------
const createButton = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.CREATE,
    async handle(interaction) {
        requireCouponAdmin(interaction);
        // `showModal` precisa ser a PRIMEIRA resposta da interacao: nada de defer.
        await interaction.showModal((0, CouponBuilders_1.buildCouponModal)('create'));
    },
};
const editButton = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.EDIT,
    async handle(interaction) {
        await openSelectPanel(interaction, customIds_1.COUPON_ACTION.EDIT_SELECT, {
            title: 'VOOK STORE — EDITAR CUPOM',
            instruction: 'Escolha o cupom que voce quer alterar. O formulario abre ja preenchido.',
        });
    },
};
const toggleButton = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.TOGGLE,
    async handle(interaction) {
        await openSelectPanel(interaction, customIds_1.COUPON_ACTION.TOGGLE_SELECT, {
            title: 'VOOK STORE — ATIVAR / DESATIVAR',
            instruction: 'Escolha o cupom para alternar o estado. Cupom desativado nao aparece para o ' +
                'vendedor na cobranca, mas continua cadastrado.',
        });
    },
};
const deleteButton = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.DELETE,
    async handle(interaction) {
        await openSelectPanel(interaction, customIds_1.COUPON_ACTION.DELETE_SELECT, {
            title: 'VOOK STORE — EXCLUIR CUPOM',
            instruction: 'Escolha o cupom a excluir. A exclusao preserva o historico dos pagamentos ja ' +
                'emitidos, e criar o mesmo codigo de novo restaura o cupom.',
            accent: branding_1.COLORS.DANGER,
        });
    },
};
const listButton = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.LIST,
    async handle(interaction) {
        const member = requireCouponAdmin(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const guildId = member.guild.id;
        const [coupons, usageTotals] = await Promise.all([
            (0, CouponService_1.getCoupons)(guildId),
            (0, CouponService_1.getCouponUsageTotals)(guildId),
        ]);
        await (0, reply_1.updateV2)(interaction, (0, CouponBuilders_1.buildCouponList)(coupons, usageTotals));
    },
};
const backButton = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.BACK,
    async handle(interaction) {
        const member = requireCouponAdmin(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        await refreshMenu(interaction, member.guild.id);
    },
};
exports.couponButtons = [
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
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.EDIT_SELECT,
    async handle(interaction) {
        const member = requireCouponAdmin(interaction);
        const couponId = readSelectedCouponId(interaction);
        const coupon = await (0, CouponService_1.getCouponById)(member.guild.id, couponId);
        if (coupon === null) {
            await (0, reply_1.replyError)(interaction, 'Este cupom nao existe mais. Volte ao painel e atualize a lista.');
            return;
        }
        await interaction.showModal((0, CouponBuilders_1.buildCouponModal)('edit', coupon));
    },
};
const toggleSelect = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.TOGGLE_SELECT,
    async handle(interaction) {
        const member = requireCouponAdmin(interaction);
        const couponId = readSelectedCouponId(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const guildId = member.guild.id;
        const coupon = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.COUPON_ADMIN, guildId, () => (0, CouponService_1.toggleCoupon)(guildId, couponId, member.id), { userMessage: LOCK_BUSY_MESSAGE });
        await refreshMenu(interaction, guildId, coupon.enabled
            ? `✅ Cupom **${coupon.code}** ativado.`
            : `🔴 Cupom **${coupon.code}** desativado.`);
    },
};
const deleteSelect = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.DELETE_SELECT,
    async handle(interaction) {
        const member = requireCouponAdmin(interaction);
        const couponId = readSelectedCouponId(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const guildId = member.guild.id;
        const coupon = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.COUPON_ADMIN, guildId, () => (0, CouponService_1.deleteCoupon)(guildId, couponId, member.id), { userMessage: LOCK_BUSY_MESSAGE });
        await refreshMenu(interaction, guildId, `🗑️ Cupom **${coupon.code}** excluido. Criar o mesmo codigo de novo restaura o historico.`);
    },
};
exports.couponSelects = [editSelect, toggleSelect, deleteSelect];
// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
const createModal = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.CREATE_MODAL,
    async handle(interaction) {
        const member = requireCouponAdmin(interaction);
        const terms = readCouponTerms(interaction);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const guildId = member.guild.id;
        const { coupon, restored } = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.COUPON_ADMIN, guildId, () => (0, CouponService_1.createCouponFromInput)(guildId, member.id, terms), { userMessage: LOCK_BUSY_MESSAGE });
        const coupons = await (0, CouponService_1.getCoupons)(guildId);
        await (0, reply_1.editReplyV2)(interaction, (0, CouponBuilders_1.buildCouponMenu)(coupons, {
            notice: `✅ Cupom **${coupon.code}** ${restored ? 'restaurado' : 'criado'}.\n` +
                `-# ${(0, CouponBuilders_1.describeCouponTerms)(terms)}`,
        }));
    },
};
const editModal = {
    namespace: customIds_1.NAMESPACE.COUPON,
    action: customIds_1.COUPON_ACTION.EDIT_MODAL,
    async handle(interaction, parsed) {
        const member = requireCouponAdmin(interaction);
        const couponId = (0, customIds_1.requireArg)(parsed, 0, 'cupom');
        const terms = readCouponTerms(interaction);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const guildId = member.guild.id;
        const coupon = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.COUPON_ADMIN, guildId, () => (0, CouponService_1.updateCouponFields)(guildId, couponId, member.id, terms), { userMessage: LOCK_BUSY_MESSAGE });
        const coupons = await (0, CouponService_1.getCoupons)(guildId);
        await (0, reply_1.editReplyV2)(interaction, (0, CouponBuilders_1.buildCouponMenu)(coupons, {
            notice: `✅ Cupom **${coupon.code}** atualizado.\n-# ${(0, CouponBuilders_1.describeCouponTerms)(terms)}`,
        }));
    },
};
exports.couponModals = [createModal, editModal];
//# sourceMappingURL=index.js.map