import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContainerBuilder,
  MessageFlags,
  REST,
  Routes,
  TextDisplayBuilder,
} from 'discord.js';

import { sendV2WithLargeFile } from '../src/components/reply';

/**
 * Envio de anexo grande (renders de ate 100 MB).
 *
 * O REST comum do discord.js desiste em 15 s e TENTA DE NOVO sozinho. Com um
 * arquivo grande, isso e prazo curto demais e, pior, risco de post duplicado:
 * uma tentativa abortada depois de o Discord ja ter recebido o corpo cria a
 * mensagem, e a repeticao cria outra. Este teste trava as duas regras do
 * cliente dedicado — prazo longo, zero repeticao — e o formato da mensagem.
 */

interface CapturedRequest {
  body: {
    components: unknown[];
    flags: number;
    allowed_mentions: unknown;
    attachments: unknown[];
  };
  files: Array<{ name: string; data: Buffer; contentType?: string }>;
}

function root(): ContainerBuilder {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent('oi'),
  );
}

describe('envio de anexo grande', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prazo longo e NENHUMA repeticao automatica', async () => {
    let options: REST['options'] | undefined;
    vi.spyOn(REST.prototype, 'post').mockImplementation(function (this: REST) {
      options = this.options;
      return Promise.resolve({ id: 'm1', channel_id: 'c1' });
    });

    await sendV2WithLargeFile(
      { id: 'c1', client: { token: 'token.de.teste' } as never },
      root(),
      { name: 'lobo-lycan.png', data: Buffer.from([1, 2, 3]) },
    );

    expect(options?.retries).toBe(0);
    expect(options?.timeout).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('manda uma mensagem V2, sem mencao, com o anexo referenciavel por nome', async () => {
    let route: string | undefined;
    let request: CapturedRequest | undefined;
    vi.spyOn(REST.prototype, 'post').mockImplementation((fullRoute, data) => {
      route = fullRoute;
      request = data as unknown as CapturedRequest;
      return Promise.resolve({ id: 'm1', channel_id: 'c1' });
    });

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const ref = await sendV2WithLargeFile(
      { id: 'c1', client: { token: 'token.de.teste' } as never },
      root(),
      { name: 'lobo-lycan.png', data: bytes, contentType: 'image/png' },
    );

    expect(ref).toEqual({ id: 'm1', channelId: 'c1' });
    expect(route).toBe(Routes.channelMessages('c1'));
    expect(request?.body.flags).toBe(MessageFlags.IsComponentsV2);
    expect(request?.body.allowed_mentions).toEqual({ parse: [] });
    expect(request?.body.components).toHaveLength(1);
    // O `filename` casa com o `attachment://lobo-lycan.png` do container.
    expect(request?.body.attachments).toEqual([{ id: 0, filename: 'lobo-lycan.png' }]);
    expect(request?.files).toEqual([
      { name: 'lobo-lycan.png', data: bytes, contentType: 'image/png' },
    ]);
  });
});
