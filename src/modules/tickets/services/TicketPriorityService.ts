import { OrderStatus, TicketAuditAction, TicketPriority } from '@prisma/client';
import type { Client } from 'discord.js';

import { TICKET_PRIORITY } from '../../../constants/limits';
import { createLogger } from '../../../core/logger/Logger';
import { countOrders } from '../../catalog/repositories/OrderRepository';
import { recordTicketAudit } from '../../audit/repositories/AuditRepository';
import { listStaleQueuedTickets, promoteTicketPriority } from '../repositories/TicketRepository';
import { refreshQueueHead } from './TicketQueueService';

/**
 * Prioridade da fila de atendimento.
 *
 * O campo `Ticket.priority` existe desde o inicio, a fila sempre ordenou por
 * ele (`priority DESC, ticketNumber ASC`) e NADA nunca o definia — todo ticket
 * nascia NORMAL, entao a ordenacao era, na pratica, so por numero. Este modulo
 * e o que faltava: as duas unicas fontes de prioridade do sistema.
 *
 * 1. NA ABERTURA. Quem tem pedido em aberto entra como VIP. E o cliente que ja
 *    pagou ou esta pagando; deixar essa pessoa atras de uma duvida generica e o
 *    tipo de espera que vira reembolso.
 *
 * 2. POR ESPERA. Um job sobe um degrau de cada vez em quem esta parado na fila.
 *    Sem isso, um ticket sem sorte pode ficar para tras indefinidamente quando
 *    a fila anda por numero.
 *
 * NUNCA REBAIXA. Todo caminho aqui so sobe prioridade. Um ticket que virou
 * URGENT por espera nao volta a HIGH se a fila esvaziar — a espera ja
 * aconteceu, e rebaixar significaria fazer a pessoa esperar duas vezes.
 */

const logger = createLogger('ticket:priority');

/**
 * Pedido "em aberto" para efeito de prioridade.
 *
 * Tudo que nao esta encerrado. DELIVERED entra: o produto saiu, mas enquanto o
 * pedido nao foi concluido ainda ha uma transacao viva — e e exatamente quando
 * aparece reclamacao de entrega.
 */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.IN_PROGRESS,
  OrderStatus.DELIVERED,
];

/**
 * Prioridade com que o ticket deve nascer.
 *
 * Melhor-esforco: se a consulta falhar, o ticket abre NORMAL. Prioridade e
 * otimizacao de fila, e nenhuma otimizacao vale impedir alguem de pedir ajuda.
 */
export async function initialPriorityFor(
  guildId: string,
  userId: string,
): Promise<TicketPriority> {
  try {
    const abertos = await countOrders(guildId, {
      customerId: userId,
      statuses: OPEN_ORDER_STATUSES,
    });
    return abertos > 0 ? TicketPriority.VIP : TicketPriority.NORMAL;
  } catch (error) {
    logger.warn('Falha ao calcular a prioridade inicial; assumindo NORMAL.', {
      guildId,
      entityType: 'user',
      entityId: userId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return TicketPriority.NORMAL;
  }
}

/** Os degraus, do mais alto para o mais baixo. Ordem importa: ver `escalate`. */
const STEPS: ReadonlyArray<{
  from: TicketPriority;
  to: TicketPriority;
  afterMs: number;
}> = [
  {
    from: TicketPriority.HIGH,
    to: TicketPriority.URGENT,
    afterMs: TICKET_PRIORITY.URGENT_AFTER_MS,
  },
  {
    from: TicketPriority.NORMAL,
    to: TicketPriority.HIGH,
    afterMs: TICKET_PRIORITY.HIGH_AFTER_MS,
  },
];

/**
 * Sobe a prioridade dos tickets parados na fila.
 *
 * DEGRAUS DO MAIS ALTO PARA O MAIS BAIXO, e um degrau por rodada. Na ordem
 * inversa, um ticket promovido a HIGH nesta mesma passagem ja apareceria na
 * consulta seguinte e subiria a URGENT no mesmo instante — o ticket pularia
 * NORMAL -> URGENT de uma vez, ignorando os 45 minutos.
 *
 * Devolve quantos tickets subiram. O `client` e opcional: sem ele, a promocao
 * acontece no banco e os paineis so refletem a nova posicao na proxima vez que
 * forem redesenhados.
 */
export async function escalateStaleTickets(client: Client | null = null): Promise<number> {
  const agora = Date.now();
  let promovidos = 0;

  // Categorias tocadas, para atualizar os paineis uma vez so no fim.
  const categorias = new Map<string, { guildId: string; categoryId: string }>();

  for (const step of STEPS) {
    const corte = new Date(agora - step.afterMs);
    const candidatos = await listStaleQueuedTickets(
      step.from,
      corte,
      TICKET_PRIORITY.ESCALATION_BATCH,
    );

    for (const ticket of candidatos) {
      // Alguem pode ter assumido o ticket entre a leitura e a escrita.
      if (!(await promoteTicketPriority(ticket.id, step.to))) continue;
      promovidos += 1;
      categorias.set(`${ticket.guildId}:${ticket.categoryId}`, {
        guildId: ticket.guildId,
        categoryId: ticket.categoryId,
      });

      await recordTicketAudit({
        guildId: ticket.guildId,
        ticketId: ticket.id,
        action: TicketAuditAction.PRIORITY_CHANGED,
        // Sem `actorId`: quem promoveu foi o proprio sistema, e inventar um
        // autor humano faria a auditoria mentir sobre quem decidiu.
        actorId: null,
        oldValue: step.from,
        newValue: step.to,
        metadata: { motivo: 'espera na fila', minutos: Math.round(step.afterMs / 60_000) },
      });
    }
  }

  if (promovidos === 0) return 0;

  logger.info('Prioridades escalonadas por espera.', { count: promovidos });

  /*
   * A posicao na fila mostrada no painel de cada ticket muda quando alguem
   * sobe de prioridade. `refreshQueueHead` ja limita o lote, entao redesenhar
   * a cabeca de cada categoria afetada nao vira rajada na API do Discord.
   */
  if (client !== null) {
    for (const { guildId, categoryId } of categorias.values()) {
      const guild = client.guilds.cache.get(guildId);
      if (guild === undefined) continue;
      await refreshQueueHead(guild, categoryId).catch(() => undefined);
    }
  }

  return promovidos;
}
