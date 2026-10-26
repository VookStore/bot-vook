import { ChannelType, MessageFlags } from 'discord.js';
import type { TextChannel } from 'discord.js';

import { getEnv } from '../../config/env';
import { ALERT } from '../../constants/limits';
import { container, footerNote, separator, text } from '../../components/v2';
import { COLORS } from '../../constants/branding';
import { redactContext, redactString } from '../logger/redact';
import { tryGetClient } from '../client/clientHolder';
import { createLogger } from '../logger/Logger';

/**
 * Alerta de erro num canal do Discord.
 *
 * POR QUE EXISTE. Todo erro de fundo do bot ia para o arquivo de log e para a
 * tabela `system_error_logs` — dois lugares que ninguem abre por vontade
 * propria. Na pratica, cada falha era descoberta por acaso ou por reclamacao de
 * cliente, as vezes dias depois. Este modulo faz o erro chegar a alguem no
 * momento em que acontece.
 *
 * O SILENCIO E DELIBERADO EM DOIS PONTOS:
 *
 *  1. NADA AQUI LANCA. Um alerta que falha nao pode virar um erro que dispara
 *     outro alerta — seria um laco alimentado pela propria falha. Toda excecao
 *     morre aqui dentro, no maximo virando uma linha de log.
 *  2. REPETICAO E AGRUPADA. Um job que quebra a cada rodada produziria uma
 *     mensagem por minuto ate alguem silenciar o canal — e canal silenciado nao
 *     alerta ninguem. A primeira ocorrencia sai na hora; as seguintes sao
 *     contadas e viram um resumo quando a janela fecha.
 *
 * SEGREDO NAO PASSA. Mensagem, stack e contexto vao pelo mesmo redator usado
 * na tabela de erros. O canal e privado, mas "privado" e uma configuracao que
 * alguem pode afrouxar sem pensar no que ja foi escrito ali.
 */

const logger = createLogger('alert');

interface Pending {
  /** Ocorrencias suprimidas desde o ultimo envio. */
  suppressed: number;
  /** Quando a janela de agrupamento fecha. */
  until: number;
}

const windows = new Map<string, Pending>();

/**
 * Assinatura do erro para agrupar repeticoes.
 *
 * Modulo + tipo + a PRIMEIRA LINHA da mensagem. A primeira linha basta e evita
 * que um detalhe variavel no fim (um id, um tempo de retry) transforme o mesmo
 * defeito em assinaturas diferentes — que era justamente o caso do rate limit
 * do gateway, cuja mensagem carrega os segundos que faltam.
 */
function signatureOf(moduleName: string, error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return `${moduleName}:${name}:${message.split('\n')[0]?.slice(0, 120) ?? ''}`;
}

/** Canal configurado, ou `null` quando o alerta esta desligado ou inacessivel. */
async function resolveChannel(): Promise<TextChannel | null> {
  const channelId = getEnv().ALERT_CHANNEL_ID;
  if (channelId === null) return null;

  const client = tryGetClient();
  if (client === null) return null;

  try {
    const channel = await client.channels.fetch(channelId);
    return channel !== null && channel.type === ChannelType.GuildText ? channel : null;
  } catch {
    return null;
  }
}

/** Uma linha `chave: valor` por entrada util do contexto. */
function renderContext(context: Record<string, unknown>): string {
  const safe = redactContext(context);

  const linhas = Object.entries(safe)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, ALERT.MAX_CONTEXT_FIELDS)
    .map(([key, value]) => `\`${key}\`: ${String(value).slice(0, 120)}`);

  return linhas.join('\n');
}

function buildAlert(params: {
  moduleName: string;
  error: unknown;
  context: Record<string, unknown>;
  suppressed: number;
}) {
  const root = container(COLORS.DANGER);

  const message = redactString(
    params.error instanceof Error ? params.error.message : String(params.error),
  );

  root.addTextDisplayComponents(
    text(`### 🔴 Falha em \`${params.moduleName}\``),
    text(`\`\`\`\n${message.slice(0, ALERT.MAX_MESSAGE_CHARS)}\n\`\`\``),
  );

  const contexto = renderContext(params.context);
  if (contexto.length > 0) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(text(contexto));
  }

  /*
   * O numero de repeticoes e a informacao mais util do alerta agrupado: "isto
   * aconteceu 47 vezes" e um problema de outra natureza que "isto aconteceu".
   */
  if (params.suppressed > 0) {
    root.addTextDisplayComponents(
      footerNote(`Repetiu mais ${params.suppressed} vez(es) nos ultimos minutos.`),
    );
  }

  return root;
}

/**
 * Publica o alerta, agrupando repeticoes.
 *
 * Nunca lanca e nunca chama o tratador de erros — quem o chama ja esta tratando
 * uma falha, e um segundo erro daqui apagaria o primeiro.
 */
export async function notifyAlert(
  moduleName: string,
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    const signature = signatureOf(moduleName, error);
    const now = Date.now();
    const pending = windows.get(signature);

    // Janela aberta: conta e cala.
    if (pending !== undefined && now < pending.until) {
      pending.suppressed += 1;
      return;
    }

    const channel = await resolveChannel();
    if (channel === null) {
      windows.set(signature, { suppressed: 0, until: now + ALERT.WINDOW_MS });
      return;
    }

    const suppressed = pending?.suppressed ?? 0;
    windows.set(signature, { suppressed: 0, until: now + ALERT.WINDOW_MS });

    await channel.send({
      components: [buildAlert({ moduleName, error, context, suppressed })],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } catch (alertError) {
    /*
     * Fim da linha. Este catch NAO pode chamar `handleBackgroundError`: ele
     * chamaria `notifyAlert` de volta e o laco se alimentaria da propria falha.
     */
    logger.warn('Nao foi possivel publicar o alerta.', {
      module: moduleName,
      detail: alertError instanceof Error ? alertError.message : String(alertError),
    });
  }
}

/** Somente para testes: esquece as janelas de agrupamento. */
export function resetAlertWindows(): void {
  windows.clear();
}
