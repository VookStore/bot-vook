import { config as loadDotenv } from 'dotenv';

import { ConfigurationError } from '../core/errors';
import { LOG_LEVELS, type LogLevelName } from '../core/logger/Logger';

export type NodeEnvName = 'production' | 'development' | 'test';

export interface AppEnv {
  DISCORD_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  /** Quando definido, os comandos sao registrados apenas nesta guild. */
  DISCORD_GUILD_ID: string | null;
  DATABASE_URL: string;
  NODE_ENV: NodeEnvName;
  LOG_LEVEL: LogLevelName;
  /**
   * Base do Worker que hospeda os transcripts (sem barra final).
   * Ausente desliga a hospedagem: o transcript continua indo como ANEXO no log.
   */
  TRANSCRIPT_BASE_URL: string | null;
  /** Token do `PUT` no Worker. Sem ele a base tambem e ignorada. */
  TRANSCRIPT_UPLOAD_TOKEN: string | null;
  /**
   * Canal onde os erros de fundo do bot sao publicados.
   *
   * Vazio DESLIGA o alerta — o erro continua indo para o log e para a tabela
   * `system_error_logs`, como sempre foi. Fica no ambiente e nao na
   * configuracao da guild porque muita falha nao tem guild nenhuma (backup,
   * agendador, gateway), e essas sao justamente as que ninguem ve.
   */
  ALERT_CHANNEL_ID: string | null;
  /** Canal interno que recebe as inscricoes enviadas pelo site publico. */
  INFLUENCER_APPROVAL_CHANNEL_ID: string | null;
  /**
   * Liga o backup diario feito pelo proprio bot (`pg_dump`).
   *
   * `true` por padrao. Desligado em hospedagem que nao tem `pg_dump` (a
   * ShardCloud, por exemplo, onde o banco gerenciado ja tem backup proprio):
   * sem isto o job falharia toda hora e mandaria alerta todo dia.
   */
  BACKUP_ENABLED: boolean;
  /** Pasta onde os dumps do Postgres sao gravados. */
  BACKUP_DIR: string;
  /** Quantos dumps manter antes de apagar os mais antigos. */
  BACKUP_RETENTION: number;
  /**
   * Dias que um transcript hospedado sobrevive apos o ticket fechar.
   *
   * `0` (padrao) DESLIGA a remocao. Apagar registro de cliente por conta
   * propria, so porque a funcionalidade existe, seria decidir no lugar do
   * operador algo que ele pode ter obrigacao legal de manter.
   */
  TRANSCRIPT_RETENTION_DAYS: number;
  /**
   * Caminho explicito do `pg_dump`.
   *
   * `null` deixa o servico procurar sozinho (PATH e, no Windows, a instalacao
   * padrao do PostgreSQL). Existe porque em maquina com varias versoes
   * instaladas a escolha automatica pode pegar a errada — e um `pg_dump` mais
   * antigo que o servidor recusa gerar o dump.
   */
  PG_DUMP_PATH: string | null;
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const NODE_ENVS: readonly NodeEnvName[] = ['production', 'development', 'test'];

let dotenvLoaded = false;
let cached: AppEnv | null = null;

function readString(source: NodeJS.ProcessEnv, key: string): string {
  const raw = source[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Le e valida todas as variaveis de ambiente.
 * Acumula TODOS os problemas antes de falhar, para o operador corrigir de uma vez.
 * Nenhum valor de segredo e incluido na mensagem de erro.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (!dotenvLoaded) {
    loadDotenv();
    dotenvLoaded = true;
  }

  const problems: string[] = [];

  const token = readString(source, 'DISCORD_TOKEN');
  if (token.length === 0) {
    problems.push('DISCORD_TOKEN nao definido.');
  }

  const clientId = readString(source, 'DISCORD_CLIENT_ID');
  if (clientId.length === 0) {
    problems.push('DISCORD_CLIENT_ID nao definido.');
  } else if (!SNOWFLAKE_PATTERN.test(clientId)) {
    problems.push('DISCORD_CLIENT_ID deve ser um ID numerico do Discord (17-20 digitos).');
  }

  const guildIdRaw = readString(source, 'DISCORD_GUILD_ID');
  let guildId: string | null = null;
  if (guildIdRaw.length > 0) {
    if (!SNOWFLAKE_PATTERN.test(guildIdRaw)) {
      problems.push('DISCORD_GUILD_ID deve ser um ID numerico do Discord (17-20 digitos).');
    } else {
      guildId = guildIdRaw;
    }
  }

  const databaseUrl = readString(source, 'DATABASE_URL');
  if (databaseUrl.length === 0) {
    problems.push('DATABASE_URL nao definido.');
  } else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
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
  let transcriptBase: string | null = null;

  if (transcriptBaseRaw.length > 0 || transcriptToken.length > 0) {
    if (transcriptBaseRaw.length === 0) {
      problems.push('TRANSCRIPT_UPLOAD_TOKEN definido sem TRANSCRIPT_BASE_URL.');
    } else if (!/^https:\/\//i.test(transcriptBaseRaw)) {
      problems.push('TRANSCRIPT_BASE_URL deve comecar com https:// (o link vai para o cliente).');
    } else if (transcriptToken.length === 0) {
      problems.push('TRANSCRIPT_BASE_URL definido sem TRANSCRIPT_UPLOAD_TOKEN.');
    } else {
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
  } else if (backupEnabledRaw.length > 0 && backupEnabledRaw !== 'true') {
    problems.push('BACKUP_ENABLED deve ser true ou false.');
  }

  const retentionRaw = readString(source, 'BACKUP_RETENTION');
  let retention = 14;
  if (retentionRaw.length > 0) {
    const parsed = Number(retentionRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      problems.push('BACKUP_RETENTION deve ser um inteiro entre 1 e 365.');
    } else {
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
    } else {
      transcriptRetentionDays = parsed;
    }
  }

  const alertChannelRaw = readString(source, 'ALERT_CHANNEL_ID');
  let alertChannelId: string | null = null;
  if (alertChannelRaw.length > 0) {
    if (!SNOWFLAKE_PATTERN.test(alertChannelRaw)) {
      problems.push('ALERT_CHANNEL_ID deve ser um ID de canal do Discord (17-20 digitos).');
    } else {
      alertChannelId = alertChannelRaw;
    }
  }

  const influencerChannelRaw = readString(source, 'INFLUENCER_APPROVAL_CHANNEL_ID');
  let influencerApprovalChannelId: string | null = null;
  if (influencerChannelRaw.length > 0) {
    if (!SNOWFLAKE_PATTERN.test(influencerChannelRaw)) {
      problems.push(
        'INFLUENCER_APPROVAL_CHANNEL_ID deve ser um ID de canal do Discord (17-20 digitos).',
      );
    } else {
      influencerApprovalChannelId = influencerChannelRaw;
    }
  }

  const pgDumpPath = readString(source, 'PG_DUMP_PATH');

  const nodeEnvRaw = (readString(source, 'NODE_ENV') || 'production').toLowerCase();
  if (!NODE_ENVS.includes(nodeEnvRaw as NodeEnvName)) {
    problems.push(`NODE_ENV invalido. Use: ${NODE_ENVS.join(', ')}.`);
  }

  const logLevelRaw = (readString(source, 'LOG_LEVEL') || 'info').toLowerCase();
  if (!LOG_LEVELS.includes(logLevelRaw as LogLevelName)) {
    problems.push(`LOG_LEVEL invalido. Use: ${LOG_LEVELS.join(', ')}.`);
  }

  if (problems.length > 0) {
    throw new ConfigurationError(
      `Configuracao de ambiente invalida:\n - ${problems.join('\n - ')}`,
      {
        userMessage: 'O bot nao esta configurado corretamente. Verifique o arquivo .env.',
        context: { problems },
      },
    );
  }

  return {
    DISCORD_TOKEN: token,
    DISCORD_CLIENT_ID: clientId,
    DISCORD_GUILD_ID: guildId,
    DATABASE_URL: databaseUrl,
    NODE_ENV: nodeEnvRaw as NodeEnvName,
    LOG_LEVEL: logLevelRaw as LogLevelName,
    TRANSCRIPT_BASE_URL: transcriptBase,
    TRANSCRIPT_UPLOAD_TOKEN: transcriptBase === null ? null : transcriptToken,
    TRANSCRIPT_RETENTION_DAYS: transcriptRetentionDays,
    ALERT_CHANNEL_ID: alertChannelId,
    INFLUENCER_APPROVAL_CHANNEL_ID: influencerApprovalChannelId,
    BACKUP_ENABLED: backupEnabled,
    BACKUP_DIR: backupDir,
    BACKUP_RETENTION: retention,
    PG_DUMP_PATH: pgDumpPath.length > 0 ? pgDumpPath : null,
  };
}

/** Retorna o ambiente validado (memoizado). */
export function getEnv(): AppEnv {
  cached ??= loadEnv();
  return cached;
}

/** Somente para testes. */
export function resetEnvCache(): void {
  cached = null;
  dotenvLoaded = false;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}
