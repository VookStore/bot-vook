"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryModals = exports.deliveryButtons = void 0;
const reply_1 = require("../../components/reply");
const customIds_1 = require("../../constants/customIds");
const errors_1 = require("../../core/errors");
const Logger_1 = require("../../core/logger/Logger");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const discord_1 = require("../../utils/discord");
const DeliveryBuilders_1 = require("../../modules/delivery/builders/DeliveryBuilders");
const DeliveryService_1 = require("../../modules/delivery/services/DeliveryService");
const product_1 = require("../../modules/delivery/validators/product");
const AssetHostingService_1 = require("../../modules/hosting/AssetHostingService");
const TicketRepository_1 = require("../../modules/tickets/repositories/TicketRepository");
const shared_1 = require("../catalog/shared");
/**
 * Envio do formulario de entrega.
 *
 * A permissao e conferida DE NOVO aqui, e nao so no comando que abriu o
 * formulario: e outra interacao, e entre abrir e enviar o cargo pode ter sido
 * retirado. O customId nunca autoriza nada.
 *
 * O ticket tambem e resolvido de novo pelo canal. Nada viaja no customId —
 * quem entrega e quem esta dentro do atendimento, no momento do envio.
 */
const logger = (0, Logger_1.createLogger)('delivery:modal');
/** Texto de um campo; ausente e vazio significam a mesma coisa. */
function readText(interaction, customId) {
    try {
        return interaction.fields.getTextInputValue(customId);
    }
    catch {
        // Campo opcional nao preenchido pode nem chegar no payload.
        return '';
    }
}
const sendModal = {
    namespace: customIds_1.NAMESPACE.DELIVERY,
    action: customIds_1.DELIVERY_ACTION.SEND_MODAL,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanMarkOrderDelivered)(member);
        const ticket = await (0, TicketRepository_1.findTicketByChannelId)(interaction.channelId ?? '');
        if (ticket === null || ticket.guildId !== guild.id) {
            throw new errors_1.ValidationError(`Entrega enviada fora de ticket: ${interaction.channelId ?? ''}`, {
                userMessage: 'Este atendimento não foi encontrado. Use `/entregar` dentro do ticket.',
            });
        }
        // Validacao ANTES do defer: erro de preenchimento responde direto, sem a
        // mensagem "pensando..." que o defer deixaria na tela.
        const customer = interaction.fields.getSelectedUsers(DeliveryBuilders_1.DELIVERY_FIELD.CUSTOMER)?.first();
        if (customer === undefined) {
            throw new errors_1.ValidationError('Formulario de entrega sem cliente.', {
                userMessage: 'Selecione o cliente que vai receber o produto.',
            });
        }
        if (customer.bot) {
            throw new errors_1.ValidationError(`Entrega enderecada a um bot: ${customer.id}`, {
                userMessage: 'Selecione a pessoa que comprou — um bot não recebe entrega.',
            });
        }
        const file = interaction.fields.getUploadedFiles(DeliveryBuilders_1.DELIVERY_FIELD.FILE)?.first();
        if (file === undefined) {
            throw new errors_1.ValidationError('Formulario de entrega sem arquivo.', {
                userMessage: 'Anexe o arquivo do produto e envie de novo.',
            });
        }
        // Download e reenvio de um pacote passam facil dos 3 segundos da interacao —
        // com 100 MB, podem levar minutos. O defer segura a resposta por ate 15.
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const outcome = await (0, DeliveryService_1.deliverProduct)({
            guild,
            staff: member,
            ticket,
            customer,
            note: (0, DeliveryBuilders_1.readDeliveryNote)(readText(interaction, DeliveryBuilders_1.DELIVERY_FIELD.NOTE)),
            upload: {
                url: file.url,
                name: file.name,
                contentType: file.contentType,
                size: file.size,
            },
            maxBytes: (0, product_1.effectiveProductLimit)(guild, (0, AssetHostingService_1.isAssetHostingEnabled)()),
        });
        const link = (0, discord_1.messageUrl)(guild.id, outcome.message.channelId, outcome.message.id);
        /*
         * Daqui para baixo, a entrega JA ACONTECEU.
         *
         * O token da interacao dura 15 minutos, e uma espera longa na fila mais o
         * download e os dois envios podem consumi-los num pacote grande. Se o
         * relatorio nao couber mais na tela, ele vira log — deixar o erro subir
         * transformaria uma entrega bem-sucedida em "erro inesperado" com alerta no
         * canal de erros, e a equipe entregaria o mesmo arquivo de novo.
         */
        try {
            await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)(`Produto entregue a ${customer.toString()}: ${link}`, {
                footer: (0, DeliveryBuilders_1.buildDeliverySummary)(outcome),
            }));
        }
        catch (error) {
            logger.warn('Entrega concluida, mas o relatorio nao chegou a equipe.', {
                guildId: guild.id,
                userId: member.id,
                entityType: 'message',
                entityId: outcome.message.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    },
};
/**
 * "Confirmar recebimento", tocado pelo CLIENTE no cartao da entrega.
 *
 * Fecha o atendimento e conclui o pedido. Quem pode clicar (so o dono do
 * ticket) e se ainda da (ticket aberto) e conferido antes do defer, para a
 * recusa chegar na hora.
 */
const confirmButton = {
    namespace: customIds_1.NAMESPACE.DELIVERY,
    action: customIds_1.DELIVERY_ACTION.CONFIRM,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        const ticket = await (0, DeliveryService_1.assertCanConfirmReceipt)(guild, member, (0, customIds_1.requireArg)(parsed, 0, 'ticket'));
        // Fechar gera o transcript e mexe no topico: passa dos 3 segundos.
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const result = await (0, DeliveryService_1.confirmReceipt)(guild, member, ticket);
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)('Recebimento confirmado. Obrigado pela confiança!', {
            footer: result.dmSent
                ? 'Este atendimento foi concluído. O resumo e o convite para avaliar chegaram na sua mensagem direta.'
                : 'Este atendimento foi concluído.',
        }));
    },
};
exports.deliveryButtons = [confirmButton];
exports.deliveryModals = [sendModal];
//# sourceMappingURL=index.js.map