"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketModals = exports.ticketSelects = exports.ticketButtons = void 0;
const client_1 = require("@prisma/client");
const v2_1 = require("../../components/v2");
const reply_1 = require("../../components/reply");
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const OrphanCleanupBuilder_1 = require("../../modules/tickets/builders/OrphanCleanupBuilder");
const OrphanThreadService_1 = require("../../modules/tickets/services/OrphanThreadService");
const discord_1 = require("../../utils/discord");
const TicketModalBuilder_1 = require("../../modules/tickets/builders/TicketModalBuilder");
const TicketInternalPanelBuilder_1 = require("../../modules/tickets/builders/TicketInternalPanelBuilder");
const TicketPanelBuilder_1 = require("../../modules/tickets/builders/TicketPanelBuilder");
const TicketLocatorBuilder_1 = require("../../modules/tickets/builders/TicketLocatorBuilder");
const TicketLocatorService_1 = require("../../modules/tickets/services/TicketLocatorService");
const TicketRepository_1 = require("../../modules/tickets/repositories/TicketRepository");
const TicketParticipantRepository_1 = require("../../modules/tickets/repositories/TicketParticipantRepository");
const TicketClaimService_1 = require("../../modules/tickets/services/TicketClaimService");
const TicketCloseService_1 = require("../../modules/tickets/services/TicketCloseService");
const TicketCreationService_1 = require("../../modules/tickets/services/TicketCreationService");
const TicketMemberService_1 = require("../../modules/tickets/services/TicketMemberService");
const TicketNotificationService_1 = require("../../modules/tickets/services/TicketNotificationService");
const TicketViewService_1 = require("../../modules/tickets/services/TicketViewService");
const TicketConfigService_1 = require("../../modules/tickets/services/TicketConfigService");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
/**
 * Handlers de interacao do modulo de tickets.
 *
 * Sao propositalmente finos: validam o alvo, delegam para o service e respondem.
 * Toda regra de negocio (permissao, concorrencia, fila) vive nos services.
 */
