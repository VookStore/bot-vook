import { TicketPriority, TicketStatus, type Prisma, type Ticket } from '@prisma/client';

import { getPrisma, isUniqueConstraintError, type DatabaseClient } from '../../../core/database/prisma';
import { delay } from '../../../utils/time';

/**
 * Repositorio de tickets.
 *
 * Pontos criticos implementados aqui:
 *  - numeracao sequencial por guild via contador transacional (nunca count()+1);
 *  - transicoes de estado com update CONDICIONAL (protege contra concorrencia);
 *  - posicao na fila DERIVADA dos tickets reais (nao ha coluna queuePosition).
 */

export const TICKET_COUNTER_NAME = 'ticket';

/** Ordem de prioridade (menor -> maior), igual a declaracao do enum no Postgres. */
export const PRIORITY_ORDER: readonly TicketPriority[] = [
  TicketPriority.NORMAL,
  TicketPriority.HIGH,
  TicketPriority.URGENT,
  TicketPriority.VIP,
];

/** Prioridades estritamente maiores que a informada. */
export function higherPriorities(priority: TicketPriority): TicketPriority[] {
  const index = PRIORITY_ORDER.indexOf(priority);
  return index < 0 ? [] : [...PRIORITY_ORDER.slice(index + 1)];
}

/** Tickets que ocupam a fila: abertos e ainda sem responsavel. */
export const QUEUE_FILTER = {
  status: TicketStatus.OPEN,
  claimedById: null,
} as const;

/** Estados em que o ticket esta ativo (canal existe / deveria existir). */
export const ACTIVE_STATUSES: readonly TicketStatus[] = [
  TicketStatus.CREATING,
  TicketStatus.OPEN,
  TicketStatus.CLAIMED,
  TicketStatus.CLOSING,
];

/** Estados que contam para o limite de tickets abertos do usuario. */
export const OPEN_STATUSES: readonly TicketStatus[] = [
  TicketStatus.CREATING,
  TicketStatus.OPEN,
  TicketStatus.CLAIMED,
];

// ---------------------------------------------------------------------------
// Numeracao sequencial
// ---------------------------------------------------------------------------

/**
 * Reserva o proximo numero de ticket da guild de forma atomica.
 *
 * O incremento acontece no banco (`increment`), portanto duas criacoes
 * simultaneas recebem numeros diferentes. Em caso de corrida na criacao inicial
 * do contador (duas INSERTs concorrentes), o P2002 e absorvido e a operacao e
 * repetida — a segunda tentativa cai no caminho de UPDATE.
 */
