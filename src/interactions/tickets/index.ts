import { TicketStatus } from '@prisma/client';
import type {
  ButtonInteraction,
  StringSelectMenuBuilder,
  Guild,
  GuildMember,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';

import { container, text } from '../../components/v2';
import {
  deferIfNeeded,
  deferUpdateIfNeeded,
  editReplyV2,
  replyError,
  replySuccess,
  replyV2,
  replyWarning,
} from '../../components/reply';
import { COLORS, EMOJIS } from '../../constants/branding';
import {
  NAMESPACE,
  TICKET_ACTION,
  requireArg,
  type ParsedCustomId,
} from '../../constants/customIds';
import { ValidationError } from '../../core/errors';
import {
  assertCanManageSystem,
  assertCanManageTicketMembers,
} from '../../core/permissions/PermissionService';
import {
  buildOrphanCleanupResult,
} from '../../modules/tickets/builders/OrphanCleanupBuilder';
import {
  deleteOrphanThreads,
  findOrphanThreads,
} from '../../modules/tickets/services/OrphanThreadService';
import { displayNameOf, fetchMemberSafe, userMention } from '../../utils/discord';
import {
  buildAddMemberSelect,
  buildRemoveMemberSelect,
  buildTicketCloseModal,
  buildTicketCreateModal,
  buildTicketRenameModal,
  buildTransferSelect,
  TICKET_FIELD,
} from '../../modules/tickets/builders/TicketModalBuilder';
import {
  buildAdminPanel,
  formatTicketNumber,
} from '../../modules/tickets/builders/TicketInternalPanelBuilder';
import { buildTicketCreatedNotice } from '../../modules/tickets/builders/TicketPanelBuilder';
import { buildLocatorResult } from '../../modules/tickets/builders/TicketLocatorBuilder';
import {
  locateDeliveredTickets,
  locateTickets,
} from '../../modules/tickets/services/TicketLocatorService';
import { findTicketById } from '../../modules/tickets/repositories/TicketRepository';
import { listActiveParticipants } from '../../modules/tickets/repositories/TicketParticipantRepository';
import { claimTicket, transferTicket } from '../../modules/tickets/services/TicketClaimService';
import { closeTicket } from '../../modules/tickets/services/TicketCloseService';
import { createTicketFlow } from '../../modules/tickets/services/TicketCreationService';
import {
  addTicketMember,
  removeTicketMember,
  renameTicket,
} from '../../modules/tickets/services/TicketMemberService';
import { notifyClient } from '../../modules/tickets/services/TicketNotificationService';
import {
  buildPanelForTicket,
  refreshInternalPanel,
} from '../../modules/tickets/services/TicketViewService';
import {
  getCategoryById,
  getEnabledCategories,
} from '../../modules/tickets/services/TicketConfigService';
import { getGuildConfig } from '../../modules/configuration/services/GuildConfigService';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';

/**
 * Handlers de interacao do modulo de tickets.
 *
 * Sao propositalmente finos: validam o alvo, delegam para o service e respondem.
 * Toda regra de negocio (permissao, concorrencia, fila) vive nos services.
 */

/** Carrega o ticket garantindo que ele pertence a esta guild. */
async function loadTicket(guild: Guild, ticketId: string) {
  const ticket = await findTicketById(ticketId);
  if (ticket === null || ticket.guildId !== guild.id) {
    throw new ValidationError(`Ticket inexistente: ${ticketId}`, {
      userMessage: 'Este atendimento nao foi encontrado.',
    });
  }
  return ticket;
}

function requireGuildContext(interaction: {
  guild: Guild | null;
  member: unknown;
}): { guild: Guild; member: GuildMember } {
  if (interaction.guild === null || interaction.member === null) {
    throw new ValidationError('Interacao fora de guild.', {
      userMessage: 'Esta acao so pode ser usada dentro do servidor.',
    });
  }
  return { guild: interaction.guild, member: interaction.member as GuildMember };
}

// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------

const claimButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.CLAIM,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticketId = requireArg(parsed, 0, 'ticketId');

    await deferIfNeeded(interaction, { ephemeral: true });
    const result = await claimTicket(guild, member, ticketId);

    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(
          `${EMOJIS.CLAIM} Voce assumiu o atendimento ${formatTicketNumber(result.ticket.ticketNumber)}.`,
        ),
      ),
    );
  },
};

const refreshButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.REFRESH,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticketId = requireArg(parsed, 0, 'ticketId');
    const ticket = await loadTicket(guild, ticketId);

    // O painel interno expoe assunto, cliente, responsavel e participantes.
    // Sem esta revalidacao um customId forjado (`ticket:refresh:<outroId>`)
    // renderizaria os dados de outro atendimento da guild.
    await assertCanManageTicketMembers(member, ticket);

    await deferUpdateIfNeeded(interaction);

    const panel = await buildPanelForTicket(ticket, guild);
    await editReplyV2(interaction, panel);
  },
};

const notifyButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.NOTIFY,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticketId = requireArg(parsed, 0, 'ticketId');

    await deferIfNeeded(interaction, { ephemeral: true });
    const result = await notifyClient(guild, member, ticketId);

    if (result.dmSent) {
      await editReplyV2(
        interaction,
        container(COLORS.SUCCESS).addTextDisplayComponents(
          text(`${EMOJIS.NOTIFY} Cliente notificado no canal e por mensagem direta.`),
        ),
      );
      return;
    }

    await editReplyV2(
      interaction,
      container(COLORS.WARNING).addTextDisplayComponents(
        text(
          `${EMOJIS.NOTIFY} Cliente notificado no canal.\n` +
            '⚠️ Nao foi possivel enviar a mensagem direta (DM fechada ou bloqueada).',
        ),
      ),
    );
  },
};

const adminButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.ADMIN,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticket = await loadTicket(guild, requireArg(parsed, 0, 'ticketId'));
    await assertCanManageTicketMembers(member, ticket);

    /*
     * Defer ANTES de montar o painel.
     *
     * Com os selects agora inline, abrir o painel custa tres consultas ao banco
     * mais um `guild.members.fetch` por participante (ate
     * BUSINESS_LIMITS.MAX_PARTICIPANTS_PER_TICKET = 20, e REST puro sempre que o
     * cache esta frio — depois de todo restart do PM2, por exemplo). A interacao
     * precisa ser reconhecida em 3s: sem o defer, o ticket movimentado e
     * justamente o que perde a corrida e morre com 10062 (Unknown interaction),
     * deixando a equipe sem painel. `replyV2` enxerga o defer e cai em
     * `editReply`, entao a resposta continua efemera.
     */
    await deferIfNeeded(interaction, { ephemeral: true });

    const [category, config, participants] = await Promise.all([
      getCategoryById(guild.id, ticket.categoryId),
      getGuildConfig(guild.id),
      listActiveParticipants(ticket.id),
    ]);

    /*
     * O select de remocao so existe quando ha alguem para remover: um
     * StringSelectMenu sem opcoes e recusado com 400 pela API.
     */
    let removeMemberSelect: StringSelectMenuBuilder | null = null;
    if (participants.length > 0) {
      const options = await Promise.all(
        participants.map(async (participant: { userId: string }) => {
          const target = await fetchMemberSafe(guild, participant.userId);
          return { id: participant.userId, label: displayNameOf(target, participant.userId) };
        }),
      );
      removeMemberSelect = buildRemoveMemberSelect(ticket.id, options);
    }

    await replyV2(
      interaction,
      buildAdminPanel({
        ticket,
        categoryName: category?.name ?? 'Categoria removida',
        actorId: member.id,
        addMemberSelect: buildAddMemberSelect(ticket.id),
        transferSelect: buildTransferSelect(ticket.id),
        removeMemberSelect,
        thumbnailUrl: config.panelThumbnailUrl,
        storeName: config.storeName,
      }),
      { ephemeral: true },
    );
  },
};

const closeButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.CLOSE,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const ticket = await loadTicket(guild, requireArg(parsed, 0, 'ticketId'));

    if (
      ticket.status === TicketStatus.CLOSED ||
      ticket.status === TicketStatus.CLOSING ||
      ticket.status === TicketStatus.ORPHANED
    ) {
      await replyWarning(interaction, 'Este atendimento ja esta encerrado ou em encerramento.');
      return;
    }

    // showModal precisa ser a PRIMEIRA resposta da interacao.
    await interaction.showModal(buildTicketCloseModal(ticket.id, ticket.ticketNumber));
  },
};

const renameButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.RENAME,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticket = await loadTicket(guild, requireArg(parsed, 0, 'ticketId'));
    await assertCanManageTicketMembers(member, ticket);

    await interaction.showModal(
      buildTicketRenameModal(ticket.id, ticket.channelName ?? `ticket-${ticket.ticketNumber}`),
    );
  },
};

/**
 * "Localizar meu ticket", no painel do canal de destino.
 *
 * Efemero: a lista traz assunto e situacao dos atendimentos do cliente, e o
 * canal onde o painel vive e visivel para o servidor inteiro.
 *
 * Nao exige permissao de equipe — e justamente o cliente que precisa dele. O
 * escopo e garantido pelo dado: `locateTickets` so devolve tickets cujo dono e
 * quem clicou.
 */
const locateButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.LOCATE,
  async handle(interaction, parsed): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const categoryId = requireArg(parsed, 0, 'categoria');

    await deferIfNeeded(interaction, { ephemeral: true });

    const category = await getCategoryById(guild.id, categoryId);
    if (category === null) {
      await editReplyV2(
        interaction,
        container(COLORS.DANGER).addTextDisplayComponents(
          text('⛔ Esta categoria nao existe mais. Avise a equipe.'),
        ),
      );
      return;
    }

    const located = await locateTickets(guild, interaction.user.id, category.id);
    await editReplyV2(interaction, buildLocatorResult(guild.id, category.name, located));
  },
};

/**
 * "Localizar minha entrega", no painel do canal de entregas.
 *
 * Sem argumento e sem categoria: a busca e "os tickets ENTREGUES de quem
 * clicou", em qualquer categoria. O canal so aparece para quem tem entrega
 * esperando, mas a busca nao confia nisso — quem clicou sem ter nada pendente
 * recebe a frase certa em vez de uma lista vazia.
 */
const locateDeliveredButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.LOCATE_DELIVERED,
  async handle(interaction): Promise<void> {
    const { guild } = requireGuildContext(interaction);

    await deferIfNeeded(interaction, { ephemeral: true });

    const located = await locateDeliveredTickets(guild, interaction.user.id);
    await editReplyV2(
      interaction,
      buildLocatorResult(guild.id, 'entregas', located, {
        emptyMessage:
          `${EMOJIS.SEARCH} **Nenhuma entrega esperando a sua confirmação.**\n` +
          'Quando a equipe entregar um pedido seu, ele aparece aqui até você confirmar o recebimento.',
      }),
    );
  },
};

/**
 * "Iniciar atendimento", no painel publico.
 *
 * As categorias sao lidas AQUI, no clique, e nao guardadas no customId: o
 * painel fica publicado por semanas e uma categoria desativada nesse meio tempo
 * continuaria aparecendo no formulario. `showModal` precisa ser a primeira
 * resposta da interacao — nada de deferir antes.
 */
const createButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.CREATE,
  async handle(interaction): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const categories = await getEnabledCategories(guild.id);

    await interaction.showModal(buildTicketCreateModal(categories));
  },
};

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

const addMemberSelect: SelectHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.ADD_MEMBER_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticketId = requireArg(parsed, 0, 'ticketId');

    const targetId = (interaction as UserSelectMenuInteraction).values[0];
    if (targetId === undefined) {
      await replyError(interaction, 'Nenhum membro selecionado.');
      return;
    }

    await deferIfNeeded(interaction, { ephemeral: true });

    const target = await fetchMemberSafe(guild, targetId);
    if (target === null) {
      await editReplyV2(
        interaction,
        container(COLORS.DANGER).addTextDisplayComponents(
          text('⛔ Este usuario nao esta mais no servidor.'),
        ),
      );
      return;
    }

    await addTicketMember(guild, member, ticketId, target);
    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(`${EMOJIS.ADD} ${userMention(targetId)} agora tem acesso a este atendimento.`),
      ),
    );
  },
};

const removeMemberSelect: SelectHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.REMOVE_MEMBER_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticketId = requireArg(parsed, 0, 'ticketId');

    const targetId = (interaction as StringSelectMenuInteraction).values[0];
    if (targetId === undefined) {
      await replyError(interaction, 'Nenhum participante selecionado.');
      return;
    }

    await deferIfNeeded(interaction, { ephemeral: true });
    await removeTicketMember(guild, member, ticketId, targetId);

    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(`${EMOJIS.REMOVE} ${userMention(targetId)} perdeu o acesso a este atendimento.`),
      ),
    );
  },
};

const transferSelect: SelectHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.TRANSFER_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticketId = requireArg(parsed, 0, 'ticketId');

    const targetId = (interaction as UserSelectMenuInteraction).values[0];
    if (targetId === undefined) {
      await replyError(interaction, 'Nenhum atendente selecionado.');
      return;
    }

    await deferIfNeeded(interaction, { ephemeral: true });

    const target = await fetchMemberSafe(guild, targetId);
    if (target === null) {
      await editReplyV2(
        interaction,
        container(COLORS.DANGER).addTextDisplayComponents(
          text('⛔ Este usuario nao esta mais no servidor.'),
        ),
      );
      return;
    }

    const result = await transferTicket(guild, member, ticketId, target);
    await editReplyV2(
      interaction,
      container(COLORS.SUCCESS).addTextDisplayComponents(
        text(
          `${EMOJIS.TRANSFER} Atendimento transferido para ${userMention(result.toStaffId)}.`,
        ),
      ),
    );
  },
};

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

