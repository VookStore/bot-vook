"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeTicket = closeTicket;
const client_1 = require("@prisma/client");
const reply_1 = require("../../../components/reply");
const LockService_1 = require("../../../core/locks/LockService");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const PermissionService_1 = require("../../../core/permissions/PermissionService");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const AuditRepository_1 = require("../../audit/repositories/AuditRepository");
const ReviewService_1 = require("../../reviews/services/ReviewService");
const TicketLogBuilder_1 = require("../builders/TicketLogBuilder");
const TicketParticipantRepository_1 = require("../repositories/TicketParticipantRepository");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TranscriptService_1 = require("./TranscriptService");
const TranscriptHostingService_1 = require("./TranscriptHostingService");
const TicketChannelService_1 = require("./TicketChannelService");
const TicketConfigService_1 = require("./TicketConfigService");
const TicketAccessService_1 = require("./TicketAccessService");
const TicketDoneService_1 = require("./TicketDoneService");
const TicketLocatorService_1 = require("./TicketLocatorService");
const TicketNotificationService_1 = require("./TicketNotificationService");
const TicketQueueService_1 = require("./TicketQueueService");
/**
 * Encerramento do ticket.
 *
 * Ordem escolhida para preservar integridade:
 *   permissao -> lock -> CLOSING (atomico) -> historico -> transcript ->
 *   CLOSED no banco -> log + anexo -> DM de encerramento (ja com o convite de
 *   avaliacao) -> exclusao do canal.
 *
 * O estado final e gravado ANTES de apagar o canal: se a exclusao falhar, o
 * ticket ja esta correto no banco e o canal orfao aparece no diagnostico.
 * Transcript/log/DM/avaliacao sao best-effort: nenhum deles impede o fechamento.
 */
const logger = (0, Logger_1.createLogger)('ticket:close');
/**
 * O fechamento roda inteiro sob lock e faz muita chamada REST (ate 51 paginas
 * de historico + anexo + log + DM + avaliacao + exclusao do canal). Com o TTL
 * padrao de 30s um ticket longo perde o lock no meio e deixa de estar protegido
 * contra duplo clique. 5 minutos cobrem o pior caso com folga.
 */
