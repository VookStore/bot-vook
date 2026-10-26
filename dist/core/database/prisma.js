"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRISMA_ERROR = void 0;
exports.getPrisma = getPrisma;
exports.setPrisma = setPrisma;
exports.connectDatabase = connectDatabase;
exports.disconnectDatabase = disconnectDatabase;
exports.isDatabaseConnected = isDatabaseConnected;
exports.checkDatabaseHealth = checkDatabaseHealth;
exports.isPrismaKnownError = isPrismaKnownError;
exports.isUniqueConstraintError = isUniqueConstraintError;
const client_1 = require("@prisma/client");
const env_1 = require("../../config/env");
const Logger_1 = require("../logger/Logger");
const logger = (0, Logger_1.createLogger)('database');
let client = null;
let connected = false;
function getPrisma() {
    if (client === null) {
        client = new client_1.PrismaClient({
            datasources: { db: { url: (0, env_1.getEnv)().DATABASE_URL } },
            log: [
                { emit: 'event', level: 'warn' },
                { emit: 'event', level: 'error' },
            ],
        });
        client.$on('warn', (event) => {
            logger.warn('Prisma warning', { target: event.target, detail: event.message });
        });
        client.$on('error', (event) => {
            logger.error('Prisma error', undefined, { target: event.target, detail: event.message });
        });
    }
    return client;
}
/** Permite injetar um client (testes). */
function setPrisma(instance) {
    client = instance;
    connected = instance !== null;
}
async function connectDatabase() {
    const prisma = getPrisma();
    await prisma.$connect();
    // Consulta trivial garante que a conexao realmente funciona.
    await prisma.$queryRaw `SELECT 1`;
    connected = true;
    logger.info('PostgreSQL conectado.');
}
async function disconnectDatabase() {
    if (client === null)
        return;
    await client.$disconnect();
    connected = false;
    logger.info('PostgreSQL desconectado.');
}
function isDatabaseConnected() {
    return connected;
}
async function checkDatabaseHealth() {
    const start = process.hrtime.bigint();
    try {
        await getPrisma().$queryRaw `SELECT 1`;
        const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        return { ok: true, latencyMs: Math.round(latencyMs) };
    }
    catch (error) {
        const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        return {
            ok: false,
            latencyMs: Math.round(latencyMs),
            error: error instanceof Error ? error.name : 'UnknownError',
        };
    }
}
/** Codigos de erro do Prisma usados em tratamento de concorrencia. */
exports.PRISMA_ERROR = {
    UNIQUE_CONSTRAINT: 'P2002',
    RECORD_NOT_FOUND: 'P2025',
    FOREIGN_KEY: 'P2003',
};
function isPrismaKnownError(error, code) {
    if (!(error instanceof client_1.Prisma.PrismaClientKnownRequestError))
        return false;
    return code === undefined || error.code === code;
}
/** True quando o erro e violacao de UNIQUE (ex.: numero de ticket duplicado). */
function isUniqueConstraintError(error) {
    return isPrismaKnownError(error, exports.PRISMA_ERROR.UNIQUE_CONSTRAINT);
}
//# sourceMappingURL=prisma.js.map