export async function reserveTicketNumber(
  guildId: string,
  db: DatabaseClient = getPrisma(),
  attempt = 0,
): Promise<number> {
  try {
    const counter = await db.guildCounter.upsert({
      where: { guildId_name: { guildId, name: TICKET_COUNTER_NAME } },
      create: { guildId, name: TICKET_COUNTER_NAME, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  } catch (error) {
    if (isUniqueConstraintError(error) && attempt < 3) {
      await delay(25 * (attempt + 1));
      return reserveTicketNumber(guildId, db, attempt + 1);
    }
    throw error;
  }
}

/** Ultimo numero emitido (diagnostico). */
export async function currentTicketCounter(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  const counter = await db.guildCounter.findUnique({
    where: { guildId_name: { guildId, name: TICKET_COUNTER_NAME } },
  });
  return counter?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Criacao e leitura
// ---------------------------------------------------------------------------

export interface CreateTicketInput {
  guildId: string;
  ticketNumber: number;
  categoryId: string;
  ownerId: string;
  subject: string;
  priority?: TicketPriority;
}

export async function createTicket(
  input: CreateTicketInput,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket> {
  return db.ticket.create({
    data: {
      guildId: input.guildId,
      ticketNumber: input.ticketNumber,
      categoryId: input.categoryId,
      ownerId: input.ownerId,
      subject: input.subject,
      priority: input.priority ?? TicketPriority.NORMAL,
      status: TicketStatus.CREATING,
    },
  });
}

export async function findTicketById(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket | null> {
  return db.ticket.findUnique({ where: { id } });
}

export type TicketWithCategory = Prisma.TicketGetPayload<{ include: { category: true } }>;

export async function findTicketWithCategory(
  id: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketWithCategory | null> {
  return db.ticket.findUnique({ where: { id }, include: { category: true } });
}

export async function findTicketByChannelId(
  channelId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketWithCategory | null> {
  return db.ticket.findUnique({ where: { channelId }, include: { category: true } });
}

export async function findTicketByNumber(
  guildId: string,
  ticketNumber: number,
  db: DatabaseClient = getPrisma(),
): Promise<TicketWithCategory | null> {
  return db.ticket.findUnique({
    where: { guildId_ticketNumber: { guildId, ticketNumber } },
    include: { category: true },
  });
}

// ---------------------------------------------------------------------------
// Limites e cooldown
// ---------------------------------------------------------------------------

export async function countOpenTicketsByUser(
  guildId: string,
  ownerId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.ticket.count({
    where: { guildId, ownerId, status: { in: [...OPEN_STATUSES] } },
  });
}

export async function countOpenTicketsByGuild(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.ticket.count({ where: { guildId, status: { in: [...OPEN_STATUSES] } } });
}

/**
 * Tickets abertos do cliente em UMA categoria.
 *
 * Alimenta o painel "Localizar meu ticket" do canal de destino. Ordenado do
 * mais novo para o mais antigo: quem perdeu o topico acabou de abri-lo na
 * imensa maioria das vezes.
 */
/**
 * A pessoa ainda tem motivo para enxergar o canal desta categoria?
 *
 * Conta como motivo ser DONO de um ticket aberto ou participar de um. O canal
 * de destino e oculto por padrao e o acesso e concedido pessoa a pessoa, entao
 * esta e a pergunta que decide se o acesso pode ser retirado ao fechar um
 * atendimento — sem ela, fechar um ticket cegaria alguem que ainda tem outro.
 *
 * `exceptTicketId` existe porque a checagem roda DURANTE o fechamento: o ticket
 * que esta sendo encerrado nao pode contar a favor de si mesmo.
 */
export async function hasOpenTicketAccess(
  guildId: string,
  categoryId: string,
  userId: string,
  exceptTicketId: string | null = null,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const found = await db.ticket.findFirst({
    where: {
      guildId,
      categoryId,
      status: { in: [...OPEN_STATUSES] },
      ...(exceptTicketId === null ? {} : { id: { not: exceptTicketId } }),
      OR: [
        { ownerId: userId },
        { participants: { some: { userId, removedAt: null } } },
      ],
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Todo mundo que precisa enxergar o canal desta categoria agora.
 *
 * Donos de tickets abertos mais os participantes adicionais deles. Serve para
 * o backfill: quando o canal passa a ser oculto, quem ja estava em atendimento
 * nao pode perder a conversa de vista.
 */
export async function listUserIdsWithOpenTickets(
  guildId: string,
  categoryId: string,
  db: DatabaseClient = getPrisma(),
): Promise<string[]> {
  const tickets = await db.ticket.findMany({
    where: { guildId, categoryId, status: { in: [...OPEN_STATUSES] } },
    select: {
      ownerId: true,
      participants: { where: { removedAt: null }, select: { userId: true } },
    },
  });

  const ids = new Set<string>();
  for (const ticket of tickets) {
    ids.add(ticket.ownerId);
    for (const participant of ticket.participants) ids.add(participant.userId);
  }
  return [...ids];
}

export async function listOpenTicketsByOwnerAndCategory(
  guildId: string,
  ownerId: string,
  categoryId: string,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket[]> {
  return db.ticket.findMany({
    where: { guildId, ownerId, categoryId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { ticketNumber: 'desc' },
  });
}

/**
 * Tickets ENTREGUES e ainda abertos do cliente, de qualquer categoria.
 *
 * E a busca do painel de entregas: o produto saiu, o topico foi arquivado (some
 * da lista lateral) e o atendimento so fecha quando o cliente confirma. Sem
 * filtro de categoria porque o canal de entregas e um so para a loja inteira.
 *
 * `excludeId` serve ao fechamento: o ticket que acabou de fechar nao pode contar
 * como motivo para manter o cliente no canal de entregas.
 */
export async function listDeliveredOpenTickets(
  guildId: string,
  ownerId: string,
  excludeId?: string,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket[]> {
  return db.ticket.findMany({
    where: {
      guildId,
      ownerId,
      status: { in: [...OPEN_STATUSES] },
      deliveredAt: { not: null },
      ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
    },
    orderBy: { ticketNumber: 'desc' },
  });
}

/** Clientes com pelo menos uma entrega esperando confirmacao (backfill do canal). */
export async function listOwnersWithDeliveredOpenTickets(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<string[]> {
  const rows = await db.ticket.findMany({
    where: { guildId, status: { in: [...OPEN_STATUSES] }, deliveredAt: { not: null } },
    select: { ownerId: true },
    distinct: ['ownerId'],
  });
  return rows.map((row) => row.ownerId);
}

/** Data do ultimo ticket criado pelo usuario (base do cooldown persistente). */
export async function lastTicketCreatedAt(
  guildId: string,
  ownerId: string,
  db: DatabaseClient = getPrisma(),
): Promise<Date | null> {
  const last = await db.ticket.findFirst({
    where: { guildId, ownerId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return last?.createdAt ?? null;
}

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

/**
 * Posicao real do ticket na fila da sua categoria.
 *
 * A posicao NAO e armazenada: e derivada da contagem de tickets elegiveis que
 * estao a frente (prioridade maior, ou mesma prioridade com numero menor).
 * Sao duas contagens indexadas em vez de uma comparacao de enum, porque o
 * Prisma nao suporta `gt`/`lt` em campos enum.
 *
 * Retorna 0 quando o ticket nao esta na fila (ja assumido ou fechado).
 */
export async function getQueuePosition(
  ticket: Pick<Ticket, 'guildId' | 'categoryId' | 'ticketNumber' | 'priority' | 'status' | 'claimedById'>,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  if (ticket.status !== TicketStatus.OPEN || ticket.claimedById !== null) return 0;

  const base = {
    guildId: ticket.guildId,
    categoryId: ticket.categoryId,
    ...QUEUE_FILTER,
  };

  const higher = higherPriorities(ticket.priority);
  const aheadByPriority =
    higher.length > 0
      ? await db.ticket.count({ where: { ...base, priority: { in: higher } } })
      : 0;

  const aheadBySequence = await db.ticket.count({
    where: { ...base, priority: ticket.priority, ticketNumber: { lt: ticket.ticketNumber } },
  });

  return aheadByPriority + aheadBySequence + 1;
}

/** Quantidade de tickets aguardando atendimento na categoria. */
export async function countQueue(
  guildId: string,
  categoryId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.ticket.count({ where: { guildId, categoryId, ...QUEUE_FILTER } });
}

/** Fila da categoria em ordem de atendimento. */
export async function listQueue(
  guildId: string,
  categoryId: string,
  limit: number,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket[]> {
  return db.ticket.findMany({
    where: { guildId, categoryId, ...QUEUE_FILTER },
    orderBy: [{ priority: 'desc' }, { ticketNumber: 'asc' }],
    take: limit,
  });
}

/**
 * Tickets parados na fila ha tempo demais, num degrau especifico.
 *
 * Filtra por `priority` exata (nao "menor que") porque o escalonamento sobe UM
 * degrau por vez: cada rodada trata NORMAL->HIGH e HIGH->URGENT separadamente,
 * e misturar os dois faria um ticket recem-criado pular direto para URGENT.
 */
export async function listStaleQueuedTickets(
  priority: TicketPriority,
  createdBefore: Date,
  take: number,
  db: DatabaseClient = getPrisma(),
): Promise<Array<Pick<Ticket, 'id' | 'guildId' | 'categoryId' | 'ticketNumber'>>> {
  return db.ticket.findMany({
    where: { ...QUEUE_FILTER, priority, createdAt: { lte: createdBefore } },
    orderBy: { createdAt: 'asc' },
    take,
    select: { id: true, guildId: true, categoryId: true, ticketNumber: true },
  });
}

/**
 * Sobe a prioridade de um ticket que AINDA esta na fila.
 *
 * O `where` repete `QUEUE_FILTER`: entre a leitura e a escrita alguem pode ter
 * assumido o atendimento, e promover um ticket ja atendido nao teria efeito
 * util mas geraria uma linha de auditoria mentirosa. Devolve false nesse caso.
 */
export async function promoteTicketPriority(
  id: string,
  priority: TicketPriority,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const { count } = await db.ticket.updateMany({
    where: { id, ...QUEUE_FILTER },
    data: { priority },
  });
  return count > 0;
}

/** Total de tickets aguardando em toda a guild (status do sistema). */
export async function countQueueByGuild(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.ticket.count({ where: { guildId, ...QUEUE_FILTER } });
}

// ---------------------------------------------------------------------------
// Transicoes de estado (sempre condicionais)
// ---------------------------------------------------------------------------

/** Ativa o ticket apos o canal existir: CREATING -> OPEN. */
/**
 * Amarra o canal recem-criado ao ticket AINDA em CREATING.
 *
 * Existe para fechar a janela entre `guild.channels.create()` e a ativacao: se
 * o processo caisse ali, o ticket ficava CREATING com `channelId` nulo e o
 * recovery apagava a linha — deixando no Discord um canal privado, vazio e
 * invisivel para todo o sistema, para sempre. Gravando o id imediatamente, o
 * recovery encontra `CREATING + channelId` e promove o ticket para OPEN.
 */
export async function attachTicketChannel(
  ticketId: string,
  params: { channelId: string; channelName: string },
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.ticket.update({
    where: { id: ticketId },
    data: { channelId: params.channelId, channelName: params.channelName },
  });
}

export async function activateTicket(
  ticketId: string,
  params: { channelId: string; channelName: string },
  db: DatabaseClient = getPrisma(),
): Promise<Ticket> {
  return db.ticket.update({
    where: { id: ticketId },
    data: {
      channelId: params.channelId,
      channelName: params.channelName,
      status: TicketStatus.OPEN,
    },
  });
}

export async function setPanelMessageId(
  ticketId: string,
  messageId: string,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.ticket.update({ where: { id: ticketId }, data: { panelMessageId: messageId } });
}

/** Registra a entrega do produto neste ticket. */
export async function markTicketDelivered(
  ticketId: string,
  deliveredById: string,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket> {
  return db.ticket.update({
    where: { id: ticketId },
    data: { deliveredAt: new Date(), deliveredById },
  });
}

/**
 * Onde o cartao do ticket entregue foi publicado no canal de concluidos.
 *
 * `null` nos dois apaga a referencia — o que se faz quando a mensagem sumiu,
 * para o bot parar de tentar reescreve-la.
 */
export async function setTicketDoneCard(
  ticketId: string,
  channelId: string | null,
  messageId: string | null,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.ticket.update({
    where: { id: ticketId },
    data: { doneCardChannelId: channelId, doneCardMessageId: messageId },
  });
}

/**
 * Assume o ticket de forma atomica.
 *
 * O `where` exige `claimedById: null` e `status: OPEN`, entao apenas UMA das
 * requisicoes concorrentes altera a linha. `count` diz quem venceu.
 */
export async function claimTicketAtomic(
  ticketId: string,
  staffId: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.ticket.updateMany({
    where: { id: ticketId, status: TicketStatus.OPEN, claimedById: null },
    data: { status: TicketStatus.CLAIMED, claimedById: staffId, claimedAt: new Date() },
  });
  return result.count === 1;
}

/** Transfere o atendimento para outro membro da equipe. */
export async function transferTicketAtomic(
  ticketId: string,
  fromStaffId: string | null,
  toStaffId: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.ticket.updateMany({
    where: { id: ticketId, status: TicketStatus.CLAIMED, claimedById: fromStaffId },
    data: { claimedById: toStaffId, claimedAt: new Date() },
  });
  return result.count === 1;
}

/**
 * Inicia o fechamento: OPEN|CLAIMED -> CLOSING.
 * Impede que dois fechamentos concorrentes gerem transcript/log duplicados.
 */
/**
 * Marca CLOSING e devolve o status EXATO de onde saiu (ou `null` se perdeu a
 * corrida / o ticket nao esta mais fechavel).
 *
 * Devolver o status anterior e obrigatorio: quem le o ticket antes do lock pode
 * ver OPEN enquanto outro atendente ja o assumiu (CLAIMED). Revertendo para o
 * status lido fora do lock o ticket viraria OPEN com `claimedById` preenchido —
 * um estado impossivel, fora da fila e impossivel de assumir ou transferir.
 * Por isso o `updateMany` e preso ao status recem-lido: ou ele ainda vale (e o
 * revert e fiel), ou a tentativa e refeita.
 */
export async function beginClosingAtomic(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<TicketStatus | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { status: true },
    });
    if (current === null) return null;
    if (current.status !== TicketStatus.OPEN && current.status !== TicketStatus.CLAIMED) {
      return null;
    }

    const result = await db.ticket.updateMany({
      where: { id: ticketId, status: current.status },
      data: { status: TicketStatus.CLOSING },
    });
    if (result.count === 1) return current.status;
  }
  return null;
}

/** Reverte CLOSING -> estado anterior quando o fechamento falha no meio. */
export async function revertClosing(
  ticketId: string,
  previousStatus: TicketStatus,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.ticket.updateMany({
    where: { id: ticketId, status: TicketStatus.CLOSING },
    data: { status: previousStatus },
  });
}

/**
 * Memoriza a URL publica do transcript.
 *
 * Gravada DEPOIS do fechamento, e nao junto: o upload e best-effort e pode
 * falhar, e um ticket nao pode deixar de ser encerrado porque o Worker de
 * transcript esta fora do ar.
 */
export async function setTicketTranscriptUrl(
  ticketId: string,
  transcriptUrl: string,
  /**
   * Ids dos anexos re-hospedados junto do transcript.
   *
   * Gravados AQUI porque este e o unico momento em que eles sao conhecidos: as
   * chaves no R2 sao aleatorias e nao carregam o numero do ticket, entao sem
   * esta lista o job de retencao conseguiria apagar o HTML e nunca os arquivos.
   */
  transcriptAssetIds: readonly string[] = [],
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.ticket.update({
    where: { id: ticketId },
    data: { transcriptUrl, transcriptAssetIds: [...transcriptAssetIds] },
  });
}

export async function finalizeClose(
  ticketId: string,
  params: { closedById: string; closeReason: string | null },
  db: DatabaseClient = getPrisma(),
): Promise<Ticket> {
  return db.ticket.update({
    where: { id: ticketId },
    data: {
      status: TicketStatus.CLOSED,
      closedById: params.closedById,
      closedAt: new Date(),
      closeReason: params.closeReason,
    },
  });
}

/** Canal do ticket desapareceu: marca como orfao e o tira da fila. */
export async function markOrphaned(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<boolean> {
  const result = await db.ticket.updateMany({
    where: { id: ticketId, status: { in: [...ACTIVE_STATUSES] } },
    data: { status: TicketStatus.ORPHANED, closedAt: new Date() },
  });
  return result.count === 1;
}

export async function updateTicket(
  ticketId: string,
  data: Prisma.TicketUncheckedUpdateInput,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket> {
  return db.ticket.update({ where: { id: ticketId }, data });
}

export async function touchClientNotify(
  ticketId: string,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.ticket.update({ where: { id: ticketId }, data: { lastClientNotifyAt: new Date() } });
}

export async function touchRename(
  ticketId: string,
  channelName: string,
  db: DatabaseClient = getPrisma(),
): Promise<void> {
  await db.ticket.update({
    where: { id: ticketId },
    data: { channelName, lastRenamedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Consultas de manutencao / recovery
// ---------------------------------------------------------------------------

export async function listActiveTickets(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket[]> {
  return db.ticket.findMany({
    where: { guildId, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { ticketNumber: 'asc' },
  });
}

export async function listTicketsByStatus(
  guildId: string,
  status: TicketStatus,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket[]> {
  return db.ticket.findMany({ where: { guildId, status }, orderBy: { createdAt: 'asc' } });
}

/** Tickets travados em CREATING/CLOSING alem do limite de tempo. */
export async function listStuckTickets(
  olderThan: Date,
  db: DatabaseClient = getPrisma(),
): Promise<Ticket[]> {
  return db.ticket.findMany({
    where: {
      status: { in: [TicketStatus.CREATING, TicketStatus.CLOSING] },
      updatedAt: { lt: olderThan },
    },
    orderBy: { updatedAt: 'asc' },
  });
}

export async function countActiveTickets(
  guildId: string,
  db: DatabaseClient = getPrisma(),
): Promise<number> {
  return db.ticket.count({ where: { guildId, status: { in: [...ACTIVE_STATUSES] } } });
}
