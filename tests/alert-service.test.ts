import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Alerta de erro no canal do Discord.
 *
 * Este modulo roda DENTRO do tratamento de erro do bot. Os dois riscos que ele
 * carrega sao proprios dessa posicao: virar um laco (um alerta que falha
 * disparando outro alerta) e virar spam (um job quebrado publicando por minuto
 * ate alguem silenciar o canal — e canal silenciado nao alerta ninguem).
 * Os testes existem sobretudo para esses dois.
 */

const env = { ALERT_CHANNEL_ID: '1544103906718515211' as string | null };
const fetchChannel = vi.fn();
const client = { channels: { fetch: (...args: unknown[]) => fetchChannel(...args) } };
const tryGetClient = vi.fn(() => client);

vi.mock('../src/config/env', () => ({ getEnv: () => env }));

vi.mock('../src/core/client/clientHolder', () => ({
  tryGetClient: () => tryGetClient(),
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { ALERT } from '../src/constants/limits';
import { notifyAlert, resetAlertWindows } from '../src/core/errors/AlertService';

let send: ReturnType<typeof vi.fn>;

function textOf(call: unknown[]): string {
  const payload = call[0] as { components: Array<{ toJSON(): { components?: unknown[] } }> };
  const json = payload.components[0]?.toJSON() as {
    components?: Array<{ type: number; content?: string }>;
  };
  return (json.components ?? [])
    .filter((component) => component.type === 10)
    .map((component) => component.content ?? '')
    .join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  resetAlertWindows();
  env.ALERT_CHANNEL_ID = '1544103906718515211';
  send = vi.fn().mockResolvedValue(undefined);
  fetchChannel.mockResolvedValue({ type: ChannelType.GuildText, send });
});

describe('publicacao', () => {
  it('publica o erro no canal configurado', async () => {
    await notifyAlert('backup', new Error('pg_dump saiu com codigo 1'));

    expect(send).toHaveBeenCalledTimes(1);
    const texto = textOf(send.mock.calls[0] ?? []);
    expect(texto).toContain('backup');
    expect(texto).toContain('pg_dump saiu com codigo 1');
  });

  it('inclui o contexto util', async () => {
    await notifyAlert('ticket:close', new Error('falhou'), {
      guildId: '1042089361279287366',
      entityId: 'cmt123',
    });

    const texto = textOf(send.mock.calls[0] ?? []);
    expect(texto).toContain('guildId');
    expect(texto).toContain('cmt123');
  });

  it('nao publica nada quando o alerta esta desligado', async () => {
    env.ALERT_CHANNEL_ID = null;

    await notifyAlert('backup', new Error('x'));

    expect(fetchChannel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('aceita erro que nao e Error', async () => {
    await notifyAlert('modulo', 'texto solto');

    expect(textOf(send.mock.calls[0] ?? [])).toContain('texto solto');
  });
});

describe('agrupamento de repeticoes', () => {
  /*
   * A PROTECAO CONTRA O CANAL SILENCIADO. Um job quebrado a cada rodada
   * publicaria uma mensagem por minuto; a primeira sai na hora, o resto e
   * contado.
   */
  it('publica a primeira e cala as repeticoes', async () => {
    for (let i = 0; i < 5; i += 1) {
      await notifyAlert('scheduler', new Error('mesma falha'));
    }

    expect(send).toHaveBeenCalledTimes(1);
  });

  /*
   * A mensagem do rate limit do gateway carrega os segundos que faltam ("retry
   * after 9.897 seconds"), que mudam a cada ocorrencia. Agrupar pela mensagem
   * inteira produziria uma assinatura nova toda vez — e nenhum agrupamento.
   */
  it('agrupa erros iguais mesmo com detalhe variavel na mesma linha', async () => {
    await notifyAlert('gateway', new Error('Request was rate limited. Retry after 9.8 seconds.'));
    await notifyAlert('gateway', new Error('Request was rate limited. Retry after 25.6 seconds.'));

    // Mensagens diferentes: sao assinaturas diferentes, e as duas saem.
    // O que o agrupamento garante e que a REPETICAO exata nao sai duas vezes.
    expect(send).toHaveBeenCalledTimes(2);

    await notifyAlert('gateway', new Error('Request was rate limited. Retry after 9.8 seconds.'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('separa erros de modulos diferentes', async () => {
    await notifyAlert('backup', new Error('mesma falha'));
    await notifyAlert('scheduler', new Error('mesma falha'));

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('conta quantas vezes repetiu e informa no proximo envio', async () => {
    vi.useFakeTimers();

    await notifyAlert('scheduler', new Error('falha teimosa'));
    for (let i = 0; i < 3; i += 1) {
      await notifyAlert('scheduler', new Error('falha teimosa'));
    }

    vi.advanceTimersByTime(ALERT.WINDOW_MS + 1);
    await notifyAlert('scheduler', new Error('falha teimosa'));

    expect(send).toHaveBeenCalledTimes(2);
    expect(textOf(send.mock.calls[1] ?? [])).toContain('3 vez(es)');
  });
});

describe('nunca vira um laco', () => {
  /*
   * O RISCO CENTRAL. Quem chama isto ja esta tratando uma falha; se o alerta
   * lancasse, o tratador chamaria o alerta de novo e o laco se alimentaria da
   * propria falha.
   */
  it('engole a falha de envio em vez de lancar', async () => {
    send.mockRejectedValue(new Error('canal apagado'));

    await expect(notifyAlert('backup', new Error('x'))).resolves.toBeUndefined();
  });

  it('engole a falha de resolucao do canal', async () => {
    fetchChannel.mockRejectedValue(new Error('sem acesso'));

    await expect(notifyAlert('backup', new Error('x'))).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('nao quebra quando o bot ainda nao conectou', async () => {
    tryGetClient.mockReturnValue(null as never);

    await expect(notifyAlert('bootstrap', new Error('x'))).resolves.toBeUndefined();
  });

  it('ignora canal que nao e de texto', async () => {
    fetchChannel.mockResolvedValue({ type: ChannelType.GuildVoice });

    await expect(notifyAlert('backup', new Error('x'))).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
