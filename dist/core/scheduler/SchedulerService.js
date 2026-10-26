"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeJobs = activeJobs;
exports.startSchedulers = startSchedulers;
exports.stopSchedulers = stopSchedulers;
exports.schedulerStatus = schedulerStatus;
const limits_1 = require("../../constants/limits");
const CacheService_1 = require("../cache/CacheService");
const LockService_1 = require("../locks/LockService");
const env_1 = require("../../config/env");
const Logger_1 = require("../logger/Logger");
const interactionErrorHandler_1 = require("../errors/interactionErrorHandler");
const clientHolder_1 = require("../client/clientHolder");
const AnnouncementDraftService_1 = require("../../modules/announcements/services/AnnouncementDraftService");
const PaymentDraftService_1 = require("../../modules/payments/services/PaymentDraftService");
const RecoveryService_1 = require("../../modules/system/services/RecoveryService");
const CartReminderService_1 = require("../../modules/catalog/services/CartReminderService");
const BackupService_1 = require("../../modules/system/services/BackupService");
const TicketPriorityService_1 = require("../../modules/tickets/services/TicketPriorityService");
const TranscriptRetentionService_1 = require("../../modules/tickets/services/TranscriptRetentionService");
const TwitchLiveService_1 = require("../../modules/influencers/services/TwitchLiveService");
/**
 * Agendador de jobs.
 *
 * Nao existe timer por cobranca: um unico job varre as cobrancas vencidas.
 * Cada job tem trava de execucao propria — se uma rodada demorar mais que o
 * intervalo, a proxima e ignorada em vez de rodar em paralelo.
 */
const logger = (0, Logger_1.createLogger)('scheduler');
const states = new Map();
let started = false;
async function executeJob(job) {
    const state = states.get(job.name);
    if (state === undefined)
        return;
    if (state.running) {
        logger.warn('Job anterior ainda em execucao; rodada ignorada.', { job: job.name });
        return;
    }
    state.running = true;
    const startedAt = Date.now();
    try {
        await job.run();
    }
    catch (error) {
        await (0, interactionErrorHandler_1.handleBackgroundError)(`scheduler:${job.name}`, error);
    }
    finally {
        state.running = false;
        const elapsed = Date.now() - startedAt;
        if (elapsed > job.intervalMs) {
            logger.warn('Job demorou mais que o proprio intervalo.', {
                job: job.name,
                elapsedMs: elapsed,
                intervalMs: job.intervalMs,
            });
        }
    }
}
/** Expira cobrancas vencidas e atualiza os cartoes correspondentes. */
const paymentExpirationJob = {
    name: 'PaymentExpirationJob',
    intervalMs: limits_1.SCHEDULER_INTERVALS.PAYMENT_EXPIRATION_MS,
    async run() {
        const client = (0, clientHolder_1.tryGetClient)();
        if (client === null)
            return;
        const expired = await (0, RecoveryService_1.recoverExpiredPayments)(client);
        if (expired > 0)
            logger.info('Cobrancas expiradas.', { count: expired });
    },
};
/** Reaplica o recovery leve (tickets presos e canais removidos). */
const recoveryJob = {
    name: 'RecoveryJob',
    intervalMs: limits_1.SCHEDULER_INTERVALS.RECOVERY_MS,
    async run() {
        const client = (0, clientHolder_1.tryGetClient)();
        if (client === null)
            return;
        await (0, RecoveryService_1.runPeriodicRecovery)(client);
    },
};
/**
 * Sobe a prioridade de quem esta parado na fila.
 *
 * Roda com o client para que os paineis dos tickets afetados mostrem a nova
 * posicao; sem client (bot ainda subindo), a promocao acontece so no banco.
 */
const priorityEscalationJob = {
    name: 'PriorityEscalationJob',
    intervalMs: limits_1.SCHEDULER_INTERVALS.PRIORITY_ESCALATION_MS,
    async run() {
        await (0, TicketPriorityService_1.escalateStaleTickets)((0, clientHolder_1.tryGetClient)());
    },
};
/**
 * Backup diario do banco.
 *
 * A rodada de hora em hora so PERGUNTA se o dump ja venceu; o prazo e lido da
 * data do arquivo mais recente, entao reiniciar o bot varias vezes num dia nao
 * gera varios dumps.
 *
 * DEIXA A EXCECAO SUBIR de proposito. `executeJob` a transforma em alerta pelo
 * `handleBackgroundError`, e um backup que falha em silencio e pior que backup
 * nenhum — quem confia nele so descobre no dia do resgate.
 */
