import { ValidationError } from '../core/errors';

/**
 * Download de anexo do Discord.
 *
 * DELIBERADAMENTE ESTREITO: so baixa do CDN do Discord, so ate um teto de
 * bytes e com timeout. Nao existe aqui um "baixe esta URL" generico — um
 * utilitario assim viraria, mais cedo ou mais tarde, o caminho para o bot bater
 * em servico externo arbitrario (inclusive SSRF, com URL vinda de usuario).
 *
 * O unico chamador legitimo passa a URL que veio do OBJETO de anexo da
 * interacao, nunca de texto digitado.
 */

/** Hosts de anexo do Discord. Qualquer outro e recusado. */
const ALLOWED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

const DEFAULT_TIMEOUT_MS = 15_000;

export interface DownloadResult {
  bytes: Buffer;
  contentType: string;
}

const MIB = 1024 * 1024;

/**
 * Recusa por tamanho, com o teto de QUEM CHAMOU na frase.
 *
 * O texto era fixo em "ate 8 MB" — o limite do comprovante. Quando o portfolio
 * de lobos passou a baixar renders de dezenas de MB, a mesma frase dizia 8 MB
 * para um arquivo cujo teto era 100.
 */
function tooLarge(bytes: number, maxBytes: number): ValidationError {
  return new ValidationError(`Anexo grande demais: ${bytes} bytes (teto ${maxBytes})`, {
    userMessage: `Arquivo grande demais. Envie no maximo ${Math.floor(maxBytes / MIB)} MB.`,
  });
}

/**
 * Le o corpo em STREAMING, com corte real no teto.
 *
 * POR QUE NAO `response.arrayBuffer()`. Ele custa ~3,3x o tamanho do arquivo em
 * memoria: o undici acumula os chunks, faz um `Buffer.concat` e a implementacao
 * de `arrayBuffer` ainda copia tudo de novo. Medido nesta maquina, 100 MiB
 * viravam ~330 MB so no download — e o processo e reiniciado pelo PM2 em
 * 512 MB, com o envio ainda por vir. Lendo chunk a chunk para um buffer do
 * tamanho anunciado, o custo cai para ~1x.
 *
 * O corte tambem deixou de ser cosmetico: antes o arquivo inteiro ja estava na
 * memoria quando o tamanho era conferido, entao um `content-length` mentiroso
 * custava a memoria toda. Agora a leitura para no primeiro byte excedente e
 * aborta a conexao.
 */
async function readBody(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<Buffer> {
  const body = response.body;
  // Sem corpo legivel (mock de teste, resposta vazia): cai no caminho simples,
  // que ja esta protegido pelo `content-length` conferido antes.
  if (body === null || body === undefined) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw tooLarge(bytes.length, maxBytes);
    return bytes;
  }

  const declared = Number(response.headers.get('content-length') ?? '0');
  const exact = Number.isFinite(declared) && declared > 0 && declared <= maxBytes ? declared : 0;
  // Com tamanho anunciado, um buffer so; sem ele, os pedacos sao juntados no
  // fim (o caminho raro).
  const target = exact > 0 ? Buffer.allocUnsafe(exact) : null;
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    received += chunk.length;
    if (received > maxBytes) {
      controller.abort();
      throw tooLarge(received, maxBytes);
    }
    if (target !== null && received <= exact) {
      target.set(chunk, received - chunk.length);
    } else {
      // O servidor mandou mais do que anunciou: o que ja foi copiado continua
      // valendo, e o excedente vai para a lista.
      if (target !== null && chunks.length === 0) chunks.push(target.subarray(0, received - chunk.length));
      chunks.push(Buffer.from(chunk));
    }
  }

  if (chunks.length > 0) return Buffer.concat(chunks, received);
  if (target === null) return Buffer.alloc(0);
  return received === exact ? target : target.subarray(0, received);
}

export async function downloadDiscordAttachment(
  url: string,
  maxBytes: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DownloadResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`URL de anexo invalida: ${url.slice(0, 60)}`, {
      userMessage: 'Nao foi possivel ler este arquivo. Tente enviar novamente.',
    });
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ValidationError(`Anexo fora do CDN do Discord: ${parsed.hostname}`, {
      userMessage: 'Envie o arquivo como anexo da propria mensagem, nao como link.',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(parsed.href, { signal: controller.signal });
    if (!response.ok) {
      throw new ValidationError(`Download do anexo falhou: HTTP ${response.status}`, {
        userMessage: 'Nao foi possivel baixar o arquivo enviado. Tente novamente.',
      });
    }

    // Confere o tamanho ANTES de gastar rede, quando o servidor informa o
    // cabecalho. O corte real, que nao depende de ninguem falar a verdade, vem
    // chunk a chunk logo abaixo.
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw tooLarge(declared, maxBytes);
    }

    const bytes = await readBody(response, maxBytes, controller);

    return {
      bytes,
      contentType: (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '',
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(
      `Falha ao baixar anexo: ${error instanceof Error ? error.message : String(error)}`,
      { userMessage: 'Nao foi possivel baixar o arquivo enviado. Tente novamente.' },
    );
  } finally {
    clearTimeout(timer);
  }
}
