import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

import {
  buildTemplatedQrPng,
  clearTemplateCache,
  detectWhiteSlot,
  renderQrOnTemplate,
  resolveTemplatePath,
  type TemplateSlot,
} from '../src/modules/payments/services/QrTemplateService';

/**
 * Arte personalizada do QR PIX.
 *
 * O teste central aqui e o de ida e volta: compoe o QR sobre a arte,
 * DECODIFICA o QR da imagem final e compara com o payload. E a unica forma de
 * provar que um recorte errado no template nao vira cobranca ilegivel — e como
 * o valor esta dentro do payload, ele tambem pega imagem certa com valor errado.
 *
 * Os demais testes cobrem o que pode dar errado na arte enviada pela loja:
 * quadrado ausente, pequeno demais, torto, ou concorrendo com o logo branco.
 */

/** Payload PIX realista (BR Code), com o tamanho tipico de uma cobranca. */
const PIX_PAYLOAD =
  '00020126360014BR.GOV.BCB.PIX0114+55179880120025204000053039865802BR5913VOOK STORE6009SAO PAULO' +
  '62070503***63041D3D';

const GUILD_ID = '1528606501248438282';

// ---------------------------------------------------------------------------
// Fabricas de arte sintetica
// ---------------------------------------------------------------------------

interface TemplateOptions {
  width?: number;
  height?: number;
  square?: { x: number; y: number; width: number; height: number };
  /** Cantos arredondados, como na arte real da loja. */
  cornerRadius?: number;
  /** Elementos brancos menores (logo, textos) que nao podem vencer o quadrado. */
  decorations?: boolean;
}

function paint(png: PNG, x: number, y: number, value: number): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const offset = (y * png.width + x) * 4;
  png.data[offset] = value;
  png.data[offset + 1] = value;
  png.data[offset + 2] = value;
  png.data[offset + 3] = 255;
}

/** Arte escura com um quadrado branco — o mesmo formato que a loja desenha. */
function makeTemplate(options: TemplateOptions = {}): PNG {
  const width = options.width ?? 1080;
  const height = options.height ?? 1620;
  const png = new PNG({ width, height });

  // Fundo quase preto (a arte real tem textura, nao e preto puro).
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      paint(png, x, y, (x + y) % 7 === 0 ? 18 : 10);
    }
  }

  if (options.decorations === true) {
    // Logo e textos: blocos brancos PEQUENOS, para provar que o quadrado vence.
    for (let y = 40; y < 110; y += 1) {
      for (let x = 490; x < 590; x += 1) paint(png, x, y, 255);
    }
    for (let y = 1090; y < 1130; y += 1) {
      for (let x = 250; x < 830; x += 1) paint(png, x, y, 255);
    }
  }

  const square = options.square ?? { x: 252, y: 293, width: 584, height: 585 };
  const radius = options.cornerRadius ?? 0;

  for (let y = square.y; y < square.y + square.height; y += 1) {
    for (let x = square.x; x < square.x + square.width; x += 1) {
      if (radius > 0 && isOutsideRoundedCorner(square, radius, x, y)) continue;
      paint(png, x, y, 255);
    }
  }

  return png;
}

function isOutsideRoundedCorner(
  square: { x: number; y: number; width: number; height: number },
  radius: number,
  x: number,
  y: number,
): boolean {
  const left = square.x + radius;
  const right = square.x + square.width - 1 - radius;
  const top = square.y + radius;
  const bottom = square.y + square.height - 1 - radius;

  const cornerX = x < left ? left : x > right ? right : null;
  const cornerY = y < top ? top : y > bottom ? bottom : null;
  if (cornerX === null || cornerY === null) return false;

  const dx = x - cornerX;
  const dy = y - cornerY;
  return dx * dx + dy * dy > radius * radius;
}

/** Decodifica o QR presente na imagem final. `null` = ilegivel. */
function decodeQr(buffer: Buffer): string | null {
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result?.data ?? null;
}

