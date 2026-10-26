"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pedidosCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const orders_1 = require("../../interactions/orders");
const OrderBuilders_1 = require("../../modules/catalog/builders/OrderBuilders");
const OrderService_1 = require("../../modules/catalog/services/OrderService");
/**
 * `/pedidos` — painel comercial da equipe.
 *
 * A permissao padrao do comando apenas ESCONDE a opcao de quem nao e da equipe;
 * a autorizacao real e revalidada aqui, com o membro do servidor.
 */
const SUB = {
    MANAGE: 'gerenciar',
    SEARCH: 'buscar',
    QUEUE: 'fila',
};
const STATUS_CHOICES = [
    { name: 'Todos', value: OrderBuilders_1.ALL_STATUS_VALUE },
    { name: 'Pendentes (aguardando vendedor)', value: 'PENDING' },
    { name: 'Aguardando pagamento', value: 'AWAITING_PAYMENT' },
    { name: 'Pagos', value: 'PAID' },
    { name: 'Em preparacao', value: 'IN_PROGRESS' },
    { name: 'Entregues', value: 'DELIVERED' },
    { name: 'Concluidos', value: 'COMPLETED' },
    { name: 'Cancelados', value: 'CANCELLED' },
];
const QUEUE_VIEW_CHOICES = [
    { name: 'Todas as demandas', value: 'all' },
    { name: 'Minhas demandas', value: 'mine' },
    { name: 'Livres (sem responsavel)', value: 'free' },
];
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('pedidos')
    .setDescription('Pedidos da Vook Store (equipe)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageMessages)
    .addSubcommand((subcommand) => subcommand
    .setName(SUB.MANAGE)
    .setDescription('Abre o painel de pedidos com filtros por status')
    .addStringOption((option) => option
    .setName('status')
    .setDescription('Filtro inicial do painel')
    .setRequired(false)
    .addChoices(...STATUS_CHOICES)))
    .addSubcommand((subcommand) => subcommand
    .setName(SUB.QUEUE)
    .setDescription('Demandas em producao por vencimento: pegar, atribuir e ver a carga')
    .addStringOption((option) => option
    .setName('mostrar')
    .setDescription('Recorte inicial da fila (padrao: todas)')
    .setRequired(false)
    .addChoices(...QUEUE_VIEW_CHOICES)))
    .addSubcommand((subcommand) => subcommand
    .setName(SUB.SEARCH)
    .setDescription('Abre um pedido pelo numero ou lista os pedidos de um cliente')
    .addStringOption((option) => option
    .setName('numero')
    .setDescription('Numero do pedido. Ex.: 184 ou VK-000184')
    .setRequired(false)
    .setMaxLength(20))
    .addUserOption((option) => option
    .setName('cliente')
    .setDescription('Lista todos os pedidos deste cliente')
    .setRequired(false)));
async function execute(interaction) {
    await (0, PermissionService_1.assertCanManageOrders)(interaction.member);
    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === SUB.MANAGE) {
        const status = interaction.options.getString('status') ?? OrderBuilders_1.ALL_STATUS_VALUE;
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, orders_1.renderAdminOrdersForCommand)(interaction, interaction.guildId, status, 1);
        return;
    }
    if (subcommand === SUB.QUEUE) {
        const raw = interaction.options.getString('mostrar');
        const view = (0, OrderBuilders_1.isQueueView)(raw) ? raw : 'all';
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, orders_1.renderProductionQueueForCommand)(interaction, interaction.guildId, interaction.user.id, view);
        return;
    }
    if (subcommand === SUB.SEARCH) {
        const rawNumber = interaction.options.getString('numero');
        const customer = interaction.options.getUser('cliente');
        if (rawNumber !== null) {
            const number = (0, orders_1.parseOrderNumberInput)(rawNumber);
            if (number === null) {
                throw new errors_1.ValidationError('Numero de pedido invalido.', {
                    userMessage: 'Numero invalido. Use 184, VK-000184 ou #VK-000184.',
                });
            }
            await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
            const order = await (0, OrderService_1.getOrderByNumber)(interaction.guildId, number);
            if (order === null) {
                await (0, reply_1.replyWarning)(interaction, 'Nenhum pedido com este numero existe neste servidor.');
                return;
            }
            await (0, orders_1.renderStaffOrderForCommand)(interaction, interaction.guildId, order.id);
            return;
        }
        if (customer !== null) {
            await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
            await (0, orders_1.renderCustomerLookupForCommand)(interaction, interaction.guildId, customer.id, 1);
            return;
        }
        // Os dois sao opcionais no Discord, entao exigir UM deles e trabalho daqui —
        // com mensagem que diz o que fazer, em vez de devolver um painel vazio.
        throw new errors_1.ValidationError('Busca de pedido sem criterio.', {
            userMessage: 'Informe o `numero` do pedido ou o `cliente` para buscar.',
        });
    }
    throw new errors_1.ValidationError(`Subcomando de pedidos desconhecido: ${subcommand}`, {
        userMessage: 'Este subcomando nao existe. Use `/pedidos gerenciar`.',
        context: { guildId: interaction.guildId, userId: interaction.user.id },
    });
}
exports.pedidosCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=pedidos.js.map