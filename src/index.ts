import { Events } from 'discord.js';
import type { Client } from 'discord.js';

import { getEnv } from './config/env';
import { BOT_NAME } from './constants/branding';
import { setClient, clearClient } from './core/client/clientHolder';
import { createDiscordClient } from './core/client/createClient';
import { registry } from './core/client/registry';
import { cache } from './core/cache/CacheService';
import { connectDatabase, disconnectDatabase } from './core/database/prisma';
import { AppError, isAppError } from './core/errors';
import { handleBackgroundError } from './core/errors/interactionErrorHandler';
import { Logger, createLogger } from './core/logger/Logger';
import { startSchedulers, stopSchedulers } from './core/scheduler/SchedulerService';
import { registerEvents } from './events';
import { registerAll } from './interactions';
import {
  ensureGuildConfig,
} from './modules/configuration/repositories/GuildConfigRepository';
import { preloadGuildConfigs } from './modules/configuration/services/GuildConfigService';
import { preloadTicketConfig } from './modules/tickets/services/TicketConfigService';
import { getCoupons } from './modules/coupons/services/CouponService';
import { getAccounts } from './modules/payments/services/PaymentAccountService';
import { runStartupRecovery } from './modules/system/services/RecoveryService';
import { runDiagnostics } from './modules/system/services/DiagnosticsService';
import { registerOrderPaymentListeners } from './modules/catalog/services/OrderPaymentService';
import { shutdownOcr } from './modules/catalog/services/ReceiptOcrService';
import {
  notifyOrderChargeClosed,
  notifyOrderPaid,
} from './modules/catalog/services/OrderNotificationService';
import { publishDemandById } from './modules/demands/services/DemandBoardService';
import { tryGetClient } from './core/client/clientHolder';

/**
 * Ponto de entrada do Vook Store Bot.
 *
 * Ordem de inicializacao:
 *   Environment -> PostgreSQL -> Prisma -> Cache -> Discord -> Recovery ->
 *   Schedulers -> Validacao final.
 *
 * O cache e aquecido ANTES do Discord entrar no ar, para que a primeira
 * interacao ja encontre configuracao, categorias e equipes prontas.
 */

const logger = createLogger('bootstrap');
const TOTAL_STEPS = 8;

let shuttingDown = false;

function step(index: number, message: string): void {
  logger.info(`[${index}/${TOTAL_STEPS}] ${message}`);
}

/** Aguarda o evento ready com timeout, para nao travar o processo para sempre. */
function waitForReady(client: Client, timeoutMs = 60_000): Promise<Client<true>> {
  return new Promise<Client<true>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError('Timeout aguardando o login no Discord.', {
          code: 'DISCORD_LOGIN_TIMEOUT',
        }),
      );
    }, timeoutMs);
    timer.unref();

    client.once(Events.ClientReady, (readyClient) => {
      clearTimeout(timer);
      resolve(readyClient);
    });
  });
}

/** Pre-aquecimento do cache a partir do banco. */
async function warmCache(): Promise<void> {
  const guilds = await preloadGuildConfigs();
  logger.info('Configuracoes de guild carregadas no cache.', { guilds });
}

/** Carrega categorias, equipes, cupons e contas de cada guild conectada. */
async function warmGuildCaches(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await ensureGuildConfig(guild.id);
      const ticketConfig = await preloadTicketConfig(guild.id);
      const coupons = await getCoupons(guild.id);
      const accounts = await getAccounts(guild.id);

      logger.info('Cache da guild aquecido.', {
        guildId: guild.id,
        guildName: guild.name,
        categories: ticketConfig.categories,
        teamRoles: ticketConfig.teamRoles,
        coupons: coupons.length,
        accounts: accounts.length,
      });
    } catch (error) {
      await handleBackgroundError('bootstrap:warmGuildCaches', error, { guildId: guild.id });
    }
  }
}

