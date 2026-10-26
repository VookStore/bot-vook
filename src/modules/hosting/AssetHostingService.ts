import { randomBytes } from 'node:crypto';

import { getEnv } from '../../config/env';
import { createLogger } from '../../core/logger/Logger';

/**
 * Hospedagem de arquivo no Worker da loja.
 *
 * O bot guarda copia de arquivo em UM lugar so: a rota `/a/<id>` do Worker,
 * gravada no R2. Dois recursos dependem dela por motivos diferentes — o
 * transcript re-hospeda os anexos do ticket porque a URL do Discord expira em
 * horas, e o portfolio de lobos publica o render por link quando ele passa do
 * maior anexo que o BOT consegue enviar no servidor.
 *
 * ESTE MODULO E O UNICO QUE CONHECE O PROTOCOLO (rota, cabecalhos, token).
 * Antes ele vivia dentro do servico de transcript; com o segundo chamador, uma
 * copia significaria descobrir na terceira mudanca de rota que metade do bot
 * ficou para tras.
 *
 * OPCIONAL POR CONSTRUCAO: sem `TRANSCRIPT_BASE_URL`/`TRANSCRIPT_UPLOAD_TOKEN`
 * no ambiente, `hostAsset` devolve `null` sem tocar na rede. Quem chama decide
 * o que fazer com a ausencia — o transcript segue com o link original, o
 * portfolio recusa o render e explica.
 */

const logger = createLogger('hosting:asset');

/** True quando ha Worker e token configurados. */
export function isAssetHostingEnabled(): boolean {
  const { TRANSCRIPT_BASE_URL: base, TRANSCRIPT_UPLOAD_TOKEN: token } = getEnv();
  return base !== null && token !== null;
}

/**
 * Valor seguro para cabecalho HTTP.
 *
 * Nome de arquivo vem de quem enviou: acento, emoji e quebra de linha sao
 * comuns. `fetch` recusa (com razao) qualquer coisa fora de latin-1, e uma
 * quebra de linha seria injecao de cabecalho. O Worker sanitiza de novo do
 * outro lado; esta e a metade que impede a requisicao de nem sair.
 */
export function asciiHeader(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '_').slice(0, 120);
}

export interface HostAssetParams {
  bytes: ArrayBuffer | Uint8Array;
  /** Nome exibido no download. So informativo. */
  name: string;
  /** Tipo real do arquivo; o Worker decide por ele o que serve inline. */
  contentType: string;
  /**
   * Extensao acrescentada ao endereco (`png`, `jpg`...).
   *
   * Decorativa para o Worker, que le o arquivo pelos 32 hex — mas e ela que faz
   * o Discord tratar o link como imagem ao renderizar um post. Exige o Worker
   * atualizado: a versao antiga da rota recusa endereco com extensao, e o envio
   * falha de forma visivel em vez de publicar um post com imagem quebrada.
   */
  ext?: string;
  timeoutMs: number;
}

/**
 * Grava o arquivo e devolve a URL publica; `null` quando desligado ou ao falhar.
 *
 * NUNCA LANCA. Rede fora, Worker nao publicado, token errado e arquivo acima do
 * limite do Cloudflare viram `null` com warning — cabe a quem chamou decidir se
 * isso e fatal.
 */
export async function hostAsset(params: HostAssetParams): Promise<string | null> {
  const { TRANSCRIPT_BASE_URL: base, TRANSCRIPT_UPLOAD_TOKEN: token } = getEnv();
  if (base === null || token === null) return null;

  const id = randomBytes(16).toString('hex');
  const suffix = params.ext !== undefined && params.ext.length > 0 ? `.${params.ext}` : '';
  const target = `${base}/a/${id}${suffix}`;

  try {
    const response = await fetch(target, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        // O tipo real vai no cabecalho proprio: o Worker decide sozinho o que
        // devolver no GET e nunca confia no content-type do corpo.
        'content-type': 'application/octet-stream',
        'x-asset-name': asciiHeader(params.name),
        // Sem parametros: o Worker compara com uma lista exata de tipos.
        'x-asset-type': asciiHeader(params.contentType.split(';')[0]?.trim().toLowerCase() ?? ''),
      },
      body: params.bytes,
      signal: AbortSignal.timeout(params.timeoutMs),
    });

    if (response.ok) return target;

    logger.warn('Hospedagem recusou o arquivo.', {
      status: response.status,
      bytes: params.bytes.byteLength,
      hasExtension: suffix.length > 0,
    });
    return null;
  } catch (error) {
    logger.warn('Falha ao hospedar o arquivo.', {
      bytes: params.bytes.byteLength,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
