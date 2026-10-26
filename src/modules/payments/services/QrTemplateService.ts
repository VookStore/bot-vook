import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { PNG } from 'pngjs';
import { create as createQrCode } from 'qrcode';

import { createLogger } from '../../../core/logger/Logger';

/**
 * Arte personalizada do QR Code PIX.
 *
 * COMO FUNCIONA
 *  A loja desenha o card (logo, nome, chave, banco) e deixa um QUADRADO BRANCO
 *  solido no lugar onde o QR deve aparecer. Este servico acha esse quadrado
 *  sozinho e desenha o QR dentro dele.
 *
 * POR QUE DESENHAR MODULO A MODULO
 *  O `qrcode` entrega a matriz de modulos crua (`create().modules`), entao o QR
 *  e pintado em ESCALA INTEIRA direto nos pixels do template: cada modulo vira
 *  um bloco de N x N pixels exatos. Nao existe redimensionamento, logo nao
 *  existe borda cinza por interpolacao — que e justamente o que faz leitor de
 *  banco falhar.
 *
 * REGRA DE OURO
 *  Isto e ESTETICA. Qualquer falha (arte ausente, quadrado nao encontrado,
 *  espaco insuficiente) devolve `null` e o chamador cai no QR simples. Uma
 *  cobranca nunca deixa de existir por causa de um enfeite.
 */

const logger = createLogger('payment:qr-template');

/** Raiz das artes, relativa a raiz do projeto (o PM2 roda com cwd la). */
const TEMPLATE_ROOT = join('assets', 'pix');

/** Canal RGB (e alfa) minimo para um pixel contar como branco. */
const WHITE_MIN = 250;

/** Menor lado aceitavel do quadrado, em pixels. */
const MIN_SLOT_PX = 200;

/**
 * Quanto da caixa delimitadora precisa ser branco de fato.
 * Um quadrado com cantos arredondados fica em ~0,97; o piso baixo rejeita
 * mancha diagonal ou em L sem recusar arte legitima.
 */
const MIN_FILL_RATIO = 0.85;

/**
 * Proporcao aceitavel (largura/altura) da area branca.
 *
 * O papel desta checagem e recusar FAIXA (um banner branco, uma barra de
 * texto), nao punir um retangulo levemente fora do quadrado: se a loja desenhar
 * 600x500, o certo e centralizar um QR de 500x500 ali dentro, e nao cair no QR
 * simples sem explicar por que. Uma faixa de verdade (900x300 = 3,0) continua
 * recusada com folga.
 */
const MIN_ASPECT = 0.74;
const MAX_ASPECT = 1.35;

/** Zona silenciosa exigida pela especificacao do QR, em modulos. */
const QUIET_MODULES = 4;

/**
 * Menor tamanho de modulo aceitavel, em pixels.
 * Abaixo disso o QR fica denso demais para a camera de celular e e melhor
 * cair no QR simples do que entregar uma arte bonita e ilegivel.
 */
const MIN_MODULE_PX = 3;

/** Nivel de correcao de erro — o mesmo do QR simples. */
const QR_ERROR_CORRECTION = 'M';

/** Area onde o QR sera desenhado, ja normalizada como quadrado. */
export interface TemplateSlot {
  x: number;
  y: number;
  size: number;
}

interface CachedTemplate {
  /** PNG comprimido. Guardar o arquivo (e nao os pixels) mantem a memoria baixa. */
  file: Buffer;
  slot: TemplateSlot;
}

/**
 * Cache por caminho de arquivo.
 *
 * A arte so muda em deploy (que reinicia o processo), entao o cache nao expira.
 * Guardamos o PNG comprimido, nao os pixels: decodificar por cobranca custa
 * poucos milissegundos e evita segurar ~7 MB por arte na memoria — alem de dar
 * um buffer novo a cada uso, que e obrigatorio, ja que cada cobranca desenha um
 * QR diferente por cima.
 */
const cache = new Map<string, CachedTemplate | null>();

// ---------------------------------------------------------------------------
// Localizacao do arquivo
// ---------------------------------------------------------------------------

/**
 * Caminho da arte de uma conta PIX: `assets/pix/<guildId>/<identifier>.png`.
 *
 * A guild entra no caminho DE PROPOSITO: a arte traz nome e chave impressos, e
 * duas guilds podem ter contas com o mesmo identificador. Sem a separacao, o
 * cliente de um servidor veria o titular de outro — pagando para a pessoa
 * errada com uma imagem que parece oficial.
 *
 * Os dois segmentos sao validados contra um formato fechado e o resultado e
 * conferido contra a raiz: nao ha caminho para `../` escapar do diretorio.
 */
