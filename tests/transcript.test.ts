import { Collection, type Message, type TextChannel } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  buildTranscriptAttachment,
  buildTranscriptFilename,
  fetchChannelMessages,
  renderTranscriptHtml,
} from '../src/modules/tickets/services/TranscriptService';
import type {
  TranscriptAttachment,
  TranscriptHeader,
  TranscriptMessage,
} from '../src/modules/tickets/types/transcript';

/**
 * Testes do transcript HTML.
 *
 * Foco principal: nenhum conteudo enviado por usuario pode virar markup ativo.
 * A funcao de renderizacao e pura, entao tudo aqui roda sem Client do Discord.
 */

const OPENED_AT = new Date('2026-08-22T12:00:00.000Z');
const CLOSED_AT = new Date('2026-08-22T14:15:30.000Z');
const DURATION_MS = CLOSED_AT.getTime() - OPENED_AT.getTime();

function makeHeader(overrides: Partial<TranscriptHeader> = {}): TranscriptHeader {
  return {
    storeName: 'Vook Store',
    ticketNumber: 125,
    categoryName: 'Suporte',
    subject: 'Problema com o pedido',
    ownerId: '111111111111111111',
    ownerName: 'Cliente Teste',
    staffId: '222222222222222222',
    staffName: 'Atendente Teste',
    closedById: '222222222222222222',
    closedByName: 'Atendente Teste',
    participants: [{ id: '333333333333333333', name: 'Convidado' }],
    openedAt: OPENED_AT,
    closedAt: CLOSED_AT,
    closeReason: 'Resolvido',
    durationMs: DURATION_MS,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    id: '999999999999999999',
    author: {
      id: '111111111111111111',
      username: 'cliente',
      displayName: 'Cliente Teste',
      avatarUrl: 'https://cdn.discordapp.com/avatars/1/abc.png',
      isBot: false,
    },
    createdAt: OPENED_AT,
    content: 'Ola, preciso de ajuda.',
    attachments: [],
    embedCount: 0,
    replyToId: null,
    replyToAuthorName: null,
    editedAt: null,
    ...overrides,
  };
}

