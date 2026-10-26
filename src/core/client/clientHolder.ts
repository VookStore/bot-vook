import type { Client } from 'discord.js';

import { AppError } from '../errors';

/**
 * Referencia unica do cliente logado.
 *
 * Servicos de background (scheduler, recovery) precisam do cliente sem que ele
 * seja passado por dez camadas de funcao. Handlers de interacao continuam
 * usando `interaction.client`.
 */

let current: Client | null = null;

export function setClient(client: Client): void {
  current = client;
}

export function clearClient(): void {
  current = null;
}

export function hasClient(): boolean {
  return current !== null && current.isReady();
}

/** Cliente pronto. Lanca se chamado antes do login. */
export function getClient(): Client<true> {
  if (current === null || !current.isReady()) {
    throw new AppError('Cliente do Discord ainda nao esta pronto.', {
      code: 'CLIENT_NOT_READY',
    });
  }
  return current;
}

/** Cliente pronto ou null (para jobs que devem apenas pular a execucao). */
export function tryGetClient(): Client<true> | null {
  if (current === null || !current.isReady()) return null;
  return current;
}
