import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, replyWarning } from '../../components/reply';
import { ValidationError } from '../../core/errors';
import { assertCanManageOrders } from '../../core/permissions/PermissionService';
import {
  parseOrderNumberInput,
  renderAdminOrdersForCommand,
  renderCustomerLookupForCommand,
  renderProductionQueueForCommand,
  renderStaffOrderForCommand,
} from '../../interactions/orders';
import { ALL_STATUS_VALUE, isQueueView } from '../../modules/catalog/builders/OrderBuilders';
import { getOrderByNumber } from '../../modules/catalog/services/OrderService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

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
} as const;

const STATUS_CHOICES: ReadonlyArray<{ name: string; value: string }> = [
  { name: 'Todos', value: ALL_STATUS_VALUE },
  { name: 'Pendentes (aguardando vendedor)', value: 'PENDING' },
  { name: 'Aguardando pagamento', value: 'AWAITING_PAYMENT' },
  { name: 'Pagos', value: 'PAID' },
  { name: 'Em preparacao', value: 'IN_PROGRESS' },
  { name: 'Entregues', value: 'DELIVERED' },
  { name: 'Concluidos', value: 'COMPLETED' },
  { name: 'Cancelados', value: 'CANCELLED' },
];

const QUEUE_VIEW_CHOICES: ReadonlyArray<{ name: string; value: string }> = [
  { name: 'Todas as demandas', value: 'all' },
  { name: 'Minhas demandas', value: 'mine' },
  { name: 'Livres (sem responsavel)', value: 'free' },
];

const builder = new SlashCommandBuilder()
  .setName('pedidos')
  .setDescription('Pedidos da Vook Store (equipe)')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((subcommand) =>
    subcommand
      .setName(SUB.MANAGE)
      .setDescription('Abre o painel de pedidos com filtros por status')
      .addStringOption((option) =>
        option
          .setName('status')
          .setDescription('Filtro inicial do painel')
          .setRequired(false)
          .addChoices(...STATUS_CHOICES),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName(SUB.QUEUE)
      .setDescription('Demandas em producao por vencimento: pegar, atribuir e ver a carga')
      .addStringOption((option) =>
        option
          .setName('mostrar')
          .setDescription('Recorte inicial da fila (padrao: todas)')
          .setRequired(false)
          .addChoices(...QUEUE_VIEW_CHOICES),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName(SUB.SEARCH)
      .setDescription('Abre um pedido pelo numero ou lista os pedidos de um cliente')
      .addStringOption((option) =>
        option
          .setName('numero')
          .setDescription('Numero do pedido. Ex.: 184 ou VK-000184')
          .setRequired(false)
          .setMaxLength(20),
      )
      .addUserOption((option) =>
        option
          .setName('cliente')
          .setDescription('Lista todos os pedidos deste cliente')
          .setRequired(false),
      ),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  await assertCanManageOrders(interaction.member);
  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === SUB.MANAGE) {
    const status = interaction.options.getString('status') ?? ALL_STATUS_VALUE;
    await deferIfNeeded(interaction, { ephemeral: true });
    await renderAdminOrdersForCommand(interaction, interaction.guildId, status, 1);
    return;
  }

  if (subcommand === SUB.QUEUE) {
    const raw = interaction.options.getString('mostrar');
    const view = isQueueView(raw) ? raw : 'all';

    await deferIfNeeded(interaction, { ephemeral: true });
    await renderProductionQueueForCommand(
      interaction,
      interaction.guildId,
      interaction.user.id,
      view,
    );
    return;
  }

  if (subcommand === SUB.SEARCH) {
    const rawNumber = interaction.options.getString('numero');
    const customer = interaction.options.getUser('cliente');

    if (rawNumber !== null) {
      const number = parseOrderNumberInput(rawNumber);
      if (number === null) {
        throw new ValidationError('Numero de pedido invalido.', {
          userMessage: 'Numero invalido. Use 184, VK-000184 ou #VK-000184.',
        });
      }

      await deferIfNeeded(interaction, { ephemeral: true });

      const order = await getOrderByNumber(interaction.guildId, number);
      if (order === null) {
        await replyWarning(interaction, 'Nenhum pedido com este numero existe neste servidor.');
        return;
      }

      await renderStaffOrderForCommand(interaction, interaction.guildId, order.id);
      return;
    }

    if (customer !== null) {
      await deferIfNeeded(interaction, { ephemeral: true });
      await renderCustomerLookupForCommand(interaction, interaction.guildId, customer.id, 1);
      return;
    }

    // Os dois sao opcionais no Discord, entao exigir UM deles e trabalho daqui —
    // com mensagem que diz o que fazer, em vez de devolver um painel vazio.
    throw new ValidationError('Busca de pedido sem criterio.', {
      userMessage: 'Informe o `numero` do pedido ou o `cliente` para buscar.',
    });
  }

  throw new ValidationError(`Subcomando de pedidos desconhecido: ${subcommand}`, {
    userMessage: 'Este subcomando nao existe. Use `/pedidos gerenciar`.',
    context: { guildId: interaction.guildId, userId: interaction.user.id },
  });
}

export const pedidosCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
