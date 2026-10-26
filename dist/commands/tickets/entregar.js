"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.entregarCommand = void 0;
const discord_js_1 = require("discord.js");
const client_1 = require("@prisma/client");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const discord_1 = require("../../utils/discord");
const DeliveryBuilders_1 = require("../../modules/delivery/builders/DeliveryBuilders");
const DeliveryService_1 = require("../../modules/delivery/services/DeliveryService");
const product_1 = require("../../modules/delivery/validators/product");
const AssetHostingService_1 = require("../../modules/hosting/AssetHostingService");
const TicketInternalPanelBuilder_1 = require("../../modules/tickets/builders/TicketInternalPanelBuilder");
const TicketRepository_1 = require("../../modules/tickets/repositories/TicketRepository");
/**
 * `/entregar` — a equipe manda o arquivo do produto dentro do ticket.
 *
 * SEM SUBCOMANDO E SEM OPCAO: tudo o que ele precisa saber esta no formulario
 * que ele abre. Um `.zip` nao cabe em opcao de comando de barra de jeito util —
 * o anexo teria de ser escolhido antes de a equipe ver qualquer confirmacao —,
 * e o cliente vem de um select em vez de digitado.
 *
 * O TICKET VEM DO CANAL. Nao ha opcao de numero de ticket: entregar e coisa que
 * se faz conversando com o cliente, e o canal ja diz de quem e a conversa. Fora
 * de um ticket o comando recusa, com a frase dizendo onde usar.
 *
 * TUDO O QUE PODE DAR ERRADO E CONFERIDO ANTES DO FORMULARIO: permissao, ticket
 * aberto e canal com as permissoes do bot. O modal do Discord nao guarda nada
 * quando o envio falha, entao descobrir depois de anexar 80 MB que o ticket
 * estava fechado custaria o formulario inteiro e o upload junto.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('entregar')
    .setDescription('Entrega o arquivo do produto ao cliente deste atendimento')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageMessages);
async function execute(interaction) {
    // A permissao do comando pode ser afrouxada por um admin na interface do
    // Discord; a checagem que vale e esta.
    await (0, PermissionService_1.assertCanMarkOrderDelivered)(interaction.member);
    const ticket = await (0, TicketRepository_1.findTicketByChannelId)(interaction.channelId);
    if (ticket === null || ticket.guildId !== interaction.guildId) {
        throw new errors_1.ValidationError(`Comando de entrega fora de ticket: ${interaction.channelId}`, {
            userMessage: 'Use `/entregar` dentro do atendimento do cliente — é de lá que sai a entrega.',
        });
    }
    if (ticket.status === client_1.TicketStatus.CLOSED ||
        ticket.status === client_1.TicketStatus.CLOSING ||
        ticket.status === client_1.TicketStatus.ORPHANED) {
        throw new errors_1.ValidationError(`Entrega em ticket inativo: ${ticket.id}`, {
            userMessage: 'Este atendimento não está mais ativo. Reabra-o para entregar o produto.',
        });
    }
    // Lanca com a frase do que ajustar quando o bot nao consegue anexar aqui.
    await (0, DeliveryService_1.resolveDeliveryChannel)(interaction.guild, ticket.channelId);
    const owner = await (0, discord_1.fetchMemberSafe)(interaction.guild, ticket.ownerId);
    // `showModal` precisa ser a PRIMEIRA resposta da interacao — nada de defer.
    // O teto no formulario e o que o BOT consegue reenviar neste servidor (nivel
    // de impulsos) ou hospedar — nunca o `attachmentSizeLimit` da interacao, que
    // inclui o Nitro de quem digitou o comando (ver `guildUploadLimit`).
    await interaction.showModal((0, DeliveryBuilders_1.buildDeliveryModal)({
        ticketLabel: (0, TicketInternalPanelBuilder_1.formatTicketNumber)(ticket.ticketNumber),
        ownerHint: owner === null ? null : (0, discord_1.displayNameOf)(owner, ticket.ownerId),
        maxBytes: (0, product_1.effectiveProductLimit)(interaction.guild, (0, AssetHostingService_1.isAssetHostingEnabled)()),
    }));
}
exports.entregarCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=entregar.js.map