/** Decodifica as entidades que `escapeHtml` produz, como faria um navegador. */
function decodeEntities(input: string): string {
  const table: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#96;': '`',
    '&#61;': '=',
  };
  return input.replace(/&(?:amp|lt|gt|quot|#39|#96|#61);/g, (entity) => table[entity] ?? entity);
}

function makeAttachment(overrides: Partial<TranscriptAttachment> = {}): TranscriptAttachment {
  return {
    name: 'nota.pdf',
    url: 'https://cdn.discordapp.com/attachments/1/2/nota.pdf',
    size: 2048,
    contentType: 'application/pdf',
    ...overrides,
  };
}

describe('renderTranscriptHtml — estrutura do documento', () => {
  it('gera um documento HTML completo e auto-contido', () => {
    const html = renderTranscriptHtml(makeHeader(), [makeMessage()]);

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<style>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('nunca inclui script ou recurso externo executavel', () => {
    const html = renderTranscriptHtml(makeHeader(), [makeMessage()]);

    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('<iframe');
    expect(html.toLowerCase()).not.toContain('<object');
    expect(html.toLowerCase()).not.toContain('onerror=');
    expect(html.toLowerCase()).not.toContain('<link ');
  });

  it('renderiza o numero do ticket com padStart e a duracao', () => {
    const html = renderTranscriptHtml(makeHeader(), []);

    expect(html).toContain('Atendimento #0125');
    // 2h 15m 30s entre openedAt e closedAt.
    expect(html).toContain('2h 15m 30s');
  });

  it('renderiza cabecalho, participantes e rodape', () => {
    const html = renderTranscriptHtml(makeHeader(), [makeMessage()]);

    expect(html).toContain('Vook Store');
    expect(html).toContain('Suporte');
    expect(html).toContain('Cliente Teste');
    expect(html).toContain('Atendente Teste');
    expect(html).toContain('Convidado');
    expect(html).toContain('333333333333333333');
    expect(html).toContain('1 mensagem registrada');
    expect(html).toContain('Transcript gerado em');
  });

  it('mostra aviso amigavel quando nao ha mensagens', () => {
    const html = renderTranscriptHtml(makeHeader(), []);

    expect(html).toContain('Nenhuma mensagem foi registrada neste atendimento.');
    expect(html).toContain('0 mensagens registradas');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).not.toContain('<article class="msg"');
  });

  it('usa textos de fallback para responsavel e motivo ausentes', () => {
    const html = renderTranscriptHtml(
      makeHeader({ staffId: null, staffName: null, closeReason: null }),
      [],
    );

    expect(html).toContain('Nao atribuido');
    expect(html).toContain('Nao informado');
  });
});

describe('renderTranscriptHtml — seguranca contra XSS', () => {
  it('nao deixa <script> do usuario virar markup', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ content: '<script>alert(1)</script>' }),
    ]);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapa aspas e sinais de menor/maior no username e no apelido', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({
        author: {
          id: '444444444444444444',
          username: 'evil"><img src=x onerror=alert(1)>',
          displayName: '<b>"Chefe"</b>',
          avatarUrl: null,
          isBot: false,
        },
      }),
    ]);

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror=');
    expect(html).toContain('&lt;img src&#61;x onerror&#61;alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;&quot;Chefe&quot;&lt;/b&gt;');
  });

  it('escapa HTML no assunto e no motivo de encerramento', () => {
    const html = renderTranscriptHtml(
      makeHeader({
        subject: '<iframe src="javascript:alert(1)"></iframe>',
        closeReason: '<object data="x"></object> encerrado',
      }),
      [],
    );

    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).toContain('&lt;iframe src&#61;&quot;javascript:alert(1)&quot;&gt;');
    expect(html).toContain('&lt;object data&#61;&quot;x&quot;&gt;');
  });

  it('escapa HTML no nome da loja, categoria e nomes de participantes', () => {
    const html = renderTranscriptHtml(
      makeHeader({
        storeName: '<h1>Loja</h1>',
        categoryName: '<span>Cat</span>',
        ownerName: '<u>Dono</u>',
        participants: [{ id: '555555555555555555', name: '<i>Amigo</i>' }],
      }),
      [],
    );

    expect(html).not.toContain('<h1>Loja</h1>');
    expect(html).not.toContain('<span>Cat</span>');
    expect(html).not.toContain('<u>Dono</u>');
    expect(html).not.toContain('<i>Amigo</i>');
    expect(html).toContain('&lt;h1&gt;Loja&lt;/h1&gt;');
    expect(html).toContain('&lt;i&gt;Amigo&lt;/i&gt;');
  });
});

