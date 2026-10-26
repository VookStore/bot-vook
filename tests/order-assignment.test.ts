import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@prisma/client';
import type { GuildMember } from 'discord.js';

import { ValidationError } from '../src/core/errors';
import {
  assignOrderTo,
  claimNextOrder,
  claimOrder,
  releaseOrder,
  startOrderProgress,
} from '../src/modules/catalog/services/OrderService';

/**
 * Responsavel pela demanda.
 *
 * O que estes testes protegem:
 *  - nunca dois donos: toda troca e condicional ao responsavel que a tela viu;
 *  - ninguem toma demanda alheia por "Assumir" — tomar e transferir, explicito;
 *  - "Pegar proxima" segue a fila e pula o que outra pessoa pegou no instante;
 *  - toda troca vai para a auditoria com QUEM fez, e nada e auditado quando
 *    nada muda.
 */

const GUILD_ID = '111111111111111111';
const ANA = '333333333333333333';
const BRUNO = '444444444444444444';
const CAIO = '555555555555555555';
const ORDER_ID = 'ckorder00000000000000001';

const STAFF = { id: ANA } as unknown as GuildMember;

const repo = vi.hoisted(() => ({
  findOrderById: vi.fn(),
  setOrderAssignee: vi.fn(),
  markOrderInProgress: vi.fn(),
  listProductionQueue: vi.fn(),
}));
const audit = vi.hoisted(() => ({ recordOrderAudit: vi.fn() }));

vi.mock('../src/modules/catalog/repositories/OrderRepository', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findOrderById: (...args: unknown[]): unknown => repo.findOrderById(...args),
  setOrderAssignee: (...args: unknown[]): unknown => repo.setOrderAssignee(...args),
  markOrderInProgress: (...args: unknown[]): unknown => repo.markOrderInProgress(...args),
  listProductionQueue: (...args: unknown[]): unknown => repo.listProductionQueue(...args),
}));

vi.mock('../src/modules/catalog/repositories/CatalogAuditRepository', () => ({
  recordOrderAudit: (...args: unknown[]): unknown => audit.recordOrderAudit(...args),
}));

function pedido(
  status: OrderStatus,
  responsavel: string | null,
  id: string = ORDER_ID,
): unknown {
  return {
    id,
    guildId: GUILD_ID,
    orderNumber: 184,
    status,
    assignedToId: responsavel,
    assignedAt: responsavel === null ? null : new Date(),
    items: [],
    payment: null,
  };
}

/** Acoes auditadas, na ordem. */
function auditadas(): string[] {
  return audit.recordOrderAudit.mock.calls.map((call) => (call[0] as { action: string }).action);
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.markOrderInProgress.mockResolvedValue(false);
});

describe('assumir uma demanda', () => {
  it('demanda livre passa a ser de quem assumiu e entra em preparacao', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.PAID, null));
    repo.setOrderAssignee.mockResolvedValue(true);
    repo.markOrderInProgress.mockResolvedValue(true);

    const result = await claimOrder(GUILD_ID, STAFF, ORDER_ID);

    expect(repo.setOrderAssignee).toHaveBeenCalledWith(ORDER_ID, null, ANA);
    expect(result.started).toBe(true);
    expect(audit.recordOrderAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_ASSIGNED',
        performedById: ANA,
        oldValue: null,
        newValue: ANA,
      }),
    );
    expect(auditadas()).toEqual(['ORDER_ASSIGNED', 'ORDER_IN_PROGRESS']);
  });

  it('demanda de outra pessoa e recusada, dizendo com quem esta', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.IN_PROGRESS, BRUNO));

    const erro = await claimOrder(GUILD_ID, STAFF, ORDER_ID).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ValidationError);
    expect((erro as ValidationError).userMessage).toContain(`<@${BRUNO}>`);
    expect(repo.setOrderAssignee).not.toHaveBeenCalled();
    expect(audit.recordOrderAudit).not.toHaveBeenCalled();
  });

  it('assumir o que ja e seu nao grava nem audita nada', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.IN_PROGRESS, ANA));

    const result = await claimOrder(GUILD_ID, STAFF, ORDER_ID);

    expect(result.started).toBe(false);
    expect(repo.setOrderAssignee).not.toHaveBeenCalled();
    expect(audit.recordOrderAudit).not.toHaveBeenCalled();
  });

  it('pedido fora da producao nao tem responsavel', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.DELIVERED, null));

    await expect(claimOrder(GUILD_ID, STAFF, ORDER_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.setOrderAssignee).not.toHaveBeenCalled();
  });

  /*
   * A gravacao condicional perdeu: alguem mudou o responsavel entre a leitura
   * e a escrita. Avisar e o certo — sobrescrever tomaria a demanda de alguem.
   */
  it('se o responsavel mudou no meio, avisa em vez de sobrescrever', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.PAID, null));
    repo.setOrderAssignee.mockResolvedValue(false);

    const erro = await claimOrder(GUILD_ID, STAFF, ORDER_ID).catch((e: unknown) => e);

    expect((erro as ValidationError).userMessage).toContain('mudou enquanto voce olhava');
    expect(audit.recordOrderAudit).not.toHaveBeenCalled();
  });

  it('pedido de outra guild nao existe para quem assume', async () => {
    repo.findOrderById.mockResolvedValue({ ...(pedido(OrderStatus.PAID, null) as object), guildId: '999999999999999999' });

    await expect(claimOrder(GUILD_ID, STAFF, ORDER_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.setOrderAssignee).not.toHaveBeenCalled();
  });
});

