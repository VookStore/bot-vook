"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnv = loadEnv;
exports.getEnv = getEnv;
exports.resetEnvCache = resetEnvCache;
exports.isProduction = isProduction;
const dotenv_1 = require("dotenv");
const errors_1 = require("../core/errors");
const Logger_1 = require("../core/logger/Logger");
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const NODE_ENVS = ['production', 'development', 'test'];
let dotenvLoaded = false;
let cached = null;
function readString(source, key) {
    const raw = source[key];
    return typeof raw === 'string' ? raw.trim() : '';
}
/**
 * Le e valida todas as variaveis de ambiente.
 * Acumula TODOS os problemas antes de falhar, para o operador corrigir de uma vez.
 * Nenhum valor de segredo e incluido na mensagem de erro.
 */
function loadEnv(source = process.env) {
    if (!dotenvLoaded) {
        (0, dotenv_1.config)();
        dotenvLoaded = true;
    }
    const problems = [];
    const token = readString(source, 'DISCORD_TOKEN');
    if (token.length === 0) {
        problems.push('DISCORD_TOKEN nao definido.');
    }
    const clientId = readString(source, 'DISCORD_CLIENT_ID');
    if (clientId.length === 0) {
        problems.push('DISCORD_CLIENT_ID nao definido.');
    }
    else if (!SNOWFLAKE_PATTERN.test(clientId)) {
        problems.push('DISCORD_CLIENT_ID deve ser um ID numerico do Discord (17-20 digitos).');
    }
    const guildIdRaw = readString(source, 'DISCORD_GUILD_ID');
    let guildId = null;
    if (guildIdRaw.length > 0) {
        if (!SNOWFLAKE_PATTERN.test(guildIdRaw)) {
            problems.push('DISCORD_GUILD_ID deve ser um ID numerico do Discord (17-20 digitos).');
        }
        else {
            guildId = guildIdRaw;
        }
    }
    const databaseUrl = readString(source, 'DATABASE_URL');
    if (databaseUrl.length === 0) {
        problems.push('DATABASE_URL nao definido.');
    }
    else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
        problems.push('DATABASE_URL deve ser uma string de conexao PostgreSQL.');
    }
    /*
     * Transcript hospedado e OPCIONAL.
     *
     * As duas variaveis andam juntas: uma sozinha nao serve para nada, e tratar
     * "so a base definida" como configuracao valida faria o upload falhar a cada
     * fechamento de ticket, em silencio. Faltando as duas, o bot segue com o
     * transcript em anexo, como sempre foi.
     */
    const transcriptBaseRaw = readString(source, 'TRANSCRIPT_BASE_URL').replace(/\/+$/, '');
    const transcriptToken = readString(source, 'TRANSCRIPT_UPLOAD_TOKEN');
    let transcriptBase = null;
    if (transcriptBaseRaw.length > 0 || transcriptToken.length > 0) {
        if (transcriptBaseRaw.length === 0) {
            problems.push('TRANSCRIPT_UPLOAD_TOKEN definido sem TRANSCRIPT_BASE_URL.');
        }
        else if (!/^https:\/\//i.test(transcriptBaseRaw)) {
            problems.push('TRANSCRIPT_BASE_URL deve comecar com https:// (o link vai para o cliente).');
        }
        else if (transcriptToken.length === 0) {
            problems.push('TRANSCRIPT_BASE_URL definido sem TRANSCRIPT_UPLOAD_TOKEN.');
        }
        else {
            transcriptBase = transcriptBaseRaw;
        }
    }
    /*
     * Backup do banco.
     *
     * Todas com padrao util: o backup precisa funcionar em quem nunca leu esta
     * secao do README. `BACKUP_RETENTION` invalido e erro em vez de virar o
     * padrao em silencio — quem escreveu "0" achando que desligava o backup
     * merece descobrir agora, e nao no dia em que precisar restaurar.
     */
    const backupDir = readString(source, 'BACKUP_DIR') || 'backups';
    // Valor fora de true/false e erro: "nao", "0" ou "off" mal digitados nao
    // podem deixar o backup ligado (ou desligado) sem ninguem perceber.
    const backupEnabledRaw = readString(source, 'BACKUP_ENABLED').toLowerCase();
    let backupEnabled = true;
    if (backupEnabledRaw === 'false') {
        backupEnabled = false;
    }
    else if (backupEnabledRaw.length > 0 && backupEnabledRaw !== 'true') {
        problems.push('BACKUP_ENABLED deve ser true ou false.');
    }
    const retentionRaw = readString(source, 'BACKUP_RETENTION');
    let retention = 14;
    if (retentionRaw.length > 0) {
        const parsed = Number(retentionRaw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
            problems.push('BACKUP_RETENTION deve ser um inteiro entre 1 e 365.');
        }
        else {
            retention = parsed;
        }
    }
    /*
     * Retencao dos transcripts. Ausente ou 0 = nunca apagar, que e o padrao.
     * Teto de 10 anos: acima disso e quase sempre engano de digitacao, e "nunca"
     * ja tem um valor proprio.
     */
    const transcriptRetentionRaw = readString(source, 'TRANSCRIPT_RETENTION_DAYS');
    let transcriptRetentionDays = 0;
    if (transcriptRetentionRaw.length > 0) {
        const parsed = Number(transcriptRetentionRaw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) {
            problems.push('TRANSCRIPT_RETENTION_DAYS deve ser um inteiro entre 0 e 3650.');
        }
        else {
            transcriptRetentionDays = parsed;
        }
    }
    const alertChannelRaw = readString(source, 'ALERT_CHANNEL_ID');
    let alertChannelId = null;
    if (alertChannelRaw.length > 0) {
        if (!SNOWFLAKE_PATTERN.test(alertChannelRaw)) {
            problems.push('ALERT_CHANNEL_ID deve ser um ID de canal do Discord (17-20 digitos).');
        }
        else {
            alertChannelId = alertChannelRaw;
        }
    }
    const influencerChannelRaw = readString(source, 'INFLUENCER_APPROVAL_CHANNEL_ID');
    let influencerApprovalChannelId = null;
    if (influencerChannelRaw.length > 0) {
        if (!SNOWFLAKE_PATTERN.test(influencerChannelRaw)) {
            problems.push('INFLUENCER_APPROVAL_CHANNEL_ID deve ser um ID de canal do Discord (17-20 digitos).');
        }
        else {
            influencerApprovalChannelId = influencerChannelRaw;
        }
    }
    const twitchClientId = readString(source, 'TWITCH_CLIENT_ID');
    const twitchClientSecret = readString(source, 'TWITCH_CLIENT_SECRET');
    const twitchAnnouncementRaw = readString(source, 'TWITCH_ANNOUNCEMENT_CHANNEL_ID');
    const twitchParts = [twitchClientId, twitchClientSecret, twitchAnnouncementRaw];
    if (twitchParts.some(Boolean) && !twitchParts.every(Boolean)) {
        problems.push('TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET e TWITCH_ANNOUNCEMENT_CHANNEL_ID devem ser definidos juntos.');
    }
    if (twitchAnnouncementRaw.length > 0 && !SNOWFLAKE_PATTERN.test(twitchAnnouncementRaw)) {
        problems.push('TWITCH_ANNOUNCEMENT_CHANNEL_ID deve ser um ID de canal do Discord.');
    }
    const pgDumpPath = readString(source, 'PG_DUMP_PATH');
    const nodeEnvRaw = (readString(source, 'NODE_ENV') || 'production').toLowerCase();
    if (!NODE_ENVS.includes(nodeEnvRaw)) {
        problems.push(`NODE_ENV invalido. Use: ${NODE_ENVS.join(', ')}.`);
    }
    const logLevelRaw = (readString(source, 'LOG_LEVEL') || 'info').toLowerCase();
    if (!Logger_1.LOG_LEVELS.includes(logLevelRaw)) {
        problems.push(`LOG_LEVEL invalido. Use: ${Logger_1.LOG_LEVELS.join(', ')}.`);
    }
    if (problems.length > 0) {
        throw new errors_1.ConfigurationError(`Configuracao de ambiente invalida:\n - ${problems.join('\n - ')}`, {
            userMessage: 'O bot nao esta configurado corretamente. Verifique o arquivo .env.',
            context: { problems },
        });
    }
    return {
        DISCORD_TOKEN: token,
        DISCORD_CLIENT_ID: clientId,
        DISCORD_GUILD_ID: guildId,
        DATABASE_URL: databaseUrl,
        NODE_ENV: nodeEnvRaw,
        LOG_LEVEL: logLevelRaw,
        TRANSCRIPT_BASE_URL: transcriptBase,
        TRANSCRIPT_UPLOAD_TOKEN: transcriptBase === null ? null : transcriptToken,
        TRANSCRIPT_RETENTION_DAYS: transcriptRetentionDays,
        ALERT_CHANNEL_ID: alertChannelId,
        INFLUENCER_APPROVAL_CHANNEL_ID: influencerApprovalChannelId,
        TWITCH_CLIENT_ID: twitchClientId || null,
        TWITCH_CLIENT_SECRET: twitchClientSecret || null,
        TWITCH_ANNOUNCEMENT_CHANNEL_ID: twitchAnnouncementRaw || null,
        BACKUP_ENABLED: backupEnabled,
        BACKUP_DIR: backupDir,
        BACKUP_RETENTION: retention,
        PG_DUMP_PATH: pgDumpPath.length > 0 ? pgDumpPath : null,
    };
}
/** Retorna o ambiente validado (memoizado). */
function getEnv() {
    cached ??= loadEnv();
    return cached;
}
/** Somente para testes. */
function resetEnvCache() {
    cached = null;
    dotenvLoaded = false;
}
function isProduction() {
    return getEnv().NODE_ENV === 'production';
}
//# sourceMappingURL=env.js.map