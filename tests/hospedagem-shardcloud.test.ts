import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/*
 * Hospedagem na ShardCloud.
 *
 * Tres coisas que, se quebrarem, so aparecem na hora de subir o bot la:
 *
 *  - `BACKUP_ENABLED=false` desliga o backup por `pg_dump`, que nao existe na
 *    plataforma. Sem isso o job falha toda hora e alerta todo dia.
 *  - O `.shardcloud` respeita os campos e limites da plataforma, e o comando
 *    dele aponta para um arquivo que vai no pacote.
 *  - O Prisma CLI e dependencia de producao: o script de inicio roda
 *    `prisma generate` e `migrate deploy` la, e a plataforma pode nao instalar
 *    devDependencies.
 */

const env = { BACKUP_ENABLED: true };

vi.mock('../src/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/config/env')>();
  return { ...original, getEnv: () => env };
});

vi.mock('../src/core/logger/Logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/logger/Logger')>()),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { loadEnv } from '../src/config/env';
import { activeJobs } from '../src/core/scheduler/SchedulerService';

const ROOT = join(__dirname, '..');

const BASE: NodeJS.ProcessEnv = {
  DISCORD_TOKEN: 'token',
  DISCORD_CLIENT_ID: '123456789012345678',
  DATABASE_URL: 'postgresql://u:p@db.exemplo:5432/vook?sslmode=require',
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
};

describe('BACKUP_ENABLED', () => {
  it('fica ligado quando nao e definido', () => {
    expect(loadEnv({ ...BASE }).BACKUP_ENABLED).toBe(true);
  });

  it('aceita true e false, sem diferenciar maiusculas', () => {
    expect(loadEnv({ ...BASE, BACKUP_ENABLED: 'false' }).BACKUP_ENABLED).toBe(false);
    expect(loadEnv({ ...BASE, BACKUP_ENABLED: ' FALSE ' }).BACKUP_ENABLED).toBe(false);
    expect(loadEnv({ ...BASE, BACKUP_ENABLED: 'true' }).BACKUP_ENABLED).toBe(true);
  });

  it('recusa valor que nao e true nem false', () => {
    for (const valor of ['0', 'nao', 'off', 'desligado']) {
      expect(() => loadEnv({ ...BASE, BACKUP_ENABLED: valor })).toThrow(/BACKUP_ENABLED/);
    }
  });
});

describe('jobs do agendador', () => {
  it('roda o backup quando ligado', () => {
    env.BACKUP_ENABLED = true;
    expect(activeJobs().map((job) => job.name)).toContain('DatabaseBackupJob');
  });

  it('tira so o backup da lista quando desligado', () => {
    env.BACKUP_ENABLED = true;
    const todos = activeJobs().map((job) => job.name);

    env.BACKUP_ENABLED = false;
    const semBackup = activeJobs().map((job) => job.name);

    expect(semBackup).not.toContain('DatabaseBackupJob');
    expect(semBackup).toEqual(todos.filter((name) => name !== 'DatabaseBackupJob'));
  });
});

/** Le o `.shardcloud` como CHAVE=valor. */
function readShardcloudConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, '.shardcloud'), 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) config[match[1]] = match[2];
  }
  return config;
}

describe('.shardcloud', () => {
  const config = readShardcloudConfig();

  it('tem os campos obrigatorios dentro dos limites da plataforma', () => {
    expect(config.DISPLAY_NAME?.length).toBeGreaterThan(0);
    expect(config.DISPLAY_NAME?.length).toBeLessThanOrEqual(50);
    expect((config.DESCRIPTION ?? '').length).toBeLessThanOrEqual(1024);
    expect(config.LANGUAGE).toBe('node');
    expect(['recommended', 'latest']).toContain(config.VERSION);
    expect(Number(config.MEMORY)).toBeGreaterThanOrEqual(512);
    expect(Number.isInteger(Number(config.MEMORY))).toBe(true);
  });

  it('inicia por um script que existe e vai no pacote', () => {
    const command = config.CUSTOM_COMMAND ?? '';
    expect(command.length).toBeLessThanOrEqual(250);
    // Sem `&&`: uma cadeia roda num shell, e o SIGTERM nao chegaria ao bot.
    expect(command).not.toContain('&&');

    const script = /^node (\S+)$/.exec(command)?.[1];
    expect(script).toBeDefined();
    expect(existsSync(join(ROOT, script ?? ''))).toBe(true);

    const packer = readFileSync(join(ROOT, 'scripts', 'empacotar-shardcloud.mjs'), 'utf8');
    expect(packer).toContain(`'${script ?? ''}'`);
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('leva o Prisma CLI em dependencies, na mesma versao do client', () => {
    expect(pkg.dependencies.prisma).toBeDefined();
    expect(pkg.devDependencies.prisma).toBeUndefined();
    expect(pkg.dependencies.prisma).toBe(pkg.dependencies['@prisma/client']);
  });

  it('fixa as versoes de producao, ja que o lockfile nao vai no pacote', () => {
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
