import { ButtonStyle, ComponentType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Lembrete de carrinho abandonado.
 *
 * O carrinho e persistente e ninguem nunca cutucava quem largou itens la. O
 * job manda UMA DM depois de 24h — e "uma" e a palavra que estes testes
 * defendem. O custo de insistir nao e a irritacao: e o cliente bloquear as DMs
 * do bot, o que leva junto os avisos de cobranca, pagamento e entrega, que sao
 * os que ele realmente precisa receber.
 */

const listAbandonedCarts = vi.fn();
const markAbandonedNoticeSent = vi.fn();
const getCartView = vi.fn();
const getGuildConfig = vi.fn();
const fetchMemberSafe = vi.fn();

vi.mock('../src/modules/catalog/repositories/CartRepository', () => ({
  listAbandonedCarts: (...args: unknown[]) => listAbandonedCarts(...args),
  markAbandonedNoticeSent: (...args: unknown[]) => markAbandonedNoticeSent(...args),
}));

vi.mock('../src/modules/catalog/services/CartService', () => ({
  getCartView: (...args: unknown[]) => getCartView(...args),
}));

vi.mock('../src/modules/configuration/services/GuildConfigService', () => ({
  getGuildConfig: (...args: unknown[]) => getGuildConfig(...args),
}));

// `delay` real deixaria o lote de 40 carrinhos levando um minuto por teste.
vi.mock('../src/utils/time', () => ({
  delay: () => Promise.resolve(),
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

/*
 * So `fetchMemberSafe` e trocado: o resto de `utils/discord` (os
 * classificadores de erro do Discord, NO_MENTIONS, channelUrl) e exercitado de
 * verdade, e mocka-lo esconderia justamente o tratamento de DM fechada.
 */
vi.mock('../src/utils/discord', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/discord')>(
    '../src/utils/discord',
  );
  return { ...actual, fetchMemberSafe: (...args: unknown[]) => fetchMemberSafe(...args) };
});

import { CART_REMINDER } from '../src/constants/limits';
import { buildAbandonedCartDm } from '../src/modules/catalog/builders/CartBuilders';
import { remindAbandonedCarts } from '../src/modules/catalog/services/CartReminderService';

const GUILD_ID = '1042089361279287366';
const CATALOG_CHANNEL = '1419479659166568662';

function pack(name: string, price: number, id = name) {
  return { id, name, price } as never;
}

function line(name: string, price: number, unavailable = false) {
  return {
    item: { id: `i-${name}`, packId: name },
    pack: pack(name, price),
    unavailable,
    reason: null,
  } as never;
}

function view(lines: unknown[], subtotal: number, sellableCount = lines.length) {
  return { cart: { id: 'c1' }, lines, subtotal, sellableCount } as never;
}

function guild() {
  return { id: GUILD_ID, members: { cache: new Map(), fetch: vi.fn() } } as never;
}

function client() {
  return { guilds: { cache: new Map([[GUILD_ID, guild()]]) } } as never;
}

let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  send = vi.fn().mockResolvedValue(undefined);
  fetchMemberSafe.mockResolvedValue({ user: { send } });
  markAbandonedNoticeSent.mockResolvedValue(true);
  getGuildConfig.mockResolvedValue({
    storeName: 'Vook Store',
    catalogChannelId: CATALOG_CHANNEL,
  });
  getCartView.mockResolvedValue(view([line('Pack A', 1000)], 1000));
  listAbandonedCarts.mockResolvedValue([]);
});

