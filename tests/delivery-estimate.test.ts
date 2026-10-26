import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Previsao de entrega dos pedidos.
 *
 * Tudo que a loja vende e feito sob encomenda, entao esta data e uma PROMESSA
 * ao cliente. Os testes cobrem principalmente as tres decisoes que a tornam
 * honesta: contar em dias uteis, usar o MAIOR prazo do pedido, e nunca
 * reescrever uma promessa ja feita.
 */

const packFindMany = vi.fn();
const orderUpdate = vi.fn();

vi.mock('../src/core/database/prisma', () => ({
  getPrisma: () => ({
    catalogPack: { findMany: (...args: unknown[]) => packFindMany(...args) },
    order: { update: (...args: unknown[]) => orderUpdate(...args) },
  }),
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  addBusinessDays,
  dueStatusOf,
  leadTimeForOrder,
  setDeliveryEstimate,
} from '../src/modules/catalog/services/DeliveryEstimateService';

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    guildId: 'g1',
    dueAt: null,
    items: [{ packId: 'p1' }],
    ...overrides,
  } as never;
}

/** Categorias devolvidas para os packs do pedido. */
function packsWithLeadTimes(days: Array<number | null>) {
  packFindMany.mockResolvedValue(days.map((d) => ({ category: { leadTimeDays: d } })));
}

beforeEach(() => {
  vi.clearAllMocks();
  orderUpdate.mockResolvedValue(undefined);
  packsWithLeadTimes([5]);
});

describe('addBusinessDays', () => {
  /*
   * DIAS UTEIS, e nao corridos: e como uma loja de trabalho sob encomenda
   * opera, e como o cliente le "5 dias". Contar corrido faria a loja prometer
   * producao no sabado.
   */
  it('pula o fim de semana', () => {
    // Sexta 28/08/2026 + 1 dia util = segunda 31/08.
    const sexta = new Date('2026-08-28T12:00:00Z');
    expect(addBusinessDays(sexta, 1).getDate()).toBe(31);
  });

  it('soma cinco dias uteis atravessando um fim de semana', () => {
    // Segunda 24/08 + 5 uteis = segunda 31/08 (7 dias corridos).
    const segunda = new Date('2026-08-24T12:00:00Z');
    const resultado = addBusinessDays(segunda, 5);
    expect(resultado.getDate()).toBe(31);
  });

  it('devolve a mesma data para zero dias', () => {
    const agora = new Date('2026-08-26T12:00:00Z');
    expect(addBusinessDays(agora, 0).getTime()).toBe(agora.getTime());
  });

  it('trata numero negativo como zero, nunca voltando no tempo', () => {
    const agora = new Date('2026-08-26T12:00:00Z');
    expect(addBusinessDays(agora, -5).getTime()).toBe(agora.getTime());
  });
});

describe('leadTimeForOrder', () => {
  /*
   * O MAIOR prazo, e nao a soma nem a media. Os itens sao produzidos em
   * paralelo e o pedido so fica pronto quando o ultimo fica: somar prometeria
   * uma data absurda num carrinho de cinco itens, e a media prometeria uma data
   * que o pedido nao cumpre.
   */
  it('usa o maior prazo entre os itens', async () => {
    packsWithLeadTimes([3, 10, 5]);
    await expect(leadTimeForOrder(order())).resolves.toBe(10);
  });

  it('ignora categorias sem prazo definido', async () => {
    packsWithLeadTimes([null, 7, null]);
    await expect(leadTimeForOrder(order())).resolves.toBe(7);
  });

  it('devolve null quando nenhuma categoria tem prazo', async () => {
    packsWithLeadTimes([null, null]);
    await expect(leadTimeForOrder(order())).resolves.toBeNull();
  });

  it('devolve null para pedido sem itens', async () => {
    await expect(leadTimeForOrder(order({ items: [] }))).resolves.toBeNull();
    expect(packFindMany).not.toHaveBeenCalled();
  });
});

describe('setDeliveryEstimate', () => {
  it('grava a previsao a partir da data do pagamento', async () => {
    packsWithLeadTimes([5]);
    const pago = new Date('2026-08-24T12:00:00Z');

    const due = await setDeliveryEstimate(order(), pago);

    expect(due).not.toBeNull();
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' } }),
    );
  });

  /*
   * A PROMESSA NAO SE REESCREVE. Se a loja mudar o prazo da categoria, ou se o
   * pedido for reprocessado, quem ja comprou mantem a data que recebeu.
   */
  it('nunca sobrescreve uma previsao ja existente', async () => {
    const existente = new Date('2026-09-10T12:00:00Z');

    const due = await setDeliveryEstimate(order({ dueAt: existente }));

    expect(due).toBe(existente);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('nao grava nada quando nao ha prazo cadastrado', async () => {
    packsWithLeadTimes([null]);

    await expect(setDeliveryEstimate(order())).resolves.toBeNull();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  /*
   * Melhor-esforco: uma falha aqui nao pode desfazer um pagamento aprovado. O
   * pedido segue sem previsao e a equipe combina o prazo no atendimento.
   */
  it('engole a falha em vez de derrubar o pagamento', async () => {
    packFindMany.mockRejectedValue(new Error('banco fora'));

    await expect(setDeliveryEstimate(order())).resolves.toBeNull();
  });
});

describe('dueStatusOf', () => {
  const agora = new Date('2026-08-31T12:00:00Z');

  it('reconhece pedido sem prazo', () => {
    expect(dueStatusOf(null, agora)).toBe('sem-prazo');
  });

  it('reconhece atraso', () => {
    expect(dueStatusOf(new Date('2026-08-30T12:00:00Z'), agora)).toBe('atrasado');
  });

  it('trata o que vence em menos de 24h como "hoje"', () => {
    expect(dueStatusOf(new Date('2026-08-31T20:00:00Z'), agora)).toBe('hoje');
  });

  it('reconhece pedido dentro do prazo', () => {
    expect(dueStatusOf(new Date('2026-09-05T12:00:00Z'), agora)).toBe('no-prazo');
  });
});