/** Validacao final: registra no log qualquer configuracao quebrada. */
async function validateGuilds(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      const report = await runDiagnostics(guild);
      if (report.errors > 0) {
        logger.warn('Guild com configuracao incompleta.', {
          guildId: guild.id,
          guildName: guild.name,
          errors: report.errors,
          warnings: report.warnings,
          details: report.items
            .filter((item) => item.level === 'error')
            .map((item) => `${item.label}: ${item.detail}`)
            .join(' | '),
        });
      }
    } catch (error) {
      await handleBackgroundError('bootstrap:validate', error, { guildId: guild.id });
    }
  }
}

async function bootstrap(): Promise<void> {
  logger.info(`Inicializando ${BOT_NAME}...`);

  step(1, 'Environment');
  const env = getEnv();
  Logger.setLevel(env.LOG_LEVEL);

  step(2, 'PostgreSQL');
  await connectDatabase();

  step(3, 'Prisma');
  // O client e instanciado e validado por connectDatabase (SELECT 1).
  logger.info('Prisma Client pronto.');

  step(4, 'Cache');
  await warmCache();

  step(5, 'Discord');
  registerAll(registry);
  registry.logSummary();

  /*
   * Pedido <- pagamento.
   *
   * O catalogo NAO tem gateway proprio: ele apenas escuta o modulo central de
   * pagamentos. Quando uma cobranca e aprovada (hoje pela equipe; amanha por um
   * provider automatico), o pedido correspondente vira PAGO e o cliente recebe
   * a DM. O registro acontece antes do login para nao existir janela em que uma
   * aprovacao aconteca sem ouvinte.
   */
  registerOrderPaymentListeners({
    onPaid: async (order) => {
      if (order === null) return;
      const guild = tryGetClient()?.guilds.cache.get(order.guildId);
      if (guild === undefined) return;
      await notifyOrderPaid(guild, order);
      // Pago = ha trabalho a fazer: a demanda entra no quadro. Best-effort, como
      // o aviso acima — quadro que nao publica nao pode desfazer um pagamento.
      await publishDemandById(guild, order.id);
    },
    // Cobranca vencida/cancelada avisa os dois lados: o cliente para nao tentar
    // pagar um QR morto, e a equipe para emitir uma nova.
    onChargeClosed: async (order, payment) => {
      if (order === null) return;
      const guild = tryGetClient()?.guilds.cache.get(order.guildId);
      if (guild === undefined) return;
      await notifyOrderChargeClosed(guild, order, payment);
    },
  });

  const client = createDiscordClient();
  registerEvents(client);

  /*
   * Handlers de processo ANTES do login.
   *
   * O listener de interacao ja esta ativo aqui, e warmGuildCaches/recovery/
   * validacao levam dezenas de segundos com I/O de Discord e banco. Registrando
   * so no fim do bootstrap, essa janela inteira ficava sem `unhandledRejection`
   * (o default do Node 20 e derrubar o processo), sem `uncaughtException` (o
   * crash nao chegava ao SystemErrorLog) e sem SIGINT/SIGTERM.
   */
  registerProcessHandlers(client);

  const loginPromise = waitForReady(client);
  await client.login(env.DISCORD_TOKEN);
  const readyClient = await loginPromise;

  setClient(readyClient);
  logger.info('Conectado ao Discord.', {
    user: readyClient.user.tag,
    guilds: readyClient.guilds.cache.size,
  });

  await warmGuildCaches(readyClient);

  step(6, 'Recovery');
  // Best-effort: o recovery conserta estado deixado por uma queda anterior, mas
  // NAO e condicao para o bot existir. Antes, um erro transitorio do Discord
  // aqui abortava o boot; como cada tentativa morria em segundos (abaixo do
  // `min_uptime`), o PM2 contava reinicio instavel e, em poucos minutos,
  // marcava o app como `errored` e parava de tentar.
  await runStartupRecovery(readyClient).catch((error: unknown) =>
    handleBackgroundError('bootstrap:recovery', error),
  );

  step(7, 'Schedulers');
  startSchedulers();

  step(8, 'Validation');
  await validateGuilds(readyClient);

  logger.info(`${BOT_NAME} operacional.`, {
    guilds: readyClient.guilds.cache.size,
    commands: registry.commands.size,
  });
}