/** Carrega o ticket garantindo que ele pertence a esta guild. */
async function loadTicket(guild, ticketId) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null || ticket.guildId !== guild.id) {
        throw new errors_1.ValidationError(`Ticket inexistente: ${ticketId}`, {
            userMessage: 'Este atendimento nao foi encontrado.',
        });
    }
    return ticket;
}
function requireGuildContext(interaction) {
    if (interaction.guild === null || interaction.member === null) {
        throw new errors_1.ValidationError('Interacao fora de guild.', {
            userMessage: 'Esta acao so pode ser usada dentro do servidor.',
        });
    }
    return { guild: interaction.guild, member: interaction.member };
}
// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------
const claimButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.CLAIM,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'ticketId');
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const result = await (0, TicketClaimService_1.claimTicket)(guild, member, ticketId);
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.CLAIM} Voce assumiu o atendimento ${(0, TicketInternalPanelBuilder_1.formatTicketNumber)(result.ticket.ticketNumber)}.`)));
    },
};
const refreshButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.REFRESH,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'ticketId');
        const ticket = await loadTicket(guild, ticketId);
        // O painel interno expoe assunto, cliente, responsavel e participantes.
        // Sem esta revalidacao um customId forjado (`ticket:refresh:<outroId>`)
        // renderizaria os dados de outro atendimento da guild.
        await (0, PermissionService_1.assertCanManageTicketMembers)(member, ticket);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const panel = await (0, TicketViewService_1.buildPanelForTicket)(ticket, guild);
        await (0, reply_1.editReplyV2)(interaction, panel);
    },
};
const notifyButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.NOTIFY,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'ticketId');
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const result = await (0, TicketNotificationService_1.notifyClient)(guild, member, ticketId);
        if (result.dmSent) {
            await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.NOTIFY} Cliente notificado no canal e por mensagem direta.`)));
            return;
        }
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.WARNING).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.NOTIFY} Cliente notificado no canal.\n` +
            '⚠️ Nao foi possivel enviar a mensagem direta (DM fechada ou bloqueada).')));
    },
};
const adminButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.ADMIN,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticket = await loadTicket(guild, (0, customIds_1.requireArg)(parsed, 0, 'ticketId'));
        await (0, PermissionService_1.assertCanManageTicketMembers)(member, ticket);
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
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const [category, config, participants] = await Promise.all([
            (0, TicketConfigService_1.getCategoryById)(guild.id, ticket.categoryId),
            (0, GuildConfigService_1.getGuildConfig)(guild.id),
            (0, TicketParticipantRepository_1.listActiveParticipants)(ticket.id),
        ]);
        /*
         * O select de remocao so existe quando ha alguem para remover: um
         * StringSelectMenu sem opcoes e recusado com 400 pela API.
         */
        let removeMemberSelect = null;
        if (participants.length > 0) {
            const options = await Promise.all(participants.map(async (participant) => {
                const target = await (0, discord_1.fetchMemberSafe)(guild, participant.userId);
                return { id: participant.userId, label: (0, discord_1.displayNameOf)(target, participant.userId) };
            }));
            removeMemberSelect = (0, TicketModalBuilder_1.buildRemoveMemberSelect)(ticket.id, options);
        }
        await (0, reply_1.replyV2)(interaction, (0, TicketInternalPanelBuilder_1.buildAdminPanel)({
            ticket,
            categoryName: category?.name ?? 'Categoria removida',
            actorId: member.id,
            addMemberSelect: (0, TicketModalBuilder_1.buildAddMemberSelect)(ticket.id),
            transferSelect: (0, TicketModalBuilder_1.buildTransferSelect)(ticket.id),
            removeMemberSelect,
            thumbnailUrl: config.panelThumbnailUrl,
            storeName: config.storeName,
        }), { ephemeral: true });
    },
};
const closeButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.CLOSE,
    async handle(interaction, parsed) {
        const { guild } = requireGuildContext(interaction);
        const ticket = await loadTicket(guild, (0, customIds_1.requireArg)(parsed, 0, 'ticketId'));
        if (ticket.status === client_1.TicketStatus.CLOSED ||
            ticket.status === client_1.TicketStatus.CLOSING ||
            ticket.status === client_1.TicketStatus.ORPHANED) {
            await (0, reply_1.replyWarning)(interaction, 'Este atendimento ja esta encerrado ou em encerramento.');
            return;
        }
        // showModal precisa ser a PRIMEIRA resposta da interacao.
        await interaction.showModal((0, TicketModalBuilder_1.buildTicketCloseModal)(ticket.id, ticket.ticketNumber));
    },
};
const renameButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.RENAME,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticket = await loadTicket(guild, (0, customIds_1.requireArg)(parsed, 0, 'ticketId'));
        await (0, PermissionService_1.assertCanManageTicketMembers)(member, ticket);
        await interaction.showModal((0, TicketModalBuilder_1.buildTicketRenameModal)(ticket.id, ticket.channelName ?? `ticket-${ticket.ticketNumber}`));
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
const locateButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.LOCATE,
    async handle(interaction, parsed) {
        const { guild } = requireGuildContext(interaction);
        const categoryId = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const category = await (0, TicketConfigService_1.getCategoryById)(guild.id, categoryId);
        if (category === null) {
            await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.DANGER).addTextDisplayComponents((0, v2_1.text)('⛔ Esta categoria nao existe mais. Avise a equipe.')));
            return;
        }
        const located = await (0, TicketLocatorService_1.locateTickets)(guild, interaction.user.id, category.id);
        await (0, reply_1.editReplyV2)(interaction, (0, TicketLocatorBuilder_1.buildLocatorResult)(guild.id, category.name, located));
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
const locateDeliveredButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.LOCATE_DELIVERED,
    async handle(interaction) {
        const { guild } = requireGuildContext(interaction);
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const located = await (0, TicketLocatorService_1.locateDeliveredTickets)(guild, interaction.user.id);
        await (0, reply_1.editReplyV2)(interaction, (0, TicketLocatorBuilder_1.buildLocatorResult)(guild.id, 'entregas', located, {
            emptyMessage: `${branding_1.EMOJIS.SEARCH} **Nenhuma entrega esperando a sua confirmação.**\n` +
                'Quando a equipe entregar um pedido seu, ele aparece aqui até você confirmar o recebimento.',
        }));
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
const createButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.CREATE,
    async handle(interaction) {
        const { guild } = requireGuildContext(interaction);
        const categories = await (0, TicketConfigService_1.getEnabledCategories)(guild.id);
        await interaction.showModal((0, TicketModalBuilder_1.buildTicketCreateModal)(categories));
    },
};
// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------
const addMemberSelect = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.ADD_MEMBER_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'ticketId');
        const targetId = interaction.values[0];
        if (targetId === undefined) {
            await (0, reply_1.replyError)(interaction, 'Nenhum membro selecionado.');
            return;
        }
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const target = await (0, discord_1.fetchMemberSafe)(guild, targetId);
        if (target === null) {
            await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.DANGER).addTextDisplayComponents((0, v2_1.text)('⛔ Este usuario nao esta mais no servidor.')));
            return;
        }
        await (0, TicketMemberService_1.addTicketMember)(guild, member, ticketId, target);
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.ADD} ${(0, discord_1.userMention)(targetId)} agora tem acesso a este atendimento.`)));
    },
};
const removeMemberSelect = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.REMOVE_MEMBER_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'ticketId');
        const targetId = interaction.values[0];
        if (targetId === undefined) {
            await (0, reply_1.replyError)(interaction, 'Nenhum participante selecionado.');
            return;
        }
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        await (0, TicketMemberService_1.removeTicketMember)(guild, member, ticketId, targetId);
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.REMOVE} ${(0, discord_1.userMention)(targetId)} perdeu o acesso a este atendimento.`)));
    },
};
const transferSelect = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.TRANSFER_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'ticketId');
        const targetId = interaction.values[0];
        if (targetId === undefined) {
            await (0, reply_1.replyError)(interaction, 'Nenhum atendente selecionado.');
            return;
        }
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const target = await (0, discord_1.fetchMemberSafe)(guild, targetId);
        if (target === null) {
            await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.DANGER).addTextDisplayComponents((0, v2_1.text)('⛔ Este usuario nao esta mais no servidor.')));
            return;
        }
        const result = await (0, TicketClaimService_1.transferTicket)(guild, member, ticketId, target);
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.SUCCESS).addTextDisplayComponents((0, v2_1.text)(`${branding_1.EMOJIS.TRANSFER} Atendimento transferido para ${(0, discord_1.userMention)(result.toStaffId)}.`)));
    },
};
// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
const createModal = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.CREATE_MODAL,
    async handle(interaction) {
        const { guild, member } = requireGuildContext(interaction);
        const subject = interaction.fields.getTextInputValue(TicketModalBuilder_1.TICKET_FIELD.SUBJECT);
        /*
         * A categoria vem do SELECT do proprio formulario, nao mais do customId:
         * motivo e categoria chegam no mesmo envio. `createTicketFlow` recarrega a
         * categoria no banco, entao uma desativada entre abrir e enviar o
         * formulario ainda e recusada.
         */
        const categoryId = interaction.fields.getStringSelectValues(TicketModalBuilder_1.TICKET_FIELD.CATEGORY)[0];
        if (categoryId === undefined) {
            throw new errors_1.ValidationError('Formulario de ticket enviado sem categoria.', {
                userMessage: 'Escolha uma categoria de atendimento e envie novamente.',
            });
        }
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const result = await (0, TicketCreationService_1.createTicketFlow)({ guild, member, categoryId, subject });
        await (0, reply_1.editReplyV2)(interaction, (0, TicketPanelBuilder_1.buildTicketCreatedNotice)({
            guildId: guild.id,
            ticketNumber: result.ticket.ticketNumber,
            categoryName: result.categoryName,
            channelId: result.channel.id,
            queuePosition: result.queue.position,
            aheadCount: result.queue.ahead,
        }));
    },
};
const closeModal = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.CLOSE_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'ticketId');
        const reason = interaction.fields.getTextInputValue('reason');
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const result = await (0, TicketCloseService_1.closeTicket)(guild, member, ticketId, reason);
        const notes = [
            `${branding_1.EMOJIS.CLOSE} Atendimento ${(0, TicketInternalPanelBuilder_1.formatTicketNumber)(result.ticket.ticketNumber)} finalizado.`,
            `Transcript com ${result.messageCount} mensagem(ns) ${result.logSent ? 'enviado ao canal de logs.' : 'nao pode ser enviado (canal de logs indisponivel).'}`,
        ];
        if (!result.dmSent)
            notes.push('⚠️ Nao foi possivel enviar a DM de encerramento ao cliente.');
        if (!result.reviewRequested)
            notes.push('⚠️ Nao foi possivel enviar o pedido de avaliacao.');
        // O canal costuma ser apagado antes desta resposta chegar; por isso ela e efemera.
        await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(branding_1.COLORS.NEUTRAL).addTextDisplayComponents((0, v2_1.text)(notes.join('\n')))).catch(() => undefined);
    },
};
const renameModal = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.RENAME_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        const ticketId = (0, customIds_1.requireArg)(parsed, 0, 'ticketId');
        const name = interaction.fields.getTextInputValue('name');
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const result = await (0, TicketMemberService_1.renameTicket)(guild, member, ticketId, name);
        const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
        if (ticket !== null)
            await (0, TicketViewService_1.refreshInternalPanel)(guild, ticket);
        await (0, reply_1.replySuccess)(interaction, `${branding_1.EMOJIS.EDIT} Canal renomeado de \`${result.oldName}\` para \`${result.newName}\`.`);
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
const cleanOrphansButton = {
    namespace: customIds_1.NAMESPACE.TICKET,
    action: customIds_1.TICKET_ACTION.CLEAN_ORPHANS,
    async handle(interaction, parsed) {
        const { guild, member } = requireGuildContext(interaction);
        // O botao nao autoriza nada: quem clica precisa ser admin AGORA, nao no
        // momento em que a previa foi gerada.
        (0, PermissionService_1.assertCanManageSystem)(member);
        const cutoff = Number((0, customIds_1.requireArg)(parsed, 0, 'cutoff'));
        if (!Number.isFinite(cutoff)) {
            throw new errors_1.ValidationError('Corte invalido na limpeza de orfaos.', {
                userMessage: 'Esta tela expirou. Rode o comando de orfaos novamente.',
            });
        }
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const orphans = (await (0, OrphanThreadService_1.findOrphanThreads)(guild)).filter((orphan) => orphan.createdAt !== null && orphan.createdAt.getTime() <= cutoff);
        const result = await (0, OrphanThreadService_1.deleteOrphanThreads)(guild, orphans);
        await (0, reply_1.editReplyV2)(interaction, (0, OrphanCleanupBuilder_1.buildOrphanCleanupResult)(result));
    },
};
exports.ticketButtons = [
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
exports.ticketSelects = [
    addMemberSelect,
    removeMemberSelect,
    transferSelect,
];
exports.ticketModals = [createModal, closeModal, renameModal];
//# sourceMappingURL=index.js.map