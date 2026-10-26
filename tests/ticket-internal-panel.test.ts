import { describe, expect, it } from 'vitest';
import { ComponentType, type ContainerBuilder } from 'discord.js';
import { TicketStatus, type Ticket } from '@prisma/client';

import { NAMESPACE, TICKET_ACTION, buildCustomId } from '../src/constants/customIds';

import {
  buildAdminPanel,
  buildInternalPanel,
  formatTicketNumber,
} from '../src/modules/tickets/builders/TicketInternalPanelBuilder';
import {
  buildAddMemberSelect,
  buildRemoveMemberSelect,
  buildTransferSelect,
} from '../src/modules/tickets/builders/TicketModalBuilder';
import { Registry } from '../src/core/client/registry';
import { registerAll } from '../src/interactions';

/**
 * Painel interno do ticket e painel administrativo.
 *
 * Os dois vivem perto do teto de 10 filhos por container — o admin so cabe
 * porque foi dividido em dois containers. Qualquer bloco novo precisa passar
 * por aqui antes de virar 400 em producao.
 */

const LOGO = 'https://cdn.vook.store/logo.png';
const BANNER = 'https://cdn.vook.store/banner.gif';
const OWNER = '111111111111111111';
const STAFF = '222222222222222222';

const CONTAINER_MAX_CHILDREN = 10;
const ROWS_PER_MESSAGE_MAX = 5;

/**
 * Rotas realmente escutadas pelo bot.
 *
 * Comparar os customId com strings literais provaria apenas que o builder sabe
 * concatenar. Cruzar com o Registry e o que pega o caso real: os selects de
 * membro/transferencia deixaram de ser botao e passaram a viver dentro deste
 * painel — se o handler correspondente sumir, o componente aparece bonito no
 * Discord e nao faz absolutamente nada.
 */
const REGISTERED_ROUTES = (() => {
  const registry = registerAll(new Registry());
  return new Set<string>([
    ...registry.buttons.keys(),
    ...registry.selects.keys(),
    ...registry.modals.keys(),
  ]);
})();

/** `ticket:add-select:<id>` -> `ticket:add-select`. */
function routeOf(customId: string): string {
  const parts = customId.split(':');
  return `${parts[0]}:${parts[1]}`;
}

/**
 * Todos os customId do payload, inclusive os que ficam escondidos no acessorio
 * de uma Section (e o caso dos tres botoes do painel admin).
 */
function customIdsOf(payloads: readonly unknown[]): string[] {
  const found: string[] = [];

  function visit(node: unknown): void {
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const customId = record['custom_id'];
    if (typeof customId === 'string') found.push(customId);
    for (const key of ['components', 'accessory']) {
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) visit(item);
      } else if (child !== undefined) {
        visit(child);
      }
    }
  }

  for (const payload of payloads) visit(payload);
  return found;
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ckq1abc2xyz0000dadosaqui',
    guildId: '1528606501248438282',
    ticketNumber: 153,
    categoryId: 'c1',
    ownerId: OWNER,
    subject: 'EMBED PAG',
    channelId: 'ch1',
    channelName: 'ticket-0153',
    status: TicketStatus.OPEN,
    priority: 'NORMAL',
    claimedById: null,
    claimedAt: null,
    closedById: null,
    closedAt: null,
    closeReason: null,
    panelMessageId: null,
    lastClientNotifyAt: null,
    lastRenamedAt: null,
    createdAt: new Date('2026-08-23T00:00:00.000Z'),
    updatedAt: new Date('2026-08-23T00:00:00.000Z'),
    ...overrides,
  } as Ticket;
}

function panelOf(
  ticket: Ticket,
  queuePosition = 3,
  participantIds: string[] = [],
  orderRefs: string[] = [],
) {
  return buildInternalPanel({
    ticket,
    categoryName: 'Outros',
    queuePosition,
    participantIds,
    orderRefs,
    thumbnailUrl: LOGO,
    bannerUrl: BANNER,
    storeName: 'Vook Store',
  }).toJSON();
}

