"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.LOG_LEVELS = void 0;
exports.createConsoleSink = createConsoleSink;
exports.createJsonSink = createJsonSink;
exports.createLogger = createLogger;
const stringify_1 = require("../../utils/stringify");
const redact_1 = require("./redact");
exports.LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'audit'];
/** Peso usado para filtrar por LOG_LEVEL. AUDIT nunca e filtrado. */
const LEVEL_WEIGHT = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    audit: 100,
};
const LEVEL_LABEL = {
    debug: 'DEBUG',
    info: 'INFO ',
    warn: 'WARN ',
    error: 'ERROR',
    audit: 'AUDIT',
};
const LEVEL_COLOR = {
    debug: '\u001b[90m',
    info: '\u001b[36m',
    warn: '\u001b[33m',
    error: '\u001b[31m',
    audit: '\u001b[35m',
};
const COLOR_RESET = '\u001b[0m';
function supportsColor() {
    if (process.env['NO_COLOR'])
        return false;
    return process.stdout.isTTY === true;
}
const CONTEXT_ORDER = ['guildId', 'channelId', 'userId', 'entityType', 'entityId'];
function formatContext(context) {
    const parts = [];
    for (const key of CONTEXT_ORDER) {
        const value = context[key];
        if (value !== undefined && value !== null && value !== '') {
            parts.push(`${key}=${(0, stringify_1.toDisplayString)(value)}`);
        }
    }
    for (const [key, value] of Object.entries(context)) {
        if (CONTEXT_ORDER.includes(key))
            continue;
        if (value === undefined || value === null || value === '')
            continue;
        const rendered = (0, stringify_1.toDisplayString)(value);
        parts.push(`${key}=${rendered}`);
    }
    return parts.length > 0 ? ` { ${parts.join(' ')} }` : '';
}
/** Sink padrao: console humano-legivel com cores em TTY. */
function createConsoleSink() {
    const useColor = supportsColor();
    return (record) => {
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
function createJsonSink() {
    return (record) => {
        const stream = record.level === 'error' ? process.stderr : process.stdout;
        stream.write(`${JSON.stringify(record)}\n`);
    };
}
class Logger {
    static level = 'info';
    static sinks = [createConsoleSink()];
    moduleName;
    baseContext;
    constructor(moduleName, baseContext = {}) {
        this.moduleName = moduleName;
        this.baseContext = baseContext;
    }
    static setLevel(level) {
        Logger.level = level;
    }
    static getLevel() {
        return Logger.level;
    }
    static setSinks(sinks) {
        Logger.sinks = sinks;
    }
    /** Adiciona um destino extra (ex.: persistencia em SystemErrorLog). */
    static addSink(sink) {
        Logger.sinks.push(sink);
    }
    static resetSinks() {
        Logger.sinks = [createConsoleSink()];
    }
    /** Cria um logger filho herdando o contexto atual. */
    child(context) {
        return new Logger(this.moduleName, { ...this.baseContext, ...context });
    }
    debug(message, context = {}) {
        this.write('debug', message, context);
    }
    info(message, context = {}) {
        this.write('info', message, context);
    }
    warn(message, context = {}) {
        this.write('warn', message, context);
    }
    error(message, error, context = {}) {
        this.write('error', message, context, error);
    }
    /** Trilha de auditoria: nunca filtrada por LOG_LEVEL. */
    audit(message, context = {}) {
        this.write('audit', message, context);
    }
    write(level, message, context, error) {
        if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[Logger.level])
            return;
        const merged = { ...this.baseContext, ...context };
        const record = {
            timestamp: new Date().toISOString(),
            level,
            module: this.moduleName,
            message: (0, redact_1.redactString)(message),
            context: (0, redact_1.redactContext)(merged),
        };
        if (error !== undefined) {
            if (error instanceof Error) {
                record.error = {
                    name: error.name,
                    message: (0, redact_1.redactString)(error.message),
                    stack: error.stack ? (0, redact_1.redactString)(error.stack) : undefined,
                };
            }
            else {
                record.error = {
                    name: 'UnknownError',
                    message: (0, redact_1.redactString)((0, stringify_1.toDisplayString)(error)),
                };
            }
        }
        for (const sink of Logger.sinks) {
            try {
                sink(record);
            }
            catch {
                // Um sink com defeito nunca pode derrubar a aplicacao.
            }
        }
    }
}
exports.Logger = Logger;
/** Fabrica curta para modulos. */
function createLogger(moduleName, context = {}) {
    return new Logger(moduleName, context);
}
//# sourceMappingURL=Logger.js.map