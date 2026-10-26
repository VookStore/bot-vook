import { TicketAuditAction, TicketStatus } from '@prisma/client';
import type { Guild, GuildMember } from 'discord.js';
import type { Ticket } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import { TicketStateError, ValidationError } from '../../../core/errors';
import { createLogger } from '../../../core/logger/Logger';
import { assertCanCloseTicket } from '../../../core/permissions/PermissionService';
import {
  displayNameOf,
  fetchChannelSafe,
  fetchMemberSafe,
  isSendableTextChannel,
} from '../../../utils/discord';
import { sanitizeReason } from '../../../utils/sanitize';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { recordTicketAudit } from '../../audit/repositories/AuditRepository';
import { canRequestReview } from '../../reviews/services/ReviewService';
import { buildCloseLog } from '../builders/TicketLogBuilder';
import { listActiveParticipants } from '../repositories/TicketParticipantRepository';
import {
  beginClosingAtomic,
  finalizeClose,
  findTicketById,
  revertClosing,
  setTicketTranscriptUrl,
} from '../repositories/TicketRepository';
import type { TranscriptHeader, TranscriptMessage } from '../types/transcript';
import {
  buildTranscriptAttachment,
  fetchChannelMessages,
  renderTranscriptHtml,
} from './TranscriptService';
import {
  assetIdFromUrl,
  mirrorTranscriptAttachments,
  publishTranscript,
} from './TranscriptHostingService';
import {
  deleteTicketChannel,
  resolveTicketChannel,
  type TicketConversation,
} from './TicketChannelService';
import { getCategoryById } from './TicketConfigService';
import { revokeCategoryAccessIfLast } from './TicketAccessService';
import { refreshTicketDoneCard } from './TicketDoneService';
import { revokeDeliveredLocatorAccess } from './TicketLocatorService';
import { sendClosureDm } from './TicketNotificationService';
import { refreshQueueHead } from './TicketQueueService';

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

const logger = createLogger('ticket:close');

/**
 * O fechamento roda inteiro sob lock e faz muita chamada REST (ate 51 paginas
 * de historico + anexo + log + DM + avaliacao + exclusao do canal). Com o TTL
 * padrao de 30s um ticket longo perde o lock no meio e deixa de estar protegido
 * contra duplo clique. 5 minutos cobrem o pior caso com folga.
 */
const CLOSE_LOCK_TTL_MS = 5 * 60_000;

export interface CloseTicketResult {
  ticket: Ticket;
  messageCount: number;
  logSent: boolean;
  dmSent: boolean;
  reviewRequested: boolean;
  channelDeleted: boolean;
  /** Nulo quando a hospedagem esta desligada ou o upload falhou. */
  transcriptUrl: string | null;
}

async function buildHeader(params: {
  guild: Guild;
  ticket: Ticket;
  categoryName: string;
  storeName: string;
  closedBy: GuildMember;
  closedAt: Date;
  participantIds: readonly string[];
}): Promise<TranscriptHeader> {
  const { guild, ticket } = params;

  const ownerMember = await fetchMemberSafe(guild, ticket.ownerId);
  const staffMember =
    ticket.claimedById !== null ? await fetchMemberSafe(guild, ticket.claimedById) : null;

  const participants: Array<{ id: string; name: string }> = [];
  for (const participantId of params.participantIds) {
    const member = await fetchMemberSafe(guild, participantId);
    participants.push({ id: participantId, name: displayNameOf(member, participantId) });
  }

  return {
    storeName: params.storeName,
    ticketNumber: ticket.ticketNumber,
    categoryName: params.categoryName,
    subject: ticket.subject,
    ownerId: ticket.ownerId,
    ownerName: displayNameOf(ownerMember, ticket.ownerId),
    staffId: ticket.claimedById,
    staffName: staffMember !== null ? displayNameOf(staffMember, ticket.claimedById ?? '') : null,
    closedById: params.closedBy.id,
    closedByName: displayNameOf(params.closedBy, params.closedBy.id),
    participants,
    openedAt: ticket.createdAt,
    closedAt: params.closedAt,
    closeReason: ticket.closeReason,
    durationMs: Math.max(0, params.closedAt.getTime() - ticket.createdAt.getTime()),
  };
}

