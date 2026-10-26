import { describe, expect, it } from 'vitest';
import type { ContainerBuilder } from 'discord.js';
import type { GuildConfig, Payment } from '@prisma/client';

import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../src/constants/limits';
import {
  CONFIG_TEXT_LIMITS,
  VISUAL_FIELD,
  buildVisualModal,
} from '../src/modules/configuration/builders/ConfigBuilders';
import { sanitizeImageUrl } from '../src/utils/sanitize';

import { buildDiagnosticsPanel } from '../src/commands/system/ticketSistema';
import { buildPaymentCard } from '../src/modules/payments/builders/PaymentBuilders';
import { buildQueueSummary } from '../src/modules/tickets/builders/TicketPanelBuilder';
import { buildWelcomeCard } from '../src/modules/welcome/builders/WelcomeBuilder';
import type { DiagnosticItem } from '../src/modules/system/services/DiagnosticsService';

/**
 * Conformidade com os limites REAIS da API do Discord.
 *
 * Estes limites nao sao validados por `discord.js`: o builder serializa sem
 * reclamar e o Discord responde 400 Invalid Form Body no envio. Os numeros
 * abaixo vem da propria tipagem oficial que acompanha a lib
 * (`discord-api-types`, `APIContainerComponent`: "up to 10 components").
 */

const CONTAINER_MAX_CHILDREN = 10;
const V2_TEXT_TOTAL_MAX = 4000;
const TEXT_DISPLAY = 10;
const ACTION_ROW = 1;
const BUTTON = 2;

const USER_ID = '123456789012345678';

interface JsonNode {
  type: number;
  content?: string;
  components?: JsonNode[];
  accessory?: JsonNode;
}

/** Quantos botoes cada ActionRow do painel carrega. */
function buttonsPerRow(root: ContainerBuilder): number[] {
  const json = root.toJSON() as unknown as JsonNode;
  return (json.components ?? [])
    .filter((node) => node.type === ACTION_ROW)
    .map((row) => (row.components ?? []).filter((node) => node.type === BUTTON).length);
}

/** Filhos diretos do Container e soma de TODO texto da mensagem. */
function measure(root: ContainerBuilder): { children: number; textTotal: number } {
  const json = root.toJSON() as unknown as JsonNode;
  const children = json.components ?? [];
  let textTotal = 0;

  const walk = (node: JsonNode): void => {
    if (node.type === TEXT_DISPLAY && typeof node.content === 'string') {
      textTotal += node.content.length;
    }
    for (const child of node.components ?? []) walk(child);
    if (node.accessory !== undefined) walk(node.accessory);
  };
  for (const child of children) walk(child);

  return { children: children.length, textTotal };
}

function expectWithinLimits(root: ContainerBuilder): void {
  const { children, textTotal } = measure(root);
  expect(children).toBeLessThanOrEqual(CONTAINER_MAX_CHILDREN);
  expect(textTotal).toBeLessThanOrEqual(V2_TEXT_TOTAL_MAX);
  // Um painel no teto de filhos nao tem para onde abrir uma segunda linha:
  // botao novo entra na linha existente, e ela tambem tem teto.
  for (const total of buttonsPerRow(root)) {
    expect(total).toBeLessThanOrEqual(DISCORD_LIMITS.BUTTONS_PER_ROW);
  }
}

// ---------------------------------------------------------------------------
// Cartao de cobranca PIX
// ---------------------------------------------------------------------------

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'cmg7x2k9p0001abcd1234efgh',
    guildId: '222222222222222222',
    customerId: USER_ID,
    description: 'Plano mensal',
    originalAmount: 5000,
    discountAmount: 0,
    finalAmount: 5000,
    couponId: null,
    couponCodeSnapshot: null,
    pixPayload:
      '00020126360014BR.GOV.BCB.PIX0114+5511999999995204000053039865802BR5913VOOK STORE6009SAO PAULO62070503***6304AB12',
    sourceType: 'MANUAL_COMMAND',
    sourceId: null,
    status: 'PENDING',
    expiresAt: new Date('2026-08-22T18:45:00.000Z'),
    approvedById: null,
    cancelReason: null,
    ...overrides,
  } as unknown as Payment;
}