/** Teto absoluto para o encerramento: passou disso, sai de qualquer jeito. */
const SHUTDOWN_WATCHDOG_MS = 10_000;

/**
 * Encerramento gracioso.
 *
 * Ordem: marcar shutdown -> PARAR DE ACEITAR TRABALHO (destruir o cliente do
 * Discord) -> parar schedulers -> desconectar Prisma -> limpar cache -> sair.
 *
 * O cliente e destruido PRIMEIRO de proposito. Na ordem anterior o Prisma era
 * desconectado enquanto o gateway ainda entregava interacoes: cada interacao
 * dessa janela abria uma operacao de banco que o `process.exit` cortava no
 * meio, e `recordSystemError` passava a devolver `null` — todo erro da janela
 * (inclusive o que porventura causou o shutdown) era descartado em silencio.
 */
async function shutdown(client: Client, signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('Encerrando...', { signal });

  /*
   * Se `client.destroy()` ou `$disconnect()` travar — cenario provavel logo
   * apos um `uncaughtException` causado por queda do banco — o processo ficaria
   * vivo e inutil: o PM2 mostraria `online` e nao reiniciaria, porque o
   * `kill_timeout` so vale quando e o PM2 que manda parar.
   */
  const watchdog = setTimeout(() => {
    logger.error('Encerramento travou; saindo a forca.', undefined, { signal });
    process.exit(exitCode);
  }, SHUTDOWN_WATCHDOG_MS);
  watchdog.unref();

  try {
    clearClient();
    await client.destroy();
  } catch (error) {
    logger.error('Falha ao encerrar o cliente do Discord.', error);
  }

  try {
    stopSchedulers();
  } catch (error) {
    logger.error('Falha ao parar os schedulers.', error);
  }

  try {
    // O OCR do comprovante roda em worker proprio: sem encerrar, ele segura o
    // processo vivo depois do `destroy` do cliente do Discord.
    await shutdownOcr();
  } catch (error) {
    logger.error('Falha ao encerrar o OCR.', error);
  }

  try {
    await disconnectDatabase();
    cache.clearAll();
  } catch (error) {
    logger.error('Falha ao desconectar do banco.', error);
  }

  clearTimeout(watchdog);
  logger.info('Encerrado com seguranca.');
  process.exit(exitCode);
}

function registerProcessHandlers(client: Client): void {
  process.on('SIGINT', () => {
    void shutdown(client, 'SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown(client, 'SIGTERM');
  });

  /*
   * Encerramento gracioso no Windows (a plataforma de deploy deste bot).
   *
   * Nao existem sinais POSIX aqui: `process.kill(pid, 'SIGTERM')` do PM2 chama
   * TerminateProcess e os handlers acima NAO rodam — `stop-bot.bat` e o
   * "[5] Reiniciar" do monitor matavam o processo no meio de um fechamento de
   * ticket ou do laco de expiracao de cobrancas. O mecanismo do PM2 para
   * Windows e IPC: `shutdown_with_message: true` no ecosystem.config.js faz o
   * PM2 mandar a mensagem 'shutdown' em vez do sinal.
   */
  process.on('message', (message: unknown) => {
    if (message === 'shutdown') {
      void shutdown(client, 'pm2:shutdown');
    }
  });

  process.on('unhandledRejection', (reason) => {
    void handleBackgroundError('unhandledRejection', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('uncaughtException: estado do processo pode estar corrompido.', error);
    void handleBackgroundError('uncaughtException', error).finally(() => {
      // Continuar apos uma excecao nao capturada e arriscado: o PM2 reinicia.
      void shutdown(client, 'uncaughtException', 1);
    });
  });
}

bootstrap().catch((error: unknown) => {
  const message = isAppError(error) ? error.message : String(error);
  logger.error('Falha fatal na inicializacao.', error, { detail: message });
  process.exit(1);
});