describe('remindAbandonedCarts', () => {
  it('nao consulta nada alem do lote quando nao ha carrinho parado', async () => {
    await expect(remindAbandonedCarts(client())).resolves.toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('usa o corte de 24 horas de inatividade', async () => {
    const antes = Date.now();
    await remindAbandonedCarts(client());

    const [corte, lote] = listAbandonedCarts.mock.calls[0] as [Date, number];
    expect(lote).toBe(CART_REMINDER.BATCH);

    const esperado = antes - CART_REMINDER.ABANDONED_AFTER_MS;
    expect(Math.abs(corte.getTime() - esperado)).toBeLessThan(5_000);
  });

  it('manda a DM e marca o carrinho', async () => {
    listAbandonedCarts.mockResolvedValue([{ id: 'c1', guildId: GUILD_ID, customerId: 'u1' }]);

    await expect(remindAbandonedCarts(client())).resolves.toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(markAbandonedNoticeSent).toHaveBeenCalledWith('c1');
  });

  /*
   * A GARANTIA CENTRAL. A marcacao acontece mesmo sem DM. Sem isso, um cliente
   * com DM fechada voltaria na consulta a cada meia hora, para sempre —
   * consumindo o lote inteiro e impedindo carrinhos novos de serem avisados.
   */
  it('marca o carrinho mesmo quando a DM nao pode ser entregue', async () => {
    listAbandonedCarts.mockResolvedValue([{ id: 'c1', guildId: GUILD_ID, customerId: 'u1' }]);
    fetchMemberSafe.mockResolvedValue(null);

    await expect(remindAbandonedCarts(client())).resolves.toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(markAbandonedNoticeSent).toHaveBeenCalledWith('c1');
  });

  it('marca o carrinho de uma guild em que o bot nao esta mais', async () => {
    listAbandonedCarts.mockResolvedValue([{ id: 'c1', guildId: 'outra', customerId: 'u1' }]);

    await expect(remindAbandonedCarts(client())).resolves.toBe(0);
    expect(markAbandonedNoticeSent).toHaveBeenCalledWith('c1');
  });

  /*
   * Um pack que saiu do ar entre a adicao e o lembrete viraria uma promessa
   * quebrada no primeiro clique. O carrinho e marcado assim mesmo: o momento
   * passou, e insistir depois seria um lembrete de algo que nao existe.
   */
  it('nao manda DM quando nenhum item esta mais disponivel', async () => {
    listAbandonedCarts.mockResolvedValue([{ id: 'c1', guildId: GUILD_ID, customerId: 'u1' }]);
    getCartView.mockResolvedValue(view([line('Pack A', 1000, true)], 0, 0));

    await expect(remindAbandonedCarts(client())).resolves.toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(markAbandonedNoticeSent).toHaveBeenCalledWith('c1');
  });

  it('uma falha num carrinho nao impede os seguintes', async () => {
    listAbandonedCarts.mockResolvedValue([
      { id: 'c1', guildId: GUILD_ID, customerId: 'u1' },
      { id: 'c2', guildId: GUILD_ID, customerId: 'u2' },
    ]);
    getCartView
      .mockRejectedValueOnce(new Error('banco fora'))
      .mockResolvedValue(view([line('Pack A', 1000)], 1000));

    await expect(remindAbandonedCarts(client())).resolves.toBe(1);
    // Os DOIS sao marcados: o que falhou tambem nao pode voltar para sempre.
    expect(markAbandonedNoticeSent).toHaveBeenCalledWith('c1');
    expect(markAbandonedNoticeSent).toHaveBeenCalledWith('c2');
  });
});

describe('buildAbandonedCartDm', () => {
  function render(
    lines: unknown[],
    subtotal: number,
    catalogChannelId: string | null = CATALOG_CHANNEL,
  ) {
    return buildAbandonedCartDm({
      view: view(lines, subtotal),
      guildId: GUILD_ID,
      catalogChannelId,
      storeName: 'Vook Store',
    }).toJSON();
  }

  function textOf(json: ReturnType<typeof render>): string {
    return json.components
      .flatMap((component) => {
        if (component.type === ComponentType.TextDisplay) return [component.content];
        if (component.type === ComponentType.Section) {
          return component.components.map((child) => child.content);
        }
        return [];
      })
      .join('\n');
  }

  function buttonsOf(json: ReturnType<typeof render>) {
    return json.components.flatMap((component) =>
      component.type === ComponentType.ActionRow ? component.components : [],
    );
  }

  it('lista os itens com o preco atual e o subtotal', () => {
    const texto = textOf(render([line('Pack A', 1000), line('Pack B', 2550)], 3550));

    expect(texto).toContain('Pack A');
    expect(texto).toContain('Pack B');
    expect(texto).toContain('R$ 35,50');
  });

  it('deixa claro que o preco nao esta congelado', () => {
    // O carrinho nunca congela preco: quem le tres dias depois precisa saber.
    expect(textOf(render([line('Pack A', 1000)], 1000))).toContain('podem mudar');
  });

  it('leva o cliente de volta ao canal do catalogo', () => {
    const [botao] = buttonsOf(render([line('Pack A', 1000)], 1000));

    expect(botao).toHaveProperty('style', ButtonStyle.Link);
    expect(botao).toHaveProperty(
      'url',
      `https://discord.com/channels/${GUILD_ID}/${CATALOG_CHANNEL}`,
    );
  });

  it('cai no servidor quando nao ha canal de catalogo configurado', () => {
    const [botao] = buttonsOf(render([line('Pack A', 1000)], 1000, null));
    expect(botao).toHaveProperty('url', `https://discord.com/channels/${GUILD_ID}`);
  });

  it('omite item indisponivel da lista', () => {
    const texto = textOf(
      render([line('Pack Vivo', 1000), line('Pack Morto', 2000, true)], 1000),
    );

    expect(texto).toContain('Pack Vivo');
    expect(texto).not.toContain('Pack Morto');
  });

  it('resume quando ha itens demais para caber', () => {
    const muitos = Array.from({ length: 10 }, (_, index) => line(`Pack ${index}`, 1000));
    const texto = textOf(render(muitos, 10_000));

    expect(texto).toContain('e mais 4 itens');
  });
});
