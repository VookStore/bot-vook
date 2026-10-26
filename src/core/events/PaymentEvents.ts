import type { Payment } from '@prisma/client';

import { createLogger } from '../logger/Logger';

/**
 * Barramento interno de eventos de pagamento.
 *
 * POR QUE ISTO EXISTE
 *  O catalogo precisa saber quando uma cobranca foi aprovada, expirou ou foi
 *  cancelada — mas o `PaymentService` NAO pode conhecer o modulo de pedidos
 *  (seria dependencia circular, e a autoridade financeira e ele). Entao o
 *  pagamento apenas ANUNCIA o que aconteceu e quem se interessa escuta.
 *
 * REGRAS
 *  - O emissor nunca e afetado pelo ouvinte: falha de listener vira WARN e a
 *    operacao financeira segue valida (ela ja foi commitada).
 *  - Listener NAO pode adquirir o lock `PAYMENT_ACTION` do mesmo pagamento:
 *    o emissor costuma estar dentro dele e os locks nao sao reentrantes.
 *  - Toda sincronizacao derivada precisa ser IDEMPOTENTE: o mesmo evento pode
 *    chegar de novo pelo recovery apos um restart.
 */

const logger = createLogger('payment:events');

export type PaymentEventName = 'approved' | 'cancelled' | 'expired';

export interface PaymentEvent {
  payment: Payment;
  /** Quem executou a acao (equipe). `null` quando foi o scheduler. */
  actorId: string | null;
}

export type PaymentEventListener = (event: PaymentEvent) => Promise<void> | void;

const listeners = new Map<PaymentEventName, PaymentEventListener[]>();

export function onPaymentEvent(name: PaymentEventName, listener: PaymentEventListener): void {
  const current = listeners.get(name) ?? [];
  current.push(listener);
  listeners.set(name, current);
}

/**
 * Dispara o evento e AGUARDA os ouvintes.
 *
 * A espera e proposital: quando a equipe aprova uma cobranca, o pedido precisa
 * ja estar como PAGO na resposta da interacao. Erros de ouvinte sao engolidos
 * (com WARN) porque o pagamento em si esta correto e commitado.
 */
export async function emitPaymentEvent(
  name: PaymentEventName,
  event: PaymentEvent,
): Promise<void> {
  const registered = listeners.get(name);
  if (registered === undefined || registered.length === 0) return;

  for (const listener of registered) {
    try {
      await listener(event);
    } catch (error) {
      logger.warn('Ouvinte de evento de pagamento falhou.', {
        guildId: event.payment.guildId,
        entityType: 'payment',
        entityId: event.payment.id,
        event: name,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Somente para testes. */
export function clearPaymentEventListeners(): void {
  listeners.clear();
}

export function paymentEventListenerCount(name: PaymentEventName): number {
  return listeners.get(name)?.length ?? 0;
}
