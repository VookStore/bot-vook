import { SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, editReplyV2 } from '../../components/reply';
import { ValidationError } from '../../core/errors';
import { parseOrderNumberInput } from '../../interactions/orders';
import { buildReceiptCustomerAck } from '../../modules/catalog/builders/ReceiptBuilders';
import { getOrderByNumber } from '../../modules/catalog/services/OrderService';
import { submitReceipt } from '../../modules/catalog/services/OrderReceiptService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

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

const builder = new SlashCommandBuilder()
  .setName('comprovante')
  .setDescription('Envia o comprovante de pagamento de um pedido')
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName(SUB_SEND)
      .setDescription('Envia o comprovante do PIX para a equipe conferir')
      .addStringOption((option) =>
        option
          .setName('pedido')
          .setDescription('Numero do pedido. Ex.: 184 ou VK-000184')
          .setRequired(true)
          .setMaxLength(20),
      )
      .addAttachmentOption((option) =>
        option
          .setName('arquivo')
          .setDescription('Imagem (PNG, JPG, WEBP) ou PDF do comprovante')
          .setRequired(true),
      ),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand !== SUB_SEND) {
    throw new ValidationError(`Subcomando de comprovante desconhecido: ${subcommand}`, {
      userMessage: 'Este subcomando nao existe. Use `/comprovante enviar`.',
    });
  }

  const number = parseOrderNumberInput(interaction.options.getString('pedido', true));
  if (number === null) {
    throw new ValidationError('Numero de pedido invalido.', {
      userMessage: 'Numero invalido. Use 184, VK-000184 ou #VK-000184.',
    });
  }

  const attachment = interaction.options.getAttachment('arquivo', true);

  // Efemero: o comprovante traz dados bancarios do cliente e nao pode virar
  // conteudo do canal onde o comando foi digitado.
  await deferIfNeeded(interaction, { ephemeral: true });

  const order = await getOrderByNumber(interaction.guildId, number);
  if (order === null) {
    throw new ValidationError(`Pedido inexistente: ${number}`, {
      userMessage: 'Nenhum pedido com este numero existe neste servidor.',
    });
  }

  const result = await submitReceipt({
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

  await editReplyV2(interaction, buildReceiptCustomerAck(result.order, result.analysis));
}

export const comprovanteCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
