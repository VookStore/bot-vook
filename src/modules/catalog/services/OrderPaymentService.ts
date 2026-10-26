import { PaymentSource, PaymentStatus, type Payment } from '@prisma/client';
import type { Guild, GuildMember } from 'discord.js';

import { BUSINESS_LIMITS } from '../../../constants/limits';
import { ConfigurationError, ValidationError } from '../../../core/errors';
import { onPaymentEvent } from '../../../core/events/PaymentEvents';
import { createLogger } from '../../../core/logger/Logger';
import { LOCK_NAMESPACE, locks } from '../../../core/locks/LockService';
import { formatCents } from '../../../utils/money';
import { truncate } from '../../../utils/sanitize';
import type { SendableConversation } from '../../../utils/discord';
import {
  cancelPaymentAtomic,
  findPaymentById,
} from '../../payments/repositories/PaymentRepository';
import { findOrderById } from '../repositories/OrderRepository';
import { getAccountById, getEnabledAccounts } from '../../payments/services/PaymentAccountService';
import {
  publishPaymentCard,
  refreshPaymentCard,
  registerOrderLabelResolver,
} from '../../payments/services/PaymentCardService';
import { cancelPayment, createCharge, linkedOrderId } from '../../payments/services/PaymentService';
import {
  formatOrderNumber,
  isFinanciallyOpen,
  linkPaymentToOrder,
  requireOrder,
  syncOrderPaid,
  syncOrderPaymentClosed,
} from './OrderService';
import type { OrderWithItemsAndPayment } from '../repositories/OrderRepository';

/**
 * PONTE entre o pedido e o modulo central de pagamentos.
 *
 * REGRA ABSOLUTA: este arquivo NAO cobra nada. Ele apenas traduz "pedido" para
 * os parametros que o `PaymentService` — o mesmo usado por `/pagamento criar` —
 * ja sabe processar: cliente, valor, descricao, conta e cupom.
 *
 * Consequencia direta: qualquer provider configurado no modulo central
 * (PIX manual hoje, outro amanha) passa a valer para o catalogo sem uma linha a
 * mais aqui — nao existe configuracao financeira propria do catalogo.
 */

const logger = createLogger('order:payment');

export interface CreateOrderPaymentParams {
  guild: Guild;
  staff: GuildMember;
  orderId: string;
  /** Conta PIX escolhida pelo vendedor. `null` usa a conta padrao da loja. */
  accountId: string | null;
  /** Canal onde o cartao de cobranca sera publicado para o cliente. */
  /** Canal ou TOPICO do atendimento onde o cartao sera publicado. */
  channel: SendableConversation;
}

export interface CreateOrderPaymentResult {
  order: OrderWithItemsAndPayment;
  payment: Payment;
}

/**
 * Gera a cobranca do pedido.
 *
 * Sequencia: valida o pedido -> escolhe a conta -> `PaymentService.createCharge`
 * (que precifica, aplica o cupom e emite o PIX) -> publica o cartao -> vincula
 * a cobranca ao pedido. Se qualquer passo depois da emissao falhar, a cobranca
 * e cancelada: melhor nenhum PIX do que um PIX orfao que o cliente pode pagar.
 */