function textOf(json: ReturnType<typeof panelOf>): string {
  return json.components
    .flatMap((c) => {
      if (c.type === ComponentType.TextDisplay) return [c.content];
      if (c.type === ComponentType.Section) return c.components.map((t) => t.content);
      return [];
    })
    .join('\n');
}

function buttonsOf(json: ReturnType<typeof panelOf>) {
  const row = json.components.find((c) => c.type === ComponentType.ActionRow);
  if (row?.type !== ComponentType.ActionRow) throw new Error('esperava ActionRow');
  return row.components.filter((c) => c.type === ComponentType.Button);
}

describe('painel interno do ticket', () => {
  it('monta os blocos na ordem de design e cabe no container', () => {
    const json = panelOf(makeTicket());

    expect(json.components.map((c) => c.type)).toEqual([
      ComponentType.Section, // cabecalho + saudacao, logo a direita
      ComponentType.Separator,
      ComponentType.TextDisplay, // dados em blocos rotulados
      ComponentType.Separator,
      ComponentType.MediaGallery, // banner
      ComponentType.Separator,
      ComponentType.ActionRow,
    ]);
    expect(json.components.length).toBeLessThanOrEqual(CONTAINER_MAX_CHILDREN);
  });

  it('mostra categoria, id, assunto, status e responsavel', () => {
    const texto = textOf(panelOf(makeTicket()));

    expect(texto).toContain('Categoria do Atendimento');
    expect(texto).toContain('ID do Ticket');
    expect(texto).toContain(formatTicketNumber(153));
    expect(texto).toContain('Assunto do Ticket');
    expect(texto).toContain('EMBED PAG');
    expect(texto).toContain('Responsavel');
  });

  /*
   * O campo "Responsavel" nasceu mostrando `Atendente <id>` porque o valor vai
   * dentro de um bloco de codigo, onde nenhuma mencao renderiza. O nome agora
   * chega resolvido de fora; estes tres casos travam os tres caminhos.
   */
  describe('responsavel', () => {
    it('mostra o nome resolvido, nunca o id', () => {
      const texto = textOf(
        buildInternalPanel({
          ticket: makeTicket({ status: TicketStatus.CLAIMED, claimedById: STAFF }),
          categoryName: 'Outros',
          queuePosition: 0,
          participantIds: [],
          claimedByName: 'Roberto',
        }).toJSON(),
      );

      expect(texto).toContain('Roberto');
      expect(texto).not.toContain(STAFF);
    });

    it('cai no id quando o membro saiu do servidor', () => {
      const texto = textOf(
        buildInternalPanel({
          ticket: makeTicket({ status: TicketStatus.CLAIMED, claimedById: STAFF }),
          categoryName: 'Outros',
          queuePosition: 0,
          participantIds: [],
          claimedByName: null,
        }).toJSON(),
      );

      // Mostrar o id e feio, mas esconder que o ticket TEM dono seria pior.
      expect(texto).toContain(`Atendente ${STAFF}`);
      expect(texto).not.toContain('Nao atribuido');
    });

    it('diz "Nao atribuido" enquanto ninguem assumiu', () => {
      expect(textOf(panelOf(makeTicket({ claimedById: null })))).toContain('Nao atribuido');
    });
  });

  it('mantem a posicao na fila visivel enquanto aguarda', () => {
    expect(textOf(panelOf(makeTicket(), 3))).toContain('3o na fila');
  });

  /*
   * Pedidos do atendimento.
   *
   * Toda cobranca gerada no ticket abre um pedido, e o numero precisa ficar no
   * topo do canal — na mensagem da cobranca ele some conversa acima. O bloco
   * entra no MESMO TextDisplay dos outros dados justamente para nao gastar o
   * orcamento de filhos do container, e e isso que os dois testes travam.
   */
  it('lista os pedidos abertos no atendimento', () => {
    const texto = textOf(
      panelOf(makeTicket(), 3, [], ['VK-000190 — Aguardando pagamento', 'VK-000191 — Entregue']),
    );

    expect(texto).toContain('Pedidos deste atendimento');
    expect(texto).toContain('VK-000190');
    expect(texto).toContain('VK-000191');
  });

  it('a linha de pedidos NAO custa um componente do container', () => {
    const semPedidos = panelOf(makeTicket());
    const comPedidos = panelOf(makeTicket(), 3, [], [
      'VK-000190 — Aguardando pagamento',
      'VK-000191 — Aguardando pagamento',
      'VK-000192 — Aguardando pagamento',
      'VK-000193 — Aguardando pagamento',
      'VK-000194 — Aguardando pagamento',
    ]);

    expect(comPedidos.components.map((c) => c.type)).toEqual(
      semPedidos.components.map((c) => c.type),
    );
    expect(comPedidos.components.length).toBeLessThanOrEqual(CONTAINER_MAX_CHILDREN);
  });

  it('atendimento sem venda nao ganha bloco vazio', () => {
    expect(textOf(panelOf(makeTicket()))).not.toContain('Pedidos deste atendimento');
  });

  it('para de anunciar fila depois de assumido', () => {
    const texto = textOf(
      panelOf(makeTicket({ status: TicketStatus.CLAIMED, claimedById: STAFF }), 0),
    );
    expect(texto).not.toContain('na fila');
  });

  it('menciona o dono do ticket na saudacao', () => {
    expect(textOf(panelOf(makeTicket()))).toContain(`<@${OWNER}>`);
  });

  it('neutraliza crases do assunto para nao quebrar o bloco de codigo', () => {
    // Sem escape, ``` fecharia o bloco e o resto viraria markdown do usuario.
    const malicioso = '```\n# TITULO FALSO\n[clique](https://evil)';
    const texto = textOf(panelOf(makeTicket({ subject: malicioso })));

    const blocos = texto.split('```').length - 1;
    expect(blocos % 2).toBe(0); // todo bloco aberto foi fechado
    expect(texto).not.toContain('# TITULO FALSO\n');
  });

  it('troca o botao de assumir quando o ticket ja tem responsavel', () => {
    const livre = buttonsOf(panelOf(makeTicket()));
    expect(livre[0]).toMatchObject({ label: 'Assumir Ticket', disabled: false });

    const assumido = buttonsOf(
      panelOf(makeTicket({ status: TicketStatus.CLAIMED, claimedById: STAFF }), 0),
    );
    expect(assumido[0]).toMatchObject({ label: 'Ticket Assumido', disabled: true });
  });

  it('mantem o botao Atualizar, de que a fila depende', () => {
    const labels = buttonsOf(panelOf(makeTicket())).map((b) => ('label' in b ? b.label : ''));
    expect(labels).toContain('Atualizar');
  });

  it('desabilita tudo quando o ticket esta encerrado', () => {
    const botoes = buttonsOf(panelOf(makeTicket({ status: TicketStatus.CLOSED }), 0));
    expect(botoes.every((b) => b.disabled === true)).toBe(true);
  });

  it('todo botao do painel aponta para um handler registrado', () => {
    const ids = customIdsOf([panelOf(makeTicket())]);

    expect(ids).toHaveLength(4);
    expect(ids.filter((id) => !REGISTERED_ROUTES.has(routeOf(id)))).toEqual([]);
  });

  it('sem banner, nao sobra divisoria orfa', () => {
    const json = buildInternalPanel({
      ticket: makeTicket(),
      categoryName: 'Outros',
      queuePosition: 1,
      participantIds: [],
      thumbnailUrl: LOGO,
      bannerUrl: null,
      storeName: 'Vook Store',
    }).toJSON();

    expect(json.components.filter((c) => c.type === ComponentType.MediaGallery)).toHaveLength(0);
    expect(json.components.filter((c) => c.type === ComponentType.Separator)).toHaveLength(2);
  });

  it('recusa banner com protocolo perigoso', () => {
    const json = buildInternalPanel({
      ticket: makeTicket(),
      categoryName: 'Outros',
      queuePosition: 1,
      participantIds: [],
      thumbnailUrl: 'javascript:alert(1)',
      bannerUrl: 'http://inseguro/x.gif',
      storeName: 'Vook Store',
    }).toJSON();

    expect(json.components.filter((c) => c.type === ComponentType.MediaGallery)).toHaveLength(0);
    expect(json.components.filter((c) => c.type === ComponentType.Section)).toHaveLength(0);
  });
});