const backupJob = {
    name: 'DatabaseBackupJob',
    intervalMs: limits_1.SCHEDULER_INTERVALS.BACKUP_CHECK_MS,
    async run() {
        const result = await (0, BackupService_1.runBackupIfDue)();
        if (result !== null) {
            logger.info('Backup diario gravado.', {
                file: result.file,
                bytes: result.bytes,
                removed: result.removed,
            });
        }
    },
};
/**
 * Lembra quem deixou itens no carrinho ha mais de 24h.
 *
 * UMA DM por carrinho, nunca duas: a trava e uma coluna no banco, nao o
 * intervalo deste job. Rodar de meia em meia hora so encurta a espera entre o
 * carrinho vencer e o lembrete sair.
 */
const cartReminderJob = {
    name: 'CartReminderJob',
    intervalMs: limits_1.SCHEDULER_INTERVALS.CART_REMINDER_MS,
    async run() {
        const client = (0, clientHolder_1.tryGetClient)();
        if (client === null)
            return;
        await (0, CartReminderService_1.remindAbandonedCarts)(client);
    },
};
/**
 * Apaga transcripts que passaram do prazo de retencao.
 *
 * DESLIGADO por padrao: sem `TRANSCRIPT_RETENTION_DAYS` no ambiente o job roda,
 * nao encontra prazo configurado e devolve zero sem tocar em nada.
 */
const transcriptRetentionJob = {
    name: 'TranscriptRetentionJob',
    intervalMs: limits_1.SCHEDULER_INTERVALS.TRANSCRIPT_RETENTION_MS,
    async run() {
        await (0, TranscriptRetentionService_1.purgeExpiredTranscripts)();
    },
};
const twitchLiveJob = {
    name: 'TwitchLiveJob',
    intervalMs: limits_1.SCHEDULER_INTERVALS.TWITCH_LIVE_CHECK_MS,
    async run() {
        const client = (0, clientHolder_1.tryGetClient)();
        if (client !== null)
            await (0, TwitchLiveService_1.announceTwitchLives)(client);
    },
};
/** Limpeza de estruturas em memoria. */
const maintenanceJob = {
    name: 'MaintenanceJob',
    intervalMs: limits_1.SCHEDULER_INTERVALS.MAINTENANCE_MS,
    run() {
        const prunedCache = CacheService_1.cache.prune();
        const prunedLocks = LockService_1.locks.prune();
        const prunedCooldowns = LockService_1.cooldowns.prune();
        const prunedDrafts = (0, PaymentDraftService_1.pruneDrafts)() + (0, AnnouncementDraftService_1.pruneAnnouncementDrafts)();
        if (prunedCache + prunedLocks + prunedCooldowns + prunedDrafts > 0) {
            logger.debug('Manutencao de memoria concluida.', {
                cache: prunedCache,
                locks: prunedLocks,
                cooldowns: prunedCooldowns,
                drafts: prunedDrafts,
            });
        }
        return Promise.resolve();
    },
};
const JOBS = [
    paymentExpirationJob,
    recoveryJob,
    priorityEscalationJob,
    cartReminderJob,
    transcriptRetentionJob,
    twitchLiveJob,
    backupJob,
    maintenanceJob,
];
/**
 * Jobs que esta instalacao roda.
 *
 * O backup sai da lista quando `BACKUP_ENABLED=false`, em vez de rodar e
 * retornar cedo: assim o log de inicio mostra que ele esta desligado, e nao ha
 * timer acordando de hora em hora para nada.
 */
function activeJobs() {
    return (0, env_1.getEnv)().BACKUP_ENABLED ? JOBS : JOBS.filter((job) => job !== backupJob);
}
function startSchedulers() {
    if (started)
        return;
    started = true;
    const jobs = activeJobs();
    if (jobs.length !== JOBS.length) {
        logger.info('Backup automatico desligado (BACKUP_ENABLED=false).');
    }
    for (const job of jobs) {
        const timer = setInterval(() => {
            void executeJob(job);
        }, job.intervalMs);
        timer.unref();
        states.set(job.name, { timer, running: false });
    }
    logger.info('Schedulers iniciados.', {
        jobs: jobs.map((job) => job.name).join(', '),
    });
}
function stopSchedulers() {
    for (const [name, state] of states) {
        clearInterval(state.timer);
        states.delete(name);
    }
    started = false;
    logger.info('Schedulers parados.');
}
function schedulerStatus() {
    return [...states.entries()].map(([name, state]) => ({ name, running: state.running }));
}
//# sourceMappingURL=SchedulerService.js.map