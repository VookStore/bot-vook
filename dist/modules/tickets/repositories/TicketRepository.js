"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPEN_STATUSES = exports.ACTIVE_STATUSES = exports.QUEUE_FILTER = exports.PRIORITY_ORDER = exports.TICKET_COUNTER_NAME = void 0;
exports.higherPriorities = higherPriorities;
exports.reserveTicketNumber = reserveTicketNumber;
exports.currentTicketCounter = currentTicketCounter;
exports.createTicket = createTicket;
exports.findTicketById = findTicketById;
exports.findTicketWithCategory = findTicketWithCategory;
exports.findTicketByChannelId = findTicketByChannelId;
exports.findTicketByNumber = findTicketByNumber;
exports.countOpenTicketsByUser = countOpenTicketsByUser;
exports.countOpenTicketsByGuild = countOpenTicketsByGuild;
exports.hasOpenTicketAccess = hasOpenTicketAccess;
exports.listUserIdsWithOpenTickets = listUserIdsWithOpenTickets;
exports.listOpenTicketsByOwnerAndCategory = listOpenTicketsByOwnerAndCategory;
exports.listDeliveredOpenTickets = listDeliveredOpenTickets;
exports.listOwnersWithDeliveredOpenTickets = listOwnersWithDeliveredOpenTickets;
exports.lastTicketCreatedAt = lastTicketCreatedAt;
exports.getQueuePosition = getQueuePosition;
exports.countQueue = countQueue;
exports.listQueue = listQueue;
exports.listStaleQueuedTickets = listStaleQueuedTickets;
exports.promoteTicketPriority = promoteTicketPriority;
exports.countQueueByGuild = countQueueByGuild;
exports.attachTicketChannel = attachTicketChannel;
exports.activateTicket = activateTicket;
exports.setPanelMessageId = setPanelMessageId;
exports.markTicketDelivered = markTicketDelivered;
exports.setTicketDoneCard = setTicketDoneCard;
exports.claimTicketAtomic = claimTicketAtomic;
exports.transferTicketAtomic = transferTicketAtomic;
exports.beginClosingAtomic = beginClosingAtomic;
exports.revertClosing = revertClosing;
exports.setTicketTranscriptUrl = setTicketTranscriptUrl;
exports.finalizeClose = finalizeClose;
exports.markOrphaned = markOrphaned;
exports.updateTicket = updateTicket;
exports.touchClientNotify = touchClientNotify;
exports.touchRename = touchRename;
exports.listActiveTickets = listActiveTickets;
exports.listTicketsByStatus = listTicketsByStatus;
exports.listStuckTickets = listStuckTickets;
exports.countActiveTickets = countActiveTickets;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../../core/database/prisma");
const time_1 = require("../../../utils/time");
/**
 * Repositorio de tickets.
 *
 * Pontos criticos implementados aqui:
 *  - numeracao sequencial por guild via contador transacional (nunca count()+1);
 *  - transicoes de estado com update CONDICIONAL (protege contra concorrencia);
 *  - posicao na fila DERIVADA dos tickets reais (nao ha coluna queuePosition).
 */