describe('painel administrativo', () => {
  const ticket = makeTicket();

  function adminOf(comParticipante: boolean) {
    return buildAdminPanel({
      ticket,
      categoryName: 'Outros',
      actorId: STAFF,
      addMemberSelect: buildAddMemberSelect(ticket.id),
      transferSelect: buildTransferSelect(ticket.id),
      removeMemberSelect: comParticipante
        ? buildRemoveMemberSelect(ticket.id, [{ id: '333333333333333333', label: 'Fulano' }])
        : null,
      thumbnailUrl: LOGO,
      storeName: 'Vook Store',
    }).map((c) => c.toJSON());
  }

  it('divide em dois containers e respeita o teto de cada um', () => {
    const containers = adminOf(true);

    expect(containers).toHaveLength(2);
    for (const c of containers) {
      expect(c.components.length).toBeLessThanOrEqual(CONTAINER_MAX_CHILDREN);
    }
  });

  it('nao passa do limite de action rows da mensagem', () => {
    const rows = adminOf(true)
      .flatMap((c) => c.components)
      .filter((c) => c.type === ComponentType.ActionRow);

    expect(rows.length).toBeLessThanOrEqual(ROWS_PER_MESSAGE_MAX);
  });

  it('expoe as seis acoes de gerenciamento', () => {
    const texto = adminOf(true)
      .flatMap((c) => c.components)
      .flatMap((c) => {
        if (c.type === ComponentType.TextDisplay) return [c.content];
        if (c.type === ComponentType.Section) return c.components.map((t) => t.content);
        return [];
      })
      .join('\n');

    for (const acao of [
      'Adicionar Membro',
      'Remover Membro',
      'Transferir Atendimento',
      'Renomear Canal',
      'Notificar Cliente',
      'Finalizar Ticket',
    ]) {
      expect(texto).toContain(acao);
    }
  });

  it('omite o select de remocao quando nao ha participante (menu vazio seria 400)', () => {
    const selects = adminOf(false)
      .flatMap((c) => c.components)
      .filter((c) => c.type === ComponentType.ActionRow)
      .flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
      .filter((c) => c.type === ComponentType.StringSelect);

    expect(selects).toHaveLength(0);
  });

  it('mantem os selects inline com customId roteavel', () => {
    const ids = adminOf(true)
      .flatMap((c) => c.components)
      .filter((c) => c.type === ComponentType.ActionRow)
      .flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
      .map((c) => ('custom_id' in c ? c.custom_id : ''));

    expect(ids).toContain(`ticket:add-select:${ticket.id}`);
    expect(ids).toContain(`ticket:remove-select:${ticket.id}`);
    expect(ids).toContain(`ticket:transfer-select:${ticket.id}`);
  });

  it('selects inline e botoes de secao apontam para handlers registrados', () => {
    // Com e sem participante: sem participante o select de remocao some, e o
    // painel nao pode perder nenhuma das outras rotas por causa disso.
    for (const comParticipante of [true, false]) {
      const ids = customIdsOf(adminOf(comParticipante));
      const rotas = [...new Set(ids.map(routeOf))];

      expect(rotas).toContain('ticket:add-select');
      expect(rotas).toContain('ticket:transfer-select');
      expect(rotas).toContain('ticket:rename');
      expect(rotas).toContain('ticket:notify');
      expect(rotas).toContain('ticket:close');
      expect(rotas.filter((rota) => !REGISTERED_ROUTES.has(rota))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Pior caso medido dos dois paineis
// ---------------------------------------------------------------------------

/**
 * Os numeros abaixo sao MEDIDOS, nao estimados.
 *
 * Nenhum limite de estrutura e validado por `discord.js`:
 * `ContainerBuilder.toJSON()` so valida a cor de destaque
 * (`@discordjs/builders` 1.14.1), serializa o resto como veio e o 400 Invalid
 * Form Body aparece no envio — em producao, no canal do cliente. Por isso o
 * teto entra aqui, com os dados de pior caso reais: assunto no maximo de
 * `TICKET_SUBJECT_MAX` (200), categoria no maximo de `CATEGORY_NAME_MAX` (60),
 * `MAX_PARTICIPANTS_PER_TICKET` (20) participantes e os seis valores de
 * `TicketStatus`.
 */

const CONTAINER_MAX = 10;
const MESSAGE_TOP_LEVEL_MAX = 10;
const MESSAGE_COMPONENTS_MAX = 40;
const MESSAGE_TEXT_MAX = 4000;
const SELECT_OPTIONS_MAX = 25;
const SELECT_LABEL_MAX = 100;
const CUSTOM_ID_MAX = 100;

interface Node {
  type: ComponentType;
  content?: string;
  components?: Node[];
  accessory?: Node;
  custom_id?: string;
  options?: { label: string; value: string }[];
}

interface Metrics {
  topLevel: number;
  children: number[];
  components: number;
  rows: number;
  textTotal: number;
  customIds: string[];
  sectionTexts: number[];
  selectOptions: number[];
  longestOptionLabel: number;
}

/** Percorre a mensagem inteira: containers, sections, rows e acessorios. */
function measureMessage(roots: readonly ContainerBuilder[]): Metrics {
  const jsons = roots.map((root) => root.toJSON() as unknown as Node);
  const metrics: Metrics = {
    topLevel: jsons.length,
    children: jsons.map((json) => (json.components ?? []).length),
    components: 0,
    rows: 0,
    textTotal: 0,
    customIds: [],
    sectionTexts: [],
    selectOptions: [],
    longestOptionLabel: 0,
  };

  const walk = (node: Node): void => {
    metrics.components += 1;
    if (node.type === ComponentType.TextDisplay) metrics.textTotal += (node.content ?? '').length;
    if (node.type === ComponentType.ActionRow) metrics.rows += 1;
    if (node.type === ComponentType.Section) {
      metrics.sectionTexts.push((node.components ?? []).length);
    }
    if (typeof node.custom_id === 'string') metrics.customIds.push(node.custom_id);
    if (node.options !== undefined) {
      metrics.selectOptions.push(node.options.length);
      for (const option of node.options) {
        metrics.longestOptionLabel = Math.max(metrics.longestOptionLabel, option.label.length);
      }
    }
    for (const child of node.components ?? []) walk(child);
    if (node.accessory !== undefined) walk(node.accessory);
  };
  for (const json of jsons) walk(json);

  return metrics;
}

function expectMessageWithinLimits(metrics: Metrics): void {
  expect(metrics.topLevel).toBeLessThanOrEqual(MESSAGE_TOP_LEVEL_MAX);
  expect(Math.max(...metrics.children)).toBeLessThanOrEqual(CONTAINER_MAX);
  expect(metrics.components).toBeLessThanOrEqual(MESSAGE_COMPONENTS_MAX);
  expect(metrics.rows).toBeLessThanOrEqual(ROWS_PER_MESSAGE_MAX);
  expect(metrics.textTotal).toBeLessThanOrEqual(MESSAGE_TEXT_MAX);

  // Uma Section aceita de 1 a 3 TextDisplay; fora disso e 400.
  for (const count of metrics.sectionTexts) {
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
  }
  // Select vazio tambem e 400 — por isso o minimo, e nao so o maximo.
  for (const count of metrics.selectOptions) {
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(SELECT_OPTIONS_MAX);
  }
  expect(metrics.longestOptionLabel).toBeLessThanOrEqual(SELECT_LABEL_MAX);
  for (const id of metrics.customIds) expect(id.length).toBeLessThanOrEqual(CUSTOM_ID_MAX);
  // custom_id repetido na mesma mensagem tambem e recusado.
  expect(new Set(metrics.customIds).size).toBe(metrics.customIds.length);
}

const SUBJECT_MAX = 'S'.repeat(200);
const CATEGORY_MAX = 'C'.repeat(60);
const PARTICIPANTS_MAX = Array.from({ length: 20 }, (_, index) =>
  String(100000000000000000 + index),
);

describe('painel interno no pior caso', () => {
  for (const status of Object.values(TicketStatus)) {
    it(`cabe nos limites com status ${status}, textos no teto e 20 participantes`, () => {
      // Sem logo o cabecalho gasta DOIS TextDisplay em vez de uma Section:
      // este, com banner, e o arranjo mais caro do painel.
      const metrics = measureMessage([
        buildInternalPanel({
          ticket: makeTicket({ status, subject: SUBJECT_MAX, claimedById: STAFF }),
          categoryName: CATEGORY_MAX,
          queuePosition: 99999,
          participantIds: PARTICIPANTS_MAX,
          thumbnailUrl: null,
          bannerUrl: BANNER,
          storeName: 'Vook Store',
        }),
      ]);

      expectMessageWithinLimits(metrics);
      expect(metrics.children).toEqual([8]);
    });
  }

  it('nao passa de 8 filhos em nenhuma combinacao de logo, banner e participantes', () => {
    const medidos: number[] = [];
    for (const logo of [null, LOGO]) {
      for (const banner of [null, BANNER]) {
        for (const participantIds of [[], PARTICIPANTS_MAX]) {
          const metrics = measureMessage([
            buildInternalPanel({
              ticket: makeTicket({ subject: SUBJECT_MAX }),
              categoryName: CATEGORY_MAX,
              queuePosition: 99999,
              participantIds,
              thumbnailUrl: logo,
              bannerUrl: banner,
              storeName: 'Vook Store',
            }),
          ]);
          expectMessageWithinLimits(metrics);
          medidos.push(metrics.children[0] ?? 0);
        }
      }
    }
    expect(Math.max(...medidos)).toBe(8);
  });
});

describe('painel administrativo no pior caso', () => {
  const nomesLongos = Array.from({ length: SELECT_OPTIONS_MAX }, (_, index) => ({
    id: String(100000000000000000 + index),
    label: `Participante ${'N'.repeat(200)} ${index}`,
  }));

  function adminNoPiorCaso(thumbnailUrl: string | null): ContainerBuilder[] {
    const alvo = makeTicket({ subject: SUBJECT_MAX });
    return buildAdminPanel({
      ticket: alvo,
      categoryName: CATEGORY_MAX,
      actorId: STAFF,
      addMemberSelect: buildAddMemberSelect(alvo.id),
      transferSelect: buildTransferSelect(alvo.id),
      removeMemberSelect: buildRemoveMemberSelect(alvo.id, nomesLongos),
      thumbnailUrl,
      storeName: 'Vook Store',
    });
  }

  it('cabe nos limites com 25 participantes de nome longo e logo', () => {
    const metrics = measureMessage(adminNoPiorCaso(LOGO));
    expectMessageWithinLimits(metrics);
    expect(metrics.children).toEqual([8, 3]);
  });

  it('cabe nos limites sem logo, o arranjo mais caro do container de membros', () => {
    const metrics = measureMessage(adminNoPiorCaso(null));
    expectMessageWithinLimits(metrics);
    // 9 de 10: sobra UM componente. Uma acao nova exige um terceiro container,
    // nao mais uma linha no de membros.
    expect(metrics.children).toEqual([9, 3]);
  });

  it('trunca o nome do participante no teto de label do select', () => {
    const metrics = measureMessage(adminNoPiorCaso(LOGO));
    expect(metrics.longestOptionLabel).toBe(SELECT_LABEL_MAX);
    expect(metrics.selectOptions).toEqual([SELECT_OPTIONS_MAX]);
  });
});

describe('customId com id real de ticket', () => {
  it('cabe em 100 chars usando o cuid de 25 caracteres do banco', () => {
    const cuid = 'cmg7x2k9p0001abcd1234efgh';
    expect(cuid).toHaveLength(25);

    const ids = Object.values(TICKET_ACTION).map((action) =>
      buildCustomId(NAMESPACE.TICKET, action, cuid),
    );
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(CUSTOM_ID_MAX);
    // Maior hoje: `ticket:transfer-select:<cuid>` = 48. Folga de 52 chars.
    expect(Math.max(...ids.map((id) => id.length))).toBe(48);
  });
});
