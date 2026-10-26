import { SCHEDULER_INTERVALS } from '../../constants/limits';
import { cache } from '../cache/CacheService';
import { cooldowns, locks } from '../locks/LockService';
import { getEnv } from '../../config/env';
import { createLogger } from '../logger/Logger';
import { handleBackgroundError } from '../errors/interactionErrorHandler';
import { tryGetClient } from '../client/clientHolder';
import { pruneAnnouncementDrafts } from '../../modules/announcements/services/AnnouncementDraftService';
import { pruneDrafts } from '../../modules/payments/services/PaymentDraftService';
import {
  recoverExpiredPayments,
  runPeriodicRecovery,
} from '../../modules/system/services/RecoveryService';
import { remindAbandonedCarts } from '../../modules/catalog/services/CartReminderService';
import { runBackupIfDue } from '../../modules/system/services/BackupService';
import { escalateStaleTickets } from '../../modules/tickets/services/TicketPriorityService';
import { purgeExpiredTranscripts } from '../../modules/tickets/services/TranscriptRetentionService';
import { announceTwitchLives } from '../../modules/influencers/services/TwitchLiveService';

/**
 * Agendador de jobs.
 *
 * Nao existe timer por cobranca: um unico job varre as cobrancas vencidas.
 * Cada job tem trava de execucao propria — se uma rodada demorar mais que o
 * intervalo, a proxima e ignorada em vez de rodar em paralelo.
 */

const logger = createLogger('scheduler');

interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

interface JobState {
  timer: NodeJS.Timeout;
  running: boolean;
}

const states = new Map<string, JobState>();
let started = false;

async function executeJob(job: Job): Promise<void> {
  const state = states.get(job.name);
  if (state === undefined) return;

  if (state.running) {
    logger.warn('Job anterior ainda em execucao; rodada ignorada.', { job: job.name });
    return;
  }

  state.running = true;
  const startedAt = Date.now();
  try {
    await job.run();
  } catch (error) {
    await handleBackgroundError(`scheduler:${job.name}`, error);
  } finally {
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
const paymentExpirationJob: Job = {
  name: 'PaymentExpirationJob',
  intervalMs: SCHEDULER_INTERVALS.PAYMENT_EXPIRATION_MS,
  async run(): Promise<void> {
    const client = tryGetClient();
    if (client === null) return;
    const expired = await recoverExpiredPayments(client);
    if (expired > 0) logger.info('Cobrancas expiradas.', { count: expired });
  },
};

/** Reaplica o recovery leve (tickets presos e canais removidos). */
const recoveryJob: Job = {
  name: 'RecoveryJob',
  intervalMs: SCHEDULER_INTERVALS.RECOVERY_MS,
  async run(): Promise<void> {
    const client = tryGetClient();
    if (client === null) return;
    await runPeriodicRecovery(client);
  },
};

/**
 * Sobe a prioridade de quem esta parado na fila.
 *
 * Roda com o client para que os paineis dos tickets afetados mostrem a nova
 * posicao; sem client (bot ainda subindo), a promocao acontece so no banco.
 */
const priorityEscalationJob: Job = {
  name: 'PriorityEscalationJob',
  intervalMs: SCHEDULER_INTERVALS.PRIORITY_ESCALATION_MS,
  async run(): Promise<void> {
    await escalateStaleTickets(tryGetClient());
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
const backupJob: Job = {
  name: 'DatabaseBackupJob',
  intervalMs: SCHEDULER_INTERVALS.BACKUP_CHECK_MS,
  async run(): Promise<void> {
    const result = await runBackupIfDue();
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
const cartReminderJob: Job = {
  name: 'CartReminderJob',
  intervalMs: SCHEDULER_INTERVALS.CART_REMINDER_MS,
  async run(): Promise<void> {
    const client = tryGetClient();
    if (client === null) return;
    await remindAbandonedCarts(client);
  },
};

/**
 * Apaga transcripts que passaram do prazo de retencao.
 *
 * DESLIGADO por padrao: sem `TRANSCRIPT_RETENTION_DAYS` no ambiente o job roda,
 * nao encontra prazo configurado e devolve zero sem tocar em nada.
 */
const transcriptRetentionJob: Job = {
  name: 'TranscriptRetentionJob',
  intervalMs: SCHEDULER_INTERVALS.TRANSCRIPT_RETENTION_MS,
  async run(): Promise<void> {
    await purgeExpiredTranscripts();
  },
};

const twitchLiveJob: Job = {
  name: 'TwitchLiveJob',
  intervalMs: SCHEDULER_INTERVALS.TWITCH_LIVE_CHECK_MS,
  async run(): Promise<void> {
    const client = tryGetClient();
    if (client !== null) await announceTwitchLives(client);
  },
};

/** Limpeza de estruturas em memoria. */
const maintenanceJob: Job = {
  name: 'MaintenanceJob',
  intervalMs: SCHEDULER_INTERVALS.MAINTENANCE_MS,
  run(): Promise<void> {
    const prunedCache = cache.prune();
    const prunedLocks = locks.prune();
    const prunedCooldowns = cooldowns.prune();
    const prunedDrafts = pruneDrafts() + pruneAnnouncementDrafts();

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

const JOBS: readonly Job[] = [
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
export function activeJobs(): readonly Job[] {
  return getEnv().BACKUP_ENABLED ? JOBS : JOBS.filter((job) => job !== backupJob);
}

export function startSchedulers(): void {
  if (started) return;
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

export function stopSchedulers(): void {
  for (const [name, state] of states) {
    clearInterval(state.timer);
    states.delete(name);
  }
  started = false;
  logger.info('Schedulers parados.');
}

export function schedulerStatus(): Array<{ name: string; running: boolean }> {
  return [...states.entries()].map(([name, state]) => ({ name, running: state.running }));
}
