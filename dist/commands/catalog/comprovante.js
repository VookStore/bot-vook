"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.comprovanteCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const orders_1 = require("../../interactions/orders");
const ReceiptBuilders_1 = require("../../modules/catalog/builders/ReceiptBuilders");
const OrderService_1 = require("../../modules/catalog/services/OrderService");
const OrderReceiptService_1 = require("../../modules/catalog/services/OrderReceiptService");
/**
 * `/comprovante enviar` — o cliente anexa o comprovante do PIX.
 *
 * O CAMINHO PRINCIPAL passou a ser o botao `Enviar Comprovante`, no proprio
 * cartao da cobranca: o componente de upload em modal chegou e tirou do slash
 * command a exclusividade do anexo.
 *
 * O comando continua porque ele nao depende do cartao. Cobranca expirada perde
 * os botoes (o pedido segue aguardando pagamento e ainda aceita comprovante),
 * o cliente nem sempre esta no canal onde o cartao foi publicado, e quem prefere
 * digitar o numero do pedido continua conseguindo.
 *
 * O comprovante NAO confirma o pagamento. Ele vai para a equipe conferir, com a
 * conferencia automatica ao lado — quem aprova a cobranca continua sendo uma
 * pessoa. Comprovante e imagem, e imagem se falsifica.
 */
const SUB_SEND = 'enviar';
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('comprovante')
    .setDescription('Envia o comprovante de pagamento de um pedido')
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
    .setName(SUB_SEND)
    .setDescription('Envia o comprovante do PIX para a equipe conferir')
    .addStringOption((option) => option
    .setName('pedido')
    .setDescription('Numero do pedido. Ex.: 184 ou VK-000184')
    .setRequired(true)
    .setMaxLength(20))
    .addAttachmentOption((option) => option
    .setName('arquivo')
    .setDescription('Imagem (PNG, JPG, WEBP) ou PDF do comprovante')
    .setRequired(true)));
async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand !== SUB_SEND) {
        throw new errors_1.ValidationError(`Subcomando de comprovante desconhecido: ${subcommand}`, {
            userMessage: 'Este subcomando nao existe. Use `/comprovante enviar`.',
        });
    }
    const number = (0, orders_1.parseOrderNumberInput)(interaction.options.getString('pedido', true));
    if (number === null) {
        throw new errors_1.ValidationError('Numero de pedido invalido.', {
            userMessage: 'Numero invalido. Use 184, VK-000184 ou #VK-000184.',
        });
    }
    const attachment = interaction.options.getAttachment('arquivo', true);
    // Efemero: o comprovante traz dados bancarios do cliente e nao pode virar
    // conteudo do canal onde o comando foi digitado.
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    const order = await (0, OrderService_1.getOrderByNumber)(interaction.guildId, number);
    if (order === null) {
        throw new errors_1.ValidationError(`Pedido inexistente: ${number}`, {
            userMessage: 'Nenhum pedido com este numero existe neste servidor.',
        });
    }
    const result = await (0, OrderReceiptService_1.submitReceipt)({
        guild: interaction.guild,
        customerId: interaction.user.id,
        orderId: order.id,
        attachment: {
            url: attachment.url,
            name: attachment.name,
            contentType: attachment.contentType,
            size: attachment.size,
        },
    });
    await (0, reply_1.editReplyV2)(interaction, (0, ReceiptBuilders_1.buildReceiptCustomerAck)(result.order, result.analysis));
}
exports.comprovanteCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=comprovante.js.map