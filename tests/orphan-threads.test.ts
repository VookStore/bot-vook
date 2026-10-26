import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Topicos de ticket sem registro no banco.
 *
 * Esta e uma rotina que APAGA CANAIS, e apagar canal nao tem desfazer. Os
 * testes existem menos para provar que ela encontra os orfaos e mais para
 * provar que ela nao encontra mais nada: um topico criado a mao pela equipe, um
 * ticket legitimo ou um canal comum jamais podem entrar na lista.
 */

const findMany = vi.fn();
const getCategories = vi.fn();
const fetchChannelSafe = vi.fn();

vi.mock('../src/core/database/prisma', () => ({
  getPrisma: () => ({ ticket: { findMany: (...args: unknown[]) => findMany(...args) } }),
}));

vi.mock('../src/modules/tickets/services/TicketConfigService', () => ({
  getCategories: (...args: unknown[]) => getCategories(...args),
}));

vi.mock('../src/utils/discord', () => ({
  fetchChannelSafe: (...args: unknown[]) => fetchChannelSafe(...args),
}));

vi.mock('../src/core/logger/Logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  deleteOrphanThreads,
  findOrphanThreads,
} from '../src/modules/tickets/services/OrphanThreadService';

const GUILD_ID = '1042089361279287366';
const DESTINO = '1419483356046823589';

const guild = { id: GUILD_ID } as never;

/** Topico dentro de um canal de destino. */
function thread(id: string, name: string, createdAt = new Date('2026-08-30T12:00:00Z')) {
  return { id, name, createdAt, isThread: () => true, delete: vi.fn().mockResolvedValue(undefined) };
}

/** Canal de destino contendo os topicos informados. */
function destino(threads: ReturnType<typeof thread>[]) {
  return {
    id: DESTINO,
    type: ChannelType.GuildText,
    threads: {
      fetchActive: vi.fn().mockResolvedValue({
        threads: new Map(threads.map((t) => [t.id, t])),
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCategories.mockResolvedValue([{ destinationChannelId: DESTINO, deletedAt: null }]);
  findMany.mockResolvedValue([]);
});

describe('findOrphanThreads', () => {
  it('acha o topico com nome de ticket que o banco nao conhece', async () => {
    fetchChannelSafe.mockResolvedValue(destino([thread('t1', 'ticket-0005')]));

    const orphans = await findOrphanThreads(guild);

    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.name).toBe('ticket-0005');
    expect(orphans[0]?.parentId).toBe(DESTINO);
  });

  /*
   * A PROTECAO PRINCIPAL. Um ticket vivo tem registro no banco; sem esta
   * comparacao a rotina apagaria a conversa de um cliente em atendimento.
   */
  it('nunca lista um topico que tem registro no banco', async () => {
    findMany.mockResolvedValue([{ channelId: 't1' }]);
    fetchChannelSafe.mockResolvedValue(destino([thread('t1', 'ticket-0005')]));

    await expect(findOrphanThreads(guild)).resolves.toEqual([]);
  });

  /*
   * O canal de destino tambem hospeda topicos que a equipe cria a mao. So o
   * padrao de nome que o proprio bot gera entra na lista.
   */
  it('ignora topico que nao tem nome de ticket', async () => {
    fetchChannelSafe.mockResolvedValue(
      destino([thread('t1', 'combinados-da-equipe'), thread('t2', 'ticket-do-joao')]),
    );

    await expect(findOrphanThreads(guild)).resolves.toEqual([]);
  });

  it('ignora categoria removida', async () => {
    getCategories.mockResolvedValue([{ destinationChannelId: DESTINO, deletedAt: new Date() }]);

    await expect(findOrphanThreads(guild)).resolves.toEqual([]);
    expect(fetchChannelSafe).not.toHaveBeenCalled();
  });

  it('ignora categoria sem canal de destino', async () => {
    getCategories.mockResolvedValue([{ destinationChannelId: null, deletedAt: null }]);

    await expect(findOrphanThreads(guild)).resolves.toEqual([]);
    expect(fetchChannelSafe).not.toHaveBeenCalled();
  });

  it('nao varre o mesmo canal duas vezes quando duas categorias o compartilham', async () => {
    getCategories.mockResolvedValue([
      { destinationChannelId: DESTINO, deletedAt: null },
      { destinationChannelId: DESTINO, deletedAt: null },
    ]);
    fetchChannelSafe.mockResolvedValue(destino([]));

    await findOrphanThreads(guild);

    expect(fetchChannelSafe).toHaveBeenCalledTimes(1);
  });

  /*
   * Um canal quebrado no meio nao pode derrubar a varredura: o diagnostico
   * precisa responder mesmo com uma categoria mal configurada.
   */
  it('segue em frente quando um canal falha', async () => {
    const bom = destino([thread('t1', 'ticket-0007')]);
    getCategories.mockResolvedValue([
      { destinationChannelId: 'quebrado', deletedAt: null },
      { destinationChannelId: DESTINO, deletedAt: null },
    ]);
    fetchChannelSafe.mockImplementation((_guild: unknown, id: string) =>
      Promise.resolve(id === DESTINO ? bom : null),
    );

    const orphans = await findOrphanThreads(guild);
    expect(orphans).toHaveLength(1);
  });
});

describe('deleteOrphanThreads', () => {
  it('apaga o topico informado', async () => {
    const alvo = thread('t1', 'ticket-0005');
    fetchChannelSafe.mockResolvedValue(alvo);

    const result = await deleteOrphanThreads(guild, [
      { id: 't1', name: 'ticket-0005', parentId: DESTINO, createdAt: null },
    ]);

    expect(alvo.delete).toHaveBeenCalledOnce();
    expect(result).toEqual({ deleted: 1, failed: 0 });
  });

  /*
   * O id vem de uma mensagem que pode estar aberta ha minutos. Reconferir nome
   * e tipo antes de apagar e o que impede um id velho levar junto um canal que
   * hoje e outra coisa.
   */
  it('recusa apagar quando o alvo nao e mais um topico de ticket', async () => {
    fetchChannelSafe.mockResolvedValue({ id: 't1', isThread: () => false });

    const result = await deleteOrphanThreads(guild, [
      { id: 't1', name: 'ticket-0005', parentId: DESTINO, createdAt: null },
    ]);

    expect(result).toEqual({ deleted: 0, failed: 1 });
  });

  it('recusa apagar topico que foi renomeado para fora do padrao', async () => {
    fetchChannelSafe.mockResolvedValue(thread('t1', 'atendimento-do-joao'));

    const result = await deleteOrphanThreads(guild, [
      { id: 't1', name: 'ticket-0005', parentId: DESTINO, createdAt: null },
    ]);

    expect(result).toEqual({ deleted: 0, failed: 1 });
  });

  it('conta a falha e segue quando o Discord recusa a remocao', async () => {
    const alvo = thread('t1', 'ticket-0005');
    alvo.delete.mockRejectedValue(new Error('sem permissao'));
    fetchChannelSafe.mockResolvedValue(alvo);

    const result = await deleteOrphanThreads(guild, [
      { id: 't1', name: 'ticket-0005', parentId: DESTINO, createdAt: null },
    ]);

    expect(result).toEqual({ deleted: 0, failed: 1 });
  });

  it('nao apaga nada quando a lista chega vazia', async () => {
    const result = await deleteOrphanThreads(guild, []);

    expect(fetchChannelSafe).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, failed: 0 });
  });
});
