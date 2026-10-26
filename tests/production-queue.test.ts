import { ButtonStyle, ComponentType } from 'discord.js';
import { OrderStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/*
 * Fila de producao por vencimento — e a gestao de demandas em cima dela.
 *
 * A previsao de entrega ja era gravada e exibida — mas NENHUMA listagem
 * ordenava por ela. Na pratica o bot respondia "quando este pedido vence?" e
 * nunca "o que vence primeiro?", que e a pergunta da segunda-feira de manha.
 *
 * Depois veio a segunda pergunta: "quem esta fazendo?". Com mais de uma pessoa
 * na equipe, fila sem dono vira trabalho duplicado ou esquecido.
 *
 * Os criterios de sucesso:
 *  - um pedido vencido aparece no topo, marcado, sem ninguem ter procurado;
 *  - cada demanda diz com quem esta, ou que esta livre;
 *  - da para pegar a proxima, assumir, liberar e transferir sem sair da tela.
 */

import {
  buildOrderStaffView,
  buildProductionQueue,
  type QueueView,
} from '../src/modules/catalog/builders/OrderBuilders';
import {
  PRODUCTION_STATUSES,
  type ProductionQueueStats,
} from '../src/modules/catalog/repositories/OrderRepository';

const CLIENTE = '541393694008410113';
const ANA = '333333333333333333';
const BRUNO = '444444444444444444';

/** Pedido da fila. `dias` negativo = vencido; `null` = sem prazo. */
function pedido(
  orderNumber: number,
  dias: number | null,
  categoria: string | null = 'Cabelos',
  status: OrderStatus = OrderStatus.PAID,
  responsavel: string | null = null,
) {
  return {
    id: `ckpedido${String(orderNumber).padStart(16, '0')}`,
    orderNumber,
    customerId: CLIENTE,
    status,
    dueAt: dias === null ? null : new Date(Date.now() + dias * 86_400_000),
    assignedToId: responsavel,
    assignedAt: responsavel === null ? null : new Date(),
    items: [{ pack: { category: categoria === null ? null : { name: categoria } } }],
  } as never;
}

function tela(
  orders: unknown[],
  opcoes: {
    total?: number;
    unassigned?: number;
    workload?: ProductionQueueStats['workload'];
    view?: QueueView;
    viewerId?: string;
    notice?: string;
  } = {},
) {
  const total = opcoes.total ?? orders.length;
  return buildProductionQueue({
    orders: orders as never,
    stats: {
      total,
      unassigned: opcoes.unassigned ?? 0,
      workload: opcoes.workload ?? [],
    },
    view: opcoes.view ?? 'all',
    viewerId: opcoes.viewerId ?? ANA,
    ...(opcoes.notice !== undefined ? { notice: opcoes.notice } : {}),
  }).toJSON();
}

interface Node {
  type: ComponentType;
  content?: string;
  custom_id?: string;
  style?: ButtonStyle;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  components?: Node[];
  options?: Array<{ value: string; label: string; description?: string }>;
  default_values?: Array<{ id: string; type: string }>;
}

/** Todos os nos do container, achatados (linhas de acao incluidas). */
function nos(json: { components: unknown[] }): Node[] {
  const out: Node[] = [];
  const walk = (node: Node): void => {
    out.push(node);
    for (const child of node.components ?? []) walk(child);
  };
  for (const child of json.components as Node[]) walk(child);
  return out;
}

function textoDe(json: { components: unknown[] }): string {
  return nos(json)
    .flatMap((n) => (n.type === ComponentType.TextDisplay && n.content ? [n.content] : []))
    .join('\n');
}

function botoes(json: { components: unknown[] }): Node[] {
  return nos(json).filter((n) => n.type === ComponentType.Button);
}

function botao(json: { components: unknown[] }, label: string): Node {
  const achado = botoes(json).find((b) => b.label === label);
  if (achado === undefined) throw new Error(`Botao "${label}" nao encontrado.`);
  return achado;
}

describe('o que a fila responde', () => {
  it('mostra o pedido vencido marcado como atrasado', () => {
    const texto = textoDe(tela([pedido(184, -3)]));

    expect(texto).toContain('VK-000184');
    expect(texto).toContain('ATRASADO');
  });

  /*
   * A ordenacao vem do banco (`dueAt` asc). O que esta tela garante e nao
   * reordenar nem embaralhar o que chegou.
   */
  it('preserva a ordem recebida, sem reordenar por conta propria', () => {
    const texto = textoDe(tela([pedido(184, -3), pedido(185, 0.4), pedido(186, 9)]));

    expect(texto.indexOf('VK-000184')).toBeLessThan(texto.indexOf('VK-000185'));
    expect(texto.indexOf('VK-000185')).toBeLessThan(texto.indexOf('VK-000186'));
  });

  it('distingue vencido, vence hoje e dentro do prazo', () => {
    const texto = textoDe(tela([pedido(1, -2), pedido(2, 0.5), pedido(3, 10)]));

    expect(texto).toContain('ATRASADO');
    expect(texto).toContain('VENCE HOJE');
    expect(texto).toContain('vence <t:');
  });

  it('mostra a categoria, porque o prazo depende dela', () => {
    const texto = textoDe(tela([pedido(1, 3, 'Cabelos'), pedido(2, 3, 'PEDs de Lobo')]));

    expect(texto).toContain('Cabelos');
    expect(texto).toContain('PEDs de Lobo');
  });

  it('junta as categorias de um pedido com itens de mais de uma', () => {
    const misto = {
      id: 'ckmisto',
      orderNumber: 9,
      customerId: CLIENTE,
      status: OrderStatus.PAID,
      dueAt: new Date(),
      assignedToId: null,
      assignedAt: null,
      items: [
        { pack: { category: { name: 'Cabelos' } } },
        { pack: { category: { name: 'Props' } } },
        { pack: { category: { name: 'Cabelos' } } },
      ],
    } as never;

    expect(textoDe(tela([misto]))).toContain('Cabelos, Props');
  });

  it('resume atrasados no topo, antes da lista', () => {
    const texto = textoDe(tela([pedido(1, -5), pedido(2, -1), pedido(3, 4)]));
    expect(texto).toContain('2 atrasado(s)');
  });
});

describe('pedido sem prazo', () => {
  /*
   * Excluir quem nao tem `dueAt` deixaria a fila vazia justamente enquanto
   * nenhuma categoria tem prazo cadastrado — e tela vazia parece defeito, nao
   * configuracao faltando. Medido no banco no dia em que isto foi escrito:
   * nenhuma categoria tinha prazo.
   */
  it('aparece na fila, nao some dela', () => {
    const texto = textoDe(tela([pedido(1, null)]));

    expect(texto).toContain('VK-000001');
    expect(texto).toContain('sem prazo definido');
  });

  it('diz onde cadastrar o prazo que falta', () => {
    expect(textoDe(tela([pedido(1, null)]))).toContain('/catalogo-painel prazo');
  });

  it('nao instrui sobre prazo quando todos ja tem', () => {
    expect(textoDe(tela([pedido(1, 3)]))).not.toContain('/catalogo-painel prazo');
  });
});

describe('quem esta com cada demanda', () => {
  it('mostra o responsavel na linha do pedido', () => {
    const texto = textoDe(tela([pedido(1, 2, 'Cabelos', OrderStatus.IN_PROGRESS, ANA)]));
    expect(texto).toContain(`<@${ANA}>`);
  });

  /*
   * "Livre" e escrito, nao deduzido pela ausencia de nome: e a palavra que faz
   * alguem pegar a demanda.
   */
  it('demanda sem responsavel aparece como livre', () => {
    expect(textoDe(tela([pedido(1, 2)]))).toContain('**livre**');
  });

  it('resume quantas estao livres', () => {
    const texto = textoDe(tela([pedido(1, 2)], { total: 3, unassigned: 2 }));
    expect(texto).toContain('2 livre(s)');
  });

  it('mostra a carga de cada pessoa da equipe', () => {
    const texto = textoDe(
      tela([pedido(1, 2)], {
        total: 5,
        workload: [
          { assigneeId: ANA, count: 3 },
          { assigneeId: BRUNO, count: 1 },
        ],
      }),
    );
    expect(texto).toContain(`Carga da equipe: <@${ANA}> 3 · <@${BRUNO}> 1`);
  });

  it('resume a carga quando a equipe e grande, sem estourar a mensagem', () => {
    const workload = Array.from({ length: 11 }, (_, i) => ({
      assigneeId: String(100000000000000000n + BigInt(i)),
      count: 11 - i,
    }));
    expect(textoDe(tela([pedido(1, 2)], { workload }))).toContain('e mais 3 pessoa(s)');
  });
});

describe('recortes da fila', () => {
  it('"Minhas" conta pelo responsavel, nao pela pagina', () => {
    const texto = textoDe(
      tela([pedido(1, 2, 'Cabelos', OrderStatus.PAID, ANA)], {
        view: 'mine',
        viewerId: ANA,
        workload: [{ assigneeId: ANA, count: 2 }],
      }),
    );
    expect(texto).toContain('suas demandas (2)');
  });

  it('"Minhas" vazio aponta para Pegar Proxima quando ha livres', () => {
    const texto = textoDe(tela([], { view: 'mine', total: 4, unassigned: 4 }));

    expect(texto).toContain('Nenhuma demanda com voce');
    expect(texto).toContain('Pegar Proxima');
  });

  it('"Livres" vazio explica que tudo ja tem dono', () => {
    const texto = textoDe(tela([], { view: 'free', total: 4, unassigned: 0 }));
    expect(texto).toContain('Tudo que esta em producao ja tem responsavel');
  });

  /*
   * O corte nunca pode esconder o tamanho do recorte: o total vem do banco,
   * nao da pagina, e o que sobrou e dito.
   */
  it('avisa quantos do recorte ficaram fora da pagina', () => {
    const texto = textoDe(tela([pedido(1, 1), pedido(2, 2)], { view: 'free', total: 40, unassigned: 30 }));
    expect(texto).toContain('28 pedido(s)');
  });

  it('nao avisa nada quando a pagina cobre tudo', () => {
    expect(textoDe(tela([pedido(1, 1)], { total: 1 }))).not.toContain('fora desta pagina');
  });
});

describe('acoes da fila', () => {
  it('Pegar Proxima fica desligado quando nao ha demanda livre', () => {
    expect(botao(tela([pedido(1, 2, 'Cabelos', OrderStatus.PAID, ANA)]), 'Pegar Proxima').disabled).toBe(true);
    expect(botao(tela([pedido(1, 2)], { unassigned: 1 }), 'Pegar Proxima').disabled).toBe(false);
  });

  it('o recorte atual aparece desligado e os outros ligados', () => {
    const json = tela([pedido(1, 2)], { view: 'mine', workload: [{ assigneeId: ANA, count: 1 }] });

    expect(botao(json, 'Minhas').disabled).toBe(true);
    expect(botao(json, 'Todas').disabled).toBeFalsy();
    expect(botao(json, 'Livres').disabled).toBeFalsy();
  });

  /*
   * O Discord recusa a mensagem INTEIRA quando dois componentes repetem o
   * customId — e "Atualizar" aponta para o mesmo recorte do filtro atual.
   */
  it('nenhum customId se repete, em nenhum recorte', () => {
    for (const view of ['all', 'mine', 'free'] as const) {
      const ids = nos(tela([pedido(1, 2), pedido(2, 3)], { view, workload: [{ assigneeId: ANA, count: 2 }] }))
        .flatMap((n) => (n.custom_id === undefined ? [] : [n.custom_id]));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('o select abre a demanda pela mesma rota do painel de pedidos', () => {
    const select = nos(tela([pedido(184, 2), pedido(185, 3)])).find(
      (n) => n.type === ComponentType.StringSelect,
    );

    expect(select?.custom_id).toBe('order:admin-sel');
    expect(select?.options?.map((o) => o.label)).toEqual(['VK-000184 · Cabelos', 'VK-000185 · Cabelos']);
  });

  it('a descricao do select diz prazo e se esta livre, em texto puro', () => {
    const select = nos(tela([pedido(1, -2)])).find((n) => n.type === ComponentType.StringSelect);
    const descricao = select?.options?.[0]?.description ?? '';

    expect(descricao).toContain('ATRASADO');
    expect(descricao).toContain('livre');
    expect(descricao).not.toContain('<t:');
  });

  it('os botoes aparecem mesmo com a fila vazia, para trocar de recorte', () => {
    expect(botoes(tela([], { view: 'mine' })).length).toBe(5);
  });
});

describe('estado sem cor', () => {
  /*
   * A politica visual da loja: nenhuma cor carrega significado. O atraso tem
   * de ser legivel em texto puro, e os botoes seguem o estilo neutro.
   */
  it('marca o atraso por palavra, nao por cor', () => {
    expect(textoDe(tela([pedido(1, -3)]))).toContain('ATRASADO');
  });

  it('todos os botoes da fila sao neutros', () => {
    for (const b of botoes(tela([pedido(1, -3)], { unassigned: 1 }))) {
      expect(b.style).toBe(ButtonStyle.Secondary);
    }
  });
});

describe('limites da mensagem', () => {
  const cheia = (): ReturnType<typeof tela> =>
    tela(
      Array.from({ length: 20 }, (_, i) => pedido(i + 1, i - 5, 'PEDs de Lobo', OrderStatus.IN_PROGRESS, ANA)),
      {
        total: 40,
        unassigned: 10,
        workload: Array.from({ length: 12 }, (_, i) => ({
          assigneeId: String(100000000000000000n + BigInt(i)),
          count: 3,
        })),
        notice: 'A'.repeat(200),
      },
    );

  it('cabe no orcamento de filhos do container, com aviso e pagina cheia', () => {
    expect(cheia().components.length).toBeLessThanOrEqual(10);
  });

  it('cabe no orcamento de texto com a pagina cheia', () => {
    expect(textoDe(cheia()).length).toBeLessThan(4000);
  });
});

describe('fila vazia', () => {
  it('explica quem entra, em vez de so dizer que esta vazia', () => {
    const texto = textoDe(tela([], { total: 0 }));

    expect(texto).toContain('Nenhum pedido em producao');
    expect(texto).toContain('pagos e em preparacao');
  });
});

describe('quem conta como em producao', () => {
  /*
   * DELIVERED fica de fora de proposito: o trabalho ja saiu. Mante-lo na fila
   * empurraria para baixo o que ainda precisa de mao.
   */
  it('inclui pago e em preparacao, e nada alem disso', () => {
    expect([...PRODUCTION_STATUSES]).toEqual([OrderStatus.PAID, OrderStatus.IN_PROGRESS]);
  });

  it('deixa de fora entregue, concluido e cancelado', () => {
    for (const fora of [
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
      OrderStatus.CANCELLED,
      OrderStatus.PENDING,
      OrderStatus.AWAITING_PAYMENT,
    ]) {
      expect(PRODUCTION_STATUSES).not.toContain(fora);
    }
  });
});

// ---------------------------------------------------------------------------
// Tela do pedido (equipe)
// ---------------------------------------------------------------------------

function pedidoCompleto(status: OrderStatus, responsavel: string | null) {
  return {
    id: 'ckorder00000000000000001',
    guildId: '111111111111111111',
    orderNumber: 184,
    customerId: CLIENTE,
    status,
    subtotalAmount: 14990,
    discountAmount: 0,
    finalAmount: 14990,
    couponId: null,
    couponCodeSnapshot: null,
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    dueAt: new Date(Date.now() + 3 * 86_400_000),
    assignedToId: responsavel,
    assignedAt: responsavel === null ? null : new Date(),
    paymentId: null,
    channelId: null,
    panelChannelId: null,
    panelMessageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: new Date(),
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    deliveredAt: null,
    deliveredById: null,
    completedAt: null,
    completedById: null,
    items: [
      {
        id: 'ckitem',
        orderId: 'ckorder00000000000000001',
        packId: 'ckpack',
        skuSnapshot: 'CAB-001',
        nameSnapshot: 'Cabelo Liso',
        priceSnapshot: 14990,
        quantity: 1,
        createdAt: new Date(),
      },
    ],
    payment: null,
  } as never;
}

function painel(status: OrderStatus, responsavel: string | null, notice?: string) {
  return buildOrderStaffView(
    pedidoCompleto(status, responsavel),
    notice === undefined ? {} : { notice },
  ).toJSON();
}

function ids(json: { components: unknown[] }): string[] {
  return nos(json).flatMap((n) => (n.custom_id === undefined ? [] : [n.custom_id]));
}

describe('tela do pedido: responsavel', () => {
  it('demanda livre diz que esta livre e oferece Assumir', () => {
    const json = painel(OrderStatus.PAID, null);

    expect(textoDe(json)).toContain('demanda livre na fila');
    expect(ids(json)).toContain('order:claim:ckorder00000000000000001');
    expect(ids(json)).not.toContain('order:release:ckorder00000000000000001');
  });

  /*
   * Com dono, "Assumir" seria tomar a demanda de alguem. Tomar e transferir,
   * e transferir e o select — explicito, auditado com quem fez.
   */
  it('demanda com dono mostra quem e desde quando, e oferece Liberar em vez de Assumir', () => {
    const json = painel(OrderStatus.IN_PROGRESS, ANA);

    expect(textoDe(json)).toContain(`<@${ANA}> · desde <t:`);
    expect(ids(json)).toContain('order:release:ckorder00000000000000001');
    expect(ids(json)).not.toContain('order:claim:ckorder00000000000000001');
  });

  it('oferece transferir para alguem da equipe, com o responsavel atual ja marcado', () => {
    const select = nos(painel(OrderStatus.IN_PROGRESS, ANA)).find(
      (n) => n.type === ComponentType.UserSelect,
    );

    expect(select?.custom_id).toBe('order:assign:ckorder00000000000000001');
    expect(select?.default_values).toEqual([{ id: ANA, type: 'user' }]);
  });

  it('volta para a fila a partir do pedido', () => {
    expect(ids(painel(OrderStatus.PAID, null))).toContain('order:queue:all');
  });

  it('pedido ainda nao pago nao tem responsavel nem transferencia', () => {
    const json = painel(OrderStatus.AWAITING_PAYMENT, null);

    expect(textoDe(json)).not.toContain('Responsavel');
    expect(nos(json).some((n) => n.type === ComponentType.UserSelect)).toBe(false);
  });

  it('pedido entregue guarda quem produziu, sem oferecer transferencia', () => {
    const json = painel(OrderStatus.DELIVERED, ANA);

    expect(textoDe(json)).toContain(`<@${ANA}>`);
    expect(nos(json).some((n) => n.type === ComponentType.UserSelect)).toBe(false);
  });

  it('cabe nos dez filhos do container com aviso, botoes e select', () => {
    for (const responsavel of [null, ANA]) {
      for (const status of [OrderStatus.PAID, OrderStatus.IN_PROGRESS]) {
        expect(painel(status, responsavel, 'A'.repeat(200)).components.length).toBeLessThanOrEqual(10);
      }
    }
  });

  it('nenhum customId se repete na tela do pedido', () => {
    const lista = ids(painel(OrderStatus.PAID, ANA));
    expect(new Set(lista).size).toBe(lista.length);
  });
});
