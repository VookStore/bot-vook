import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

import { deferIfNeeded, editReplyV2, successContainer } from '../../components/reply';
import {
  DELIVERY_ACTION,
  NAMESPACE,
  requireArg,
  type ParsedCustomId,
} from '../../constants/customIds';
import { ValidationError } from '../../core/errors';
import { createLogger } from '../../core/logger/Logger';
import { assertCanMarkOrderDelivered } from '../../core/permissions/PermissionService';
import { messageUrl } from '../../utils/discord';
import {
  DELIVERY_FIELD,
  buildDeliverySummary,
  readDeliveryNote,
} from '../../modules/delivery/builders/DeliveryBuilders';
import {
  assertCanConfirmReceipt,
  confirmReceipt,
  deliverProduct,
} from '../../modules/delivery/services/DeliveryService';
import { effectiveProductLimit } from '../../modules/delivery/validators/product';
import { isAssetHostingEnabled } from '../../modules/hosting/AssetHostingService';
import { findTicketByChannelId } from '../../modules/tickets/repositories/TicketRepository';
import type { ButtonHandler, ModalHandler } from '../../types';
import { requireGuildContext } from '../catalog/shared';

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

const logger = createLogger('delivery:modal');

/** Texto de um campo; ausente e vazio significam a mesma coisa. */
function readText(interaction: ModalSubmitInteraction, customId: string): string {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    // Campo opcional nao preenchido pode nem chegar no payload.
    return '';
  }
}

const sendModal: ModalHandler = {
  namespace: NAMESPACE.DELIVERY,
  action: DELIVERY_ACTION.SEND_MODAL,
  async handle(interaction: ModalSubmitInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanMarkOrderDelivered(member);

    const ticket = await findTicketByChannelId(interaction.channelId ?? '');
    if (ticket === null || ticket.guildId !== guild.id) {
      throw new ValidationError(`Entrega enviada fora de ticket: ${interaction.channelId ?? ''}`, {
        userMessage: 'Este atendimento não foi encontrado. Use `/entregar` dentro do ticket.',
      });
    }

    // Validacao ANTES do defer: erro de preenchimento responde direto, sem a
    // mensagem "pensando..." que o defer deixaria na tela.
    const customer = interaction.fields.getSelectedUsers(DELIVERY_FIELD.CUSTOMER)?.first();
    if (customer === undefined) {
      throw new ValidationError('Formulario de entrega sem cliente.', {
        userMessage: 'Selecione o cliente que vai receber o produto.',
      });
    }
    if (customer.bot) {
      throw new ValidationError(`Entrega enderecada a um bot: ${customer.id}`, {
        userMessage: 'Selecione a pessoa que comprou — um bot não recebe entrega.',
      });
    }

    const file = interaction.fields.getUploadedFiles(DELIVERY_FIELD.FILE)?.first();
    if (file === undefined) {
      throw new ValidationError('Formulario de entrega sem arquivo.', {
        userMessage: 'Anexe o arquivo do produto e envie de novo.',
      });
    }

    // Download e reenvio de um pacote passam facil dos 3 segundos da interacao —
    // com 100 MB, podem levar minutos. O defer segura a resposta por ate 15.
    await deferIfNeeded(interaction, { ephemeral: true });

    const outcome = await deliverProduct({
      guild,
      staff: member,
      ticket,
      customer,
      note: readDeliveryNote(readText(interaction, DELIVERY_FIELD.NOTE)),
      upload: {
        url: file.url,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
      },
      maxBytes: effectiveProductLimit(guild, isAssetHostingEnabled()),
    });

    const link = messageUrl(guild.id, outcome.message.channelId, outcome.message.id);

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
      await editReplyV2(
        interaction,
        successContainer(`Produto entregue a ${customer.toString()}: ${link}`, {
          footer: buildDeliverySummary(outcome),
        }),
      );
    } catch (error) {
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
const confirmButton: ButtonHandler = {
  namespace: NAMESPACE.DELIVERY,
  action: DELIVERY_ACTION.CONFIRM,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticket = await assertCanConfirmReceipt(guild, member, requireArg(parsed, 0, 'ticket'));

    // Fechar gera o transcript e mexe no topico: passa dos 3 segundos.
    await deferIfNeeded(interaction, { ephemeral: true });

    const result = await confirmReceipt(guild, member, ticket);

    await editReplyV2(
      interaction,
      successContainer('Recebimento confirmado. Obrigado pela confiança!', {
        footer: result.dmSent
          ? 'Este atendimento foi concluído. O resumo e o convite para avaliar chegaram na sua mensagem direta.'
          : 'Este atendimento foi concluído.',
      }),
    );
  },
};

export const deliveryButtons: ButtonHandler[] = [confirmButton];

export const deliveryModals: ModalHandler[] = [sendModal];