describe('buildPaymentCard respeita o limite de 10 filhos do Container', () => {
  it('PENDING com QR (caminho real do PaymentCardService) cabe no limite', () => {
    expectWithinLimits(buildPaymentCard(makePayment(), { qrFilename: 'pix-1234.png' }));
  });

  it('PENDING com cupom aplicado e payload longo cabe no limite', () => {
    const card = buildPaymentCard(
      makePayment({
        couponId: 'cmg7x2k9p0002abcd1234efgh',
        couponCodeSnapshot: 'VOOKSTORE20PROMO',
        discountAmount: 1000,
        finalAmount: 4000,
        description: 'D'.repeat(120),
        pixPayload: '0'.repeat(400),
      }),
      { qrFilename: 'pix-1234.png' },
    );
    expectWithinLimits(card);
  });

  /*
   * Cobranca de pedido: o cartao ganha um QUARTO botao (Enviar Comprovante) na
   * mesma linha. E o pior caso real do painel — se algum dia ele pedir uma
   * segunda ActionRow, este teste estoura antes do Discord devolver 400.
   */
  it('PENDING de pedido do catalogo, com cupom e payload longo, cabe no limite', () => {
    expectWithinLimits(
      buildPaymentCard(
        makePayment({
          sourceType: 'CATALOG_ORDER',
          sourceId: 'ckorder00000000000000001',
          couponId: 'cmg7x2k9p0002abcd1234efgh',
          couponCodeSnapshot: 'VOOKSTORE20PROMO',
          discountAmount: 1000,
          finalAmount: 4000,
          description: 'D'.repeat(120),
          pixPayload: '0'.repeat(400),
        } as never),
        { qrFilename: 'pix-1234.png' },
      ),
    );
  });

  it.each(['APPROVED', 'CANCELLED', 'EXPIRED'] as const)('status %s cabe no limite', (status) => {
    expectWithinLimits(
      buildPaymentCard(
        makePayment({ status, approvedById: USER_ID, cancelReason: 'C'.repeat(900) } as never),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Cartao de boas-vindas
// ---------------------------------------------------------------------------

describe('buildWelcomeCard respeita o limite de 10 filhos do Container', () => {
  it.each([
    [null, false],
    [null, true],
    ['https://cdn.discordapp.com/banners/1/banner.png', false],
    ['https://cdn.discordapp.com/banners/1/banner.png', true],
  ] as ReadonlyArray<[string | null, boolean]>)(
    'banner=%s preview=%s cabe no limite',
    (bannerUrl, isPreview) => {
      expectWithinLimits(
        buildWelcomeCard({
          storeName: 'Vook Store',
          userId: USER_ID,
          memberCount: 1234,
          accountCreatedAt: new Date('2020-03-15T10:30:00.000Z'),
          joinedAt: new Date('2026-08-22T18:45:00.000Z'),
          bannerUrl,
          guildIconUrl: 'https://cdn.discordapp.com/icons/1/logo.png',
          isPreview,
        }),
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Fila de atendimento
// ---------------------------------------------------------------------------

describe('buildQueueSummary respeita o teto de texto da mensagem V2', () => {
  it.each([1, 10, 25])('%s categorias cheias cabem no limite', (count) => {
    const entries = Array.from({ length: count }, (_, index) => ({
      categoryName: `Categoria ${index} ${'N'.repeat(60)}`,
      waiting: 500,
      tickets: Array.from({ length: 10 }, (_, i) => 9000 + i),
    }));
    expectWithinLimits(buildQueueSummary(entries));
  });

  it('avisa quando corta categorias por limite de tamanho', () => {
    const entries = Array.from({ length: 25 }, () => ({
      categoryName: 'Suporte Tecnico',
      waiting: 30,
      tickets: Array.from({ length: 10 }, (_, i) => i + 1),
    }));
    const json = buildQueueSummary(entries).toJSON() as unknown as JsonNode;
    const fullText = (json.components ?? [])
      .filter((node) => node.type === TEXT_DISPLAY)
      .map((node) => node.content ?? '')
      .join('\n');

    expect(fullText).toContain('nao exibida(s)');
  });
});

// ---------------------------------------------------------------------------
// Diagnostico
// ---------------------------------------------------------------------------

function diagnosticItems(enabledCategories: number): DiagnosticItem[] {
  const items: DiagnosticItem[] = [
    { label: 'Permissoes do bot', level: 'ok', detail: 'Todas as permissoes concedidas.' },
    { label: 'Painel publico', level: 'ok', detail: '<#222222222222222222>' },
    { label: 'Canal de logs', level: 'ok', detail: '<#222222222222222222>' },
    { label: 'Canal de boas-vindas', level: 'ok', detail: '<#222222222222222222>' },
    { label: 'Canal de avaliacoes', level: 'ok', detail: '<#222222222222222222>' },
    { label: 'Mensagem do painel', level: 'ok', detail: 'Publicada e acessivel.' },
    { label: 'Auto-Role', level: 'ok', detail: '<@&222222222222222222>' },
    { label: 'Categorias', level: 'ok', detail: `${enabledCategories} ativa(s).` },
  ];

  for (let index = 0; index < enabledCategories; index += 1) {
    items.push({
      label: `Destino • Suporte Tecnico Premium ${index}`,
      level: 'warn',
      detail: 'Sem categoria do Discord definida: os canais serao criados na raiz.',
    });
    items.push({
      label: `Equipe • Suporte Tecnico Premium ${index}`,
      level: 'error',
      detail: 'Sem cargo responsavel: nao e possivel abrir tickets nesta categoria.',
    });
  }

  items.push({ label: 'Contas PIX', level: 'ok', detail: '1 conta(s) ativa(s).' });
  return items;
}

describe('buildDiagnosticsPanel respeita filhos e teto de texto', () => {
  it.each([0, 1, 5, 15, 25])('%s categorias ativas cabem no limite', (categories) => {
    const items = diagnosticItems(categories);
    expectWithinLimits(
      buildDiagnosticsPanel({
        items,
        errors: items.filter((item) => item.level === 'error').length,
        warnings: items.filter((item) => item.level === 'warn').length,
      }),
    );
  });

  it('avisa quando corta verificacoes por limite de tamanho', () => {
    const items = diagnosticItems(25);
    const json = buildDiagnosticsPanel({
      items,
      errors: items.filter((item) => item.level === 'error').length,
      warnings: items.filter((item) => item.level === 'warn').length,
    }).toJSON() as unknown as JsonNode;

    const fullText = (json.components ?? [])
      .filter((node) => node.type === TEXT_DISPLAY)
      .map((node) => node.content ?? '')
      .join('\n');

    expect(fullText).toContain('nao exibida(s)');
  });
});

// ---------------------------------------------------------------------------
// Modal visual: o campo unico carrega TRES URLs
// ---------------------------------------------------------------------------

/**
 * O `TextInput` do Discord recusa `value` maior que `max_length`, entao
 * `modalInput` trunca o preenchimento para nao tomar 400. Com duas URLs o teto
 * antigo (1100) ainda cabia; com a terceira (`ticketBannerUrl`) o pior caso
 * passou a ser 3 x 512 + 6 = 1542. Sem este teste, um administrador que
 * abrisse o modal so para trocar o nome da loja salvaria a terceira URL
 * cortada — o banner do ticket sumia sem nenhum aviso.
 */
describe('modal visual comporta as tres URLs de imagem', () => {
  const urlNoTeto = `https://cdn.exemplo.com/${'a'.repeat(BUSINESS_LIMITS.IMAGE_URL_MAX - 28)}.png`;

  interface ModalJson {
    components: { components: { custom_id: string; value?: string; max_length?: number }[] }[];
  }

  function imagesInput(config: GuildConfig): {
    custom_id: string;
    value?: string;
    max_length?: number;
  } {
    const json = buildVisualModal(config).toJSON() as unknown as ModalJson;
    const input = json.components
      .flatMap((row) => row.components)
      .find((component) => component.custom_id === VISUAL_FIELD.IMAGES);
    if (input === undefined) throw new Error('campo de imagens ausente no modal');
    return input;
  }

  function configWith(urls: string | null): GuildConfig {
    return {
      storeName: 'Vook Store',
      panelTitle: 'Central',
      panelDescription: 'Descricao',
      panelNotice: null,
      panelThumbnailUrl: urls,
      panelBannerUrl: urls,
      ticketBannerUrl: urls,
    } as unknown as GuildConfig;
  }

  it('a URL de teste esta exatamente no teto aceito por sanitizeImageUrl', () => {
    expect(urlNoTeto).toHaveLength(BUSINESS_LIMITS.IMAGE_URL_MAX);
    expect(sanitizeImageUrl(urlNoTeto)).toBe(urlNoTeto);
  });

  it('preenche as tres URLs no teto sem truncar nenhuma', () => {
    const input = imagesInput(configWith(urlNoTeto));
    const partes = (input.value ?? '').split('|').map((parte) => parte.trim());

    expect(partes).toHaveLength(3);
    for (const parte of partes) expect(parte).toBe(urlNoTeto);
    expect((input.value ?? '').length).toBeLessThanOrEqual(input.max_length ?? 0);
  });

  it('mantem o max_length dentro do teto de TextInput do Discord', () => {
    const input = imagesInput(configWith(urlNoTeto));
    expect(input.max_length).toBe(CONFIG_TEXT_LIMITS.IMAGES);
    expect(input.max_length).toBeLessThanOrEqual(DISCORD_LIMITS.TEXT_INPUT_SHORT_VALUE);
  });

  it('sem imagem configurada o campo fica vazio', () => {
    expect(imagesInput(configWith(null)).value).toBeUndefined();
  });
});