const CLOSE_LOCK_TTL_MS = 5 * 60_000;
async function buildHeader(params) {
    const { guild, ticket } = params;
    const ownerMember = await (0, discord_1.fetchMemberSafe)(guild, ticket.ownerId);
    const staffMember = ticket.claimedById !== null ? await (0, discord_1.fetchMemberSafe)(guild, ticket.claimedById) : null;
    const participants = [];
    for (const participantId of params.participantIds) {
        const member = await (0, discord_1.fetchMemberSafe)(guild, participantId);
        participants.push({ id: participantId, name: (0, discord_1.displayNameOf)(member, participantId) });
    }
    return {
        storeName: params.storeName,
        ticketNumber: ticket.ticketNumber,
        categoryName: params.categoryName,
        subject: ticket.subject,
        ownerId: ticket.ownerId,
        ownerName: (0, discord_1.displayNameOf)(ownerMember, ticket.ownerId),
        staffId: ticket.claimedById,
        staffName: staffMember !== null ? (0, discord_1.displayNameOf)(staffMember, ticket.claimedById ?? '') : null,
        closedById: params.closedBy.id,
        closedByName: (0, discord_1.displayNameOf)(params.closedBy, params.closedBy.id),
        participants,
        openedAt: ticket.createdAt,
        closedAt: params.closedAt,
        closeReason: ticket.closeReason,
        durationMs: Math.max(0, params.closedAt.getTime() - ticket.createdAt.getTime()),
    };
}
async function closeTicket(guild, actor, ticketId, rawReason) {
    const ticket = await (0, TicketRepository_1.findTicketById)(ticketId);
    if (ticket === null || ticket.guildId !== guild.id) {
        throw new errors_1.ValidationError(`Ticket inexistente: ${ticketId}`, {
            userMessage: 'Este atendimento nao foi encontrado.',
        });
    }
    if (ticket.status === client_1.TicketStatus.CLOSED || ticket.status === client_1.TicketStatus.ORPHANED) {
        throw new errors_1.TicketStateError('Ticket ja encerrado.', {
            userMessage: 'Este atendimento ja foi encerrado.',
        });
    }
    if (ticket.status === client_1.TicketStatus.CLOSING) {
        throw new errors_1.TicketStateError('Ticket ja esta sendo encerrado.', {
            userMessage: 'Este atendimento ja esta sendo finalizado.',
        });
    }
    await (0, PermissionService_1.assertCanCloseTicket)(actor, ticket);
    const reason = rawReason.trim().length > 0 ? (0, sanitize_1.sanitizeReason)(rawReason) : null;
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.TICKET_CLOSE, ticket.id, async () => {
        // O status anterior vem do proprio update atomico, NUNCA da leitura
        // pre-lock: entre uma coisa e outra o ticket pode ter sido assumido.
        const previousStatus = await (0, TicketRepository_1.beginClosingAtomic)(ticket.id);
        if (previousStatus === null) {
            throw new errors_1.TicketStateError('Fechamento concorrente detectado.', {
                userMessage: 'Este atendimento ja esta sendo finalizado por outra pessoa.',
            });
        }
        let closed;
        let categoryName;
        let participantIds;
        let config;
        let channel = null;
        let messages = [];
        // A partir daqui o ticket esta CLOSING. QUALQUER falha antes do
        // `finalizeClose` precisa devolver o status anterior — senao o ticket
        // fica congelado: fora da fila, impossivel de assumir e impossivel de
        // fechar de novo, ate o RecoveryJob passar (ate ~20 min depois).
        try {
            config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
            const category = await (0, TicketConfigService_1.getCategoryById)(guild.id, ticket.categoryId);
            categoryName = category?.name ?? 'Categoria removida';
            const participants = await (0, TicketParticipantRepository_1.listActiveParticipants)(ticket.id);
            participantIds = participants.map((participant) => participant.userId);
            try {
                channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, ticket.channelId);
                if (channel !== null) {
                    messages = await (0, TranscriptService_1.fetchChannelMessages)(channel);
                }
            }
            catch (error) {
                // Sem transcript o atendimento ainda precisa ser encerrado.
                logger.warn('Falha ao coletar historico do ticket.', {
                    guildId: guild.id,
                    entityType: 'ticket',
                    entityId: ticket.id,
                    detail: error instanceof Error ? error.message : String(error),
                });
            }
            closed = await (0, TicketRepository_1.finalizeClose)(ticket.id, {
                closedById: actor.id,
                closeReason: reason,
            });
        }
        catch (error) {
            await (0, TicketRepository_1.revertClosing)(ticket.id, previousStatus).catch(() => undefined);
            throw error;
        }
        const closedAt = closed.closedAt ?? new Date();
        /*
         * --- Transcript publicado (best-effort) ---
         *
         * Vem ANTES do log porque a URL tem dois destinos: o cartao de
         * encerramento do cliente e o log da equipe. Deixar a geracao dentro do
         * bloco de log amarraria o transcript do cliente a existir um canal de
         * logs configurado.
         *
         * O HTML publicado NAO passa pelo encolhimento do anexo. Aquele corte
         * existe para caber nos 20 MiB do Discord; fora do anexo nao ha limite, e
         * perder metade da conversa era a maior fraqueza do transcript.
         */
        let header = null;
        let transcriptUrl = null;
        try {
            header = await buildHeader({
                guild,
                ticket: closed,
                categoryName,
                storeName: config.storeName,
                closedBy: actor,
                closedAt,
                participantIds,
            });
            /*
             * Copia dos anexos ANTES de renderizar.
             *
             * A URL de anexo do Discord expira em poucas horas; sem espelhar, o
             * transcript nasce com prazo de validade — e o comprovante, que e
             * justamente o que se reabre meses depois, e o primeiro a morrer. O
             * espelhamento e melhor-esforco e devolve o que conseguiu: o que falhou
             * mantem o link original e o HTML marca como temporario.
             *
             * A lista espelhada substitui a original porque o anexo do canal de
             * logs e renderizado do mesmo material — nao ha motivo para a copia da
             * equipe ser a versao pior.
             */
            messages = await (0, TranscriptHostingService_1.mirrorTranscriptAttachments)(messages);
            transcriptUrl = await (0, TranscriptHostingService_1.publishTranscript)((0, TranscriptService_1.renderTranscriptHtml)(header, messages, 0), closed.ticketNumber);
            if (transcriptUrl !== null) {
                /*
                 * Os ids dos anexos sao extraidos das URLs hospedadas e guardados com
                 * o transcript. E a unica chance: a chave no R2 e aleatoria e nao
                 * carrega o numero do ticket, entao sem esta lista o job de retencao
                 * apagaria o HTML e deixaria os arquivos — que sao a parte mais
                 * sensivel — orfaos e ilocalizaveis para sempre.
                 */
                const assetIds = messages
                    .flatMap((message) => message.attachments)
                    .flatMap((attachment) => typeof attachment.hostedUrl === 'string' ? [attachment.hostedUrl] : [])
                    .flatMap((url) => {
                    const id = (0, TranscriptHostingService_1.assetIdFromUrl)(url);
                    return id === null ? [] : [id];
                });
                await (0, TicketRepository_1.setTicketTranscriptUrl)(closed.id, transcriptUrl, assetIds);
            }
        }
        catch (error) {
            logger.warn('Falha ao gerar ou publicar o transcript.', {
                guildId: guild.id,
                entityType: 'ticket',
                entityId: closed.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
        // --- Log da equipe, com o transcript em anexo (best-effort) ---
        let logSent = false;
        try {
            const logChannel = await (0, discord_1.fetchChannelSafe)(guild, config.ticketLogChannelId);
            if ((0, discord_1.isSendableTextChannel)(logChannel) && header !== null) {
                const attachment = (0, TranscriptService_1.buildTranscriptAttachment)(header, messages);
                await (0, reply_1.sendV2)(logChannel, (0, TicketLogBuilder_1.buildCloseLog)({
                    ticketNumber: closed.ticketNumber,
                    ownerId: closed.ownerId,
                    categoryName,
                    subject: closed.subject,
                    staffId: closed.claimedById,
                    closedById: actor.id,
                    openedAt: closed.createdAt,
                    closedAt,
                    durationMs: header.durationMs,
                    closeReason: reason,
                    participantIds,
                    messageCount: messages.length,
                    ...(transcriptUrl !== null ? { transcriptUrl } : {}),
                }), { files: [attachment] });
                logSent = true;
            }
            else if (config.ticketLogChannelId !== null) {
                logger.warn('Canal de logs configurado esta inacessivel.', {
                    guildId: guild.id,
                    channelId: config.ticketLogChannelId,
                });
            }
        }
        catch (error) {
            logger.warn('Falha ao enviar log de encerramento.', {
                guildId: guild.id,
                entityType: 'ticket',
                entityId: closed.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
        /*
         * --- DM de encerramento, ja com o convite de avaliacao (best-effort) ---
         *
         * UMA mensagem, nao duas. O convite saia numa DM propria, disparada logo
         * atras desta: chegavam dois cartoes quase iguais em sequencia e o cliente
         * respondia o segundo achando que era repeticao.
         *
         * "Encerrado por" e o ATOR, nao quem assumiu: e a informacao que o cliente
         * procura quando quer saber com quem falar sobre o desfecho.
         */
        let dmSent = false;
        let reviewRequested = false;
        try {
            reviewRequested = await (0, ReviewService_1.canRequestReview)({
                guildId: guild.id,
                ticketId: closed.id,
                customerId: closed.ownerId,
            });
            dmSent = await (0, TicketNotificationService_1.sendClosureDm)({
                guild,
                ownerId: closed.ownerId,
                ticketNumber: closed.ticketNumber,
                categoryName,
                storeName: config.storeName,
                closedById: actor.id,
                closedByLabel: actor.displayName,
                closeReason: reason,
                bannerUrl: config.ticketBannerUrl,
                reviewTicketId: reviewRequested ? closed.id : null,
                transcriptUrl,
            });
        }
        catch (error) {
            logger.warn('Falha ao enviar DM de encerramento.', {
                guildId: guild.id,
                entityType: 'ticket',
                entityId: closed.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
        await (0, AuditRepository_1.recordTicketAudit)({
            guildId: guild.id,
            ticketId: closed.id,
            action: client_1.TicketAuditAction.CLOSED,
            actorId: actor.id,
            newValue: reason,
            metadata: { messageCount: messages.length, logSent, dmSent, reviewRequested },
        });
        /*
         * --- Encerramento da conversa (por ultimo) ---
         *
         * Topico e TRANCADO E ARQUIVADO; canal legado e apagado. A decisao mora
         * em `deleteTicketChannel`, que sabe distinguir os dois — aqui so
         * interessa que a conversa foi encerrada de alguma forma.
         */
        let channelDeleted = false;
        if (channel !== null) {
            try {
                const outcome = await (0, TicketChannelService_1.deleteTicketChannel)(channel, `Ticket #${closed.ticketNumber} encerrado por ${actor.user.tag}`);
                channelDeleted = outcome.outcome !== 'gone';
            }
            catch (error) {
                logger.warn('Falha ao encerrar a conversa do ticket.', {
                    guildId: guild.id,
                    channelId: channel.id,
                    entityType: 'ticket',
                    entityId: closed.id,
                    detail: error instanceof Error ? error.message : String(error),
                });
            }
        }
        /*
         * --- Acesso ao canal da categoria ---
         *
         * O canal de atendimento e oculto por padrao: so quem tem ticket aberto o
         * enxerga. Fechado o ticket, cliente e participantes perdem o acesso —
         * mas apenas quem NAO tem outro atendimento aberto na mesma categoria.
         *
         * `closed.id` e excluido da checagem: o proprio ticket que acabou de
         * fechar nao pode contar como motivo para manter o acesso.
         */
        for (const userId of new Set([closed.ownerId, ...participantIds])) {
            await (0, TicketAccessService_1.revokeCategoryAccessIfLast)(guild, closed.categoryId, userId, closed.id, `Ticket #${closed.ticketNumber} encerrado`);
        }
        /*
         * Ticket entregue tem cartao no canal de concluidos: ele passa a dizer
         * QUEM fechou — o cliente confirmando o recebimento, ou a equipe sem a
         * confirmacao dele. Ticket que nunca foi entregue nao tem cartao, e
         * nenhuma chamada ao Discord e feita.
         *
         * O transcript vai junto explicitamente: ele e gravado depois do
         * `finalizeClose`, e o `closed` em maos ainda nao o carrega.
         */
        if (closed.doneCardMessageId !== null) {
            await (0, TicketDoneService_1.refreshTicketDoneCard)(guild, { ...closed, transcriptUrl });
        }
        // Entrega confirmada (ou encerrada pela equipe): o cliente sai do canal
        // de entregas — a menos que tenha outra esperando confirmacao.
        if (closed.deliveredAt instanceof Date) {
            await (0, TicketLocatorService_1.revokeDeliveredLocatorAccess)(guild, closed.ownerId, closed.id);
        }
        logger.info('Ticket encerrado.', {
            guildId: guild.id,
            userId: actor.id,
            entityType: 'ticket',
            entityId: closed.id,
            ticketNumber: closed.ticketNumber,
            messageCount: messages.length,
            logSent,
            dmSent,
            reviewRequested,
            channelDeleted,
        });
        void (0, TicketQueueService_1.refreshQueueHead)(guild, closed.categoryId);
        return {
            ticket: closed,
            messageCount: messages.length,
            logSent,
            dmSent,
            reviewRequested,
            channelDeleted,
            transcriptUrl,
        };
    }, {
        ttlMs: CLOSE_LOCK_TTL_MS,
        userMessage: 'Este atendimento ja esta sendo finalizado.',
    });
}
//# sourceMappingURL=TicketCloseService.js.map