describe('renderTranscriptHtml — URLs', () => {
  it('nao transforma anexo com url javascript: em link', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({
        attachments: [makeAttachment({ name: 'malicioso.txt', url: 'javascript:alert(1)' })],
      }),
    ]);

    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<a href="javascript');
    expect(html).toContain('link bloqueado: javascript:alert(1)');
    expect(html).toContain('malicioso.txt');
  });

  it('rejeita anexo com url data: e escapa o nome do arquivo', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({
        attachments: [
          makeAttachment({
            name: '<script>x</script>.txt',
            url: 'data:text/html;base64,PHNjcmlwdD4=',
            contentType: null,
          }),
        ],
      }),
    ]);

    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;.txt');
  });

  it('cria link seguro para anexo https e mostra tamanho legivel', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ attachments: [makeAttachment()] }),
    ]);

    expect(html).toContain(
      '<a href="https://cdn.discordapp.com/attachments/1/2/nota.pdf" target="_blank" rel="noopener noreferrer nofollow">nota.pdf</a>',
    );
    expect(html).toContain('2,0 KB');
    expect(html).toContain('application/pdf');
  });

  /*
   * Anexos re-hospedados.
   *
   * A URL do CDN do Discord expira em poucas horas, entao o transcript nasce
   * com prazo de validade. Quando o espelhamento funciona, `hostedUrl` chega
   * preenchido e o HTML tem de preferir esse endereco; quando nao, o documento
   * precisa dizer que o link e temporario em vez de fingir que esta tudo certo.
   */
  describe('anexos hospedados', () => {
    const HOSTED = 'https://transcripts.vook.example/a/0123456789abcdef0123456789abcdef';

    it('prefere a copia hospedada ao link do Discord', () => {
      const html = renderTranscriptHtml(makeHeader(), [
        makeMessage({ attachments: [makeAttachment({ hostedUrl: HOSTED })] }),
      ]);

      expect(html).toContain(HOSTED);
      expect(html).not.toContain('cdn.discordapp.com/attachments/1/2/nota.pdf');
    });

    it('marca como temporario o anexo que nao foi espelhado', () => {
      const html = renderTranscriptHtml(makeHeader(), [
        makeMessage({ attachments: [makeAttachment()] }),
      ]);

      expect(html).toContain('link temporario');
    });

    it('nao marca como temporario o anexo espelhado', () => {
      const html = renderTranscriptHtml(makeHeader(), [
        makeMessage({ attachments: [makeAttachment({ hostedUrl: HOSTED })] }),
      ]);

      expect(html).not.toContain('link temporario');
    });

    it('desenha imagem espelhada dentro da conversa', () => {
      const html = renderTranscriptHtml(makeHeader(), [
        makeMessage({
          attachments: [
            makeAttachment({
              name: 'comprovante.png',
              contentType: 'image/png',
              hostedUrl: HOSTED,
            }),
          ],
        }),
      ]);

      expect(html).toContain(`<img src="${HOSTED}" alt="comprovante.png"`);
      expect(html).toContain('class="shot"');
    });

    /*
     * Imagem NAO espelhada continua como link. Um `<img>` apontando para o CDN
     * daria miniatura hoje e icone quebrado amanha — pior que o link de texto,
     * que ao menos deixa claro que existe um arquivo ali.
     */
    it('nao desenha imagem que ainda aponta para o Discord', () => {
      const html = renderTranscriptHtml(makeHeader(), [
        makeMessage({
          attachments: [makeAttachment({ name: 'foto.png', contentType: 'image/png' })],
        }),
      ]);

      expect(html).not.toContain('class="shot"');
      expect(html).toContain('link temporario');
    });

    it('nao desenha tipo fora da lista branca, mesmo espelhado', () => {
      const html = renderTranscriptHtml(makeHeader(), [
        makeMessage({
          attachments: [
            makeAttachment({
              name: 'mapa.svg',
              // SVG carrega script; fica fora da lista branca de propósito.
              contentType: 'image/svg+xml',
              hostedUrl: HOSTED,
            }),
          ],
        }),
      ]);

      expect(html).not.toContain('class="shot"');
      expect(html).toContain(`<a href="${HOSTED}"`);
    });
  });

  it('nao usa avatar com protocolo perigoso no src', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({
        author: {
          id: '111111111111111111',
          username: 'cliente',
          displayName: 'Cliente Teste',
          avatarUrl: 'javascript:alert(1)',
          isBot: false,
        },
      }),
    ]);

    expect(html).not.toContain('src="javascript:');
    expect(html).not.toContain('<img src=');
    // Placeholder textual com a inicial do apelido, jamais um <img> arbitrario.
    expect(html).toContain('<div class="avatar-fallback">C</div>');
  });

  it('usa avatar https quando valido', () => {
    const html = renderTranscriptHtml(makeHeader(), [makeMessage()]);

    expect(html).toContain('<img src="https://cdn.discordapp.com/avatars/1/abc.png"');
    expect(html).not.toContain('<div class="avatar-fallback">');
  });
});