export function resolveTemplatePath(guildId: string, identifier: string): string | null {
  if (!/^\d{17,20}$/.test(guildId)) return null;
  if (!/^[a-z0-9-]{1,40}$/.test(identifier)) return null;

  const root = resolve(TEMPLATE_ROOT);
  const target = resolve(join(root, guildId, `${identifier}.png`));

  if (!target.startsWith(root + sep) && target !== root) return null;
  if (!isAbsolute(target)) return null;

  return target;
}

// ---------------------------------------------------------------------------
// Deteccao do quadrado branco
// ---------------------------------------------------------------------------

function isWhitePixel(data: Buffer, index: number): boolean {
  const offset = index * 4;
  return (
    (data[offset] ?? 0) >= WHITE_MIN &&
    (data[offset + 1] ?? 0) >= WHITE_MIN &&
    (data[offset + 2] ?? 0) >= WHITE_MIN &&
    (data[offset + 3] ?? 0) >= WHITE_MIN
  );
}

/**
 * Acha o maior BLOCO CONTIGUO de pixels brancos e devolve o quadrado util
 * dentro dele.
 *
 * Por que a maior regiao conectada, e nao o maior retangulo branco: com cantos
 * arredondados, o maior retangulo inscrito e mais baixo que largo (o
 * arredondamento come as pontas), e a arte seria recusada por "nao ser
 * quadrada". A caixa delimitadora da regiao conectada, essa sim, devolve o
 * quadrado inteiro.
 *
 * Os outros elementos brancos da arte (logo, textos, tracinhos) sao blocos
 * pequenos e perdem para o quadrado por ordem de grandeza.
 */
export function detectWhiteSlot(png: PNG): TemplateSlot | null {
  const { width, height, data } = png;
  const total = width * height;
  if (total === 0) return null;

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);

  let bestArea = 0;
  let bestBox = { minX: 0, minY: 0, maxX: -1, maxY: -1 };

  for (let start = 0; start < total; start += 1) {
    if (visited[start] === 1) continue;
    visited[start] = 1;
    if (!isWhitePixel(data, start)) continue;

    // Varredura em largura (iterativa): pilha de recursao nao aguenta uma
    // regiao de centenas de milhares de pixels.
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;

    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (head < tail) {
      const pixel = queue[head] ?? 0;
      head += 1;

      const x = pixel % width;
      const y = Math.floor(pixel / width);

      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0) tail = pushNeighbour(pixel - 1, data, visited, queue, tail);
      if (x < width - 1) tail = pushNeighbour(pixel + 1, data, visited, queue, tail);
      if (y > 0) tail = pushNeighbour(pixel - width, data, visited, queue, tail);
      if (y < height - 1) tail = pushNeighbour(pixel + width, data, visited, queue, tail);
    }

    if (area > bestArea) {
      bestArea = area;
      bestBox = { minX, minY, maxX, maxY };
    }
  }

  if (bestBox.maxX < 0 || bestBox.maxY < 0) return null;

  const boxWidth = bestBox.maxX - bestBox.minX + 1;
  const boxHeight = bestBox.maxY - bestBox.minY + 1;

  if (boxWidth < MIN_SLOT_PX || boxHeight < MIN_SLOT_PX) return null;

  const aspect = boxWidth / boxHeight;
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return null;

  // Recusa mancha branca que ocupa a caixa sem preenche-la (diagonal, "L").
  if (bestArea / (boxWidth * boxHeight) < MIN_FILL_RATIO) return null;

  const size = Math.min(boxWidth, boxHeight);
  return {
    x: bestBox.minX + Math.floor((boxWidth - size) / 2),
    y: bestBox.minY + Math.floor((boxHeight - size) / 2),
    size,
  };
}

function pushNeighbour(
  pixel: number,
  data: Buffer,
  visited: Uint8Array,
  queue: Int32Array,
  tail: number,
): number {
  if (visited[pixel] === 1) return tail;
  visited[pixel] = 1;
  if (!isWhitePixel(data, pixel)) return tail;
  queue[tail] = pixel;
  return tail + 1;
}

// ---------------------------------------------------------------------------
// Composicao
// ---------------------------------------------------------------------------

function fillRect(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  value: number,
): void {
  for (let row = y; row < y + height; row += 1) {
    const rowOffset = row * png.width;
    for (let column = x; column < x + width; column += 1) {
      const offset = (rowOffset + column) * 4;
      png.data[offset] = value;
      png.data[offset + 1] = value;
      png.data[offset + 2] = value;
      png.data[offset + 3] = 255;
    }
  }
}

