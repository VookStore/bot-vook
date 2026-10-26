import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIComponentInMessageActionRow,
  APIStringSelectComponent,
  ContainerBuilder,
} from 'discord.js';
import { PixKeyType } from '@prisma/client';
import type {
  CatalogCategory,
  CatalogPack,
  CatalogPackDetail,
  PackImage,
} from '@prisma/client';

import {
  buildCatalogHome,
  buildCatalogList,
  buildPackCard,
  buildPackDetails,
  normalizeImageIndex,
} from '../src/modules/catalog/builders/CatalogBuilders';
import {
  buildCartClearConfirm,
  buildCartRemovePanel,
  buildCartView,
  buildCheckoutConfirm,
} from '../src/modules/catalog/builders/CartBuilders';
import {
  buildNewOrderNotice,
  buildOrderAdminPanel,
  buildOrderChargeClosedDm,
  buildOrderChargeDm,
  buildOrderCustomerLookup,
  buildOrderCustomerPicker,
  buildOrderCustomerView,
  buildOrderListView,
  buildOrderStaffView,
} from '../src/modules/catalog/builders/OrderBuilders';
import { CATALOG_ACTION, MAX_CUSTOM_ID_LENGTH, NAMESPACE } from '../src/constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../src/constants/limits';

/**
 * Vitrine do catalogo: partes PURAS (builders e navegacao da galeria).
 *
 * O que estes testes protegem:
 *  - a galeria navega em CIRCULO e sempre informa "Imagem X de Y";
 *  - o card cabe nos limites REAIS do Discord (10 filhos, 4000 caracteres);
 *  - pack sem imagem, sem preco ou desativado nao quebra o painel;
 *  - o cliente NUNCA ve campo de cupom.
 */

const GUILD_ID = '111111111111111111';
const CATEGORY_ID = 'ckcategoria0000000000000';
const PACK_ID = 'ckpack00000000000000000';