export async function createOrderPayment(
  params: CreateOrderPaymentParams,
): Promise<CreateOrderPaymentResult> {
  return locks.withLock(
    LOCK_NAMESPACE.ORDER_ACTION,
    params.orderId,
    async () => {
      const guildId = params.guild.id;
      const order = await requireOrder(guildId, params.orderId);

      if (!isFinanciallyOpen(order)) {
        throw new ValidationError(`Pedido nao aceita cobranca: ${order.status}`, {
          userMessage:
            'Este pedido nao esta mais aguardando pagamento. Nenhuma cobranca nova pode ser gerada.',
        });
      }

      if (order.payment !== null && order.payment.status === PaymentStatus.PENDING) {
        throw new ValidationError(`Pedido ja possui cobranca pendente: ${order.payment.id}`, {
          userMessage:
            'Este pedido ja possui uma cobranca pendente. Cancele-a antes de gerar outra.',
        });
      }

      /*
       * Consistencia antes de cobrar: numa compra do catalogo o subtotal tem de
       * bater com a soma dos snapshots. Divergencia ali significa dado
       * corrompido — e cobrar por cima disso seria cobrar um valor que ninguem
       * combinou.
       *
       * Pedido de VENDA AVULSA nao tem item para conferir: ele nasce da
       * cobranca que o vendedor digitou, e o subtotal ja E o valor combinado.
       * Sem esta excecao, reemitir a cobranca de uma venda de balcao — a
       * primeira expirou, o cliente ainda quer pagar — era impossivel pelo
       * painel do pedido.
       */
      if (order.items.length > 0) {
        const snapshotTotal = order.items.reduce(
          (sum, item) => sum + item.priceSnapshot * item.quantity,
          0,
        );
        if (snapshotTotal !== order.subtotalAmount) {
          throw new ValidationError(
            `Subtotal divergente no pedido ${order.id}: ${order.subtotalAmount} != ${snapshotTotal}`,
            {
              userMessage:
                'Os valores deste pedido estao inconsistentes. Cancele-o e peca ao cliente para refazer a compra.',
            },
          );
        }
      }
      if (order.subtotalAmount < BUSINESS_LIMITS.PAYMENT_MIN_CENTS) {
        throw new ValidationError(`Pedido com total invalido: ${order.subtotalAmount}`, {
          userMessage: 'O total deste pedido e invalido para uma cobranca.',
        });
      }

      const account = await resolveAccount(guildId, params.accountId);

      const description = truncate(
        `Pedido #${formatOrderNumber(order.orderNumber)} — ${describeItems(order)}`,
        BUSINESS_LIMITS.PAYMENT_DESCRIPTION_MAX,
      );

      // AQUI mora toda a regra financeira — no modulo central, nao neste arquivo.
      const payment = await createCharge({
        guild: params.guild,
        createdBy: params.staff,
        customerId: order.customerId,
        accountId: account.id,
        description,
        amountCents: order.subtotalAmount,
        couponId: order.couponId,
        channelId: params.channel.id,
        source: { type: PaymentSource.CATALOG_ORDER, id: order.id },
      });

      try {
        await publishPaymentCard(params.channel, payment);
        const updated = await linkPaymentToOrder(guildId, params.staff.id, order.id, payment);

        logger.info('Cobranca do pedido gerada pelo modulo central de pagamentos.', {
          guildId,
          userId: params.staff.id,
          entityType: 'order',
          entityId: order.id,
          paymentId: payment.id,
          finalAmount: payment.finalAmount,
        });

        return { order: updated, payment };
      } catch (error) {
        await rollbackCharge(params.guild, payment, params.staff.id);
        throw error;
      }
    },
    { userMessage: 'Este pedido ja esta sendo processado. Aguarde alguns segundos.' },
  );
}

/**
 * Desfaz uma cobranca que nao pode ser entregue ao cliente.
 * Sem isso a cobranca ficaria PENDING e invisivel — contando como pendente ate
 * expirar e, pior, pagavel se o cartao tiver chegado a aparecer.
 */
async function rollbackCharge(guild: Guild, payment: Payment, staffId: string): Promise<void> {
  await cancelPaymentAtomic(
    payment.id,
    staffId,
    'Falha ao vincular a cobranca ao pedido do catalogo.',
  ).catch(() => undefined);

  const updated = await findPaymentById(payment.id).catch(() => null);
  if (updated !== null) {
    await refreshPaymentCard(guild, updated).catch(() => undefined);
  }
}

function describeItems(order: OrderWithItemsAndPayment): string {
  const first = order.items[0];
  // Pedido sem item e venda avulsa (nasceu de `/pagamento criar`): nao existe
  // pack para nomear, e repetir a descricao da cobranca antiga acabaria
  // aninhando "Pedido #... — Pedido #..." a cada reemissao.
  if (first === undefined) return 'Venda avulsa';
  if (order.items.length === 1) return first.nameSnapshot;
  return `${first.nameSnapshot} +${order.items.length - 1}`;
}

/** Conta PIX do pedido: a escolhida pelo vendedor ou a padrao ativa da loja. */
async function resolveAccount(
  guildId: string,
  accountId: string | null,
): Promise<{ id: string }> {
  if (accountId !== null) {
    const account = await getAccountById(guildId, accountId);
    if (account === null || account.deletedAt !== null || !account.enabled) {
      throw new ValidationError(`Conta PIX indisponivel: ${accountId}`, {
        userMessage: 'Esta conta PIX nao esta mais disponivel. Escolha outra.',
      });
    }
    return account;
  }

  const enabled = await getEnabledAccounts(guildId);
  const first = enabled[0];
  if (first === undefined) {
    throw new ConfigurationError('Nenhuma conta PIX ativa para cobrar o pedido.', {
      userMessage:
        'Nenhuma conta PIX ativa foi encontrada. Cadastre uma em `/config-pagamento gerenciar`.',
      context: { guildId },
    });
  }
  return first;
}

/**
 * Cancela a cobranca PENDENTE de um pedido.
 * Usado quando a equipe cancela o pedido: cobranca e pedido sao coisas
 * diferentes, mas deixar um PIX pagavel de um pedido morto seria um bug caro.
 */
export async function cancelOrderPayment(
  guild: Guild,
  staff: GuildMember,
  order: OrderWithItemsAndPayment,
  reason: string,
): Promise<boolean> {
  if (order.payment === null || order.payment.status !== PaymentStatus.PENDING) return false;

  const cancelled = await cancelPayment(guild.id, staff, order.payment.id, reason);
  await refreshPaymentCard(guild, cancelled).catch(() => undefined);
  return true;
}

