import type { Guild } from 'discord.js';

import { BUSINESS_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { guildUploadLimit } from '../../../utils/discord';
import { describeMaxSize, transferTimeoutMs } from '../../../utils/transfer';

/**
 * O render do lobo.
 *
 * O arquivo chega pelo formulario (upload de modal) e sai no post como anexo
 * do BOT. Nao existe caminho em que a URL original vire a imagem do post: link
 * de anexo do Discord expira em poucas horas, e um portfolio cujas imagens
 * somem na manha seguinte e pior que nao ter portfolio.
 */

export interface RenderFormat {
  /** Extensao do anexo reenviado. O Discord decide como exibir pela extensao. */
  ext: string;
  mime: string;
  /** Como o formato aparece para quem preenche o formulario. */
  label: string;
}

export const RENDER_FORMATS: readonly RenderFormat[] = [
  { ext: 'png', mime: 'image/png', label: 'PNG' },
  { ext: 'jpg', mime: 'image/jpeg', label: 'JPG' },
  { ext: 'webp', mime: 'image/webp', label: 'WEBP' },
  { ext: 'gif', mime: 'image/gif', label: 'GIF' },
];

/** "PNG, JPG, WEBP ou GIF" — a mesma lista no painel, no formulario e no erro. */
export function describeRenderFormats(): string {
  const labels = RENDER_FORMATS.map((format) => format.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} ou ${labels[labels.length - 1] ?? ''}`;
}

/**
 * Maior render que vira ANEXO da mensagem do bot neste servidor.
 *
 * Quem limita e o reenvio do bot, nao o upload de quem preenche o formulario:
 * uma conta com Nitro sobe 500 MB pelo modal, mas o bot so reenvia ate o limite
 * do nivel de impulsos do servidor (`guildUploadLimit`).
 *
 * A PRIMEIRA versao lia `interaction.attachmentSizeLimit` — que o Discord
 * calcula como o MAXIMO entre o Nitro de quem clicou e o nivel do servidor. Com
 * Nitro na conta, ela prometia 100 MB num servidor que aceita 20, e o reenvio
 * tomava 40005.
 */
export function discordRenderLimit(guild: Pick<Guild, 'premiumTier'>): number {
  return Math.min(BUSINESS_LIMITS.WOLF_RENDER_MAX_BYTES, guildUploadLimit(guild));
}

/**
 * Maior render que a loja aceita HOSPEDAR no proprio Worker; 0 quando nao ha
 * hospedagem configurada.
 *
 * Acima do limite de anexo do Discord o render vai para o Worker e entra no
 * post como link. E o que permite publicar um render de 50 MB num servidor sem
 * impulso — o post deixa de depender do nivel do servidor e passa a depender do
 * Worker continuar no ar, que e a troca aceita aqui.
 */
export function hostedRenderLimit(hostingEnabled: boolean): number {
  return hostingEnabled ? BUSINESS_LIMITS.WOLF_HOSTED_MAX_BYTES : 0;
}

/**
 * Teto REAL do render: o maior entre o caminho do anexo e o da hospedagem.
 *
 * E este numero que o painel e o formulario mostram, porque e o que de fato
 * sera aceito — qual dos dois caminhos vai ser usado e decisao do envio, e nao
 * muda nada para quem preenche o formulario.
 */
export function effectiveRenderLimit(
  guild: Pick<Guild, 'premiumTier'>,
  hostingEnabled: boolean,
): number {
  return Math.max(discordRenderLimit(guild), hostedRenderLimit(hostingEnabled));
}

/**
 * As duas contas abaixo valem para qualquer arquivo grande e moram em
 * `utils/transfer` desde que a entrega de produto no ticket passou a precisar
 * das mesmas. Os nomes proprios continuam aqui para as chamadas do portfolio
 * seguirem lendo como portfolio.
 */

/** "100 MB" — derivado do limite, para o texto nunca divergir da regra. */
export function describeRenderMaxSize(maxBytes: number): string {
  return describeMaxSize(maxBytes);
}

/** Prazo para baixar OU reenviar o render, proporcional ao tamanho. */
export function renderTransferTimeoutMs(bytes: number): number {
  return transferTimeoutMs(bytes);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function asciiBytes(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/**
 * Formato da imagem lido da ASSINATURA dos bytes.
 *
 * Nome e content-type sao declaracoes de quem enviou, e as duas mentem com
 * facilidade: um `.png` que na verdade e WEBP, um PDF renomeado. Reenviar com a
 * extensao errada faz o Discord mostrar um quadrado quebrado no post publico —
 * e isso so seria notado por quem abrisse o portfolio depois.
 */
export function detectRenderFormat(bytes: Uint8Array): RenderFormat | null {
  const byExt = (ext: string): RenderFormat | null =>
    RENDER_FORMATS.find((format) => format.ext === ext) ?? null;

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return byExt('png');
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return byExt('jpg');
  if (startsWith(bytes, asciiBytes('GIF87a')) || startsWith(bytes, asciiBytes('GIF89a'))) return byExt('gif');
  // WEBP: "RIFF", 4 bytes de tamanho, "WEBP".
  if (startsWith(bytes, asciiBytes('RIFF')) && startsWith(bytes, asciiBytes('WEBP'), 8)) return byExt('webp');
  return null;
}

/** O anexo como o formulario o entregou. */
export interface RenderUpload {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
}

/**
 * Conferencia do que o Discord DECLAROU, antes de baixar.
 *
 * Nao substitui a leitura dos bytes — so poupa o download de um arquivo que ja
 * se sabe recusado (um video, um PDF, um render maior que o servidor aceita).
 * Content-type ausente nao reprova: o Discord as vezes omite, e quem decide
 * nesse caso sao os bytes.
 *
 * `maxBytes` e o teto EFETIVO (`effectiveRenderLimit`). A mensagem so fala em
 * nivel de impulsos quando ele e mesmo o que limita: com a hospedagem ligada,
 * o teto deixa de depender do servidor, e mandar alguem impulsionar seria um
 * conselho errado.
 */
export function assertRenderDeclaration(
  upload: RenderUpload,
  maxBytes: number,
  hostingEnabled: boolean,
): void {
  if (upload.size > maxBytes) {
    const boostWouldHelp = !hostingEnabled && maxBytes < BUSINESS_LIMITS.WOLF_RENDER_MAX_BYTES;
    throw new ValidationError(`Render grande demais: ${upload.size} bytes (teto ${maxBytes})`, {
      userMessage: boostWouldHelp
        ? `O render passa de ${describeRenderMaxSize(maxBytes)}, o maior anexo que este servidor aceita. ` +
          'O limite sobe com o nivel de impulsos (50 MB no nivel 2, 100 MB no nivel 3) — ' +
          'ate la, exporte em JPG ou WEBP, ou reduza a resolucao.'
        : `O render passa de ${describeRenderMaxSize(maxBytes)}. ` +
          'Exporte em JPG ou WEBP, ou reduza a resolucao, e envie de novo.',
    });
  }

  const declared = (upload.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (declared.length === 0) return;

  const accepted =
    declared === 'image/jpg' || RENDER_FORMATS.some((format) => format.mime === declared);
  if (!accepted) {
    throw new ValidationError(`Render com tipo recusado: ${declared}`, {
      userMessage: `Envie o render como imagem ${describeRenderFormats()}.`,
    });
  }
}
