import { afterEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../src/core/errors';
import { downloadDiscordAttachment } from '../src/utils/download';

/**
 * Download de anexo do Discord.
 *
 * O QUE ESTES TESTES TRAVAM:
 *  1. o corpo e lido em STREAMING, com corte no teto — `response.arrayBuffer()`
 *     custava ~3,3x o tamanho do arquivo em memoria (medido: 100 MiB viravam
 *     ~330 MB), e o processo e reiniciado pelo PM2 em 512 MB;
 *  2. o corte vale mesmo quando o `content-length` mente — antes o arquivo
 *     inteiro ja estava na memoria quando o tamanho era conferido;
 *  3. so o CDN do Discord e aceito (a defesa contra SSRF);
 *  4. a recusa por tamanho fala o teto de QUEM CHAMOU, nao um numero fixo.
 */

const URL_OK = 'https://cdn.discordapp.com/attachments/1/2/render.png';

function streamOf(chunks: readonly Buffer[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

/** Resposta com corpo em stream; `declared` vai no content-length. */
function respond(chunks: readonly Buffer[], declared?: number): Response {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const headers: Record<string, string> = { 'content-type': 'image/png' };
  if (declared !== 0) headers['content-length'] = String(declared ?? total);
  return new Response(streamOf(chunks), { status: 200, headers });
}

function stubFetch(response: Response | (() => Response)): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(typeof response === 'function' ? response() : response)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('download de anexo', () => {
  it('le o corpo inteiro e devolve o tipo', async () => {
    const bytes = Buffer.from('imagem-de-teste');
    stubFetch(respond([bytes]));

    const result = await downloadDiscordAttachment(URL_OK, 1024);

    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.contentType).toBe('image/png');
  });

  it('junta os pedacos na ordem', async () => {
    const chunks = [Buffer.from('aa'), Buffer.from('bb'), Buffer.from('cc')];
    stubFetch(respond(chunks));

    const result = await downloadDiscordAttachment(URL_OK, 1024);

    expect(result.bytes.toString()).toBe('aabbcc');
  });

  it('funciona sem content-length (o caminho raro)', async () => {
    const chunks = [Buffer.from('aa'), Buffer.from('bb')];
    stubFetch(respond(chunks, 0));

    const result = await downloadDiscordAttachment(URL_OK, 1024);

    expect(result.bytes.toString()).toBe('aabb');
  });

  /**
   * Corpo servido sob demanda: cada pedaco so nasce quando alguem le.
   *
   * E o unico jeito de o teste enxergar ONDE a leitura parou — um stream que
   * enfileira tudo no `start` entregaria o arquivo inteiro de qualquer forma.
   */
  function lazyResponse(
    chunkCount: number,
    chunkSize: number,
    declared: number,
  ): { response: Response; pulls: () => number } {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= chunkCount) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(new Uint8Array(Buffer.alloc(chunkSize)));
      },
    });
    return {
      response: new Response(stream, {
        status: 200,
        headers: { 'content-length': String(declared) },
      }),
      pulls: () => pulled,
    };
  }

  it('recusa pelo content-length sem puxar o corpo', async () => {
    const { response, pulls } = lazyResponse(20, 16, 320);
    stubFetch(response);

    await expect(downloadDiscordAttachment(URL_OK, 10)).rejects.toBeInstanceOf(ValidationError);
    // No maximo o pedaco que o proprio stream adianta ao ser criado — nunca os 20.
    expect(pulls()).toBeLessThanOrEqual(1);
  });

  /**
   * O caso que a leitura por streaming resolve: o cabecalho mente e o corte
   * real precisa acontecer no meio da transferencia, nao depois de o arquivo
   * inteiro estar na memoria.
   */
  it('corta no teto mesmo quando o content-length mente, sem ler o resto', async () => {
    // Anuncia 16 bytes e entrega 100 pedacos de 16 (1600).
    const { response, pulls } = lazyResponse(100, 16, 16);
    stubFetch(response);

    await expect(downloadDiscordAttachment(URL_OK, 32)).rejects.toBeInstanceOf(ValidationError);
    // Parou logo depois de passar dos 32 bytes; o corpo inteiro nunca existiu
    // na memoria.
    expect(pulls()).toBeLessThanOrEqual(5);
  });

  it('aceita exatamente o teto', async () => {
    const bytes = Buffer.alloc(64, 7);
    stubFetch(respond([bytes]));

    const result = await downloadDiscordAttachment(URL_OK, 64);

    expect(result.bytes.length).toBe(64);
  });

  /**
   * A frase era fixa em "ate 8 MB" — o teto do comprovante — e aparecia tambem
   * no fluxo do render, cujo teto chega a 100 MB.
   */
  it.each([
    [8 * 1024 * 1024, '8 MB'],
    [50 * 1024 * 1024, '50 MB'],
  ])('a recusa por tamanho fala o teto de quem chamou (%s)', async (maxBytes, esperado) => {
    const declarado = maxBytes + 1;
    stubFetch(respond([Buffer.from('x')], declarado));

    const erro = (await downloadDiscordAttachment(URL_OK, maxBytes).catch(
      (error: unknown) => error,
    )) as ValidationError;

    expect(erro).toBeInstanceOf(ValidationError);
    expect(erro.userMessage).toContain(esperado);
  });

  it.each([
    'https://exemplo.com/arquivo.png',
    'http://cdn.discordapp.com/attachments/1/2/a.png',
    'https://cdn.discordapp.com.evil.test/a.png',
  ])('recusa endereco fora do CDN do Discord (%s)', async (url) => {
    stubFetch(respond([Buffer.from('x')]));

    await expect(downloadDiscordAttachment(url, 1024)).rejects.toBeInstanceOf(ValidationError);
  });

  it('HTTP de erro vira ValidationError, nao vazamento do corpo', async () => {
    stubFetch(new Response('nao encontrado', { status: 404 }));

    await expect(downloadDiscordAttachment(URL_OK, 1024)).rejects.toBeInstanceOf(ValidationError);
  });
});