const createModal: ModalHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.CREATE_MODAL,
  async handle(interaction: ModalSubmitInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const subject = interaction.fields.getTextInputValue(TICKET_FIELD.SUBJECT);

    /*
     * A categoria vem do SELECT do proprio formulario, nao mais do customId:
     * motivo e categoria chegam no mesmo envio. `createTicketFlow` recarrega a
     * categoria no banco, entao uma desativada entre abrir e enviar o
     * formulario ainda e recusada.
     */
    const categoryId = interaction.fields.getStringSelectValues(TICKET_FIELD.CATEGORY)[0];
    if (categoryId === undefined) {
      throw new ValidationError('Formulario de ticket enviado sem categoria.', {
        userMessage: 'Escolha uma categoria de atendimento e envie novamente.',
      });
    }

    await deferIfNeeded(interaction, { ephemeral: true });

    const result = await createTicketFlow({ guild, member, categoryId, subject });

    await editReplyV2(
      interaction,
      buildTicketCreatedNotice({
        guildId: guild.id,
        ticketNumber: result.ticket.ticketNumber,
        categoryName: result.categoryName,
        channelId: result.channel.id,
        queuePosition: result.queue.position,
        aheadCount: result.queue.ahead,
      }),
    );
  },
};

const closeModal: ModalHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.CLOSE_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticketId = requireArg(parsed, 0, 'ticketId');
    const reason = interaction.fields.getTextInputValue('reason');

    await deferIfNeeded(interaction, { ephemeral: true });

    const result = await closeTicket(guild, member, ticketId, reason);

    const notes: string[] = [
      `${EMOJIS.CLOSE} Atendimento ${formatTicketNumber(result.ticket.ticketNumber)} finalizado.`,
      `Transcript com ${result.messageCount} mensagem(ns) ${result.logSent ? 'enviado ao canal de logs.' : 'nao pode ser enviado (canal de logs indisponivel).'}`,
    ];
    if (!result.dmSent) notes.push('⚠️ Nao foi possivel enviar a DM de encerramento ao cliente.');
    if (!result.reviewRequested) notes.push('⚠️ Nao foi possivel enviar o pedido de avaliacao.');

    // O canal costuma ser apagado antes desta resposta chegar; por isso ela e efemera.
    await editReplyV2(
      interaction,
      container(COLORS.NEUTRAL).addTextDisplayComponents(text(notes.join('\n'))),
    ).catch(() => undefined);
  },
};

const renameModal: ModalHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.RENAME_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const ticketId = requireArg(parsed, 0, 'ticketId');
    const name = interaction.fields.getTextInputValue('name');

    await deferIfNeeded(interaction, { ephemeral: true });
    const result = await renameTicket(guild, member, ticketId, name);

    const ticket = await findTicketById(ticketId);
    if (ticket !== null) await refreshInternalPanel(guild, ticket);

    await replySuccess(
      interaction,
      `${EMOJIS.EDIT} Canal renomeado de \`${result.oldName}\` para \`${result.newName}\`.`,
    );
  },
};

/**
 * Confirmacao da limpeza de topicos orfaos.
 *
 * VARRE DE NOVO em vez de confiar numa lista guardada. O customId carrega
 * apenas o instante da previa, e o que passa do corte fica de fora: um ticket
 * aberto entre a tela e o clique nunca foi mostrado ao operador.
 *
 * A segunda varredura tambem reconsulta o banco, entao um topico que virou
 * ticket legitimo nesse intervalo deixa de ser orfao e sai da lista sozinho.
 */
const cleanOrphansButton: ButtonHandler = {
  namespace: NAMESPACE.TICKET,
  action: TICKET_ACTION.CLEAN_ORPHANS,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    // O botao nao autoriza nada: quem clica precisa ser admin AGORA, nao no
    // momento em que a previa foi gerada.
    assertCanManageSystem(member);

    const cutoff = Number(requireArg(parsed, 0, 'cutoff'));
    if (!Number.isFinite(cutoff)) {
      throw new ValidationError('Corte invalido na limpeza de orfaos.', {
        userMessage: 'Esta tela expirou. Rode o comando de orfaos novamente.',
      });
    }

    await deferUpdateIfNeeded(interaction);

    const orphans = (await findOrphanThreads(guild)).filter(
      (orphan) => orphan.createdAt !== null && orphan.createdAt.getTime() <= cutoff,
    );

    const result = await deleteOrphanThreads(guild, orphans);
    await editReplyV2(interaction, buildOrphanCleanupResult(result));
  },
};

export const ticketButtons: ButtonHandler[] = [
  createButton,
  locateButton,
  locateDeliveredButton,
  claimButton,
  refreshButton,
  notifyButton,
  adminButton,
  closeButton,
  renameButton,
  cleanOrphansButton,
];

export const ticketSelects: SelectHandler[] = [
  addMemberSelect,
  removeMemberSelect,
  transferSelect,
];

export const ticketModals: ModalHandler[] = [createModal, closeModal, renameModal];
