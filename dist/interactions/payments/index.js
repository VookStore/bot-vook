"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentModals = exports.paymentSelects = exports.paymentButtons = void 0;
const client_1 = require("@prisma/client");
const v2_1 = require("../../components/v2");
const reply_1 = require("../../components/reply");
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const errors_1 = require("../../core/errors");
const LockService_1 = require("../../core/locks/LockService");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const money_1 = require("../../utils/money");
const sanitize_1 = require("../../utils/sanitize");
const discord_1 = require("../../utils/discord");
const CouponCalculator_1 = require("../../modules/coupons/services/CouponCalculator");
const CouponService_1 = require("../../modules/coupons/services/CouponService");
const PaymentBuilders_1 = require("../../modules/payments/builders/PaymentBuilders");
const ReceiptBuilders_1 = require("../../modules/catalog/builders/ReceiptBuilders");
const OrderReceiptService_1 = require("../../modules/catalog/services/OrderReceiptService");
const OrderService_1 = require("../../modules/catalog/services/OrderService");
const TicketViewService_1 = require("../../modules/tickets/services/TicketViewService");
const PaymentCardService_1 = require("../../modules/payments/services/PaymentCardService");
const PaymentDraftService_1 = require("../../modules/payments/services/PaymentDraftService");
const PaymentAccountService_1 = require("../../modules/payments/services/PaymentAccountService");
const PaymentRepository_1 = require("../../modules/payments/repositories/PaymentRepository");
const PaymentService_1 = require("../../modules/payments/services/PaymentService");
/**
 * Handlers de cobranca PIX.
 *
 * TODA acao revalida a permissao da equipe no servidor — o customId jamais
 * autoriza nada. O cliente pode ver os botoes no cartao, mas nunca consegue
 * aprovar, cancelar ou alterar a cobranca.
 */
function requireGuildContext(interaction) {
    if (interaction.guild === null || interaction.member === null) {
        throw new errors_1.ValidationError('Interacao fora de guild.', {
            userMessage: 'Esta acao so pode ser usada dentro do servidor.',
        });
    }
    return { guild: interaction.guild, member: interaction.member };
}
/**
 * Aviso acrescentado quando a operacao foi gravada mas o cartao publico nao
 * pode ser reescrito (canal apagado ou bot sem permissao). Sem isto o vendedor
 * ve uma confirmacao de sucesso enquanto o cartao no canal continua mostrando
 * o total antigo, o QR antigo e os botoes de uma cobranca ja resolvida.
 */
function staleCardNote(refreshed) {
    return refreshed
        ? ''
        : '\n\n⚠️ A alteracao foi salva, mas o cartao publicado no canal **nao pode ser atualizado** ' +
            '(canal removido ou sem permissao do bot). Verifique as permissoes e atualize o canal.';
}
/**
 * Porteiro do comprovante: devolve o pedido em que a evidencia sera gravada.
 *
 * O botao vive num cartao PUBLICO — todo mundo do canal enxerga e pode clicar.
 * O customId nao autoriza nada (regra do projeto), entao a checagem de dono
 * mora aqui, e `submitReceipt` ainda reconfere por `requireCustomerOrder`.
 * Duas vezes de proposito: e a diferenca entre "anexei no meu pedido" e
 * "anexei no pedido de outra pessoa".
 */