function compose(png: PNG, slot: TemplateSlot, payload = PIX_PAYLOAD): Buffer {
  const composed = renderQrOnTemplate(png, slot, payload);
  if (composed === null) throw new Error('composicao devolveu null');
  return composed;
}

// ---------------------------------------------------------------------------
// Deteccao do quadrado
// ---------------------------------------------------------------------------

describe('deteccao do quadrado branco', () => {
  it('encontra o quadrado na posicao e no tamanho certos', () => {
    const slot = detectWhiteSlot(
      makeTemplate({ square: { x: 252, y: 293, width: 584, height: 584 } }),
    );

    expect(slot).not.toBeNull();
    expect(slot?.x).toBe(252);
    expect(slot?.y).toBe(293);
    expect(slot?.size).toBe(584);
  });

  it('aceita cantos arredondados (a caixa delimitadora continua quadrada)', () => {
    const slot = detectWhiteSlot(
      makeTemplate({
        square: { x: 252, y: 293, width: 584, height: 584 },
        cornerRadius: 40,
      }),
    );

    expect(slot).not.toBeNull();
    expect(slot?.size).toBe(584);
  });

  it('ignora logo e textos brancos menores que o quadrado', () => {
    const slot = detectWhiteSlot(
      makeTemplate({
        square: { x: 252, y: 293, width: 584, height: 584 },
        cornerRadius: 40,
        decorations: true,
      }),
    );

    // O quadrado do QR, nunca o bloco do logo (que fica em y=40).
    expect(slot?.y).toBe(293);
    expect(slot?.size).toBe(584);
  });

  it('centraliza o quadrado util quando a area branca e retangular', () => {
    const slot = detectWhiteSlot(
      makeTemplate({ square: { x: 100, y: 200, width: 600, height: 500 } }),
    );

    expect(slot?.size).toBe(500);
    // Sobra de 100 px na largura, dividida nos dois lados.
    expect(slot?.x).toBe(150);
    expect(slot?.y).toBe(200);
  });

  it('recusa arte sem nenhum quadrado branco', () => {
    const png = makeTemplate({ square: { x: 0, y: 0, width: 0, height: 0 } });
    expect(detectWhiteSlot(png)).toBeNull();
  });

  it('recusa quadrado pequeno demais para um QR legivel', () => {
    const slot = detectWhiteSlot(
      makeTemplate({ square: { x: 10, y: 10, width: 120, height: 120 } }),
    );
    expect(slot).toBeNull();
  });

  it('recusa area branca muito alongada (nao e o slot do QR)', () => {
    const slot = detectWhiteSlot(
      makeTemplate({ square: { x: 50, y: 50, width: 900, height: 300 } }),
    );
    expect(slot).toBeNull();
  });

  it('recusa mancha branca que nao preenche a propria caixa', () => {
    // Faixa diagonal: caixa delimitadora quadrada, mas quase tudo preto dentro.
    const png = makeTemplate({ square: { x: 0, y: 0, width: 0, height: 0 } });
    for (let i = 0; i < 600; i += 1) {
      for (let thickness = 0; thickness < 3; thickness += 1) {
        paint(png, 200 + i, 200 + i + thickness, 255);
      }
    }
    expect(detectWhiteSlot(png)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Composicao e legibilidade
// ---------------------------------------------------------------------------

describe('composicao do QR sobre a arte', () => {
  it('o QR da imagem final decodifica exatamente o payload PIX', () => {
    const png = makeTemplate({ cornerRadius: 40, decorations: true });
    const slot = detectWhiteSlot(png);
    expect(slot).not.toBeNull();
    if (slot === null) return;

    expect(decodeQr(compose(png, slot))).toBe(PIX_PAYLOAD);
  });

  it('continua legivel com payload longo (descricao grande na cobranca)', () => {
    const payload = `${PIX_PAYLOAD}${'0'.repeat(200)}`;
    const png = makeTemplate({ cornerRadius: 40 });
    const slot = detectWhiteSlot(png);
    if (slot === null) throw new Error('slot nao detectado');

    expect(decodeQr(compose(png, slot, payload))).toBe(payload);
  });

  it('cada modulo ocupa um numero INTEIRO de pixels (sem borda cinza)', () => {
    const png = makeTemplate();
    const slot = detectWhiteSlot(png);
    if (slot === null) throw new Error('slot nao detectado');

    const composed = PNG.sync.read(compose(png, slot));

    // Dentro do slot so pode existir preto puro ou branco puro. Qualquer tom
    // intermediario denunciaria interpolacao — a causa classica de QR que o
    // aplicativo do banco nao le.
    const tonsIntermediarios = new Set<number>();
    for (let y = slot.y; y < slot.y + slot.size; y += 1) {
      for (let x = slot.x; x < slot.x + slot.size; x += 1) {
        const value = composed.data[(y * composed.width + x) * 4] ?? 0;
        if (value !== 0 && value !== 255) tonsIntermediarios.add(value);
      }
    }

    expect([...tonsIntermediarios]).toEqual([]);
  });

  it('preserva a arte fora do quadrado', () => {
    const png = makeTemplate({ decorations: true });
    const slot = detectWhiteSlot(png);
    if (slot === null) throw new Error('slot nao detectado');

    const composed = PNG.sync.read(compose(png, slot));

    // Bloco do "logo" continua branco...
    expect(composed.data[(60 * composed.width + 520) * 4]).toBe(255);
    // ...e o fundo escuro logo acima do quadrado continua escuro.
    const acima = composed.data[((slot.y - 30) * composed.width + slot.x + 100) * 4] ?? 255;
    expect(acima).toBeLessThan(60);
  });

  it('desenha a zona silenciosa branca em volta do QR', () => {
    const png = makeTemplate();
    const slot = detectWhiteSlot(png);
    if (slot === null) throw new Error('slot nao detectado');

    const composed = PNG.sync.read(compose(png, slot));

    // O canto do slot pertence a zona silenciosa: precisa ser branco.
    const canto = composed.data[((slot.y + 2) * composed.width + slot.x + 2) * 4];
    expect(canto).toBe(255);
  });

  it('recusa compor quando o quadrado nao comporta modulos legiveis', () => {
    const png = makeTemplate({ square: { x: 10, y: 10, width: 210, height: 210 } });
    // Slot valido para a deteccao, mas apertado para um payload longo.
    const slot: TemplateSlot = { x: 10, y: 10, size: 210 };
    const payload = `${PIX_PAYLOAD}${'0'.repeat(600)}`;

    expect(renderQrOnTemplate(png, slot, payload)).toBeNull();
  });

  it('nao vaza para fora da imagem quando o slot fica na borda', () => {
    const png = makeTemplate({ width: 700, height: 700 });
    const slot: TemplateSlot = { x: 600, y: 600, size: 400 };

    expect(renderQrOnTemplate(png, slot, PIX_PAYLOAD)).toBeNull();
  });

  it('duas cobrancas seguidas nao empilham QR na mesma arte', () => {
    const outroPayload = PIX_PAYLOAD.replace('5204', '5205');

    // Cada composicao parte de um PNG recem-decodificado, como em producao.
    const base = PNG.sync.write(makeTemplate());
    const slot = detectWhiteSlot(PNG.sync.read(base));
    if (slot === null) throw new Error('slot nao detectado');

    expect(decodeQr(compose(PNG.sync.read(base), slot, PIX_PAYLOAD))).toBe(PIX_PAYLOAD);
    expect(decodeQr(compose(PNG.sync.read(base), slot, outroPayload))).toBe(outroPayload);
  });
});

// ---------------------------------------------------------------------------
// Resolucao do caminho (isolamento entre guilds e path traversal)
// ---------------------------------------------------------------------------

describe('caminho da arte', () => {
  it('separa a arte por guild e por conta', () => {
    const path = resolveTemplatePath(GUILD_ID, 'principal');
    expect(path).not.toBeNull();
    expect(path).toContain(GUILD_ID);
    expect(path?.endsWith('principal.png')).toBe(true);
  });

  it('guilds diferentes nunca compartilham a mesma arte', () => {
    // A arte traz nome e chave impressos: compartilhar mostraria ao cliente o
    // titular de outro servidor.
    const a = resolveTemplatePath(GUILD_ID, 'principal');
    const b = resolveTemplatePath('999999999999999999', 'principal');
    expect(a).not.toBe(b);
  });

  it('recusa identificador com travessia de diretorio', () => {
    expect(resolveTemplatePath(GUILD_ID, '../../../etc/passwd')).toBeNull();
    expect(resolveTemplatePath(GUILD_ID, '..')).toBeNull();
    expect(resolveTemplatePath(GUILD_ID, 'conta/../../segredo')).toBeNull();
  });

  it('recusa guildId que nao e um snowflake', () => {
    expect(resolveTemplatePath('../..', 'principal')).toBeNull();
    expect(resolveTemplatePath('abc', 'principal')).toBeNull();
    expect(resolveTemplatePath('', 'principal')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fallback: a arte nunca pode impedir a cobranca
// ---------------------------------------------------------------------------

describe('a arte e estetica: falha nela nunca derruba a cobranca', () => {
  /** Guild ficticia: o diretorio inteiro e removido no fim de cada teste. */
  const SANDBOX_GUILD = '111111111111111111';
  const sandboxDir = join('assets', 'pix', SANDBOX_GUILD);

  beforeEach(() => {
    clearTemplateCache();
  });

  afterEach(() => {
    rmSync(sandboxDir, { recursive: true, force: true });
    clearTemplateCache();
  });

  it('conta sem arte cadastrada devolve null (o chamador usa o QR simples)', async () => {
    const resultado = await buildTemplatedQrPng({
      guildId: SANDBOX_GUILD,
      accountIdentifier: 'conta-inexistente',
      payload: PIX_PAYLOAD,
    });

    expect(resultado).toBeNull();
  });

  it('arquivo corrompido devolve null em vez de lancar', async () => {
    mkdirSync(sandboxDir, { recursive: true });
    writeFileSync(join(sandboxDir, 'corrompida.png'), Buffer.from('isto nao e um png'));

    await expect(
      buildTemplatedQrPng({
        guildId: SANDBOX_GUILD,
        accountIdentifier: 'corrompida',
        payload: PIX_PAYLOAD,
      }),
    ).resolves.toBeNull();
  });

  it('arte sem quadrado branco devolve null em vez de desenhar em cima da arte', async () => {
    mkdirSync(sandboxDir, { recursive: true });
    writeFileSync(
      join(sandboxDir, 'sem-quadrado.png'),
      PNG.sync.write(makeTemplate({ square: { x: 0, y: 0, width: 0, height: 0 } })),
    );

    await expect(
      buildTemplatedQrPng({
        guildId: SANDBOX_GUILD,
        accountIdentifier: 'sem-quadrado',
        payload: PIX_PAYLOAD,
      }),
    ).resolves.toBeNull();
  });

  it('arte valida no disco produz um QR que decodifica o payload', async () => {
    mkdirSync(sandboxDir, { recursive: true });
    writeFileSync(
      join(sandboxDir, 'principal.png'),
      PNG.sync.write(makeTemplate({ cornerRadius: 40, decorations: true })),
    );

    const composed = await buildTemplatedQrPng({
      guildId: SANDBOX_GUILD,
      accountIdentifier: 'principal',
      payload: PIX_PAYLOAD,
    });

    expect(composed).not.toBeNull();
    if (composed === null) return;
    expect(decodeQr(composed)).toBe(PIX_PAYLOAD);
  });
});
