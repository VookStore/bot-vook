import type { Guild } from 'discord.js';

import { BUSINESS_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { guildUploadLimit } from '../../../utils/discord';
import { describeMaxSize, transferTimeoutMs } from '../../../utils/transfer';

/**
 * O arquivo do produto entregue no ticket.
 *
 * Chega pelo formulario (upload de modal) e sai como anexo do BOT, ou como link
 * do Worker quando nao cabe. Nao existe caminho em que a URL do formulario vire
 * a entrega: link de anexo do Discord e assinado e expira em poucas horas, e um
 * produto que some da mao do cliente no dia seguinte nao foi entregue.
 */

export interface ProductFormat {
  /** Extensao do anexo reenviado. */
  ext: string;
  mime: string;
  /** Como o formato aparece para quem preenche o formulario. */
  label: string;
}

export const PRODUCT_FORMATS: readonly ProductFormat[] = [
  { ext: 'zip', mime: 'application/zip', label: 'ZIP' },
  { ext: 'rar', mime: 'application/vnd.rar', label: 'RAR' },
  { ext: '7z', mime: 'application/x-7z-compressed', label: '7Z' },
];

/** "ZIP, RAR ou 7Z" — a mesma lista no formulario e no erro. */
export function describeProductFormats(): string {
  const labels = PRODUCT_FORMATS.map((format) => format.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} ou ${labels[labels.length - 1] ?? ''}`;
}

/**
 * Maior arquivo que vira ANEXO da mensagem do bot neste servidor.
 *
 * Quem limita e o reenvio do bot, nao o upload de quem preenche o formulario:
 * uma conta com Nitro sobe 500 MB pelo modal, mas o bot so reenvia ate o limite
 * do nivel de impulsos do servidor (`guildUploadLimit`). Usar o
 * `attachmentSizeLimit` da interacao aqui seria repetir o defeito que derrubou
 * o primeiro render de lobo acima de 20 MB: ele inclui o Nitro de quem clicou.
 */
export function discordProductLimit(guild: Pick<Guild, 'premiumTier'>): number {
  return Math.min(BUSINESS_LIMITS.DELIVERY_MAX_BYTES, guildUploadLimit(guild));
}

/** Maior arquivo que a loja aceita HOSPEDAR; 0 sem hospedagem configurada. */
export function hostedProductLimit(hostingEnabled: boolean): number {
  return hostingEnabled ? BUSINESS_LIMITS.DELIVERY_HOSTED_MAX_BYTES : 0;
}

/**
 * Teto REAL do arquivo: o maior entre o caminho do anexo e o da hospedagem.
 *
 * E este numero que o formulario mostra, porque e o que de fato sera aceito.
 * Qual dos dois caminhos vai ser usado e decisao do envio.
 */
export function effectiveProductLimit(
  guild: Pick<Guild, 'premiumTier'>,
  hostingEnabled: boolean,
): number {
  return Math.max(discordProductLimit(guild), hostedProductLimit(hostingEnabled));
}

/** "100 MB" — derivado do limite, para o texto nunca divergir da regra. */
export function describeProductMaxSize(maxBytes: number): string {
  return describeMaxSize(maxBytes);
}

/** Prazo para baixar OU reenviar o arquivo, proporcional ao tamanho. */
export function productTransferTimeoutMs(bytes: number): number {
  return transferTimeoutMs(bytes);
}

/** Tamanho legivel do arquivo entregue ("12,4 MB", "870 KB"). */
export function formatFileSize(bytes: number): string {
  const kib = 1024;
  const mib = kib * 1024;
  if (bytes >= mib) return `${(bytes / mib).toFixed(1).replace('.', ',')} MB`;
  if (bytes >= kib) return `${Math.max(1, Math.round(bytes / kib))} KB`;
  return `${bytes} B`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function asciiBytes(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/**
 * Formato lido da ASSINATURA dos bytes.
 *
 * Nome e content-type sao declaracoes de quem enviou, e as duas mentem com
 * facilidade — inclusive sem ma fe: renomear `.rar` para `.zip` e o erro mais
 * comum de quem exporta o pack. Reenviar com a extensao errada entrega ao
 * cliente um arquivo que o computador dele nao abre, e a equipe so descobre
 * quando ele volta reclamando.
 *
 * PK\x05\x06 e PK\x07\x08 sao ZIP tambem: o primeiro e um arquivo vazio e o
 * segundo, um volume de arquivo dividido. Recusa-los diria "isto nao e um ZIP"
 * sobre algo que e.
 */
export function detectProductFormat(bytes: Uint8Array): ProductFormat | null {
  const byExt = (ext: string): ProductFormat | null =>
    PRODUCT_FORMATS.find((format) => format.ext === ext) ?? null;

  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return byExt('zip');
  }
  // RAR 4 termina em 0x00; RAR 5 acrescenta 0x01 0x00.
  if (startsWith(bytes, [...asciiBytes('Rar!'), 0x1a, 0x07])) return byExt('rar');
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return byExt('7z');
  return null;
}

/** O anexo como o formulario o entregou. */
export interface ProductUpload {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
}

/**
 * Tipos que NAO sao arquivo compactado nem por engano.
 *
 * A conferencia do content-type aqui e proposital e deliberadamente frouxa: o
 * Discord declara ZIP ora como `application/zip`, ora `application/x-zip-
 * compressed`, ora `application/octet-stream`, e recusar por essa lista
 * reprovaria entrega legitima. Barram-se so as familias que jamais sao um
 * pacote — e a unica coisa que isso compra e nao baixar 100 MB de video antes
 * de recusar. Quem decide de verdade sao os bytes (`detectProductFormat`).
 */
const REJECTED_TYPE_PREFIXES = ['image/', 'video/', 'audio/', 'text/'];

/**
 * Conferencia do que o Discord DECLAROU, antes de baixar.
 *
 * `maxBytes` e o teto EFETIVO (`effectiveProductLimit`). A mensagem so fala em
 * nivel de impulsos quando ele e mesmo o que limita: com a hospedagem ligada o
 * teto deixa de depender do servidor, e mandar alguem impulsionar seria um
 * conselho errado.
 */
export function assertProductDeclaration(
  upload: ProductUpload,
  maxBytes: number,
  hostingEnabled: boolean,
): void {
  if (upload.size > maxBytes) {
    const boostWouldHelp = !hostingEnabled && maxBytes < BUSINESS_LIMITS.DELIVERY_MAX_BYTES;
    throw new ValidationError(`Produto grande demais: ${upload.size} bytes (teto ${maxBytes})`, {
      userMessage: boostWouldHelp
        ? `O arquivo passa de ${describeProductMaxSize(maxBytes)}, o maior anexo que este servidor aceita. ` +
          'O limite sobe com o nível de impulsos (50 MB no nível 2, 100 MB no nível 3) — ' +
          'até lá, divida o pacote ou envie o link por fora.'
        : `O arquivo passa de ${describeProductMaxSize(maxBytes)}. ` +
          'Divida o pacote em partes menores e envie de novo.',
    });
  }

  const declared = (upload.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (declared.length === 0) return;

  if (REJECTED_TYPE_PREFIXES.some((prefix) => declared.startsWith(prefix))) {
    throw new ValidationError(`Produto com tipo recusado: ${declared}`, {
      userMessage: `Envie o produto compactado em ${describeProductFormats()}.`,
    });
  }
}
