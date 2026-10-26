import { OrderStatus, TicketAuditAction, TicketPriority } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Prioridade da fila de atendimento.
 *
 * O campo `Ticket.priority` existia desde o inicio e a fila sempre ordenou por
 * ele, mas NADA nunca o definia: todo ticket nascia NORMAL e a fila era, na
 * pratica, ordenada so por numero. Estes testes cobrem as duas fontes que
 * passaram a alimenta-lo, e principalmente as duas armadilhas do escalonamento:
 * o pulo de degrau e a corrida com quem assume o ticket.
 */

const countOrders = vi.fn();
const listStaleQueuedTickets = vi.fn();
const promoteTicketPriority = vi.fn();
const recordTicketAudit = vi.fn();
const refreshQueueHead = vi.fn();

vi.mock('../src/modules/catalog/repositories/OrderRepository', () => ({
  countOrders: (...args: unknown[]) => countOrders(...args),
}));

vi.mock('../src/modules/tickets/repositories/TicketRepository', () => ({
  listStaleQueuedTickets: (...args: unknown[]) => listStaleQueuedTickets(...args),
  promoteTicketPriority: (...args: unknown[]) => promoteTicketPriority(...args),
}));

vi.mock('../src/modules/audit/repositories/AuditRepository', () => ({
  recordTicketAudit: (...args: unknown[]) => recordTicketAudit(...args),
}));