describe('renderTranscriptHtml — conteudo das mensagens', () => {
  it('converte quebras de linha em <br>', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ content: 'linha 1\nlinha 2\r\nlinha 3' }),
    ]);

    expect(html).toContain('linha 1<br>linha 2<br>linha 3');
  });

  it('marca mensagem editada e badge BOT', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({
        editedAt: CLOSED_AT,
        author: {
          id: '777777777777777777',
          username: 'vookbot',
          displayName: 'Vook Bot',
          avatarUrl: null,
          isBot: true,
        },
      }),
    ]);

    expect(html).toContain('(editado)');
    expect(html).toContain('<span class="badge">BOT</span>');
    expect(html).toContain('@vookbot');
  });

  it('avisa sobre embeds nao renderizados', () => {
    const html = renderTranscriptHtml(makeHeader(), [makeMessage({ embedCount: 3 })]);

    expect(html).toContain('3 embed(s) nao renderizado(s)');
  });

  it('nao exibe aviso de embed quando nao ha embeds', () => {
    const html = renderTranscriptHtml(makeHeader(), [makeMessage({ embedCount: 0 })]);

    expect(html).not.toContain('embed(s) nao renderizado(s)');
  });

  it('renderiza bloco de resposta com o autor escapado', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ replyToId: '888888888888888888', replyToAuthorName: '<b>Ana</b>' }),
    ]);

    expect(html).toContain('Em resposta a');
    expect(html).toContain('888888888888888888');
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(html).not.toContain('<b>Ana</b>');
  });

  it('usa autor desconhecido quando a referencia nao foi resolvida', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ replyToId: '888888888888888888', replyToAuthorName: null }),
    ]);

    expect(html).toContain('autor desconhecido');
  });

  it('indica mensagem sem texto', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ content: '', attachments: [makeAttachment()] }),
    ]);

    expect(html).toContain('(mensagem sem texto)');
  });

  it('transforma url http(s) do conteudo em link seguro', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ content: 'veja https://vook.store/ajuda' }),
    ]);

    expect(html).toContain('<a href="https://vook.store/ajuda"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('exibe aviso quando mensagens antigas foram omitidas', () => {
    const html = renderTranscriptHtml(makeHeader(), [makeMessage()], 42);

    expect(html).toContain('42 mensagens mais antigas foram omitidas');
  });

  // Regressao: o href era montado a partir do texto JA escapado e sofria escape
  // duplo ("&amp;" virava "&amp;amp;"), quebrando toda URL com query string —
  // isto e, praticamente todo link de CDN do Discord colado numa conversa.
  it('preserva a url original no href de links com query string', () => {
    const url = 'https://cdn.discordapp.com/attachments/1/2/f.png?ex=68a&is=68b&hm=abc';
    const html = renderTranscriptHtml(makeHeader(), [makeMessage({ content: `veja ${url}` })]);

    const href = /<a href="([^"]*)"/.exec(html)?.[1];
    expect(href).toBeDefined();
    // O atributo carrega as entidades; o navegador as decodifica de volta na URL.
    expect(decodeEntities(href ?? '')).toBe(url);
    expect(html).not.toContain('&amp;amp;');
  });

  it('nao cria link quando a url do conteudo tem protocolo perigoso', () => {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ content: 'clique em javascript:alert(1) agora' }),
    ]);

    expect(html).not.toContain('<a href=');
  });
});

describe('formatBytes (via anexo)', () => {
  function sizeLabel(size: number): string | undefined {
    const html = renderTranscriptHtml(makeHeader(), [
      makeMessage({ attachments: [makeAttachment({ size })] }),
    ]);
    return /<span class="file-size">([^<]*)<\/span>/.exec(html)?.[1];
  }

  it('formata as unidades e nunca imprime "1024,0" numa unidade menor', () => {
    expect(sizeLabel(0)).toBe('0 B');
    expect(sizeLabel(1023)).toBe('1023 B');
    expect(sizeLabel(1024)).toBe('1,0 KB');
    expect(sizeLabel(2048)).toBe('2,0 KB');
    // Regressao: 1048575 arredondava para "1024,0 KB" em vez de subir a unidade.
    expect(sizeLabel(1024 * 1024 - 1)).toBe('1,0 MB');
    expect(sizeLabel(1024 * 1024)).toBe('1,0 MB');
    expect(sizeLabel(1024 * 1024 * 1024 - 1)).toBe('1,0 GB');
    expect(sizeLabel(1024 * 1024 * 1024)).toBe('1,0 GB');
  });

  it('trata tamanhos invalidos como zero', () => {
    expect(sizeLabel(Number.NaN)).toBe('0 B');
    expect(sizeLabel(-100)).toBe('0 B');
  });
});

