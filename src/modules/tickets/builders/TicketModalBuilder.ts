import {
  ActionRowBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { TicketCategory } from '@prisma/client';

import { NAMESPACE, TICKET_ACTION, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { truncate } from '../../../utils/sanitize';
import { normalizeCategoryEmoji } from '../../configuration/builders/CategoryBuilders';

/** Modais e seletores do fluxo de tickets. */

/**
 * Ids dos CAMPOS do formulario de abertura.
 *
 * Nao sao customIds de roteamento: campo de modal nao passa pelo router. Usar
 * `ticket:algo` aqui daria a entender, erradamente, que existe um handler
 * escutando — e o roteador nunca veria esses ids.
 */
export const TICKET_FIELD = {
  SUBJECT: 'subject',
  CATEGORY: 'category',
} as const;

/** Texto do seletor de categorias dentro do formulario. */
export const CATEGORY_SELECT_PLACEHOLDER = 'Faca uma selecao';

/**
 * Emoji de categoria valido para o select (unicode simples ou emoji custom).
 *
 * Reusa a MESMA validacao da escrita (`normalizeCategoryEmoji`). Aceitar
 * qualquer string aqui era arriscado: `setEmoji('carrinho')` nao lanca,
 * serializa `{"name":"carrinho"}` e derruba a mensagem inteira com 400 — antes
 * o painel publico, agora o proprio formulario. A unica barreira era a
 * normalizacao no modal de cadastro, entao qualquer linha vinda de migracao,
 * seed ou SQL manual quebrava a abertura de ticket.
 */
function parseEmoji(raw: string | null): string | undefined {
  return normalizeCategoryEmoji(raw) ?? undefined;
}

/**
 * Seletor de categorias.
 *
 * Vive DENTRO do formulario de abertura, e nao mais no painel publico: o
 * cliente escolhe motivo e categoria na mesma tela, num envio so. Antes eram
 * dois passos — escolher a categoria no painel e depois digitar o assunto num
 * modal — e quem desistia no meio deixava a interacao pendurada.
 */
export function buildCategorySelect(
  categories: readonly TicketCategory[],
): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(TICKET_FIELD.CATEGORY)
    .setPlaceholder(truncate(CATEGORY_SELECT_PLACEHOLDER, DISCORD_LIMITS.SELECT_PLACEHOLDER))
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    categories.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((category) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(truncate(category.name, DISCORD_LIMITS.SELECT_LABEL))
        .setValue(category.id);

      if (category.description !== null && category.description.length > 0) {
        option.setDescription(truncate(category.description, DISCORD_LIMITS.SELECT_DESCRIPTION));
      }
      const emoji = parseEmoji(category.emoji);
      if (emoji !== undefined) option.setEmoji(emoji);
      return option;
    }),
  );

  return menu;
}

/**
 * Formulario de abertura: motivo do contato + categoria, num envio so.
 *
 * O modal usa `LabelBuilder` nos DOIS campos porque a estrutura nao se mistura:
 * um modal e todo em `ActionRow` (so aceita texto) ou todo em `Label` (aceita
 * select e upload). Como a categoria virou select, o campo de texto teve de vir
 * junto para o formato novo.
 *
 * Lanca quando nao ha categoria: um select sem opcao e recusado com 400 pelo
 * Discord, e o erro apareceria como "algo deu errado" no clique do cliente.
 */
export function buildTicketCreateModal(
  categories: readonly TicketCategory[],
): ModalBuilder {
  if (categories.length === 0) {
    throw new ValidationError('Formulario de ticket sem categoria disponivel.', {
      userMessage:
        'Nenhuma categoria de atendimento esta disponivel no momento. Tente novamente mais tarde.',
    });
  }

  return new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CREATE_MODAL))
    .setTitle(truncate('Abrir um ticket', DISCORD_LIMITS.MODAL_TITLE))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(truncate('Qual e o motivo do seu contato?', DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(TICKET_FIELD.SUBJECT)
            .setPlaceholder(
              truncate(
                'Escreva com detalhes o motivo pelo qual voce esta abrindo este ticket...',
                DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER,
              ),
            )
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(BUSINESS_LIMITS.TICKET_SUBJECT_MIN)
            .setMaxLength(BUSINESS_LIMITS.TICKET_SUBJECT_MAX),
        ),
      new LabelBuilder()
        .setLabel(truncate('Escolha uma categoria', DISCORD_LIMITS.TEXT_INPUT_LABEL))
        .setStringSelectMenuComponent(buildCategorySelect(categories)),
    );
}

/** Modal de encerramento: resumo/motivo (opcional). */
export function buildTicketCloseModal(ticketId: string, ticketNumber: number): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CLOSE_MODAL, ticketId))
    .setTitle(
      truncate(`Finalizar #${String(ticketNumber).padStart(4, '0')}`, DISCORD_LIMITS.MODAL_TITLE),
    );

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Resumo / motivo do encerramento')
    .setPlaceholder('Opcional. Sera registrado no log e enviado ao cliente.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(BUSINESS_LIMITS.CLOSE_REASON_MAX);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason));
  return modal;
}

/** Modal de renomeacao do canal. */
export function buildTicketRenameModal(ticketId: string, currentName: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.RENAME_MODAL, ticketId))
    .setTitle('Renomear canal');

  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Novo nome do canal')
    .setPlaceholder('Sera convertido para o formato do Discord (a-z, 0-9 e hifen).')
    .setValue(truncate(currentName, 90))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(DISCORD_LIMITS.CHANNEL_NAME);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name));
  return modal;
}

/** Seletor de usuario para adicionar participante. */
export function buildAddMemberSelect(ticketId: string): UserSelectMenuBuilder {
  return new UserSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.ADD_MEMBER_SELECT, ticketId))
    .setPlaceholder('Selecione o membro que tera acesso')
    .setMinValues(1)
    .setMaxValues(1);
}

/** Seletor de usuario para transferir o atendimento. */
export function buildTransferSelect(ticketId: string): UserSelectMenuBuilder {
  return new UserSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.TRANSFER_SELECT, ticketId))
    .setPlaceholder('Selecione o novo responsavel')
    .setMinValues(1)
    .setMaxValues(1);
}

/** Seletor dos participantes atuais para remocao. */
export function buildRemoveMemberSelect(
  ticketId: string,
  participants: ReadonlyArray<{ id: string; label: string }>,
): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.REMOVE_MEMBER_SELECT, ticketId))
    .setPlaceholder('Selecione quem sera removido')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    participants.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((participant) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(participant.label, DISCORD_LIMITS.SELECT_LABEL))
        .setValue(participant.id),
    ),
  );

  return menu;
}