/** Contas ativas para o seletor do painel comercial. */
export async function listPaymentAccountsForOrder(
  guildId: string,
): Promise<Awaited<ReturnType<typeof getEnabledAccounts>>> {
  return getEnabledAccounts(guildId);
}

// ---------------------------------------------------------------------------
// Sincronizacao dirigida por eventos
// ---------------------------------------------------------------------------

export type OrderPaidHandler = (
  order: Awaited<ReturnType<typeof syncOrderPaid>>,
  payment: Payment,
) => Promise<void>;

/** Cobranca que morreu sem pagamento (expirou ou foi cancelada). */
export type OrderChargeClosedHandler = (
  order: Awaited<ReturnType<typeof syncOrderPaymentClosed>>,
  payment: Payment,
) => Promise<void>;

export interface OrderPaymentHandlers {
  onPaid?: OrderPaidHandler;
  onChargeClosed?: OrderChargeClosedHandler;
}

let paidHandler: OrderPaidHandler | null = null;
let chargeClosedHandler: OrderChargeClosedHandler | null = null;
let registered = false;

/**
 * Liga o pedido ao ciclo de vida da cobranca.
 *
 * NAO existe webhook proprio do catalogo, nem polling: quem descobre a
 * aprovacao e o modulo central (aprovacao manual hoje, provider automatico
 * amanha) e apenas ANUNCIA. Aqui so traduzimos o anuncio para o pedido.
 *
 * Idempotente por construcao: `syncOrderPaid` usa update condicional, entao um
 * evento repetido nao gera efeito nem notificacao duplicada.
 */
export function registerOrderPaymentListeners(handlers: OrderPaymentHandlers = {}): void {
  if (handlers.onPaid !== undefined) paidHandler = handlers.onPaid;
  if (handlers.onChargeClosed !== undefined) chargeClosedHandler = handlers.onChargeClosed;
  if (registered) return;
  registered = true;

  /*
   * Pedido -> cartao da cobranca.
   *
   * O modulo de pagamentos nao pode importar catalogo (senao o catalogo deixa
   * de ser substituivel), entao e o catalogo que se apresenta: ensina o cartao
   * a estampar `VK-000185` sem que o outro lado saiba o que e um pedido.
   */
  registerOrderLabelResolver(async (payment) => {
    const orderId = linkedOrderId(payment);
    if (orderId === null) return null;
    const order = await findOrderById(orderId);
    return order === null ? null : formatOrderNumber(order.orderNumber);
  });

  onPaymentEvent('approved', async ({ payment }) => {
    // Vale para as duas origens: o que decide e a cobranca ter pedido, nao ele
    // ter vindo do catalogo. Venda avulsa aprovada tambem marca o pedido pago.
    if (linkedOrderId(payment) === null) return;
    const order = await syncOrderPaid(payment);
    if (order === null) return;
    if (paidHandler !== null) await paidHandler(order, payment);
  });

  /*
   * Expirou ou foi cancelada: o pedido NAO morre junto — ele volta a esperar
   * uma cobranca nova. Mas os dois lados precisam ser avisados, senao o cliente
   * fica com um QR morto na DM e a equipe nao descobre que precisa emitir outro.
   */
  const announceClosed = async (payment: Payment): Promise<void> => {
    if (linkedOrderId(payment) === null) return;
    const order = await syncOrderPaymentClosed(payment);
    if (order === null) return;
    if (chargeClosedHandler !== null) await chargeClosedHandler(order, payment);
  };

  onPaymentEvent('expired', ({ payment }) => announceClosed(payment));
  onPaymentEvent('cancelled', ({ payment }) => announceClosed(payment));

  logger.info('Sincronizacao pedido <- pagamento registrada.');
}

/** Somente para testes. */
export function resetOrderPaymentListeners(): void {
  registered = false;
  paidHandler = null;
  chargeClosedHandler = null;
}

/** Texto curto do estado da cobranca para o painel do pedido. */
export function describePaymentState(payment: Payment | null): string {
  if (payment === null) return 'Nenhuma cobranca gerada.';
  switch (payment.status) {
    case PaymentStatus.PENDING:
      return `Cobranca pendente de ${formatCents(payment.finalAmount)}.`;
    case PaymentStatus.APPROVED:
      return `Cobranca aprovada de ${formatCents(payment.finalAmount)}.`;
    case PaymentStatus.EXPIRED:
      return 'Cobranca expirada. Gere uma nova cobranca.';
    case PaymentStatus.CANCELLED:
      return 'Cobranca cancelada. Gere uma nova cobranca.';
    default:
      return String(payment.status);
  }
}
