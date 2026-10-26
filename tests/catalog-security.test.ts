import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/**
 * Cargos de equipe vem do banco em producao. Aqui o servidor de teste nao tem
 * banco: o dublê devolve "nenhum cargo de equipe", que e exatamente o cenario
 * que interessa — provar que um membro sem cargo nao opera pedidos.
 */
vi.mock('../src/modules/tickets/services/TicketConfigService', () => ({
  getGuildTeamRoleIds: () => Promise.resolve([]),
  getTeamRoleIds: () => Promise.resolve([]),
}));
import {
  ComponentType,
  PermissionFlagsBits,
  type ContainerBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import type { CatalogCategory, CatalogPack, Order, OrderItem, Payment } from '@prisma/client';

import { PermissionError } from '../src/core/errors';
import {
  assertCanManageCatalog,
  assertCanManageCatalogCategories,
  canApplyOrderCoupon,
  canCancelOrder,
  canManageCatalog,
  canManageOrders,
} from '../src/core/permissions/PermissionService';
import {
  isCategoryPickKind,
  isImagePickKind,
  isPackPickKind,
} from '../src/modules/catalog/types/catalog';
import { requireArg, parseCustomId } from '../src/constants/customIds';
import {
  buildCatalogHome,
  buildPackCard,
  buildPackDetails,
} from '../src/modules/catalog/builders/CatalogBuilders';
import { buildCartView, buildCheckoutConfirm } from '../src/modules/catalog/builders/CartBuilders';
import {
  buildNewOrderNotice,
  buildOrderCustomerView,
  buildOrderStaffView,
} from '../src/modules/catalog/builders/OrderBuilders';
import { parsePackName } from '../src/modules/catalog/validators/packValidators';
import { ZERO_WIDTH_SPACE } from '../src/utils/sanitize';

/**
 * Seguranca e politica comercial do catalogo.
 *
 * Duas regras da Vook Store que estes testes travam:
 *
 *  1. O CLIENTE NUNCA APLICA CUPOM. Nenhuma tela publica pode ter campo,
 *     botao ou menu de desconto — cupom e ferramenta interna da equipe.
 *  2. NENHUM COMPONENTE AUTORIZA. customId e apenas um ponteiro: permissao e
 *     posse sao revalidadas no servidor a cada acao.
 *
 * Somado a isso, dado sensivel (chave PIX, payload da cobranca) nunca pode
 * vazar para painel publico ou canal de pedidos.
 */

const GUILD_ID = '111111111111111111';
const CUSTOMER_ID = '222222222222222222';
const STAFF_ID = '333333333333333333';
const CATEGORY_ID = 'ckcategoria000000000000';
const PACK_ID = 'ckpack00000000000000001';
const ORDER_ID = 'ckorder00000000000000001';

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

function makeCategory(overrides: Partial<CatalogCategory> = {}): CatalogCategory {
  return {
    id: CATEGORY_ID,
    guildId: GUILD_ID,
    name: 'Veiculos',
    identifier: 'veiculos',
    description: null,
    emoji: null,
    position: 0,
    enabled: true,
  boosterEligible: true,
  leadTimeDays: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makePack(overrides: Partial<CatalogPack> = {}): CatalogPack {
  return {
    id: PACK_ID,
    guildId: GUILD_ID,
    categoryId: CATEGORY_ID,
    name: 'Vook Vehicles Collection',
    slug: 'vook-vehicles',
    sku: 'VEH-001',
    shortDescription: 'Pack premium.',
    description: 'Descricao completa.',
    price: 14990,
    position: 0,
    enabled: true,
    featured: false,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeItem(): OrderItem {
  return {
    id: 'ckitem0000000000000001',
    orderId: ORDER_ID,
    packId: PACK_ID,
    skuSnapshot: 'VEH-001',
    nameSnapshot: 'Vook Vehicles Collection',
    priceSnapshot: 14990,
    quantity: 1,
    createdAt: new Date(),
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'ckpayment000000000000001',
    guildId: GUILD_ID,
    customerId: CUSTOMER_ID,
    createdById: STAFF_ID,
    accountId: 'ckaccount00000000000001',
    description: 'Pedido #VK-000184',
    originalAmount: 14990,
    discountAmount: 0,
    finalAmount: 14990,
    couponId: null,
    couponCodeSnapshot: null,
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    // Dados que NUNCA podem sair do cartao oficial da cobranca.
    pixPayload: '00020126360014BR.GOV.BCB.PIX0114CHAVE-SECRETA',
    sourceType: 'CATALOG_ORDER',
    sourceId: ORDER_ID,
    status: PaymentStatus.PENDING,
    expiresAt: new Date(Date.now() + 60_000),
    channelId: null,
    messageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: null,
    approvedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    ...overrides,
  } as Payment;
}

function makeOrder(
  overrides: Partial<Order> = {},
  payment: Payment | null = null,
): Order & { items: OrderItem[]; payment: Payment | null } {
  return {
    id: ORDER_ID,
    guildId: GUILD_ID,
    orderNumber: 184,
    dueAt: null,
    customerId: CUSTOMER_ID,
    status: OrderStatus.PENDING,
    subtotalAmount: 14990,
    discountAmount: 0,
    finalAmount: 14990,
    couponId: null,
    couponCodeSnapshot: null,
    couponTypeSnapshot: null,
    couponValueSnapshot: null,
    paymentId: payment?.id ?? null,
    channelId: null,
    panelChannelId: null,
    panelMessageId: null,
    demandChannelId: null,
    demandMessageId: null,
    demandStartedChannelId: null,
    demandStartedMessageId: null,
    demandDoneChannelId: null,
    demandDoneMessageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    deliveredAt: null,
    deliveredById: null,
    completedAt: null,
    completedById: null,
    assignedToId: null,
    assignedAt: null,
    ...overrides,
    items: [makeItem()],
    payment,
  };
}

function makeMember(options: { admin?: boolean; manageGuild?: boolean } = {}): GuildMember {
  const guild = { id: GUILD_ID, ownerId: '000000000000000000' } as unknown as Guild;
  return {
    id: STAFF_ID,
    permissions: {
      has: (flag: bigint) =>
        (flag === PermissionFlagsBits.Administrator && options.admin === true) ||
        (flag === PermissionFlagsBits.ManageGuild && options.manageGuild === true),
    },
    roles: { cache: { has: () => false } },
    get guild() {
      return guild;
    },
  } as unknown as GuildMember;
}

// ---------------------------------------------------------------------------
// Leitura de componentes
// ---------------------------------------------------------------------------

interface JsonNode {
  type: ComponentType;
  content?: string;
  components?: JsonNode[];
  accessory?: JsonNode;
  custom_id?: string;
  options?: Array<{ label: string; description?: string; value: string }>;
}

function walkAll(root: ContainerBuilder): JsonNode[] {
  const json = root.toJSON() as unknown as JsonNode;
  const found: JsonNode[] = [];
  const walk = (node: JsonNode): void => {
    found.push(node);
    for (const child of node.components ?? []) walk(child);
    if (node.accessory !== undefined) walk(node.accessory);
  };
  for (const child of json.components ?? []) walk(child);
  return found;
}

function allText(root: ContainerBuilder): string {
  return walkAll(root)
    .filter((node) => node.type === ComponentType.TextDisplay)
    .map((node) => node.content ?? '')
    .join('\n');
}

function allCustomIds(root: ContainerBuilder): string[] {
  return walkAll(root)
    .map((node) => node.custom_id ?? '')
    .filter((id) => id.length > 0);
}

const CART_VIEW = {
  cart: { id: 'ckcart' } as never,
  lines: [
    {
      item: { id: 'ckitem1', packId: PACK_ID } as never,
      pack: makePack(),
      unavailable: false,
      reason: null,
    },
  ],
  subtotal: 14990,
  sellableCount: 1,
};

// ---------------------------------------------------------------------------
// 1. O cliente nunca aplica cupom
// ---------------------------------------------------------------------------

describe('cupom e ferramenta interna: o cliente nunca escolhe desconto', () => {
  const telasDoCliente: Array<[string, () => ContainerBuilder]> = [
    [
      'home do catalogo',
      () =>
        buildCatalogHome({
          storeName: 'Vook Store',
          description: 'Explore.',
          categories: [{ category: makeCategory(), count: 3 }],
          featured: [makePack()],
          totalPacks: 3,
        }),
    ],
    [
      'card do pack',
      () =>
        buildPackCard({
          view: { pack: makePack(), category: makeCategory(), images: [], details: [] },
          imageIndex: 0,
        }),
    ],
    [
      'mais informacoes',
      () =>
        buildPackDetails({
          pack: makePack(),
          category: makeCategory(),
          images: [],
          details: [],
        }),
    ],
    ['carrinho', () => buildCartView(CART_VIEW)],
    ['confirmacao de compra', () => buildCheckoutConfirm(CART_VIEW)],
    ['pedido do cliente', () => buildOrderCustomerView(makeOrder())],
  ];

  it.each(telasDoCliente)('%s nao pede cupom ao cliente', (_nome, build) => {
    const root = build();
    const texto = allText(root).toLowerCase();

    for (const proibido of [
      'digite seu cupom',
      'tem cupom',
      'aplicar desconto',
      'codigo de desconto',
      'inserir cupom',
    ]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it.each(telasDoCliente)('%s nao expoe nenhuma rota de cupom', (_nome, build) => {
    for (const id of allCustomIds(build())) {
      expect(id).not.toContain('coupon');
      expect(id).not.toContain('cupom');
    }
  });

  it('o painel da EQUIPE, sim, tem a acao de cupom', () => {
    const ids = allCustomIds(buildOrderStaffView(makeOrder())).join(' ');
    expect(ids).toContain('coupon');
  });

  it('pedido do cliente mostra o desconto ja aplicado, mas nao deixa mexer', () => {
    const order = makeOrder({
      couponCodeSnapshot: 'VOOK20',
      discountAmount: 2998,
      finalAmount: 11992,
    });
    const root = buildOrderCustomerView(order);

    // Transparencia: o cliente ve o desconto que a equipe concedeu...
    expect(allText(root)).toContain('VOOK20');
    // ...mas nao existe rota para ele alterar isso.
    expect(allCustomIds(root).join(' ')).not.toContain('coupon');
  });
});

// ---------------------------------------------------------------------------
// 2. Dados sensiveis
// ---------------------------------------------------------------------------

describe('privacidade: nada de PIX em painel que nao seja o da cobranca', () => {
  it('o aviso de novo pedido nao carrega payload nem chave PIX', () => {
    const payment = makePayment();
    const texto = allText(buildNewOrderNotice(makeOrder({}, payment)));

    expect(texto).not.toContain(payment.pixPayload);
    expect(texto).not.toContain('CHAVE-SECRETA');
    expect(texto).not.toContain('00020126');
  });

  it('o painel da equipe mostra o ESTADO da cobranca, nunca o payload', () => {
    const payment = makePayment();
    const texto = allText(buildOrderStaffView(makeOrder({}, payment)));

    expect(texto).not.toContain(payment.pixPayload);
    expect(texto).toContain('Pendente');
  });

  /**
   * O DONO do pedido, sim, precisa do payload — e para ele que o PIX existe.
   *
   * A tela do cliente e efemera e o pedido ja foi conferido como dele
   * (`requireCustomerOrder`), entao este e o lugar MAIS seguro para o copia e
   * cola aparecer: melhor que um cartao publicado num canal, onde todo mundo
   * do canal enxerga.
   */
  it('o dono do pedido VE o copia e cola enquanto a cobranca esta pendente', () => {
    const payment = makePayment({ status: PaymentStatus.PENDING });
    const texto = allText(buildOrderCustomerView(makeOrder({}, payment)));

    expect(texto).toContain(payment.pixPayload);
    expect(texto).toContain('Copia e Cola');
  });

  it('cobranca ja resolvida para de mostrar o payload ao cliente', () => {
    for (const status of [
      PaymentStatus.APPROVED,
      PaymentStatus.EXPIRED,
      PaymentStatus.CANCELLED,
    ]) {
      const payment = makePayment({ status });
      const texto = allText(buildOrderCustomerView(makeOrder({}, payment)));
      expect(texto).not.toContain(payment.pixPayload);
    }
  });

});

describe('conteudo de produto nao vira ataque', () => {
  it('nome com mencao em massa e neutralizado antes de renderizar', () => {
    // O nome ja chega sanitizado do validador; o card apenas o exibe. Este
    // teste garante que o caminho inteiro (validador -> builder) mantem a
    // mencao quebrada.
    const nome = parsePackName('Pack @everyone gratis');
    const root = buildPackCard({
      view: { pack: makePack({ name: nome }), category: makeCategory(), images: [], details: [] },
      imageIndex: 0,
    });

    const texto = allText(root);
    expect(texto).not.toContain('@everyone');
    expect(texto).toContain(ZERO_WIDTH_SPACE);
  });
});

// ---------------------------------------------------------------------------
// 3. Permissoes
// ---------------------------------------------------------------------------

describe('permissoes do catalogo', () => {
  it('membro comum NAO gerencia o catalogo', () => {
    const membro = makeMember();

    expect(canManageCatalog(membro)).toBe(false);
    expect(() => assertCanManageCatalog(membro)).toThrow(PermissionError);
    expect(() => assertCanManageCatalogCategories(membro)).toThrow(PermissionError);
  });

  it('administrador e Manage Guild gerenciam o catalogo', () => {
    expect(canManageCatalog(makeMember({ admin: true }))).toBe(true);
    expect(canManageCatalog(makeMember({ manageGuild: true }))).toBe(true);
    expect(() => assertCanManageCatalog(makeMember({ admin: true }))).not.toThrow();
  });

  it('pedidos e cupom de pedido exigem equipe (nao sao acoes de cliente)', async () => {
    const membro = makeMember();

    expect(await canManageOrders(membro)).toBe(false);
    expect(await canApplyOrderCoupon(membro)).toBe(false);
    expect(await canCancelOrder(membro)).toBe(false);
  });

  it('administrador tambem opera pedidos', async () => {
    const admin = makeMember({ admin: true });

    expect(await canManageOrders(admin)).toBe(true);
    expect(await canApplyOrderCoupon(admin)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. customId adulterado
// ---------------------------------------------------------------------------

describe('customId adulterado', () => {
  it('acao de pack desconhecida e recusada', () => {
    expect(isPackPickKind('edit')).toBe(true);
    expect(isPackPickKind('delete')).toBe(true);
    expect(isPackPickKind('DROP TABLE')).toBe(false);
    expect(isPackPickKind('__proto__')).toBe(false);
    expect(isPackPickKind('')).toBe(false);
  });

  it('acao de imagem desconhecida e recusada', () => {
    expect(isImagePickKind('cover')).toBe(true);
    expect(isImagePickKind('hack')).toBe(false);
  });

  it('acao de categoria desconhecida e recusada', () => {
    expect(isCategoryPickKind('toggle')).toBe(true);
    expect(isCategoryPickKind('sudo')).toBe(false);
  });

  it('argumento obrigatorio ausente vira erro tratado, nao crash', () => {
    const parsed = parseCustomId('catalog:pack');
    expect(parsed).not.toBeNull();
    if (parsed === null) return;

    expect(() => requireArg(parsed, 0, 'pack')).toThrow();
  });

  it('customId com separador extra nao confunde o parser', () => {
    const parsed = parseCustomId('order:staff:ckorder1:extra');
    expect(parsed?.namespace).toBe('order');
    expect(parsed?.action).toBe('staff');
    expect(parsed?.args).toEqual(['ckorder1', 'extra']);
  });
});

// ---------------------------------------------------------------------------
// 5. Varredura estrutural
// ---------------------------------------------------------------------------

const SRC = resolve(__dirname, '..', 'src');

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = listFiles(SRC).map((path) => ({
  relative: path.slice(SRC.length + 1).split(sep).join('/'),
  source: readFileSync(path, 'utf8'),
}));

describe('estrutura: cliente e equipe ficam separados', () => {
  it('o fluxo do cliente nao importa o servico de cupons', () => {
    const clientes = FILES.filter(
      (file) =>
        file.relative === 'interactions/catalog/customer.ts' ||
        file.relative.startsWith('interactions/cart/') ||
        file.relative === 'modules/catalog/builders/CartBuilders.ts',
    );

    expect(clientes.length).toBeGreaterThan(0);
    for (const file of clientes) {
      expect(file.source).not.toContain('coupons/services/CouponService');
    }
  });

  it('toda acao administrativa do catalogo revalida a permissao', () => {
    const admin = FILES.find((file) => file.relative === 'interactions/catalog/admin.ts');
    expect(admin).toBeDefined();

    const handlers = (admin?.source.match(/async handle\(/g) ?? []).length;
    const asserts = (admin?.source.match(/assertCanManageCatalog/g) ?? []).length;

    // Cada handler chama um assert de permissao (categorias usam a variante
    // `assertCanManageCatalogCategories`, que casa com o mesmo prefixo).
    expect(handlers).toBeGreaterThan(0);
    expect(asserts).toBeGreaterThanOrEqual(handlers);
  });

  it('toda acao de equipe sobre pedidos revalida a permissao', () => {
    const orders = FILES.find((file) => file.relative === 'interactions/orders/index.ts');
    expect(orders).toBeDefined();

    const asserts = (orders?.source.match(/assertCan(ManageOrders|ApplyOrderCoupon|CreateOrderPayment|CancelOrder|MarkOrderDelivered)/g) ?? [])
      .length;

    expect(asserts).toBeGreaterThanOrEqual(10);
  });

  it('o acesso do cliente ao pedido passa pela checagem de dono', () => {
    const orders = FILES.find((file) => file.relative === 'interactions/orders/index.ts');
    expect(orders?.source).toContain('requireCustomerOrder');
  });

  it('nenhum handler do catalogo confia no customId como autorizacao', () => {
    const alvo = FILES.filter(
      (file) =>
        file.relative.startsWith('interactions/catalog/') ||
        file.relative.startsWith('interactions/cart/') ||
        file.relative.startsWith('interactions/orders/'),
    );

    for (const file of alvo) {
      // Nenhum comentario/codigo pode sugerir "veio do painel, entao pode".
      expect(file.source).not.toMatch(/skipPermission|trustCustomId|semChecagem/);
    }
  });
});