describe('buildTranscriptFilename', () => {
  it('gera nome de arquivo seguro com numero formatado', () => {
    expect(buildTranscriptFilename(125)).toBe('transcript-atendimento-0125.html');
    expect(buildTranscriptFilename(1)).toBe('transcript-atendimento-0001.html');
    expect(buildTranscriptFilename(123456)).toBe('transcript-atendimento-123456.html');
  });

  it('normaliza numeros invalidos', () => {
    expect(buildTranscriptFilename(-5)).toBe('transcript-atendimento-0000.html');
    expect(buildTranscriptFilename(Number.NaN)).toBe('transcript-atendimento-0000.html');
  });
});

/* -------------------------------------------------------------------------- */
/* Dublês do Discord para testar a paginacao                                   */
/* -------------------------------------------------------------------------- */

const FETCH_BASE_TIME = Date.UTC(2026, 7, 22, 10, 0, 0);

interface FetchCall {
  limit: number;
  before: string | undefined;
}

/**
 * Mensagem falsa com apenas os campos que o TranscriptService le.
 * O cast unico acontece aqui, na fronteira do duble — o codigo de producao
 * continua tipado contra o `Message` real do discord.js.
 */
function fakeDiscordMessage(
  index: number,
  replyToId: string | null = null,
  overrides: { id?: string; createdAt?: Date } = {},
): Message {
  const fake = {
    id: overrides.id ?? String(100_000 + index),
    author: {
      id: '111111111111111111',
      username: `user${index}`,
      bot: false,
      displayAvatarURL: (): string => `https://cdn.discordapp.com/avatars/1/${index}.png`,
    },
    member: null,
    createdAt: overrides.createdAt ?? new Date(FETCH_BASE_TIME + index * 1000),
    content: `msg ${index}`,
    attachments: new Collection<string, never>(),
    embeds: [],
    reference: replyToId === null ? null : { messageId: replyToId },
    editedAt: null,
  };
  return fake as unknown as Message;
}

/** Lista do mais recente para o mais antigo, como o Discord devolve. */
function fakeDiscordMessages(total: number): Message[] {
  const newestFirst: Message[] = [];
  for (let index = total - 1; index >= 0; index -= 1) {
    newestFirst.push(fakeDiscordMessage(index));
  }
  return newestFirst;
}

function fakeTextChannel(newestFirst: readonly Message[]): {
  channel: TextChannel;
  calls: FetchCall[];
  cache: Collection<string, Message>;
} {
  const calls: FetchCall[] = [];
  const cache = new Collection<string, Message>();

  const fake = {
    id: '555555555555555555',
    guildId: '666666666666666666',
    messages: {
      cache,
      fetch: (options: {
        limit?: number;
        before?: string;
      }): Promise<Collection<string, Message>> => {
        const limit = options.limit ?? 50;
        calls.push({ limit, before: options.before });

        let start = 0;
        if (options.before !== undefined) {
          start = newestFirst.findIndex((message) => message.id === options.before) + 1;
        }
        const slice = newestFirst.slice(start, start + limit);
        return Promise.resolve(
          new Collection(slice.map((message): [string, Message] => [message.id, message])),
        );
      },
    },
  };

  return { channel: fake as unknown as TextChannel, calls, cache };
}

