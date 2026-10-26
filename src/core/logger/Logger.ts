import { toDisplayString } from '../../utils/stringify';
import { redactContext, redactString } from './redact';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'audit'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/** Peso usado para filtrar por LOG_LEVEL. AUDIT nunca e filtrado. */
const LEVEL_WEIGHT: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  audit: 100,
};

export interface LogContext {
  guildId?: string | null;
  channelId?: string | null;
  userId?: string | null;
  interactionId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  [key: string]: unknown;
}

export interface LogRecord {
  timestamp: string;
  level: LogLevelName;
  module: string;
  message: string;
  context: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
}

/** Destino de logs (console, arquivo, banco...). */
export type LogSink = (record: LogRecord) => void;

const LEVEL_LABEL: Record<LogLevelName, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
  audit: 'AUDIT',
};

const LEVEL_COLOR: Record<LogLevelName, string> = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
  audit: '\u001b[35m',
};

const COLOR_RESET = '\u001b[0m';

function supportsColor(): boolean {
  if (process.env['NO_COLOR']) return false;
  return process.stdout.isTTY === true;
}

const CONTEXT_ORDER = ['guildId', 'channelId', 'userId', 'entityType', 'entityId'] as const;

function formatContext(context: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of CONTEXT_ORDER) {
    const value = context[key];
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${key}=${toDisplayString(value)}`);
    }
  }
  for (const [key, value] of Object.entries(context)) {
    if ((CONTEXT_ORDER as readonly string[]).includes(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    const rendered = toDisplayString(value);
    parts.push(`${key}=${rendered}`);
  }
  return parts.length > 0 ? ` { ${parts.join(' ')} }` : '';
}

/** Sink padrao: console humano-legivel com cores em TTY. */
export function createConsoleSink(): LogSink {
  const useColor = supportsColor();
  return (record: LogRecord): void => {
    const time = record.timestamp.slice(11, 23);
    const label = LEVEL_LABEL[record.level];
    const head = useColor
      ? `${LEVEL_COLOR[record.level]}${label}${COLOR_RESET}`
      : label;
    const line = `${time} ${head} [${record.module}] ${record.message}${formatContext(record.context)}`;
    /*
     * SOMENTE erro vai para stderr.
     *
     * O PM2 roteia stderr para `logs/error.log`. Mandando WARN junto, avisos
     * esperados — "Guild com configuracao incompleta", DM fechada pelo cliente,
     * canal de log ainda nao configurado — enchiam o arquivo onde o operador
     * procura falha de verdade, e um startup saudavel parecia quebrado.
     */
    const stream = record.level === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
    if (record.error?.stack) {
      stream.write(`${record.error.stack}\n`);
    }
  };
}

/** Sink JSON (uma linha por registro), util para agregadores de log. */
export function createJsonSink(): LogSink {
  return (record: LogRecord): void => {
    const stream = record.level === 'error' ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(record)}\n`);
  };
}

export class Logger {
  private static level: LogLevelName = 'info';
  private static sinks: LogSink[] = [createConsoleSink()];

  private readonly moduleName: string;
  private readonly baseContext: LogContext;

  public constructor(moduleName: string, baseContext: LogContext = {}) {
    this.moduleName = moduleName;
    this.baseContext = baseContext;
  }

  public static setLevel(level: LogLevelName): void {
    Logger.level = level;
  }

  public static getLevel(): LogLevelName {
    return Logger.level;
  }

  public static setSinks(sinks: LogSink[]): void {
    Logger.sinks = sinks;
  }

  /** Adiciona um destino extra (ex.: persistencia em SystemErrorLog). */
  public static addSink(sink: LogSink): void {
    Logger.sinks.push(sink);
  }

  public static resetSinks(): void {
    Logger.sinks = [createConsoleSink()];
  }

  /** Cria um logger filho herdando o contexto atual. */
  public child(context: LogContext): Logger {
    return new Logger(this.moduleName, { ...this.baseContext, ...context });
  }

  public debug(message: string, context: LogContext = {}): void {
    this.write('debug', message, context);
  }

  public info(message: string, context: LogContext = {}): void {
    this.write('info', message, context);
  }

  public warn(message: string, context: LogContext = {}): void {
    this.write('warn', message, context);
  }

  public error(message: string, error?: unknown, context: LogContext = {}): void {
    this.write('error', message, context, error);
  }

  /** Trilha de auditoria: nunca filtrada por LOG_LEVEL. */
  public audit(message: string, context: LogContext = {}): void {
    this.write('audit', message, context);
  }

  private write(
    level: LogLevelName,
    message: string,
    context: LogContext,
    error?: unknown,
  ): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[Logger.level]) return;

    const merged = { ...this.baseContext, ...context };
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      module: this.moduleName,
      message: redactString(message),
      context: redactContext(merged as Record<string, unknown>),
    };

    if (error !== undefined) {
      if (error instanceof Error) {
        record.error = {
          name: error.name,
          message: redactString(error.message),
          stack: error.stack ? redactString(error.stack) : undefined,
        };
      } else {
        record.error = {
          name: 'UnknownError',
          message: redactString(toDisplayString(error)),
        };
      }
    }

    for (const sink of Logger.sinks) {
      try {
        sink(record);
      } catch {
        // Um sink com defeito nunca pode derrubar a aplicacao.
      }
    }
  }
}

/** Fabrica curta para modulos. */
export function createLogger(moduleName: string, context: LogContext = {}): Logger {
  return new Logger(moduleName, context);
}
