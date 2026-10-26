import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { TicketStatus } from '@prisma/client';

import { ValidationError } from '../../core/errors';
import { assertCanMarkOrderDelivered } from '../../core/permissions/PermissionService';
import { displayNameOf, fetchMemberSafe } from '../../utils/discord';
import { buildDeliveryModal } from '../../modules/delivery/builders/DeliveryBuilders';
import { resolveDeliveryChannel } from '../../modules/delivery/services/DeliveryService';
import {
  effectiveProductLimit,
} from '../../modules/delivery/validators/product';
import { isAssetHostingEnabled } from '../../modules/hosting/AssetHostingService';
import { formatTicketNumber } from '../../modules/tickets/builders/TicketInternalPanelBuilder';
import { findTicketByChannelId } from '../../modules/tickets/repositories/TicketRepository';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

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

const builder = new SlashCommandBuilder()
  .setName('entregar')
  .setDescription('Entrega o arquivo do produto ao cliente deste atendimento')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  // A permissao do comando pode ser afrouxada por um admin na interface do
  // Discord; a checagem que vale e esta.
  await assertCanMarkOrderDelivered(interaction.member);

  const ticket = await findTicketByChannelId(interaction.channelId);
  if (ticket === null || ticket.guildId !== interaction.guildId) {
    throw new ValidationError(`Comando de entrega fora de ticket: ${interaction.channelId}`, {
      userMessage:
        'Use `/entregar` dentro do atendimento do cliente — é de lá que sai a entrega.',
    });
  }

  if (
    ticket.status === TicketStatus.CLOSED ||
    ticket.status === TicketStatus.CLOSING ||
    ticket.status === TicketStatus.ORPHANED
  ) {
    throw new ValidationError(`Entrega em ticket inativo: ${ticket.id}`, {
      userMessage: 'Este atendimento não está mais ativo. Reabra-o para entregar o produto.',
    });
  }

  // Lanca com a frase do que ajustar quando o bot nao consegue anexar aqui.
  await resolveDeliveryChannel(interaction.guild, ticket.channelId);

  const owner = await fetchMemberSafe(interaction.guild, ticket.ownerId);

  // `showModal` precisa ser a PRIMEIRA resposta da interacao — nada de defer.
  // O teto no formulario e o que o BOT consegue reenviar neste servidor (nivel
  // de impulsos) ou hospedar — nunca o `attachmentSizeLimit` da interacao, que
  // inclui o Nitro de quem digitou o comando (ver `guildUploadLimit`).
  await interaction.showModal(
    buildDeliveryModal({
      ticketLabel: formatTicketNumber(ticket.ticketNumber),
      ownerHint: owner === null ? null : displayNameOf(owner, ticket.ownerId),
      maxBytes: effectiveProductLimit(interaction.guild, isAssetHostingEnabled()),
    }),
  );
}

export const entregarCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