describe('fetchChannelMessages', () => {
  it('pagina em lotes de 100 e devolve em ordem cronologica', async () => {
    const { channel, calls } = fakeTextChannel(fakeDiscordMessages(250));

    const result = await fetchChannelMessages(channel);

    expect(result).toHaveLength(250);
    expect(calls.map((call) => call.limit)).toEqual([100, 100, 100]);
    expect(calls[0]?.before).toBeUndefined();
    expect(calls[1]?.before).toBeDefined();
    expect(result[0]?.content).toBe('msg 0');
    expect(result[249]?.content).toBe('msg 249');

    const timestamps = result.map((message) => message.createdAt.getTime());
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });

  it('respeita maxMessages e preserva as mensagens mais recentes', async () => {
    const { channel, calls } = fakeTextChannel(fakeDiscordMessages(250));

    const result = await fetchChannelMessages(channel, 30);

    expect(result).toHaveLength(30);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.limit).toBe(30);
    expect(result[0]?.content).toBe('msg 220');
    expect(result[29]?.content).toBe('msg 249');
  });

  it('para no primeiro lote vazio sem entrar em loop', async () => {
    const { channel, calls } = fakeTextChannel([]);

    const result = await fetchChannelMessages(channel);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('nao consulta o Discord quando o limite e zero ou invalido', async () => {
    const { channel, calls } = fakeTextChannel(fakeDiscordMessages(10));

    expect(await fetchChannelMessages(channel, 0)).toEqual([]);
    expect(await fetchChannelMessages(channel, Number.NaN)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('extrai autor, avatar e ordena mesmo com o Discord devolvendo invertido', async () => {
    const { channel } = fakeTextChannel(fakeDiscordMessages(3));

    const result = await fetchChannelMessages(channel);

    expect(result[0]?.author.username).toBe('user0');
    expect(result[0]?.author.displayName).toBe('user0');
    expect(result[0]?.author.isBot).toBe(false);
    expect(result[0]?.author.avatarUrl).toBe('https://cdn.discordapp.com/avatars/1/0.png');
    expect(result[0]?.embedCount).toBe(0);
    expect(result[0]?.attachments).toEqual([]);
    expect(result[0]?.editedAt).toBeNull();
  });

  // Regressao: Infinity nao e finito, e o codigo antigo o convertia em 0 —
  // devolvia [] em silencio e o transcript saia vazio.
  it('trata limite infinito como o teto de negocio, nao como zero', async () => {
    const { channel } = fakeTextChannel(fakeDiscordMessages(120));

    const result = await fetchChannelMessages(channel, Number.POSITIVE_INFINITY);

    expect(result).toHaveLength(120);
  });

  it('trata limite negativo como zero e nao consulta o Discord', async () => {
    const { channel, calls } = fakeTextChannel(fakeDiscordMessages(10));

    expect(await fetchChannelMessages(channel, -10)).toEqual([]);
    expect(await fetchChannelMessages(channel, Number.NEGATIVE_INFINITY)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  // Regressao: o desempate comparava snowflakes como texto, entao um id de 19
  // digitos vinha antes de um de 18 (a virada aconteceu em julho de 2022).
  it('desempata snowflakes numericamente quando o timestamp e identico', async () => {
    const sameTime = new Date(FETCH_BASE_TIME);
    const novo = fakeDiscordMessage(1, null, { id: '1000000000000000000', createdAt: sameTime });
    const antigo = fakeDiscordMessage(0, null, { id: '999999999999999999', createdAt: sameTime });
    const { channel } = fakeTextChannel([novo, antigo]);

    const result = await fetchChannelMessages(channel);

    expect(result.map((message) => message.id)).toEqual([
      '999999999999999999',
      '1000000000000000000',
    ]);
  });

  it('resolve o autor da resposta pelo cache do canal', async () => {
    const older = fakeDiscordMessage(0);
    const newer = fakeDiscordMessage(1, older.id);
    const { channel, cache } = fakeTextChannel([newer, older]);
    cache.set(older.id, older);

    const result = await fetchChannelMessages(channel);

    expect(result[1]?.replyToId).toBe(older.id);
    expect(result[1]?.replyToAuthorName).toBe('user0');
    expect(result[0]?.replyToId).toBeNull();
  });

  it('deixa o autor da resposta nulo quando a mensagem nao esta em cache', async () => {
    const older = fakeDiscordMessage(0);
    const newer = fakeDiscordMessage(1, older.id);
    const { channel } = fakeTextChannel([newer, older]);

    const result = await fetchChannelMessages(channel);

    expect(result[1]?.replyToId).toBe(older.id);
    expect(result[1]?.replyToAuthorName).toBeNull();
  });
});

describe('buildTranscriptAttachment', () => {
  it('produz um anexo com o nome esperado e conteudo utf-8', () => {
    const attachment = buildTranscriptAttachment(makeHeader(), [
      makeMessage({ content: 'acentuacao: coracao' }),
    ]);

    expect(attachment.name).toBe('transcript-atendimento-0125.html');
    expect(Buffer.isBuffer(attachment.attachment)).toBe(true);

    const html = (attachment.attachment as Buffer).toString('utf8');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('acentuacao: coracao');
  });
});

/**
 * Teto do anexo no canal de logs.
 *
 * O limite padrao de upload do Discord e 20 MiB ("Uploading Files", em
 * docs.discord.com/developers/reference). O bot usava 25 MiB: um transcript
 * entre os dois nao era reduzido e o envio do log voltava com 40005 (Request
 * entity too large) — a equipe ficava sem log e sem transcript.
 *
 * Os numeros aqui sao LITERAIS de proposito, e nao `DISCORD_LIMITS`: se o teto
 * voltar a subir, o teste precisa quebrar em vez de acompanhar a mudanca.
 */
describe('buildTranscriptAttachment — teto de 20 MiB', () => {
  const MIB = 1024 * 1024;
  const DISCORD_DEFAULT_UPLOAD = 20 * MIB;

  /** Mensagem de 4000 caracteres, o maximo que o Discord aceita (com Nitro). */
  function longMessage(index: number, marker = ''): TranscriptMessage {
    return makeMessage({
      id: String(100_000_000_000_000_000n + BigInt(index)),
      createdAt: new Date(OPENED_AT.getTime() + index * 1000),
      content: marker + 'a'.repeat(4000 - marker.length),
    });
  }

  function conversation(total: number): TranscriptMessage[] {
    return Array.from({ length: total }, (_, index) => {
      if (index === 0) return longMessage(index, 'inicio da conversa ');
      if (index === total - 1) return longMessage(index, 'fim da conversa ');
      return longMessage(index);
    });
  }

  function bytesOf(attachment: ReturnType<typeof buildTranscriptAttachment>): Buffer {
    return attachment.attachment as Buffer;
  }

  it('um transcript de ~22 MB e reduzido para caber nos 20 MiB', () => {
    // 5000 mensagens e o teto de coleta do bot; com 4000 caracteres cada, o
    // HTML fica entre 20 e 25 MiB — a faixa que o teto antigo deixava passar.
    const messages = conversation(5000);
    const full = Buffer.byteLength(renderTranscriptHtml(makeHeader(), messages, 0), 'utf8');
    expect(full).toBeGreaterThan(DISCORD_DEFAULT_UPLOAD);
    expect(full).toBeLessThan(25 * MIB);

    const buffer = bytesOf(buildTranscriptAttachment(makeHeader(), messages));
    const html = buffer.toString('utf8');

    expect(buffer.byteLength).toBeLessThanOrEqual(DISCORD_DEFAULT_UPLOAD);
    expect(html).toContain('mensagens mais antigas foram omitidas');
    // O corte descarta o COMECO: o desfecho do atendimento e o que a equipe le.
    expect(html).toContain('fim da conversa');
    expect(html).not.toContain('inicio da conversa');
  });

  it('um transcript que ja cabe nos 20 MiB vai inteiro', () => {
    const messages = conversation(4400);
    const full = Buffer.byteLength(renderTranscriptHtml(makeHeader(), messages, 0), 'utf8');
    expect(full).toBeGreaterThan(18 * MIB);
    expect(full).toBeLessThanOrEqual(DISCORD_DEFAULT_UPLOAD);

    const buffer = bytesOf(buildTranscriptAttachment(makeHeader(), messages));
    const html = buffer.toString('utf8');

    expect(buffer.byteLength).toBe(full);
    expect(html).not.toContain('foram omitidas');
    expect(html).toContain('inicio da conversa');
    expect(html).toContain('fim da conversa');
  });
});