exports.TICKET_COUNTER_NAME = 'ticket';
/** Ordem de prioridade (menor -> maior), igual a declaracao do enum no Postgres. */
exports.PRIORITY_ORDER = [
    client_1.TicketPriority.NORMAL,
    client_1.TicketPriority.HIGH,
    client_1.TicketPriority.URGENT,
    client_1.TicketPriority.VIP,
];
/** Prioridades estritamente maiores que a informada. */
function higherPriorities(priority) {
    const index = exports.PRIORITY_ORDER.indexOf(priority);
    return index < 0 ? [] : [...exports.PRIORITY_ORDER.slice(index + 1)];
}
/** Tickets que ocupam a fila: abertos e ainda sem responsavel. */
exports.QUEUE_FILTER = {
    status: client_1.TicketStatus.OPEN,
    claimedById: null,
};
/** Estados em que o ticket esta ativo (canal existe / deveria existir). */
exports.ACTIVE_STATUSES = [
    client_1.TicketStatus.CREATING,
    client_1.TicketStatus.OPEN,
    client_1.TicketStatus.CLAIMED,
    client_1.TicketStatus.CLOSING,
];
/** Estados que contam para o limite de tickets abertos do usuario. */
exports.OPEN_STATUSES = [
    client_1.TicketStatus.CREATING,
    client_1.TicketStatus.OPEN,
    client_1.TicketStatus.CLAIMED,
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
async function reserveTicketNumber(guildId, db = (0, prisma_1.getPrisma)(), attempt = 0) {
    try {
        const counter = await db.guildCounter.upsert({
            where: { guildId_name: { guildId, name: exports.TICKET_COUNTER_NAME } },
            create: { guildId, name: exports.TICKET_COUNTER_NAME, value: 1 },
            update: { value: { increment: 1 } },
        });
        return counter.value;
    }
    catch (error) {
        if ((0, prisma_1.isUniqueConstraintError)(error) && attempt < 3) {
            await (0, time_1.delay)(25 * (attempt + 1));
            return reserveTicketNumber(guildId, db, attempt + 1);
        }
        throw error;
    }
}
/** Ultimo numero emitido (diagnostico). */
async function currentTicketCounter(guildId, db = (0, prisma_1.getPrisma)()) {
    const counter = await db.guildCounter.findUnique({
        where: { guildId_name: { guildId, name: exports.TICKET_COUNTER_NAME } },
    });
    return counter?.value ?? 0;
}
async function createTicket(input, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.create({
        data: {
            guildId: input.guildId,
            ticketNumber: input.ticketNumber,
            categoryId: input.categoryId,
            ownerId: input.ownerId,
            subject: input.subject,
            priority: input.priority ?? client_1.TicketPriority.NORMAL,
            status: client_1.TicketStatus.CREATING,
        },
    });
}
async function findTicketById(id, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findUnique({ where: { id } });
}
async function findTicketWithCategory(id, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findUnique({ where: { id }, include: { category: true } });
}
async function findTicketByChannelId(channelId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findUnique({ where: { channelId }, include: { category: true } });
}
async function findTicketByNumber(guildId, ticketNumber, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findUnique({
        where: { guildId_ticketNumber: { guildId, ticketNumber } },
        include: { category: true },
    });
}
// ---------------------------------------------------------------------------
// Limites e cooldown
// ---------------------------------------------------------------------------
async function countOpenTicketsByUser(guildId, ownerId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.count({
        where: { guildId, ownerId, status: { in: [...exports.OPEN_STATUSES] } },
    });
}
async function countOpenTicketsByGuild(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.count({ where: { guildId, status: { in: [...exports.OPEN_STATUSES] } } });
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
async function hasOpenTicketAccess(guildId, categoryId, userId, exceptTicketId = null, db = (0, prisma_1.getPrisma)()) {
    const found = await db.ticket.findFirst({
        where: {
            guildId,
            categoryId,
            status: { in: [...exports.OPEN_STATUSES] },
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
async function listUserIdsWithOpenTickets(guildId, categoryId, db = (0, prisma_1.getPrisma)()) {
    const tickets = await db.ticket.findMany({
        where: { guildId, categoryId, status: { in: [...exports.OPEN_STATUSES] } },
        select: {
            ownerId: true,
            participants: { where: { removedAt: null }, select: { userId: true } },
        },
    });
    const ids = new Set();
    for (const ticket of tickets) {
        ids.add(ticket.ownerId);
        for (const participant of ticket.participants)
            ids.add(participant.userId);
    }
    return [...ids];
}
async function listOpenTicketsByOwnerAndCategory(guildId, ownerId, categoryId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findMany({
        where: { guildId, ownerId, categoryId, status: { in: [...exports.OPEN_STATUSES] } },
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
async function listDeliveredOpenTickets(guildId, ownerId, excludeId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findMany({
        where: {
            guildId,
            ownerId,
            status: { in: [...exports.OPEN_STATUSES] },
            deliveredAt: { not: null },
            ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
        },
        orderBy: { ticketNumber: 'desc' },
    });
}
/** Clientes com pelo menos uma entrega esperando confirmacao (backfill do canal). */
async function listOwnersWithDeliveredOpenTickets(guildId, db = (0, prisma_1.getPrisma)()) {
    const rows = await db.ticket.findMany({
        where: { guildId, status: { in: [...exports.OPEN_STATUSES] }, deliveredAt: { not: null } },
        select: { ownerId: true },
        distinct: ['ownerId'],
    });
    return rows.map((row) => row.ownerId);
}
/** Data do ultimo ticket criado pelo usuario (base do cooldown persistente). */
async function lastTicketCreatedAt(guildId, ownerId, db = (0, prisma_1.getPrisma)()) {
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
async function getQueuePosition(ticket, db = (0, prisma_1.getPrisma)()) {
    if (ticket.status !== client_1.TicketStatus.OPEN || ticket.claimedById !== null)
        return 0;
    const base = {
        guildId: ticket.guildId,
        categoryId: ticket.categoryId,
        ...exports.QUEUE_FILTER,
    };
    const higher = higherPriorities(ticket.priority);
    const aheadByPriority = higher.length > 0
        ? await db.ticket.count({ where: { ...base, priority: { in: higher } } })
        : 0;
    const aheadBySequence = await db.ticket.count({
        where: { ...base, priority: ticket.priority, ticketNumber: { lt: ticket.ticketNumber } },
    });
    return aheadByPriority + aheadBySequence + 1;
}
/** Quantidade de tickets aguardando atendimento na categoria. */
async function countQueue(guildId, categoryId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.count({ where: { guildId, categoryId, ...exports.QUEUE_FILTER } });
}
/** Fila da categoria em ordem de atendimento. */
async function listQueue(guildId, categoryId, limit, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findMany({
        where: { guildId, categoryId, ...exports.QUEUE_FILTER },
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
async function listStaleQueuedTickets(priority, createdBefore, take, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findMany({
        where: { ...exports.QUEUE_FILTER, priority, createdAt: { lte: createdBefore } },
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
async function promoteTicketPriority(id, priority, db = (0, prisma_1.getPrisma)()) {
    const { count } = await db.ticket.updateMany({
        where: { id, ...exports.QUEUE_FILTER },
        data: { priority },
    });
    return count > 0;
}
/** Total de tickets aguardando em toda a guild (status do sistema). */
async function countQueueByGuild(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.count({ where: { guildId, ...exports.QUEUE_FILTER } });
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
async function attachTicketChannel(ticketId, params, db = (0, prisma_1.getPrisma)()) {
    await db.ticket.update({
        where: { id: ticketId },
        data: { channelId: params.channelId, channelName: params.channelName },
    });
}
async function activateTicket(ticketId, params, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.update({
        where: { id: ticketId },
        data: {
            channelId: params.channelId,
            channelName: params.channelName,
            status: client_1.TicketStatus.OPEN,
        },
    });
}
async function setPanelMessageId(ticketId, messageId, db = (0, prisma_1.getPrisma)()) {
    await db.ticket.update({ where: { id: ticketId }, data: { panelMessageId: messageId } });
}
/** Registra a entrega do produto neste ticket. */
async function markTicketDelivered(ticketId, deliveredById, db = (0, prisma_1.getPrisma)()) {
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
async function setTicketDoneCard(ticketId, channelId, messageId, db = (0, prisma_1.getPrisma)()) {
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
async function claimTicketAtomic(ticketId, staffId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.ticket.updateMany({
        where: { id: ticketId, status: client_1.TicketStatus.OPEN, claimedById: null },
        data: { status: client_1.TicketStatus.CLAIMED, claimedById: staffId, claimedAt: new Date() },
    });
    return result.count === 1;
}
/** Transfere o atendimento para outro membro da equipe. */
async function transferTicketAtomic(ticketId, fromStaffId, toStaffId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.ticket.updateMany({
        where: { id: ticketId, status: client_1.TicketStatus.CLAIMED, claimedById: fromStaffId },
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
async function beginClosingAtomic(ticketId, db = (0, prisma_1.getPrisma)()) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await db.ticket.findUnique({
            where: { id: ticketId },
            select: { status: true },
        });
        if (current === null)
            return null;
        if (current.status !== client_1.TicketStatus.OPEN && current.status !== client_1.TicketStatus.CLAIMED) {
            return null;
        }
        const result = await db.ticket.updateMany({
            where: { id: ticketId, status: current.status },
            data: { status: client_1.TicketStatus.CLOSING },
        });
        if (result.count === 1)
            return current.status;
    }
    return null;
}
/** Reverte CLOSING -> estado anterior quando o fechamento falha no meio. */
async function revertClosing(ticketId, previousStatus, db = (0, prisma_1.getPrisma)()) {
    await db.ticket.updateMany({
        where: { id: ticketId, status: client_1.TicketStatus.CLOSING },
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
async function setTicketTranscriptUrl(ticketId, transcriptUrl, 
/**
 * Ids dos anexos re-hospedados junto do transcript.
 *
 * Gravados AQUI porque este e o unico momento em que eles sao conhecidos: as
 * chaves no R2 sao aleatorias e nao carregam o numero do ticket, entao sem
 * esta lista o job de retencao conseguiria apagar o HTML e nunca os arquivos.
 */
transcriptAssetIds = [], db = (0, prisma_1.getPrisma)()) {
    await db.ticket.update({
        where: { id: ticketId },
        data: { transcriptUrl, transcriptAssetIds: [...transcriptAssetIds] },
    });
}
async function finalizeClose(ticketId, params, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.update({
        where: { id: ticketId },
        data: {
            status: client_1.TicketStatus.CLOSED,
            closedById: params.closedById,
            closedAt: new Date(),
            closeReason: params.closeReason,
        },
    });
}
/** Canal do ticket desapareceu: marca como orfao e o tira da fila. */
async function markOrphaned(ticketId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.ticket.updateMany({
        where: { id: ticketId, status: { in: [...exports.ACTIVE_STATUSES] } },
        data: { status: client_1.TicketStatus.ORPHANED, closedAt: new Date() },
    });
    return result.count === 1;
}
async function updateTicket(ticketId, data, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.update({ where: { id: ticketId }, data });
}
async function touchClientNotify(ticketId, db = (0, prisma_1.getPrisma)()) {
    await db.ticket.update({ where: { id: ticketId }, data: { lastClientNotifyAt: new Date() } });
}
async function touchRename(ticketId, channelName, db = (0, prisma_1.getPrisma)()) {
    await db.ticket.update({
        where: { id: ticketId },
        data: { channelName, lastRenamedAt: new Date() },
    });
}
// ---------------------------------------------------------------------------
// Consultas de manutencao / recovery
// ---------------------------------------------------------------------------
async function listActiveTickets(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findMany({
        where: { guildId, status: { in: [...exports.ACTIVE_STATUSES] } },
        orderBy: { ticketNumber: 'asc' },
    });
}
async function listTicketsByStatus(guildId, status, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findMany({ where: { guildId, status }, orderBy: { createdAt: 'asc' } });
}
/** Tickets travados em CREATING/CLOSING alem do limite de tempo. */
async function listStuckTickets(olderThan, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.findMany({
        where: {
            status: { in: [client_1.TicketStatus.CREATING, client_1.TicketStatus.CLOSING] },
            updatedAt: { lt: olderThan },
        },
        orderBy: { updatedAt: 'asc' },
    });
}
async function countActiveTickets(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.ticket.count({ where: { guildId, status: { in: [...exports.ACTIVE_STATUSES] } } });
}
//# sourceMappingURL=TicketRepository.js.map