describe('liberar', () => {
  it('devolve a fila pela condicao de quem estava, e audita quem liberou', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.IN_PROGRESS, BRUNO));
    repo.setOrderAssignee.mockResolvedValue(true);

    await releaseOrder(GUILD_ID, STAFF, ORDER_ID);

    expect(repo.setOrderAssignee).toHaveBeenCalledWith(ORDER_ID, BRUNO, null);
    expect(audit.recordOrderAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_UNASSIGNED',
        performedById: ANA,
        oldValue: BRUNO,
        newValue: null,
      }),
    );
  });

  it('liberar demanda que ja esta livre e recusado', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.PAID, null));

    await expect(releaseOrder(GUILD_ID, STAFF, ORDER_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.setOrderAssignee).not.toHaveBeenCalled();
  });
});

describe('atribuir', () => {
  it('transfere de uma pessoa para outra, auditando quem fez a troca', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.IN_PROGRESS, BRUNO));
    repo.setOrderAssignee.mockResolvedValue(true);

    await assignOrderTo(GUILD_ID, STAFF, ORDER_ID, CAIO);

    expect(repo.setOrderAssignee).toHaveBeenCalledWith(ORDER_ID, BRUNO, CAIO);
    expect(audit.recordOrderAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_ASSIGNED',
        performedById: ANA,
        oldValue: BRUNO,
        newValue: CAIO,
      }),
    );
  });

  it('atribuir a quem ja esta com a demanda nao grava nada', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.IN_PROGRESS, CAIO));

    await assignOrderTo(GUILD_ID, STAFF, ORDER_ID, CAIO);

    expect(repo.setOrderAssignee).not.toHaveBeenCalled();
    expect(audit.recordOrderAudit).not.toHaveBeenCalled();
  });
});

describe('pegar a proxima', () => {
  const A = 'ckpedidoA00000000000000';
  const B = 'ckpedidoB00000000000000';

  it('pede so demandas livres, na ordem da fila, e fica com a primeira', async () => {
    repo.listProductionQueue.mockResolvedValue([pedido(OrderStatus.PAID, null, A), pedido(OrderStatus.PAID, null, B)]);
    repo.setOrderAssignee.mockResolvedValue(true);
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.IN_PROGRESS, ANA, A));

    const result = await claimNextOrder(GUILD_ID, STAFF);

    // `null` no terceiro argumento = so as sem responsavel.
    expect(repo.listProductionQueue).toHaveBeenCalledWith(GUILD_ID, expect.any(Number), null);
    expect(repo.setOrderAssignee).toHaveBeenCalledTimes(1);
    expect(repo.setOrderAssignee).toHaveBeenCalledWith(A, null, ANA);
    expect(result?.order.id).toBe(A);
  });

  /*
   * Duas pessoas clicaram juntas. Quem perdeu a primeira nao recebe erro de
   * "pedido ocupado": recebe a proxima.
   */
  it('pula a que outra pessoa pegou no mesmo instante', async () => {
    repo.listProductionQueue.mockResolvedValue([pedido(OrderStatus.PAID, null, A), pedido(OrderStatus.PAID, null, B)]);
    repo.setOrderAssignee.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.IN_PROGRESS, ANA, B));

    const result = await claimNextOrder(GUILD_ID, STAFF);

    expect(result?.order.id).toBe(B);
    expect(audit.recordOrderAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ORDER_ASSIGNED', orderId: B }),
    );
    expect(audit.recordOrderAudit).not.toHaveBeenCalledWith(expect.objectContaining({ orderId: A }));
  });

  it('sem demanda livre devolve null, sem gravar nada', async () => {
    repo.listProductionQueue.mockResolvedValue([]);

    expect(await claimNextOrder(GUILD_ID, STAFF)).toBeNull();
    expect(repo.setOrderAssignee).not.toHaveBeenCalled();
  });
});

describe('em preparacao', () => {
  it('quem poe em preparacao vira responsavel quando ninguem era', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.PAID, null));
    repo.markOrderInProgress.mockResolvedValue(true);
    repo.setOrderAssignee.mockResolvedValue(true);

    await startOrderProgress(GUILD_ID, STAFF, ORDER_ID);

    expect(repo.setOrderAssignee).toHaveBeenCalledWith(ORDER_ID, null, ANA);
    expect(auditadas()).toEqual(['ORDER_IN_PROGRESS', 'ORDER_ASSIGNED']);
  });

  it('nao toma a demanda de quem ja estava com ela', async () => {
    repo.findOrderById.mockResolvedValue(pedido(OrderStatus.PAID, BRUNO));
    repo.markOrderInProgress.mockResolvedValue(true);

    await startOrderProgress(GUILD_ID, STAFF, ORDER_ID);

    expect(repo.setOrderAssignee).not.toHaveBeenCalled();
    expect(auditadas()).toEqual(['ORDER_IN_PROGRESS']);
  });
});