function makeCategory(overrides: Partial<CatalogCategory> = {}): CatalogCategory {
  return {
    id: CATEGORY_ID,
    guildId: GUILD_ID,
    name: 'Veiculos',
    identifier: 'veiculos',
    description: 'Veiculos exclusivos para FiveM',
    emoji: '🚗',
    position: 0,
    enabled: true,
  boosterEligible: true,
  leadTimeDays: null,
    createdById: null,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
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
    slug: 'vook-vehicles-collection',
    sku: 'VEH-001',
    shortDescription: 'Pack completo de veiculos premium para FiveM.',
    description: 'Inclui 15 veiculos, texturas otimizadas e atualizacoes.',
    price: 14990,
    position: 0,
    enabled: true,
    featured: true,
    createdById: null,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeImages(total: number): PackImage[] {
  return Array.from({ length: total }, (_unused, index) => ({
    id: `ckimg${String(index).padStart(20, '0')}`,
    packId: PACK_ID,
    url: `https://cdn.exemplo.com/pack-${index}.png`,
    altText: `Imagem ${index + 1}`,
    position: index,
    isCover: index === 0,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  }));
}

function makeDetails(total: number): CatalogPackDetail[] {
  return Array.from({ length: total }, (_unused, index) => ({
    id: `ckdet${String(index).padStart(20, '0')}`,
    packId: PACK_ID,
    label: `Campo ${index + 1}`,
    value: `Valor ${index + 1}`,
    position: index,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  }));
}

// ---------------------------------------------------------------------------
// Leitura do JSON dos componentes
// ---------------------------------------------------------------------------

interface JsonNode {
  type: ComponentType;
  content?: string;
  components?: JsonNode[];
  accessory?: JsonNode;
}

function measure(root: ContainerBuilder): { children: number; textTotal: number } {
  const json = root.toJSON() as unknown as JsonNode;
  const children = json.components ?? [];
  let textTotal = 0;

  const walk = (node: JsonNode): void => {
    if (node.type === ComponentType.TextDisplay && typeof node.content === 'string') {
      textTotal += node.content.length;
    }
    for (const child of node.components ?? []) walk(child);
    if (node.accessory !== undefined) walk(node.accessory);
  };
  for (const child of children) walk(child);

  return { children: children.length, textTotal };
}

function expectWithinDiscordLimits(root: ContainerBuilder): void {
  const { children, textTotal } = measure(root);
  expect(children).toBeLessThanOrEqual(10);
  expect(textTotal).toBeLessThanOrEqual(DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL);
}

function allText(root: ContainerBuilder): string {
  const json = root.toJSON() as unknown as JsonNode;
  const parts: string[] = [];
  const walk = (node: JsonNode): void => {
    if (node.type === ComponentType.TextDisplay && typeof node.content === 'string') {
      parts.push(node.content);
    }
    for (const child of node.components ?? []) walk(child);
    if (node.accessory !== undefined) walk(node.accessory);
  };
  for (const child of json.components ?? []) walk(child);
  return parts.join('\n');
}

function buttons(root: ContainerBuilder): APIButtonComponent[] {
  return root
    .toJSON()
    .components.filter(
      (component): component is APIActionRowComponent<APIComponentInMessageActionRow> =>
        component.type === ComponentType.ActionRow,
    )
    .flatMap((row) => row.components)
    .filter((component): component is APIButtonComponent => component.type === ComponentType.Button);
}

function selects(root: ContainerBuilder): APIStringSelectComponent[] {
  return root
    .toJSON()
    .components.filter(
      (component): component is APIActionRowComponent<APIComponentInMessageActionRow> =>
        component.type === ComponentType.ActionRow,
    )
    .flatMap((row) => row.components)
    .filter(
      (component): component is APIStringSelectComponent =>
        component.type === ComponentType.StringSelect,
    );
}

function customIds(root: ContainerBuilder): string[] {
  return [
    ...buttons(root)
      .map((button) => ('custom_id' in button ? button.custom_id : ''))
      .filter((id) => id.length > 0),
    ...selects(root).map((select) => select.custom_id),
  ];
}

function galleryUrls(root: ContainerBuilder): string[] {
  const json = root.toJSON() as unknown as {
    components?: Array<{ type: ComponentType; items?: Array<{ media?: { url?: string } }> }>;
  };
  return (json.components ?? [])
    .filter((component) => component.type === ComponentType.MediaGallery)
    .flatMap((component) => component.items ?? [])
    .map((item) => item.media?.url ?? '');
}

// ---------------------------------------------------------------------------
// Navegacao da galeria
// ---------------------------------------------------------------------------

describe('normalizeImageIndex: navegacao circular', () => {
  it('avanca dentro da lista', () => {
    expect(normalizeImageIndex(0, 7)).toBe(0);
    expect(normalizeImageIndex(3, 7)).toBe(3);
    expect(normalizeImageIndex(6, 7)).toBe(6);
  });

  it('da ultima imagem, "proxima" volta para a primeira', () => {
    expect(normalizeImageIndex(7, 7)).toBe(0);
    expect(normalizeImageIndex(8, 7)).toBe(1);
  });

  it('da primeira imagem, "anterior" leva a ultima', () => {
    expect(normalizeImageIndex(-1, 7)).toBe(6);
    expect(normalizeImageIndex(-8, 7)).toBe(6);
  });

  it('pack sem imagem nunca produz indice invalido', () => {
    expect(normalizeImageIndex(5, 0)).toBe(0);
    expect(normalizeImageIndex(-3, 0)).toBe(0);
  });

  it('indice corrompido no customId nao quebra a conta', () => {
    expect(normalizeImageIndex(Number.NaN, 4)).toBe(0);
    expect(normalizeImageIndex(Number.POSITIVE_INFINITY, 4)).toBe(0);
  });
});

describe('card do pack: galeria', () => {
  const view = (images: PackImage[], pack = makePack()) => ({
    pack,
    category: makeCategory(),
    images,
    details: makeDetails(3),
  });

  it('mostra UMA imagem por vez e informa a posicao', () => {
    const card = buildPackCard({ view: view(makeImages(7)), imageIndex: 1 });

    expect(galleryUrls(card)).toEqual(['https://cdn.exemplo.com/pack-1.png']);
    expect(allText(card)).toContain('Imagem 2 de 7');
  });

  it('emite os botoes de navegacao carregando o indice ATUAL', () => {
    const card = buildPackCard({ view: view(makeImages(7)), imageIndex: 2 });
    const ids = customIds(card);

    expect(ids).toContain(`${NAMESPACE.CATALOG}:${CATALOG_ACTION.IMAGE_PREV}:${PACK_ID}:2`);
    expect(ids).toContain(`${NAMESPACE.CATALOG}:${CATALOG_ACTION.IMAGE_NEXT}:${PACK_ID}:2`);
  });

  it('com uma unica imagem, a navegacao nao aparece', () => {
    const card = buildPackCard({ view: view(makeImages(1)), imageIndex: 0 });
    const ids = customIds(card).join(' ');

    expect(ids).not.toContain(CATALOG_ACTION.IMAGE_PREV);
    expect(ids).not.toContain(CATALOG_ACTION.IMAGE_NEXT);
    expect(allText(card)).toContain('Imagem 1 de 1');
  });

  it('pack sem imagem mostra aviso em vez de quebrar o painel', () => {
    const card = buildPackCard({ view: view([]), imageIndex: 0 });

    expect(galleryUrls(card)).toEqual([]);
    expect(allText(card)).toContain('Nenhuma imagem cadastrada');
    expectWithinDiscordLimits(card);
  });

  it('o indice sobrevive a um customId adulterado (normaliza em vez de estourar)', () => {
    const card = buildPackCard({ view: view(makeImages(3)), imageIndex: 99 });
    expect(allText(card)).toContain('Imagem 1 de 3');
  });
});

describe('card do pack: limites e regras comerciais', () => {
  const fullView = {
    pack: makePack({
      name: 'N'.repeat(BUSINESS_LIMITS.PACK_NAME_MAX),
      shortDescription: 'S'.repeat(BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX),
      description: 'D'.repeat(BUSINESS_LIMITS.PACK_DESCRIPTION_MAX),
    }),
    category: makeCategory(),
    images: makeImages(BUSINESS_LIMITS.MAX_IMAGES_PER_PACK),
    details: makeDetails(BUSINESS_LIMITS.MAX_DETAILS_PER_PACK),
  };

  it('o pior caso cabe nos limites do Discord', () => {
    expectWithinDiscordLimits(buildPackCard({ view: fullView, imageIndex: 0 }));
    expectWithinDiscordLimits(
      buildPackCard({ view: fullView, imageIndex: 0, notice: 'A'.repeat(200), inCart: true }),
    );
    expectWithinDiscordLimits(buildPackDetails(fullView));
  });

  it('preco invalido bloqueia a compra em vez de vender por zero', () => {
    const card = buildPackCard({
      view: { ...fullView, pack: makePack({ price: 0 }) },
      imageIndex: 0,
    });

    expect(allText(card)).toContain('Indisponivel');

    const addToCart = buttons(card).find(
      (button) => 'custom_id' in button && button.custom_id.includes(CATALOG_ACTION.CART_ADD),
    );
    const buyNow = buttons(card).find(
      (button) => 'custom_id' in button && button.custom_id.includes(CATALOG_ACTION.BUY),
    );

    expect(addToCart?.disabled).toBe(true);
    expect(buyNow?.disabled).toBe(true);
  });

  it('pack ja no carrinho nao pode ser adicionado de novo', () => {
    const card = buildPackCard({ view: fullView, imageIndex: 0, inCart: true });
    const addToCart = buttons(card).find(
      (button) => 'custom_id' in button && button.custom_id.includes(CATALOG_ACTION.CART_ADD),
    );

    expect(addToCart?.disabled).toBe(true);
  });

  it('todos os botoes seguem a politica visual (cinza) e cabem no customId', () => {
    const card = buildPackCard({ view: fullView, imageIndex: 3 });

    for (const button of buttons(card)) {
      expect(button.style).toBe(ButtonStyle.Secondary);
    }
    for (const id of customIds(card)) {
      expect(id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
    }
  });

  it('o cliente NUNCA ve campo de cupom no card', () => {
    const card = buildPackCard({ view: fullView, imageIndex: 0 });
    const texto = allText(card).toLowerCase();

    expect(texto).not.toContain('cupom');
    expect(texto).not.toContain('desconto');
    expect(customIds(card).join(' ')).not.toContain('coupon');
  });
});

// ---------------------------------------------------------------------------
// Home e listagem
// ---------------------------------------------------------------------------

describe('home do catalogo', () => {
  const categories = [
    { category: makeCategory(), count: 12 },
    { category: makeCategory({ id: 'ckcat2', name: 'Roupas', emoji: '👕' }), count: 8 },
  ];

  it('lista categorias e o destaque, dentro dos limites', () => {
    const home = buildCatalogHome({
      storeName: 'Vook Store',
      description: 'Explore os packs disponiveis.',
      categories,
      featured: [makePack()],
      totalPacks: 24,
    });

    expect(allText(home)).toContain('DESTAQUE');
    expect(allText(home)).toContain('24');
    expectWithinDiscordLimits(home);
  });

  it('catalogo vazio nao quebra e nem oferece selecao inexistente', () => {
    const home = buildCatalogHome({
      storeName: 'Vook Store',
      description: 'Explore os packs disponiveis.',
      categories: [],
      featured: [],
      totalPacks: 0,
    });

    expect(allText(home)).toContain('Nenhum pack disponivel');
    expect(selects(home)).toHaveLength(0);
    expectWithinDiscordLimits(home);
  });

  it('o seletor de categorias respeita o limite de 25 opcoes', () => {
    const many = Array.from({ length: 40 }, (_unused, index) => ({
      category: makeCategory({ id: `ckcat${index}`, name: `Categoria ${index}` }),
      count: index,
    }));

    const home = buildCatalogHome({
      storeName: 'Vook Store',
      description: 'Explore.',
      categories: many,
      featured: [],
      totalPacks: 100,
    });

    const menu = selects(home)[0];
    expect(menu).toBeDefined();
    expect(menu?.options.length).toBeLessThanOrEqual(DISCORD_LIMITS.SELECT_OPTIONS);
  });

  it('a home nao expoe nenhum campo de cupom', () => {
    const home = buildCatalogHome({
      storeName: 'Vook Store',
      description: 'Explore.',
      categories,
      featured: [makePack()],
      totalPacks: 24,
    });

    expect(allText(home).toLowerCase()).not.toContain('cupom');
  });
});

describe('listagem por categoria', () => {
  const packs = Array.from({ length: 20 }, (_unused, index) =>
    makePack({
      id: `ckpack${String(index).padStart(18, '0')}`,
      name: `Pack ${index}`,
      description: 'D'.repeat(BUSINESS_LIMITS.PACK_DESCRIPTION_MAX),
      shortDescription: 'S'.repeat(BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX),
    }),
  );

  it('uma pagina cheia cabe nos limites do Discord', () => {
    expectWithinDiscordLimits(
      buildCatalogList({
        categories: [{ category: makeCategory(), count: 20 }],
        category: makeCategory(),
        packs,
        page: 1,
        totalPages: 4,
        total: 74,
      }),
    );
  });

  it('a paginacao e circular nos dois sentidos', () => {
    const list = buildCatalogList({
      categories: [{ category: makeCategory(), count: 20 }],
      category: makeCategory(),
      packs,
      page: 1,
      totalPages: 4,
      total: 74,
    });

    const ids = customIds(list);
    // Da pagina 1, "anterior" vai para a ultima (4) e "proxima" para a 2.
    expect(ids).toContain(
      `${NAMESPACE.CATALOG}:${CATALOG_ACTION.CATEGORY_PAGE}:${CATEGORY_ID}:4`,
    );
    expect(ids).toContain(
      `${NAMESPACE.CATALOG}:${CATALOG_ACTION.CATEGORY_PAGE}:${CATEGORY_ID}:2`,
    );
  });

  it('pagina unica nao mostra navegacao', () => {
    const list = buildCatalogList({
      categories: [{ category: makeCategory(), count: 1 }],
      category: makeCategory(),
      packs: [makePack()],
      page: 1,
      totalPages: 1,
      total: 1,
    });

    expect(customIds(list).join(' ')).not.toContain(CATALOG_ACTION.CATEGORY_PAGE);
  });

  it('busca sem resultado explica em vez de mostrar lista vazia', () => {
    const list = buildCatalogList({
      categories: [],
      category: null,
      packs: [],
      page: 1,
      totalPages: 1,
      total: 0,
      searchTerm: 'inexistente',
    });

    expect(allText(list)).toContain('Nenhum pack encontrado');
    expectWithinDiscordLimits(list);
  });

  it('o select de packs respeita o limite de 25 opcoes', () => {
    const list = buildCatalogList({
      categories: [{ category: makeCategory(), count: 40 }],
      category: makeCategory(),
      packs: Array.from({ length: 40 }, (_unused, index) =>
        makePack({ id: `ckp${String(index).padStart(20, '0')}`, name: `Pack ${index}` }),
      ),
      page: 1,
      totalPages: 2,
      total: 40,
    });

    const menu = selects(list)[0];
    expect(menu?.options.length).toBeLessThanOrEqual(DISCORD_LIMITS.SELECT_OPTIONS);
  });
});

// ---------------------------------------------------------------------------
// Carrinho e pedidos: os paineis mais proximos do teto de 10 filhos
// ---------------------------------------------------------------------------

describe('carrinho e pedido cabem nos limites do Discord', () => {
  const cartLines = Array.from({ length: BUSINESS_LIMITS.MAX_CART_ITEMS }, (_unused, index) => ({
    item: { id: `ckitem${index}`, packId: `ckpack${index}` } as never,
    pack: makePack({
      id: `ckpack${index}`,
      name: 'N'.repeat(BUSINESS_LIMITS.PACK_NAME_MAX),
    }),
    unavailable: index % 3 === 0,
    reason: index % 3 === 0 ? 'Produto indisponivel no momento.' : null,
  }));

  const cartView = {
    cart: { id: 'ckcart' } as never,
    lines: cartLines,
    subtotal: 149900,
    sellableCount: cartLines.filter((line) => !line.unavailable).length,
  };

  const orderItems = Array.from({ length: BUSINESS_LIMITS.MAX_ORDER_ITEMS }, (_unused, index) => ({
    id: `ckoitem${index}`,
    orderId: 'ckorder1',
    packId: `ckpack${index}`,
    skuSnapshot: 'VEH-001',
    nameSnapshot: 'N'.repeat(BUSINESS_LIMITS.PACK_NAME_MAX),
    priceSnapshot: 14990,
    quantity: 1,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
  }));

  const order = {
    id: 'ckorder1',
    guildId: GUILD_ID,
    orderNumber: 184,
    dueAt: null,
    customerId: '222222222222222222',
    status: 'AWAITING_PAYMENT',
    subtotalAmount: 224850,
    discountAmount: 44970,
    finalAmount: 179880,
    couponId: 'ckcupom1',
    couponCodeSnapshot: 'VOOKSTORE20PROMO',
    couponTypeSnapshot: 'PERCENTAGE',
    couponValueSnapshot: 2000,
    paymentId: null,
    channelId: null,
    panelChannelId: null,
    panelMessageId: null,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    paidAt: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: 'C'.repeat(900),
    deliveredAt: null,
    deliveredById: null,
    completedAt: null,
    completedById: null,
    assignedToId: null,
    assignedAt: null,
    items: orderItems,
    payment: null,
  } as never;

  it('carrinho cheio, com itens indisponiveis e aviso', () => {
    expectWithinDiscordLimits(buildCartView(cartView, { notice: 'A'.repeat(200) }));
    expectWithinDiscordLimits(buildCartRemovePanel(cartView));
    expectWithinDiscordLimits(buildCartClearConfirm(cartView));
    expectWithinDiscordLimits(buildCheckoutConfirm(cartView));
  });

  it('carrinho vazio', () => {
    expectWithinDiscordLimits(
      buildCartView({ cart: null, lines: [], subtotal: 0, sellableCount: 0 }),
    );
  });

  it('pedido do cliente e da equipe no pior caso (com aviso no topo)', () => {
    expectWithinDiscordLimits(buildOrderCustomerView(order, { notice: 'A'.repeat(200) }));
    expectWithinDiscordLimits(buildOrderStaffView(order, { notice: 'A'.repeat(200) }));
    expectWithinDiscordLimits(buildNewOrderNotice(order));
  });

  /**
   * Caminho MAIS PESADO da tela do cliente: aviso no topo, itens no limite,
   * galeria do QR e o bloco do copia e cola. E o que chega mais perto do teto
   * de 10 filhos do Container.
   */
  it('pedido com cobranca pendente: QR + copia e cola cabem no limite', () => {
    const pendente = {
      ...(order as object),
      status: 'AWAITING_PAYMENT',
      payment: {
        id: 'ckpayment1',
        status: 'PENDING',
        finalAmount: 179880,
        expiresAt: new Date('2026-08-24T12:00:00.000Z'),
        pixPayload: '0'.repeat(400),
      },
    } as never;

    const comQr = buildOrderCustomerView(pendente, {
      notice: 'A'.repeat(200),
      qrFilename: 'pix-abc123.png',
    });

    expectWithinDiscordLimits(comQr);
    expect(allText(comQr)).toContain('Copia e Cola');
    expect(galleryUrls(comQr)).toEqual(['attachment://pix-abc123.png']);

    // Sem o anexo (falha ao gerar a imagem) o copia e cola continua na tela.
    const semQr = buildOrderCustomerView(pendente, { notice: 'A'.repeat(200) });
    expectWithinDiscordLimits(semQr);
    expect(allText(semQr)).toContain('Copia e Cola');
    expect(galleryUrls(semQr)).toEqual([]);
  });

  /**
   * Cobranca morta com pedido ainda AGUARDANDO PAGAMENTO.
   *
   * Sem tratamento, o cliente ve "aguardando pagamento" e o PIX simplesmente
   * sumido da tela — sem QR, sem copia e cola e sem explicacao.
   */
  it.each([
    ['EXPIRED', 'expirou'],
    ['CANCELLED', 'cancelada'],
  ])('cobranca %s explica o que houve em vez de sumir o PIX', (status, esperado) => {
    const semCobranca = {
      ...(order as object),
      status: 'AWAITING_PAYMENT',
      payment: {
        id: 'ckpayment1',
        status,
        finalAmount: 179880,
        expiresAt: new Date('2026-08-24T12:00:00.000Z'),
        pixPayload: '0'.repeat(400),
      },
    } as never;

    const painel = buildOrderCustomerView(semCobranca);
    const texto = allText(painel);

    expectWithinDiscordLimits(painel);
    expect(texto.toLowerCase()).toContain(esperado);
    // O payload morto nao pode continuar na tela convidando ao pagamento.
    expect(texto).not.toContain('0'.repeat(400));
    expect(galleryUrls(painel)).toEqual([]);
  });

  it('cobranca aprovada nao mostra aviso de expirada', () => {
    const paga = {
      ...(order as object),
      status: 'PAID',
      payment: {
        id: 'ckpayment1',
        status: 'APPROVED',
        finalAmount: 179880,
        expiresAt: new Date('2026-08-24T12:00:00.000Z'),
        pixPayload: '0'.repeat(400),
      },
    } as never;

    const texto = allText(buildOrderCustomerView(paga)).toLowerCase();
    expect(texto).not.toContain('expirou');
    expect(texto).not.toContain('cancelada');
  });

  it('DM avisa o cliente quando a cobranca morre', () => {
    const expirada = buildOrderChargeClosedDm({
      order,
      expired: true,
      storeName: 'Vook Store',
    });
    expectWithinDiscordLimits(expirada);
    expect(allText(expirada).toLowerCase()).toContain('expirou');

    const cancelada = buildOrderChargeClosedDm({
      order,
      expired: false,
      storeName: 'Vook Store',
    });
    expectWithinDiscordLimits(cancelada);
    expect(allText(cancelada).toLowerCase()).toContain('cancelada');
  });

  it('o aviso da equipe destaca que a cobranca precisa ser refeita', () => {
    const comEstado = buildNewOrderNotice(order, {
      chargeState: '⌛ **Cobranca expirada** — gere uma nova para o cliente.',
    });

    expectWithinDiscordLimits(comEstado);
    expect(allText(comEstado)).toContain('Cobranca expirada');
  });

  it('DM de cobranca leva QR, total e copia e cola', () => {
    const dm = buildOrderChargeDm({
      order,
      payment: {
        id: 'ckpayment1',
        finalAmount: 179880,
        expiresAt: new Date('2026-08-24T12:00:00.000Z'),
        pixPayload: '0'.repeat(400),
      } as never,
      storeName: 'Vook Store',
      qrFilename: 'pix-abc123.png',
    });

    expectWithinDiscordLimits(dm);
    expect(allText(dm)).toContain('Copia e Cola');
    expect(galleryUrls(dm)).toEqual(['attachment://pix-abc123.png']);
  });

  /**
   * A chave PIX em texto nas telas do CLIENTE.
   *
   * O cartao do canal, a DM e `/meus-pedidos` mostram o mesmo copia e cola, e
   * ate aqui nenhuma delas mostrava a chave: ela so existia desenhada na arte
   * do QR — uma imagem, que nao da para copiar, e que loja sem arte cadastrada
   * nem tem. Se so uma das tres passar a mostrar, o cliente aprende a pagar por
   * chave numa tela e nao encontra o dado na seguinte.
   */
  describe('chave PIX em texto', () => {
    const RECEIVER = {
      key: 'pagamentos@vookstore.com',
      keyType: PixKeyType.EMAIL,
      holder: 'VOOK STORE LTDA',
    };

    const pendente = {
      ...(order as object),
      status: 'AWAITING_PAYMENT',
      payment: {
        id: 'ckpayment1',
        status: 'PENDING',
        finalAmount: 179880,
        expiresAt: new Date('2026-08-24T12:00:00.000Z'),
        pixPayload: '0'.repeat(400),
      },
    } as never;

    const charge = {
      id: 'ckpayment1',
      finalAmount: 179880,
      expiresAt: new Date('2026-08-24T12:00:00.000Z'),
      pixPayload: '0'.repeat(400),
    } as never;

    it('a DM de cobranca leva chave e titular junto do copia e cola', () => {
      // A DM e onde o QR mais falha — anexo em DM depende de o cliente
      // aceitar —, entao e onde a chave em texto mais serve.
      const dm = buildOrderChargeDm({
        order,
        payment: charge,
        storeName: 'Vook Store',
        receiver: RECEIVER,
      });

      expectWithinDiscordLimits(dm);
      expect(allText(dm)).toContain('pagamentos@vookstore.com');
      expect(allText(dm)).toContain('VOOK STORE LTDA');
    });

    it('/meus-pedidos mostra a chave mesmo quando o QR nao foi gerado', () => {
      const semQr = buildOrderCustomerView(pendente, { receiver: RECEIVER });

      expectWithinDiscordLimits(semQr);
      expect(galleryUrls(semQr)).toEqual([]);
      expect(allText(semQr)).toContain('pagamentos@vookstore.com');
    });

    it('as tres telas dao o MESMO aviso sobre o valor', () => {
      // Transferencia por chave nao carrega valor: quem digita a chave digita o
      // total tambem. O aviso perde a serventia se so uma tela o der.
      const dm = allText(
        buildOrderChargeDm({ order, payment: charge, storeName: 'Vook Store', receiver: RECEIVER }),
      );
      const painel = allText(buildOrderCustomerView(pendente, { receiver: RECEIVER }));

      expect(dm).toContain('o valor nao vai junto');
      expect(painel).toContain('o valor nao vai junto');
    });

    it('sem conta resolvida as duas telas continuam pagaveis pelo copia e cola', () => {
      expect(allText(buildOrderCustomerView(pendente))).not.toContain('Ou copie a chave');
      expect(allText(buildOrderCustomerView(pendente))).toContain('Copia e Cola');
    });
  });

  it.each(['PENDING', 'AWAITING_PAYMENT', 'PAID', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'CANCELLED'])(
    'painel da equipe no status %s',
    (status) => {
      expectWithinDiscordLimits(
        buildOrderStaffView({ ...(order as object), status } as never, {
          notice: 'A'.repeat(200),
        }),
      );
    },
  );

  it('historico paginado do cliente', () => {
    expectWithinDiscordLimits(
      buildOrderListView({
        orders: Array.from({ length: BUSINESS_LIMITS.ORDER_PAGE_SIZE }, () => order),
        page: 2,
        totalPages: 9,
        total: 43,
      }),
    );
  });

  it('painel administrativo cheio (filtro + select + navegacao)', () => {
    expectWithinDiscordLimits(
      buildOrderAdminPanel({
        orders: Array.from({ length: BUSINESS_LIMITS.ORDER_PAGE_SIZE }, () => order),
        status: 'all',
        page: 2,
        totalPages: 9,
        total: 43,
        totals: new Map([
          ['PENDING', 4],
          ['AWAITING_PAYMENT', 3],
          ['PAID', 2],
          ['IN_PROGRESS', 1],
          ['DELIVERED', 8],
        ] as never),
      }),
    );
  });

  it('busca por cliente: seletor e resultado cabem nos limites', () => {
    expectWithinDiscordLimits(buildOrderCustomerPicker());

    expectWithinDiscordLimits(
      buildOrderCustomerLookup({
        customerId: '222222222222222222',
        orders: Array.from({ length: BUSINESS_LIMITS.ORDER_PAGE_SIZE }, () => order),
        page: 2,
        totalPages: 5,
        total: 23,
      }),
    );

    // Cliente sem pedido explica em vez de mostrar lista vazia.
    const vazio = buildOrderCustomerLookup({
      customerId: '222222222222222222',
      orders: [],
      page: 1,
      totalPages: 1,
      total: 0,
    });
    expectWithinDiscordLimits(vazio);
    expect(allText(vazio)).toContain('ainda nao possui pedidos');
  });

  it('o seletor de cliente e um UserSelect (o vendedor escolhe pelo nome)', () => {
    const json = buildOrderCustomerPicker().toJSON() as unknown as {
      components?: Array<{ type: number; components?: Array<{ type: number }> }>;
    };

    const tipos = (json.components ?? [])
      .flatMap((row) => row.components ?? [])
      .map((component) => component.type);

    expect(tipos).toContain(ComponentType.UserSelect);
  });
});

describe('mais informacoes', () => {
  it('mostra a descricao completa e a ficha tecnica', () => {
    const panel = buildPackDetails({
      pack: makePack(),
      category: makeCategory(),
      images: makeImages(3),
      details: makeDetails(4),
    });

    const texto = allText(panel);
    expect(texto).toContain('Inclui 15 veiculos');
    expect(texto).toContain('Campo 1');
    expectWithinDiscordLimits(panel);
  });

  it('pack sem descricao cadastrada nao inventa conteudo', () => {
    const panel = buildPackDetails({
      pack: makePack({ description: null, shortDescription: null }),
      category: makeCategory(),
      images: [],
      details: [],
    });

    expect(allText(panel)).toContain('Nenhuma descricao cadastrada');
  });
});