/**
 * Desenha o QR do payload dentro do slot e devolve o PNG final.
 *
 * O `png` recebido E MUTADO — passe sempre um buffer recem-decodificado, nunca
 * um template compartilhado, senao a arte acumula o QR de cobrancas anteriores.
 *
 * Devolve `null` quando o quadrado nao comporta o QR com modulos legiveis.
 */
export function renderQrOnTemplate(
  png: PNG,
  slot: TemplateSlot,
  payload: string,
): Buffer | null {
  const qr = createQrCode(payload, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const modules = qr.modules.size;
  const totalModules = modules + QUIET_MODULES * 2;

  // Escala INTEIRA: cada modulo ocupa um numero exato de pixels.
  const scale = Math.floor(slot.size / totalModules);
  if (scale < MIN_MODULE_PX) return null;

  const drawn = totalModules * scale;
  const originX = slot.x + Math.floor((slot.size - drawn) / 2);
  const originY = slot.y + Math.floor((slot.size - drawn) / 2);

  if (
    originX < 0 ||
    originY < 0 ||
    originX + drawn > png.width ||
    originY + drawn > png.height
  ) {
    return null;
  }

  // Zona silenciosa explicita: o template ja e branco aqui, mas repintar
  // garante o contraste mesmo se a arte tiver ruido ou textura leve.
  fillRect(png, originX, originY, drawn, drawn, 255);

  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (qr.modules.get(row, column) !== 1) continue;
      fillRect(
        png,
        originX + (column + QUIET_MODULES) * scale,
        originY + (row + QUIET_MODULES) * scale,
        scale,
        scale,
        0,
      );
    }
  }

  return PNG.sync.write(png);
}

// ---------------------------------------------------------------------------
// Carga (com cache) e ponto de entrada
// ---------------------------------------------------------------------------

async function loadTemplate(path: string): Promise<CachedTemplate | null> {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;

  let entry: CachedTemplate | null = null;

  try {
    const file = await readFile(path);
    const png = PNG.sync.read(file);
    const slot = detectWhiteSlot(png);

    if (slot === null) {
      logger.warn('Arte do QR ignorada: nenhum quadrado branco valido encontrado.', {
        path,
        width: png.width,
        height: png.height,
      });
    } else {
      entry = { file, slot };
      logger.info('Arte do QR carregada.', {
        path,
        width: png.width,
        height: png.height,
        slotX: slot.x,
        slotY: slot.y,
        slotSize: slot.size,
      });
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Conta sem arte cadastrada e o caso NORMAL: usa o QR simples.
      logger.debug('Conta sem arte de QR cadastrada.', { path });
    } else {
      logger.warn('Falha ao carregar a arte do QR; usando o QR simples.', {
        path,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  cache.set(path, entry);
  return entry;
}

/**
 * Gera o PNG do QR ja aplicado sobre a arte da conta.
 * Devolve `null` sempre que a arte nao puder ser usada — o chamador cai no QR
 * simples sem que o cliente perceba qualquer falha.
 */
export async function buildTemplatedQrPng(params: {
  guildId: string;
  accountIdentifier: string;
  payload: string;
}): Promise<Buffer | null> {
  const path = resolveTemplatePath(params.guildId, params.accountIdentifier);
  if (path === null) return null;

  const template = await loadTemplate(path);
  if (template === null) return null;

  try {
    // Decodifica de novo a cada cobranca: `renderQrOnTemplate` muta os pixels,
    // e reaproveitar o mesmo buffer empilharia QR sobre QR.
    const png = PNG.sync.read(template.file);
    const composed = renderQrOnTemplate(png, template.slot, params.payload);

    if (composed === null) {
      logger.warn('Quadrado branco pequeno demais para este payload; usando o QR simples.', {
        guildId: params.guildId,
        path,
        slotSize: template.slot.size,
        payloadLength: params.payload.length,
      });
    }
    return composed;
  } catch (error) {
    logger.warn('Falha ao compor o QR sobre a arte; usando o QR simples.', {
      guildId: params.guildId,
      path,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** True quando a conta possui arte utilizavel (usado no diagnostico). */
export async function hasUsableTemplate(
  guildId: string,
  accountIdentifier: string,
): Promise<boolean> {
  const path = resolveTemplatePath(guildId, accountIdentifier);
  if (path === null) return false;
  return (await loadTemplate(path)) !== null;
}

/** Somente para testes e para recarregar a arte sem reiniciar o processo. */
export function clearTemplateCache(): void {
  cache.clear();
}
