"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const env_1 = require("./config/env");
const branding_1 = require("./constants/branding");
const clientHolder_1 = require("./core/client/clientHolder");
const createClient_1 = require("./core/client/createClient");
const registry_1 = require("./core/client/registry");
const CacheService_1 = require("./core/cache/CacheService");
const prisma_1 = require("./core/database/prisma");
const errors_1 = require("./core/errors");
const interactionErrorHandler_1 = require("./core/errors/interactionErrorHandler");
const Logger_1 = require("./core/logger/Logger");
const SchedulerService_1 = require("./core/scheduler/SchedulerService");
const events_1 = require("./events");
const interactions_1 = require("./interactions");
const GuildConfigRepository_1 = require("./modules/configuration/repositories/GuildConfigRepository");
const GuildConfigService_1 = require("./modules/configuration/services/GuildConfigService");
const TicketConfigService_1 = require("./modules/tickets/services/TicketConfigService");
const CouponService_1 = require("./modules/coupons/services/CouponService");
const PaymentAccountService_1 = require("./modules/payments/services/PaymentAccountService");
const RecoveryService_1 = require("./modules/system/services/RecoveryService");
const DiagnosticsService_1 = require("./modules/system/services/DiagnosticsService");
const OrderPaymentService_1 = require("./modules/catalog/services/OrderPaymentService");
const ReceiptOcrService_1 = require("./modules/catalog/services/ReceiptOcrService");
const OrderNotificationService_1 = require("./modules/catalog/services/OrderNotificationService");
const DemandBoardService_1 = require("./modules/demands/services/DemandBoardService");
const clientHolder_2 = require("./core/client/clientHolder");
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
const logger = (0, Logger_1.createLogger)('bootstrap');
const TOTAL_STEPS = 8;
let shuttingDown = false;
function step(index, message) {
    logger.info(`[${index}/${TOTAL_STEPS}] ${message}`);
}
/** Aguarda o evento ready com timeout, para nao travar o processo para sempre. */
function waitForReady(client, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new errors_1.AppError('Timeout aguardando o login no Discord.', {
                code: 'DISCORD_LOGIN_TIMEOUT',
            }));
        }, timeoutMs);
        timer.unref();
        client.once(discord_js_1.Events.ClientReady, (readyClient) => {
            clearTimeout(timer);
            resolve(readyClient);
        });
    });
}
/** Pre-aquecimento do cache a partir do banco. */
async function warmCache() {
    const guilds = await (0, GuildConfigService_1.preloadGuildConfigs)();
    logger.info('Configuracoes de guild carregadas no cache.', { guilds });
}
/** Carrega categorias, equipes, cupons e contas de cada guild conectada. */
async function warmGuildCaches(client) {
    for (const guild of client.guilds.cache.values()) {
        try {
            await (0, GuildConfigRepository_1.ensureGuildConfig)(guild.id);
            const ticketConfig = await (0, TicketConfigService_1.preloadTicketConfig)(guild.id);
            const coupons = await (0, CouponService_1.getCoupons)(guild.id);
            const accounts = await (0, PaymentAccountService_1.getAccounts)(guild.id);
            logger.info('Cache da guild aquecido.', {
                guildId: guild.id,
                guildName: guild.name,
                categories: ticketConfig.categories,
                teamRoles: ticketConfig.teamRoles,
                coupons: coupons.length,
                accounts: accounts.length,
            });
        }
        catch (error) {
            await (0, interactionErrorHandler_1.handleBackgroundError)('bootstrap:warmGuildCaches', error, { guildId: guild.id });
        }
    }
}
/** Validacao final: registra no log qualquer configuracao quebrada. */
async function validateGuilds(client) {
    for (const guild of client.guilds.cache.values()) {
        try {
            const report = await (0, DiagnosticsService_1.runDiagnostics)(guild);
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
        }
        catch (error) {
            await (0, interactionErrorHandler_1.handleBackgroundError)('bootstrap:validate', error, { guildId: guild.id });
        }
    }
}
async function bootstrap() {
    logger.info(`Inicializando ${branding_1.BOT_NAME}...`);
    step(1, 'Environment');
    const env = (0, env_1.getEnv)();
    Logger_1.Logger.setLevel(env.LOG_LEVEL);
    step(2, 'PostgreSQL');
    await (0, prisma_1.connectDatabase)();
    step(3, 'Prisma');
    // O client e instanciado e validado por connectDatabase (SELECT 1).
    logger.info('Prisma Client pronto.');
    step(4, 'Cache');
    await warmCache();
    step(5, 'Discord');
    (0, interactions_1.registerAll)(registry_1.registry);
    registry_1.registry.logSummary();
    /*
     * Pedido <- pagamento.
     *
     * O catalogo NAO tem gateway proprio: ele apenas escuta o modulo central de
     * pagamentos. Quando uma cobranca e aprovada (hoje pela equipe; amanha por um
     * provider automatico), o pedido correspondente vira PAGO e o cliente recebe
     * a DM. O registro acontece antes do login para nao existir janela em que uma
     * aprovacao aconteca sem ouvinte.
     */
    (0, OrderPaymentService_1.registerOrderPaymentListeners)({
        onPaid: async (order) => {
            if (order === null)
                return;
            const guild = (0, clientHolder_2.tryGetClient)()?.guilds.cache.get(order.guildId);
            if (guild === undefined)
                return;
            await (0, OrderNotificationService_1.notifyOrderPaid)(guild, order);
            // Pago = ha trabalho a fazer: a demanda entra no quadro. Best-effort, como
            // o aviso acima — quadro que nao publica nao pode desfazer um pagamento.
            await (0, DemandBoardService_1.publishDemandById)(guild, order.id);
        },
        // Cobranca vencida/cancelada avisa os dois lados: o cliente para nao tentar
        // pagar um QR morto, e a equipe para emitir uma nova.
        onChargeClosed: async (order, payment) => {
            if (order === null)
                return;
            const guild = (0, clientHolder_2.tryGetClient)()?.guilds.cache.get(order.guildId);
            if (guild === undefined)
                return;
            await (0, OrderNotificationService_1.notifyOrderChargeClosed)(guild, order, payment);
        },
    });
    const client = (0, createClient_1.createDiscordClient)();
    (0, events_1.registerEvents)(client);
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
    (0, clientHolder_1.setClient)(readyClient);
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
    await (0, RecoveryService_1.runStartupRecovery)(readyClient).catch((error) => (0, interactionErrorHandler_1.handleBackgroundError)('bootstrap:recovery', error));
    step(7, 'Schedulers');
    (0, SchedulerService_1.startSchedulers)();
    step(8, 'Validation');
    await validateGuilds(readyClient);
    logger.info(`${branding_1.BOT_NAME} operacional.`, {
        guilds: readyClient.guilds.cache.size,
        commands: registry_1.registry.commands.size,
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
async function shutdown(client, signal, exitCode = 0) {
    if (shuttingDown)
        return;
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
        (0, clientHolder_1.clearClient)();
        await client.destroy();
    }
    catch (error) {
        logger.error('Falha ao encerrar o cliente do Discord.', error);
    }
    try {
        (0, SchedulerService_1.stopSchedulers)();
    }
    catch (error) {
        logger.error('Falha ao parar os schedulers.', error);
    }
    try {
        // O OCR do comprovante roda em worker proprio: sem encerrar, ele segura o
        // processo vivo depois do `destroy` do cliente do Discord.
        await (0, ReceiptOcrService_1.shutdownOcr)();
    }
    catch (error) {
        logger.error('Falha ao encerrar o OCR.', error);
    }
    try {
        await (0, prisma_1.disconnectDatabase)();
        CacheService_1.cache.clearAll();
    }
    catch (error) {
        logger.error('Falha ao desconectar do banco.', error);
    }
    clearTimeout(watchdog);
    logger.info('Encerrado com seguranca.');
    process.exit(exitCode);
}
function registerProcessHandlers(client) {
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
    process.on('message', (message) => {
        if (message === 'shutdown') {
            void shutdown(client, 'pm2:shutdown');
        }
    });
    process.on('unhandledRejection', (reason) => {
        void (0, interactionErrorHandler_1.handleBackgroundError)('unhandledRejection', reason);
    });
    process.on('uncaughtException', (error) => {
        logger.error('uncaughtException: estado do processo pode estar corrompido.', error);
        void (0, interactionErrorHandler_1.handleBackgroundError)('uncaughtException', error).finally(() => {
            // Continuar apos uma excecao nao capturada e arriscado: o PM2 reinicia.
            void shutdown(client, 'uncaughtException', 1);
        });
    });
}
bootstrap().catch((error) => {
    const message = (0, errors_1.isAppError)(error) ? error.message : String(error);
    logger.error('Falha fatal na inicializacao.', error, { detail: message });
    process.exit(1);
});
//# sourceMappingURL=index.js.map