function requireReceiptTarget(payment, userId) {
    if (payment.customerId !== userId) {
        throw new errors_1.ValidationError(`Comprovante de terceiro na cobranca ${payment.id}.`, {
            userMessage: 'Somente o cliente desta cobranca pode enviar o comprovante.',
        });
    }
    if (payment.status !== client_1.PaymentStatus.PENDING) {
        throw new errors_1.ValidationError(`Cobranca nao aguarda comprovante: ${payment.status}`, {
            userMessage: `Esta cobranca esta com status "${(0, PaymentService_1.describeStatus)(payment.status)}" e nao aguarda comprovante.`,
        });
    }
    const orderId = (0, PaymentService_1.linkedOrderId)(payment);
    if (orderId === null) {
        throw new errors_1.ValidationError(`Cobranca sem pedido vinculado: ${payment.id}`, {
            userMessage: 'Esta cobranca nao pertence a um pedido do catalogo. Envie o comprovante para a equipe no atendimento.',
        });
    }
    return orderId;
}
/** Recarrega o rascunho e devolve o painel de confirmacao atualizado. */
async function renderDraftPanel(guild, draftId, userId) {
    const draft = (0, PaymentDraftService_1.getDraft)(draftId, guild.id, userId);
    const account = await (0, PaymentAccountService_1.getAccountById)(guild.id, draft.accountId);
    if (account === null) {
        throw new errors_1.ValidationError('Conta PIX do rascunho nao existe mais.', {
            userMessage: 'A conta PIX escolhida nao existe mais. Refaca a cobranca.',
        });
    }
    let couponCode = null;
    let pricing = {
        originalAmount: draft.amountCents,
        discountAmount: 0,
        finalAmount: draft.amountCents,
    };
    if (draft.couponId !== null) {
        const eligible = await (0, CouponService_1.listSelectableCoupons)(guild.id, draft.amountCents, draft.customerId);
        const match = eligible.find((entry) => entry.coupon.id === draft.couponId);
        if (match !== undefined) {
            couponCode = match.coupon.code;
            pricing = (0, CouponCalculator_1.calculateDiscount)(match.coupon, draft.amountCents);
        }
        else {
            // Cupom deixou de ser elegivel: remove do rascunho em vez de cobrar errado.
            (0, PaymentDraftService_1.setDraftCoupon)(draftId, guild.id, userId, null);
        }
    }
    return (0, PaymentBuilders_1.buildChargeDraftPanel)({
        draftId,
        customerId: draft.customerId,
        description: draft.description,
        account,
        pricing,
        couponCode,
        expirationMinutes: account.defaultExpirationMinutes,
    });
}
// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------
const couponButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.COUPON,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const kind = (0, customIds_1.requireArg)(parsed, 0, 'tipo');
        const target = (0, customIds_1.requireArg)(parsed, 1, 'alvo');
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        if (kind === 'draft') {
            await (0, PermissionService_1.assertCanCreatePayments)(member);
            const draft = (0, PaymentDraftService_1.getDraft)(target, guild.id, member.id);
            const options = await (0, CouponService_1.listSelectableCoupons)(guild.id, draft.amountCents, draft.customerId);
            await (0, reply_1.editReplyV2)(interaction, (0, PaymentBuilders_1.buildCouponSelectionPanel)('draft', target, options, draft.couponId));
            return;
        }
        await (0, PermissionService_1.assertCanManagePayments)(member);
        const payment = await (0, PaymentService_1.loadPayment)(guild.id, target);
        const options = await (0, CouponService_1.listSelectableCoupons)(guild.id, payment.originalAmount, payment.customerId);
        await (0, reply_1.editReplyV2)(interaction, (0, PaymentBuilders_1.buildCouponSelectionPanel)('payment', target, options, payment.couponId));
    },
};
const confirmButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.CONFIRM,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const draftId = (0, customIds_1.requireArg)(parsed, 0, 'draftId');
        await (0, PermissionService_1.assertCanCreatePayments)(member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        /*
         * O rascunho e consumido sob lock.
         *
         * O Discord nao desabilita o botao enquanto a interacao esta deferida, e
         * entre ler o rascunho e apaga-lo ha uma escrita no banco MAIS um round-trip
         * com a API (upload do PNG do QR). Sem o lock, um duplo clique gerava DUAS
         * cobrancas PIX distintas do mesmo rascunho — e o cliente podia pagar as
         * duas.
         */
        const { payment, order } = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PAYMENT_ACTION, `draft:${draftId}`, async () => {
            const draft = (0, PaymentDraftService_1.getDraft)(draftId, guild.id, member.id);
            const channel = await (0, discord_1.fetchChannelSafe)(guild, draft.channelId);
            // Aceita TOPICO: o ticket virou topico privado, e a cobranca e
            // publicada dentro do proprio atendimento.
            if (!(0, discord_1.isSendableConversation)(channel)) {
                throw new errors_1.ValidationError('Canal do rascunho indisponivel.', {
                    userMessage: 'Nao foi possivel enviar a cobranca neste canal.',
                });
            }
            /*
             * O PEDIDO NASCE PRIMEIRO.
             *
             * Venda de balcao tambem e venda: o numero `VK-` e o que o cliente usa
             * para achar a compra em `/meus-pedidos`, o que a equipe usa no painel
             * comercial e, acima de tudo, o lugar onde o comprovante e gravado.
             * Sem pedido, quem pagava por `/pagamento criar` nao tinha onde anexar
             * o comprovante.
             *
             * Vem ANTES da cobranca porque e o `sourceId` dela que leva o numero
             * ate o cartao: criar depois exigiria reescrever um cartao que o
             * cliente ja recebeu.
             */
            const newOrder = await (0, OrderService_1.createOrderForCharge)({
                guildId: guild.id,
                customerId: draft.customerId,
                channelId: draft.channelId,
                amountCents: draft.amountCents,
                staffId: member.id,
            });
            let created;
            try {
                created = await (0, PaymentService_1.createCharge)({
                    guild,
                    createdBy: member,
                    customerId: draft.customerId,
                    accountId: draft.accountId,
                    description: draft.description,
                    amountCents: draft.amountCents,
                    couponId: draft.couponId,
                    channelId: draft.channelId,
                    source: { type: client_1.PaymentSource.MANUAL_COMMAND, id: newOrder.id },
                });
            }
            catch (error) {
                // Conta PIX desativada entre o rascunho e o clique, por exemplo. Sem
                // esta limpeza cada tentativa deixaria um pedido orfao na fila
                // comercial, como se houvesse venda esperando vendedor.
                await (0, OrderService_1.discardOrderForFailedCharge)(newOrder.id, member.id);
                throw error;
            }
            // A cobranca ja esta commitada: o rascunho nao pode sobreviver a ela,
            // senao um segundo clique geraria uma cobranca duplicada.
            (0, PaymentDraftService_1.deleteDraft)(draftId);
            try {
                await (0, OrderService_1.linkPaymentToOrder)(guild.id, member.id, newOrder.id, created);
                await (0, PaymentCardService_1.publishPaymentCard)(channel, created);
            }
            catch (error) {
                // Sem cartao publicado a cobranca fica PENDING e invisivel: ninguem
                // consegue aprovar, cancelar nem ver, e ela ainda conta como pendente
                // ate expirar. Cancelar deixa o estado limpo para o vendedor repetir.
                await (0, PaymentRepository_1.cancelPaymentAtomic)(created.id, member.id, 'Falha ao publicar o cartao da cobranca.').catch(() => undefined);
                await (0, OrderService_1.discardOrderForFailedCharge)(newOrder.id, member.id);
                throw error;
            }
            return { payment: created, order: newOrder };
        }, { userMessage: 'Esta cobranca ja esta sendo gerada.' });
        /*
         * Painel do ticket.
         *
         * Fora do lock e sem poder derrubar nada: a cobranca ja existe e o cliente
         * ja a recebeu. Se o canal nao for de um ticket, a funcao apenas devolve
         * false — cobrar em canal comum continua valendo.
         */
        if (payment.channelId !== null) {
            await (0, TicketViewService_1.refreshInternalPanelByChannel)(guild, payment.channelId).catch(() => false);
        }
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.PAYMENT} Cobranca de **${(0, money_1.formatCents)(payment.finalAmount)}** enviada para ${(0, discord_1.userMention)(payment.customerId)}.\n` +
            `Pedido **#${(0, OrderService_1.formatOrderNumber)(order.orderNumber)}** aberto para esta venda.`)));
    },
};
const discardButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.DISCARD,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const draftId = (0, customIds_1.requireArg)(parsed, 0, 'draftId');
        // Valida a posse antes de descartar.
        (0, PaymentDraftService_1.getDraft)(draftId, guild.id, member.id);
        (0, PaymentDraftService_1.deleteDraft)(draftId);
        await (0, reply_1.replyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.NEUTRAL).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.CLOSE} Rascunho de cobranca descartado.`)), { ephemeral: true });
    },
};
const approveButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.APPROVE,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        await (0, PermissionService_1.assertCanManagePayments)(member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const approved = await (0, PaymentService_1.approvePayment)(guild.id, member, paymentId);
        const refreshed = await (0, PaymentCardService_1.refreshPaymentCard)(guild, approved);
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.APPROVE} Cobranca de **${(0, money_1.formatCents)(approved.finalAmount)}** marcada como **aprovada pela equipe**.` +
            (approved.couponCodeSnapshot !== null
                ? `\nO uso do cupom \`${approved.couponCodeSnapshot}\` foi contabilizado agora.`
                : '') +
            staleCardNote(refreshed))));
    },
};
const cancelButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.CANCEL,
    async handle(interaction, parsed) {
        const { member } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        await (0, PermissionService_1.assertCanManagePayments)(member);
        // showModal precisa ser a primeira resposta.
        await interaction.showModal((0, PaymentBuilders_1.buildCancelModal)(paymentId));
    },
};
const receiptButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.RECEIPT,
    async handle(interaction, parsed) {
        const { guild } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        /*
         * Confere ANTES de abrir o modal.
         *
         * Pedir o arquivo para so entao recusar faria o cliente subir a imagem a
         * toa — e, pior, o "nao pode" chegaria depois do envio, parecendo que o
         * comprovante foi perdido pelo bot.
         */
        const payment = await (0, PaymentService_1.loadPayment)(guild.id, paymentId);
        requireReceiptTarget(payment, interaction.user.id);
        // showModal precisa ser a primeira resposta.
        await interaction.showModal((0, ReceiptBuilders_1.buildReceiptUploadModal)(payment.id));
    },
};
const manageButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.MANAGE,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        await (0, PermissionService_1.assertCanManagePayments)(member);
        const payment = await (0, PaymentService_1.loadPayment)(guild.id, paymentId);
        await (0, reply_1.replyV2)(interaction, (0, PaymentBuilders_1.buildPaymentManagePanel)(payment), { ephemeral: true });
    },
};
const couponRemoveButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.COUPON_REMOVE,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        await (0, PermissionService_1.assertCanManagePayments)(member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const updated = await (0, PaymentService_1.changePaymentCoupon)(guild.id, member, paymentId, null);
        const refreshed = await (0, PaymentCardService_1.refreshPaymentCard)(guild, updated);
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.DELETE} Cupom removido. Novo total: **${(0, money_1.formatCents)(updated.finalAmount)}**.\nQR Code e Copia e Cola regenerados.` +
            staleCardNote(refreshed))));
    },
};
const amountButton = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.AMOUNT,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        await (0, PermissionService_1.assertCanManagePayments)(member);
        const payment = await (0, PaymentService_1.loadPayment)(guild.id, paymentId);
        await interaction.showModal((0, PaymentBuilders_1.buildAmountModal)(paymentId, payment.originalAmount));
    },
};
// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------
const couponSelect = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.COUPON_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const kind = (0, customIds_1.requireArg)(parsed, 0, 'tipo');
        const target = (0, customIds_1.requireArg)(parsed, 1, 'alvo');
        const raw = interaction.values[0];
        if (raw === undefined) {
            await (0, reply_1.replyError)(interaction, 'Nenhuma opcao selecionada.');
            return;
        }
        const couponId = raw === PaymentBuilders_1.NO_COUPON_SELECT_VALUE ? null : raw;
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        if (kind === 'draft') {
            await (0, PermissionService_1.assertCanCreatePayments)(member);
            (0, PaymentDraftService_1.setDraftCoupon)(target, guild.id, member.id, couponId);
            await (0, reply_1.editReplyV2)(interaction, await renderDraftPanel(guild, target, member.id));
            return;
        }
        await (0, PermissionService_1.assertCanManagePayments)(member);
        const updated = await (0, PaymentService_1.changePaymentCoupon)(guild.id, member, target, couponId);
        const refreshed = await (0, PaymentCardService_1.refreshPaymentCard)(guild, updated);
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)((couponId === null
            ? `${branding_1.EMOJIS.DELETE} Cupom removido. Novo total: **${(0, money_1.formatCents)(updated.finalAmount)}**.`
            : `${branding_1.EMOJIS.COUPON} Cupom \`${updated.couponCodeSnapshot ?? ''}\` aplicado. Novo total: **${(0, money_1.formatCents)(updated.finalAmount)}**.`) +
            staleCardNote(refreshed))));
    },
};
// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
const cancelModal = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.CANCEL_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        const reason = (0, sanitize_1.sanitizeReason)(interaction.fields.getTextInputValue('reason'));
        await (0, PermissionService_1.assertCanManagePayments)(member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const cancelled = await (0, PaymentService_1.cancelPayment)(guild.id, member, paymentId, reason);
        const refreshed = await (0, PaymentCardService_1.refreshPaymentCard)(guild, cancelled);
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.DANGER).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.CLOSE} Cobranca cancelada. O cupom nao foi contabilizado.` +
            staleCardNote(refreshed))));
    },
};
const receiptModal = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.RECEIPT_MODAL,
    async handle(interaction, parsed) {
        const { guild } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        const file = interaction.fields.getUploadedFiles(ReceiptBuilders_1.RECEIPT_UPLOAD_FIELD)?.first();
        if (file === undefined) {
            throw new errors_1.ValidationError('Modal de comprovante submetido sem arquivo.', {
                userMessage: 'Nenhum arquivo foi anexado. Toque em Enviar Comprovante e escolha o arquivo.',
            });
        }
        // Efemero: o comprovante traz dados bancarios do cliente e nao pode virar
        // conteudo do canal onde o cartao da cobranca esta publicado.
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        // Recarrega em vez de confiar no que foi checado ao abrir o modal: entre
        // abrir e enviar, a cobranca pode ter sido aprovada ou cancelada.
        const payment = await (0, PaymentService_1.loadPayment)(guild.id, paymentId);
        const orderId = requireReceiptTarget(payment, interaction.user.id);
        const result = await (0, OrderReceiptService_1.submitReceipt)({
            guild,
            customerId: interaction.user.id,
            orderId,
            attachment: {
                url: file.url,
                name: file.name,
                contentType: file.contentType,
                size: file.size,
            },
        });
        await (0, reply_1.editReplyV2)(interaction, (0, ReceiptBuilders_1.buildReceiptCustomerAck)(result.order, result.analysis));
    },
};
const amountModal = {
    namespace: customIds_1.NAMESPACE.PAYMENT,
    action: customIds_1.PAYMENT_ACTION.AMOUNT_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const paymentId = (0, customIds_1.requireArg)(parsed, 0, 'paymentId');
        const amountCents = (0, money_1.parsePaymentAmount)(interaction.fields.getTextInputValue('amount'));
        await (0, PermissionService_1.assertCanManagePayments)(member);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const { payment: updated, droppedCoupon } = await (0, PaymentService_1.changePaymentAmount)(guild.id, member, paymentId, amountCents);
        const refreshed = await (0, PaymentCardService_1.refreshPaymentCard)(guild, updated);
        const note = droppedCoupon !== null
            ? `\n⚠️ O cupom \`${droppedCoupon}\` **nao vale** para este novo valor e foi removido da cobranca.`
            : updated.couponId !== null
                ? `\nO cupom \`${updated.couponCodeSnapshot ?? ''}\` foi mantido nos termos originais da cobranca.`
                : '';
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.EDIT} Valor atualizado. Novo total: **${(0, money_1.formatCents)(updated.finalAmount)}**.\nQR Code e Copia e Cola regenerados.${note}` +
            staleCardNote(refreshed))));
    },
};
exports.paymentButtons = [
    couponButton,
    confirmButton,
    discardButton,
    approveButton,
    receiptButton,
    cancelButton,
    manageButton,
    couponRemoveButton,
    amountButton,
];
exports.paymentSelects = [couponSelect];
exports.paymentModals = [cancelModal, amountModal, receiptModal];
//# sourceMappingURL=index.js.map