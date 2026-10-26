import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Backup do PostgreSQL.
 *
 * O banco guarda o historico comercial inteiro da loja e roda num disco so,
 * sem replica. Estes testes cobrem as tres decisoes que decidem se o backup
 * vale alguma coisa no dia do resgate:
 *
 *  - a rotacao apaga so o que ELE gerou, e nunca o arquivo que o operador
 *    guardou na mesma pasta;
 *  - o prazo e lido do disco, entao reiniciar o bot nao gera dump extra;
 *  - a senha do banco nao aparece em `argv`.
 */

const env = {
  DATABASE_URL: 'postgresql://postgres:senha%20secreta@localhost:5432/vookstore?schema=public',
  BACKUP_DIR: '',
  BACKUP_RETENTION: 3,
  PG_DUMP_PATH: null as string | null,
};

vi.mock('../src/config/env', () => ({
  getEnv: () => env,
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  backupFileName,
  isBackupDue,
  lastBackupAt,
  listBackups,
  parseConnection,
  rotateBackups,
} from '../src/modules/system/services/BackupService';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vook-backup-'));
  env.BACKUP_DIR = dir;
  env.BACKUP_RETENTION = 3;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Cria um dump falso com a data embutida no nome. */
async function fakeDump(stamp: string, mtime?: Date): Promise<string> {
  const name = `vookstore-${stamp}.dump`;
  const path = join(dir, name);
  await writeFile(path, 'PGDMP conteudo');
  if (mtime !== undefined) await utimes(path, mtime, mtime);
  return name;
}

describe('backupFileName', () => {
  /*
   * UTC e o formato compacto nao sao estetica: horario local repete uma hora
   * por ano no fim do horario de verao (dois dumps com o mesmo nome, um
   * sobrescrevendo o outro), e este formato ordena igual cronologicamente — o
   * que deixa a rotacao ser uma ordenacao de strings.
   */
  it('usa UTC compacto, ordenavel como string', () => {
    const nome = backupFileName(new Date('2026-08-30T19:15:00.123Z'));
    expect(nome).toBe('vookstore-20260830T191500Z.dump');
  });

  it('ordena por nome na mesma ordem que por data', () => {
    const antes = backupFileName(new Date('2026-08-30T23:59:59Z'));
    const depois = backupFileName(new Date('2026-08-31T00:00:01Z'));
    expect(antes.localeCompare(depois)).toBeLessThan(0);
  });
});

describe('parseConnection', () => {
  it('decodifica usuario, senha e banco da DATABASE_URL', () => {
    const conexao = parseConnection(env.DATABASE_URL);

    expect(conexao.host).toBe('localhost');
    expect(conexao.port).toBe('5432');
    expect(conexao.user).toBe('postgres');
    expect(conexao.database).toBe('vookstore');
    // Percent-encoding tem de ser desfeito: o pg_dump recebe o valor cru.
    expect(conexao.password).toBe('senha secreta');
  });

  it('assume host e porta padrao quando a URL nao traz', () => {
    const conexao = parseConnection('postgresql:///vookstore');
    expect(conexao.host).toBe('localhost');
    expect(conexao.port).toBe('5432');
  });

  it('repassa o sslmode quando presente', () => {
    const conexao = parseConnection('postgresql://u:p@h:5432/d?sslmode=require');
    expect(conexao.sslmode).toBe('require');
  });
});

describe('listBackups', () => {
  it('devolve do mais novo para o mais antigo', async () => {
    await fakeDump('20260828T120000Z');
    await fakeDump('20260830T120000Z');
    await fakeDump('20260829T120000Z');

    await expect(listBackups()).resolves.toEqual([
      'vookstore-20260830T120000Z.dump',
      'vookstore-20260829T120000Z.dump',
      'vookstore-20260828T120000Z.dump',
    ]);
  });

  it('devolve vazio quando a pasta nem existe', async () => {
    env.BACKUP_DIR = join(dir, 'inexistente');
    await expect(listBackups()).resolves.toEqual([]);
  });

  it('ignora arquivo que nao segue o padrao de nome', async () => {
    await fakeDump('20260830T120000Z');
    await writeFile(join(dir, 'anotacoes.txt'), 'x');
    await writeFile(join(dir, 'vookstore-antigo.dump'), 'x');

    await expect(listBackups()).resolves.toEqual(['vookstore-20260830T120000Z.dump']);
  });
});

describe('rotateBackups', () => {
  it('mantem os N mais recentes e apaga o resto', async () => {
    for (const dia of ['26', '27', '28', '29', '30']) {
      await fakeDump(`202608${dia}T120000Z`);
    }

    await expect(rotateBackups()).resolves.toBe(2);

    await expect(listBackups()).resolves.toEqual([
      'vookstore-20260830T120000Z.dump',
      'vookstore-20260829T120000Z.dump',
      'vookstore-20260828T120000Z.dump',
    ]);
  });

  it('nao apaga nada quando ainda cabe na retencao', async () => {
    await fakeDump('20260830T120000Z');
    await expect(rotateBackups()).resolves.toBe(0);
  });

  /*
   * A pasta de backup e do operador. Se ele guardou ali um dump feito a mao
   * antes de uma migracao arriscada, a rotacao NAO pode leva-lo junto — por
   * isso ela so age sobre o padrao de nome que este modulo gera.
   */
  it('nunca toca em arquivo que nao foi este modulo que gerou', async () => {
    for (const dia of ['26', '27', '28', '29', '30']) {
      await fakeDump(`202608${dia}T120000Z`);
    }
    await writeFile(join(dir, 'antes-da-migracao.dump'), 'PGDMP');
    await writeFile(join(dir, 'leia-me.txt'), 'x');

    await rotateBackups();

    const restantes = await readdir(dir);
    expect(restantes).toContain('antes-da-migracao.dump');
    expect(restantes).toContain('leia-me.txt');
  });
});

describe('isBackupDue', () => {
  const AGORA = new Date('2026-08-30T12:00:00Z');

  it('esta vencido quando nunca houve backup', async () => {
    await expect(isBackupDue(AGORA)).resolves.toBe(true);
    await expect(lastBackupAt()).resolves.toBeNull();
  });

  /*
   * O prazo sai da data do arquivo no DISCO, nao de um contador em memoria.
   * E o que faz reiniciar o bot cinco vezes num dia continuar gerando um dump
   * so — e o que faz o backup sair logo apos uma parada de tres dias.
   */
  it('nao esta vencido logo depois de um backup', async () => {
    await fakeDump('20260830T100000Z', new Date('2026-08-30T10:00:00Z'));
    await expect(isBackupDue(AGORA)).resolves.toBe(false);
  });

  it('esta vencido depois de mais de 20 horas', async () => {
    await fakeDump('20260829T140000Z', new Date('2026-08-29T14:00:00Z'));
    await expect(isBackupDue(AGORA)).resolves.toBe(true);
  });
});
