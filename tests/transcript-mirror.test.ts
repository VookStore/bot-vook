import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptAttachment, TranscriptMessage } from '../src/modules/tickets/types/transcript';

/*
 * Espelhamento dos anexos do transcript.
 *
 * A URL de anexo do Discord expira em poucas horas, entao um transcript
 * guardado nasce com prazo de validade — e o comprovante, que e justamente o
 * que se reabre meses depois, e o primeiro a morrer. O servico baixa cada
 * anexo e grava uma copia junto do HTML.
 *
 * O QUE ESTE ARQUIVO PROTEGE. Tudo aqui roda DENTRO do fechamento do ticket,
 * que segura um lock e tem um cliente esperando. Os testes de teto e de falha
 * existem para garantir que nenhum anexo gigante, CDN lento ou Worker fora do
 * ar transforme "fechar ticket" numa operacao que nao termina.
 */

const env = {
  TRANSCRIPT_BASE_URL: 'https://transcripts.example' as string | null,
  TRANSCRIPT_UPLOAD_TOKEN: 'segredo' as string | null,
};

vi.mock('../src/config/env', () => ({
  getEnv: () => env,
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { mirrorTranscriptAttachments } from '../src/modules/tickets/services/TranscriptHostingService';

const MB = 1024 * 1024;

function attachment(overrides: Partial<TranscriptAttachment> = {}): TranscriptAttachment {
  return {
    name: 'comprovante.png',
    url: 'https://cdn.discordapp.com/attachments/1/2/comprovante.png',
    size: 1024,
    contentType: 'image/png',
    ...overrides,
  };
}

function message(attachments: TranscriptAttachment[]): TranscriptMessage {
  return {
    id: '1',
    author: {
      id: '2',
      displayName: 'Cliente',
      username: 'cliente',
      avatarUrl: null,
      isBot: false,
    },
    createdAt: new Date('2026-08-30T12:00:00Z'),
    editedAt: null,
    content: '',
    attachments,
    embedCount: 0,
    replyToId: null,
    replyToAuthorName: null,
  };
}

/** Stub de `fetch` que aceita download e upload e registra as chamadas. */
function stubFetch(options: { downloadOk?: boolean; uploadOk?: boolean } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const impl = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    if (method === 'PUT') {
      return Promise.resolve({ ok: options.uploadOk ?? true } as Response);
    }
    return Promise.resolve({
      ok: options.downloadOk ?? true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as Response);
  });

  vi.stubGlobal('fetch', impl);
  return calls;
}

describe('mirrorTranscriptAttachments', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    env.TRANSCRIPT_BASE_URL = 'https://transcripts.example';
    env.TRANSCRIPT_UPLOAD_TOKEN = 'segredo';
  });

  it('nao toca na rede quando nao ha hospedagem configurada', async () => {
    env.TRANSCRIPT_BASE_URL = null;
    env.TRANSCRIPT_UPLOAD_TOKEN = null;
    const calls = stubFetch();

    const result = await mirrorTranscriptAttachments([message([attachment()])]);

    expect(calls).toHaveLength(0);
    expect(result[0]?.attachments[0]?.hostedUrl).toBeUndefined();
  });

  it('grava a copia e aponta o anexo para ela', async () => {
    const calls = stubFetch();

    const result = await mirrorTranscriptAttachments([message([attachment()])]);

    const hosted = result[0]?.attachments[0]?.hostedUrl;
    expect(hosted).toMatch(/^https:\/\/transcripts\.example\/a\/[a-f0-9]{32}$/);

    const upload = calls.find((call) => call.method === 'PUT');
    expect(upload?.url).toBe(hosted);
    expect(upload?.headers.authorization).toBe('Bearer segredo');
  });

  it('nao altera a lista original', async () => {
    stubFetch();
    const original = message([attachment()]);

    const result = await mirrorTranscriptAttachments([original]);

    expect(original.attachments[0]).not.toHaveProperty('hostedUrl');
    expect(result[0]).not.toBe(original);
  });

  /*
   * O tamanho ja vem do Discord, entao o arquivo grande demais e descartado
   * SEM custo de rede — o teto existe para o fechamento nao pendurar, e baixar
   * 40 MB antes de decidir descartar derrotaria o proposito.
   */
  it('nem baixa o anexo acima do teto por arquivo', async () => {
    const calls = stubFetch();

    const result = await mirrorTranscriptAttachments([
      message([attachment({ name: 'video.mp4', size: 20 * MB })]),
    ]);

    expect(calls).toHaveLength(0);
    expect(result[0]?.attachments[0]?.hostedUrl).toBeUndefined();
  });

  it('respeita o teto total do ticket', async () => {
    stubFetch();

    // 8 arquivos de 7 MB = 56 MB, acima do teto de 48 MB do ticket.
    const anexos = Array.from({ length: 8 }, (_, index) =>
      attachment({ name: `p${index}.png`, size: 7 * MB }),
    );

    const result = await mirrorTranscriptAttachments([message(anexos)]);

    const espelhados = result[0]?.attachments.filter(
      (item) => typeof item.hostedUrl === 'string',
    );
    expect(espelhados?.length).toBe(6);
  });

  it('mantem o link original quando o download falha', async () => {
    stubFetch({ downloadOk: false });

    const result = await mirrorTranscriptAttachments([message([attachment()])]);

    expect(result[0]?.attachments[0]?.hostedUrl).toBeUndefined();
    expect(result[0]?.attachments[0]?.url).toContain('cdn.discordapp.com');
  });

  it('mantem o link original quando o upload e recusado', async () => {
    stubFetch({ uploadOk: false });

    const result = await mirrorTranscriptAttachments([message([attachment()])]);

    expect(result[0]?.attachments[0]?.hostedUrl).toBeUndefined();
  });

  /*
   * O tipo vai num cabecalho proprio e o Worker o compara com uma lista exata
   * para decidir o que serve inline. `image/png; charset=utf-8` nao bateria.
   */
  it('envia o tipo sem parametros', async () => {
    const calls = stubFetch();

    await mirrorTranscriptAttachments([
      message([attachment({ contentType: 'image/PNG; charset=utf-8' })]),
    ]);

    const upload = calls.find((call) => call.method === 'PUT');
    expect(upload?.headers['x-asset-type']).toBe('image/png');
  });

  /*
   * Nome de arquivo vem de quem enviou: acento e emoji sao comuns, e `fetch`
   * recusa qualquer coisa fora de latin-1 num cabecalho — a requisicao nem
   * sairia. O Worker sanitiza de novo do outro lado.
   */
  it('reduz o nome do arquivo a ASCII no cabecalho', async () => {
    const calls = stubFetch();

    await mirrorTranscriptAttachments([
      message([attachment({ name: 'comprovante-pix-ação-🧾.png' })]),
    ]);

    const upload = calls.find((call) => call.method === 'PUT');
    const nome = upload?.headers['x-asset-name'] ?? '';
    expect(nome).toMatch(/^[\x20-\x7e]*$/);
    expect(nome).toContain('comprovante-pix-a');
    expect(nome.endsWith('.png')).toBe(true);
  });
});