export async function closeTicket(
  guild: Guild,
  actor: GuildMember,
  ticketId: string,
  rawReason: string,
): Promise<CloseTicketResult> {
  const ticket = await findTicketById(ticketId);
  if (ticket === null || ticket.guildId !== guild.id) {
    throw new ValidationError(`Ticket inexistente: ${ticketId}`, {
      userMessage: 'Este atendimento nao foi encontrado.',
    });
  }
  if (ticket.status === TicketStatus.CLOSED || ticket.status === TicketStatus.ORPHANED) {
    throw new TicketStateError('Ticket ja encerrado.', {
      userMessage: 'Este atendimento ja foi encerrado.',
    });
  }
  if (ticket.status === TicketStatus.CLOSING) {
    throw new TicketStateError('Ticket ja esta sendo encerrado.', {
      userMessage: 'Este atendimento ja esta sendo finalizado.',
    });
  }

  await assertCanCloseTicket(actor, ticket);

  const reason = rawReason.trim().length > 0 ? sanitizeReason(rawReason) : null;

  return locks.withLock(
    LOCK_NAMESPACE.TICKET_CLOSE,
    ticket.id,
    async () => {
      // O status anterior vem do proprio update atomico, NUNCA da leitura
      // pre-lock: entre uma coisa e outra o ticket pode ter sido assumido.
      const previousStatus = await beginClosingAtomic(ticket.id);
      if (previousStatus === null) {
        throw new TicketStateError('Fechamento concorrente detectado.', {
          userMessage: 'Este atendimento ja esta sendo finalizado por outra pessoa.',
        });
      }

      let closed: Ticket;
      let categoryName: string;
      let participantIds: string[];
      let config: Awaited<ReturnType<typeof getGuildConfig>>;
      let channel: TicketConversation | null = null;
      let messages: TranscriptMessage[] = [];

      // A partir daqui o ticket esta CLOSING. QUALQUER falha antes do
      // `finalizeClose` precisa devolver o status anterior — senao o ticket
      // fica congelado: fora da fila, impossivel de assumir e impossivel de
      // fechar de novo, ate o RecoveryJob passar (ate ~20 min depois).
      try {
        config = await getGuildConfig(guild.id);
        const category = await getCategoryById(guild.id, ticket.categoryId);
        categoryName = category?.name ?? 'Categoria removida';
        const participants = await listActiveParticipants(ticket.id);
        participantIds = participants.map((participant) => participant.userId);

        try {
          channel = await resolveTicketChannel(guild, ticket.channelId);
          if (channel !== null) {
            messages = await fetchChannelMessages(channel);
          }
        } catch (error) {
          // Sem transcript o atendimento ainda precisa ser encerrado.
          logger.warn('Falha ao coletar historico do ticket.', {
            guildId: guild.id,
            entityType: 'ticket',
            entityId: ticket.id,
            detail: error instanceof Error ? error.message : String(error),
          });
        }

        closed = await finalizeClose(ticket.id, {
          closedById: actor.id,
          closeReason: reason,
        });
      } catch (error) {
        await revertClosing(ticket.id, previousStatus).catch(() => undefined);
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
      let header: TranscriptHeader | null = null;
      let transcriptUrl: string | null = null;
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
        messages = await mirrorTranscriptAttachments(messages);

        transcriptUrl = await publishTranscript(
          renderTranscriptHtml(header, messages, 0),
          closed.ticketNumber,
        );
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
            .flatMap((attachment) =>
              typeof attachment.hostedUrl === 'string' ? [attachment.hostedUrl] : [],
            )
            .flatMap((url) => {
              const id = assetIdFromUrl(url);
              return id === null ? [] : [id];
            });

          await setTicketTranscriptUrl(closed.id, transcriptUrl, assetIds);
        }
      } catch (error) {
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
        const logChannel = await fetchChannelSafe(guild, config.ticketLogChannelId);
        if (isSendableTextChannel(logChannel) && header !== null) {
          const attachment = buildTranscriptAttachment(header, messages);
          await sendV2(
            logChannel,
            buildCloseLog({
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
            }),
            { files: [attachment] },
          );
          logSent = true;
        } else if (config.ticketLogChannelId !== null) {
          logger.warn('Canal de logs configurado esta inacessivel.', {
            guildId: guild.id,
            channelId: config.ticketLogChannelId,
          });
        }
      } catch (error) {
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
        reviewRequested = await canRequestReview({
          guildId: guild.id,
          ticketId: closed.id,
          customerId: closed.ownerId,
        });

        dmSent = await sendClosureDm({
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
      } catch (error) {
        logger.warn('Falha ao enviar DM de encerramento.', {
          guildId: guild.id,
          entityType: 'ticket',
          entityId: closed.id,
          detail: error instanceof Error ? error.message : String(error),
        });
      }

      await recordTicketAudit({
        guildId: guild.id,
        ticketId: closed.id,
        action: TicketAuditAction.CLOSED,
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
          const outcome = await deleteTicketChannel(
            channel,
            `Ticket #${closed.ticketNumber} encerrado por ${actor.user.tag}`,
          );
          channelDeleted = outcome.outcome !== 'gone';
        } catch (error) {
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
        await revokeCategoryAccessIfLast(
          guild,
          closed.categoryId,
          userId,
          closed.id,
          `Ticket #${closed.ticketNumber} encerrado`,
        );
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
        await refreshTicketDoneCard(guild, { ...closed, transcriptUrl });
      }

      // Entrega confirmada (ou encerrada pela equipe): o cliente sai do canal
      // de entregas — a menos que tenha outra esperando confirmacao.
      if (closed.deliveredAt instanceof Date) {
        await revokeDeliveredLocatorAccess(guild, closed.ownerId, closed.id);
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

      void refreshQueueHead(guild, closed.categoryId);

      return {
        ticket: closed,
        messageCount: messages.length,
        logSent,
        dmSent,
        reviewRequested,
        channelDeleted,
        transcriptUrl,
      };
    },
    {
      ttlMs: CLOSE_LOCK_TTL_MS,
      userMessage: 'Este atendimento ja esta sendo finalizado.',
    },
  );
}