vi.mock('../src/modules/tickets/services/TicketQueueService', () => ({
  refreshQueueHead: (...args: unknown[]) => refreshQueueHead(...args),
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  OPEN_ORDER_STATUSES,
  escalateStaleTickets,
  initialPriorityFor,
} from '../src/modules/tickets/services/TicketPriorityService';

function ticket(id: string) {
  return { id, guildId: 'g1', categoryId: 'c1', ticketNumber: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  listStaleQueuedTickets.mockResolvedValue([]);
  promoteTicketPriority.mockResolvedValue(true);
  recordTicketAudit.mockResolvedValue(null);
});

describe('initialPriorityFor', () => {
  it('abre como VIP quem tem pedido em aberto', async () => {
    countOrders.mockResolvedValue(1);

    await expect(initialPriorityFor('g1', 'u1')).resolves.toBe(TicketPriority.VIP);

    expect(countOrders).toHaveBeenCalledWith('g1', {
      customerId: 'u1',
      statuses: OPEN_ORDER_STATUSES,
    });
  });

  it('abre como NORMAL quem nao tem pedido em aberto', async () => {
    countOrders.mockResolvedValue(0);
    await expect(initialPriorityFor('g1', 'u1')).resolves.toBe(TicketPriority.NORMAL);
  });

  /*
   * Prioridade e otimizacao de fila. Nenhuma otimizacao vale impedir alguem de
   * pedir ajuda, entao falha de banco cai em NORMAL em vez de propagar.
   */
  it('cai em NORMAL quando a consulta falha', async () => {
    countOrders.mockRejectedValue(new Error('banco fora'));
    await expect(initialPriorityFor('g1', 'u1')).resolves.toBe(TicketPriority.NORMAL);
  });

  it('nao considera pedido concluido nem cancelado', () => {
    expect(OPEN_ORDER_STATUSES).not.toContain(OrderStatus.COMPLETED);
    expect(OPEN_ORDER_STATUSES).not.toContain(OrderStatus.CANCELLED);
  });
});

describe('escalateStaleTickets', () => {
  it('nao faz nada quando ninguem esta parado', async () => {
    await expect(escalateStaleTickets()).resolves.toBe(0);
    expect(promoteTicketPriority).not.toHaveBeenCalled();
  });

  it('sobe NORMAL para HIGH', async () => {
    listStaleQueuedTickets.mockImplementation((priority: TicketPriority) =>
      Promise.resolve(priority === TicketPriority.NORMAL ? [ticket('t1')] : []),
    );

    await expect(escalateStaleTickets()).resolves.toBe(1);
    expect(promoteTicketPriority).toHaveBeenCalledWith('t1', TicketPriority.HIGH);
  });

  /*
   * A ARMADILHA DO PULO DE DEGRAU.
   *
   * Se os degraus fossem varridos de baixo para cima, um ticket promovido a
   * HIGH nesta mesma rodada apareceria na consulta seguinte e subiria a URGENT
   * no mesmo instante — NORMAL -> URGENT direto, ignorando os 45 minutos. A
   * ordem HIGH-primeiro e o que impede isso, e este teste e o que a fixa.
   */
  it('consulta o degrau mais alto antes do mais baixo', async () => {
    listStaleQueuedTickets.mockResolvedValue([]);

    await escalateStaleTickets();

    const ordem = listStaleQueuedTickets.mock.calls.map((call) => call[0]);
    expect(ordem).toEqual([TicketPriority.HIGH, TicketPriority.NORMAL]);
  });

  it('exige espera maior para URGENT do que para HIGH', async () => {
    listStaleQueuedTickets.mockResolvedValue([]);

    await escalateStaleTickets();

    const [[, corteUrgent], [, corteHigh]] = listStaleQueuedTickets.mock.calls as [
      [TicketPriority, Date],
      [TicketPriority, Date],
    ];
    // Corte mais antigo = espera maior exigida.
    expect(corteUrgent.getTime()).toBeLessThan(corteHigh.getTime());
  });

  /*
   * A ARMADILHA DA CORRIDA. Entre listar e promover, um atendente pode ter
   * assumido o ticket. O repositorio recusa a escrita nesse caso, e aqui
   * garantimos que a auditoria nao registra uma promocao que nao aconteceu.
   */
  it('nao audita o ticket que foi assumido no meio do caminho', async () => {
    listStaleQueuedTickets.mockImplementation((priority: TicketPriority) =>
      Promise.resolve(priority === TicketPriority.NORMAL ? [ticket('t1')] : []),
    );
    promoteTicketPriority.mockResolvedValue(false);

    await expect(escalateStaleTickets()).resolves.toBe(0);
    expect(recordTicketAudit).not.toHaveBeenCalled();
  });

  it('registra a promocao na auditoria sem inventar um autor', async () => {
    listStaleQueuedTickets.mockImplementation((priority: TicketPriority) =>
      Promise.resolve(priority === TicketPriority.HIGH ? [ticket('t9')] : []),
    );

    await escalateStaleTickets();

    expect(recordTicketAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't9',
        action: TicketAuditAction.PRIORITY_CHANGED,
        actorId: null,
        oldValue: TicketPriority.HIGH,
        newValue: TicketPriority.URGENT,
      }),
    );
  });

  it('nao toca no Discord quando nao ha client', async () => {
    listStaleQueuedTickets.mockImplementation((priority: TicketPriority) =>
      Promise.resolve(priority === TicketPriority.NORMAL ? [ticket('t1')] : []),
    );

    await escalateStaleTickets(null);
    expect(refreshQueueHead).not.toHaveBeenCalled();
  });

  it('atualiza a cabeca da fila uma vez por categoria afetada', async () => {
    const guild = { id: 'g1' };
    const client = { guilds: { cache: new Map([['g1', guild]]) } };

    listStaleQueuedTickets.mockImplementation((priority: TicketPriority) =>
      Promise.resolve(
        priority === TicketPriority.NORMAL ? [ticket('t1'), ticket('t2'), ticket('t3')] : [],
      ),
    );
    refreshQueueHead.mockResolvedValue(0);

    await expect(escalateStaleTickets(client as never)).resolves.toBe(3);

    // Tres tickets, uma categoria: um unico redesenho, nao tres.
    expect(refreshQueueHead).toHaveBeenCalledTimes(1);
    expect(refreshQueueHead).toHaveBeenCalledWith(guild, 'c1');
  });
});
