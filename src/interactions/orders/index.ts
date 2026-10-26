import { OrderStatus, PaymentStatus } from '@prisma/client';
import type {
  ButtonInteraction,
  Guild,
  ModalSubmitInteraction,
  RepliableInteraction,
} from 'discord.js';

import { deferIfNeeded, replyError } from '../../components/reply';
import {
  announceDemandStarted,
  refreshDemandCards,
} from '../../modules/demands/services/DemandBoardService';
import { EMOJIS } from '../../constants/branding';
import {
  NAMESPACE,
  ORDER_ACTION,
  requireArg,
  type ParsedCustomId,
} from '../../constants/customIds';
import { ValidationError } from '../../core/errors';
import { createLogger } from '../../core/logger/Logger';
import {
  assertCanApplyOrderCoupon,
  assertCanCancelOrder,
  assertCanCreateOrderPayment,
  assertCanManageOrders,
  assertCanMarkOrderDelivered,
  canManageOrders,
} from '../../core/permissions/PermissionService';
import { fetchMemberSafe, isSendableConversation, userMention } from '../../utils/discord';
import { sanitizeReason } from '../../utils/sanitize';
import { listSelectableCoupons } from '../../modules/coupons/services/CouponService';
import {
  ALL_STATUS_VALUE,
  NO_COUPON_VALUE,
  buildOrderAccountPanel,
  buildOrderAdminPanel,
  buildOrderCancelModal,
  buildOrderCouponPanel,
  buildOrderCustomerLookup,
  buildOrderCustomerPicker,
  buildOrderCustomerView,
  buildOrderListView,
  buildOrderNotFound,
  buildOrderSearchModal,
  buildOrderStaffView,
  buildProductionQueue,
  isOrderStatusFilter,
  isQueueView,
  type QueueView,
} from '../../modules/catalog/builders/OrderBuilders';
import {
  cancelOrderPayment,
  createOrderPayment,
  listPaymentAccountsForOrder,
} from '../../modules/catalog/services/OrderPaymentService';
import {
  notifyOrderCharge,
  notifyOrderDelivered,
  refreshOrderNotice,
} from '../../modules/catalog/services/OrderNotificationService';
import {
  applyOrderCoupon,
  assignOrderTo,
  cancelOrder,
  claimNextOrder,
  claimOrder,
  completeOrder,
  deliverOrder,
  formatOrderNumber,
  getOrderByNumber,
  getOrderTotals,
  listCustomerOrders,
  listOrdersByStatus,
  releaseOrder,
  requireCustomerOrder,
  requireOrder,
  startOrderProgress,
  type ClaimResult,
} from '../../modules/catalog/services/OrderService';
import { buildPaymentQr, resolvePixReceiver } from '../../modules/payments/services/PaymentCardService';
import { describeReceiptForCustomer } from '../../modules/catalog/builders/ReceiptBuilders';
import { getLatestReceipt } from '../../modules/catalog/services/OrderReceiptService';
import {
  getProductionQueueStats,
  listProductionQueue,
  type OrderWithItemsAndPayment,
  type QueueAssigneeFilter,
} from '../../modules/catalog/repositories/OrderRepository';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';
import {
  beginPanel,
  parsePage,
  readSelectedValue,
  requireGuildContext,
  showPanel,
  type ComponentSource,
} from '../catalog/shared';

const logger = createLogger('order:view');

/**
 * Mantem o quadro de demandas em dia depois de uma transicao.
 *
 * Fica AQUI, e nao nos botoes do quadro, de proposito: a mesma transicao pode
 * vir do cartao publico, do painel efemero, da fila de producao ou do
 * `/entregar`. Se so os botoes do quadro atualizassem o cartao, qualquer
 * mudanca feita em outra tela o deixaria mentindo — e um quadro que mente e
 * pior que nao ter quadro.
 *
 * NUNCA LANCA: o pedido ja mudou de estado no banco quando isto roda. Uma
 * mensagem que nao pode ser reescrita nao pode virar erro para quem clicou.
 */
async function syncDemandBoard(
  guild: Guild,
  order: OrderWithItemsAndPayment,
  options: { started?: boolean } = {},
): Promise<void> {
  try {
    if (options.started === true) {
      await announceDemandStarted(guild, order);
      return;
    }
    await refreshDemandCards(guild, order);
  } catch (error) {
    logger.warn('Falha ao atualizar o quadro de demandas.', {
      guildId: guild.id,
      entityType: 'order',
      entityId: order.id,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Pedidos.
 *
 * SEPARACAO DE PAPEIS
 *  - Cliente: ve apenas os PROPRIOS pedidos, sem nenhuma acao financeira.
 *  - Equipe: painel comercial completo (cupom, cobranca, entrega, cancelamento).
 *
 * SEGURANCA: o orderId chega por customId e nao autoriza nada. Todo handler de
 * cliente passa por `requireCustomerOrder` (que confere o dono) e todo handler
 * de equipe revalida a permissao com o membro real antes de agir.
 *
 * PAGAMENTO: nenhuma cobranca nasce aqui. `createOrderPayment` apenas traduz o
 * pedido para o `PaymentService` — o mesmo motor usado por `/pagamento criar`.
 */

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/**
 * Pedido do cliente, com o PIX quando ha cobranca pendente.
 *
 * O QR e gerado a partir do `pixPayload` salvo no banco, pelo mesmo caminho do
 * cartao publicado — nunca de um payload recalculado aqui. Falha ao gerar a
 * imagem nao esconde o pedido: o copia e cola continua na tela.
 *
 * Exportado porque catalogo e carrinho tambem terminam nesta tela depois de
 * criar um pedido, e todos precisam mostrar o PIX do mesmo jeito.
 */
export async function showCustomerOrder(
  interaction: RepliableInteraction,
  order: OrderWithItemsAndPayment,
  notice?: string,
): Promise<void> {
  const charge = order.payment;
  const pending = charge !== null && charge.status === PaymentStatus.PENDING;

  // Comprovante ja enviado vira uma linha no painel: sem isso o cliente que
  // acabou de mandar o arquivo ve a mesma tela de antes e manda de novo.
  const receipt = await getLatestReceipt(order.id).catch(() => null);
  const receiptNote = describeReceiptForCustomer(receipt);

  const base = {
    ...(notice !== undefined ? { notice } : {}),
    ...(receiptNote !== null ? { receiptNote } : {}),
  };

  if (!pending) {
    await showPanel(interaction, buildOrderCustomerView(order, base));
    return;
  }

  // Resolvido ANTES do try de proposito: se o QR falhar, a chave em texto e o
  // que sobra ao lado do copia e cola — e e ai que ela mais serve.
  const receiver = await resolvePixReceiver(charge);
  const payable = { ...base, ...(receiver !== undefined ? { receiver } : {}) };

  try {
    const { attachment, filename } = await buildPaymentQr(charge);
    await showPanel(
      interaction,
      buildOrderCustomerView(order, { ...payable, qrFilename: filename }),
      { files: [attachment] },
    );
  } catch (error) {
    logger.warn('Falha ao gerar o QR do pedido; exibindo apenas o copia e cola.', {
      guildId: order.guildId,
      entityType: 'order',
      entityId: order.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    await showPanel(interaction, buildOrderCustomerView(order, payable));
  }
}

async function renderCustomerList(
  interaction: RepliableInteraction,
  guildId: string,
  customerId: string,
  page: number,
): Promise<void> {
  const result = await listCustomerOrders(guildId, customerId, page);
  await showPanel(
    interaction,
    buildOrderListView({
      orders: result.items,
      page: result.page,
      totalPages: result.totalPages,
      total: result.total,
    }),
  );
}

const listButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.LIST,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const page = parsePage(parsed.args[0]);

    await beginPanel(interaction);
    await renderCustomerList(interaction, guild.id, member.id, page);
  },
};

const viewButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.VIEW,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);

    // Confere o DONO do pedido: um id trocado na mao nao abre pedido alheio.
    const order = await requireCustomerOrder(guild.id, member.id, orderId);
    await showCustomerOrder(interaction, order);
  },
};

const listSelect: SelectHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.LIST_SELECT,
  async handle(interaction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const orderId = readSelectedValue(interaction);

    await beginPanel(interaction);
    const order = await requireCustomerOrder(guild.id, member.id, orderId);
    await showCustomerOrder(interaction, order);
  },
};

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

async function renderStaffOrder(
  interaction: RepliableInteraction,
  guildId: string,
  orderId: string,
  notice?: string,
): Promise<void> {
  const order = await requireOrder(guildId, orderId);
  await showPanel(
    interaction,
    buildOrderStaffView(order, notice === undefined ? {} : { notice }),
  );
}

const staffButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.STAFF,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);
    await renderStaffOrder(interaction, guild.id, orderId);
  },
};

/**
 * Aplicar cupom — VENDEDOR, nunca cliente.
 * Os cupons elegiveis vem do modulo central, avaliados para o subtotal deste
 * pedido e para este cliente.
 */
const couponButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.COUPON,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanApplyOrderCoupon(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);

    const order = await requireOrder(guild.id, orderId);
    const options = await listSelectableCoupons(
      guild.id,
      order.subtotalAmount,
      order.customerId,
    );

    await showPanel(interaction, buildOrderCouponPanel(orderId, options, order.couponId));
  },
};

const couponSelect: SelectHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.COUPON_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanApplyOrderCoupon(member);

    const orderId = requireArg(parsed, 0, 'pedido');
    const raw = readSelectedValue(interaction);
    const couponId = raw === NO_COUPON_VALUE ? null : raw;

    await beginPanel(interaction);

    const { order, couponCode } = await applyOrderCoupon(guild.id, member, orderId, couponId);
    await refreshOrderNotice(guild, order);

    await showPanel(
      interaction,
      buildOrderStaffView(order, {
        notice:
          couponCode === null
            ? `${EMOJIS.DELETE} Cupom removido do pedido.`
            : `${EMOJIS.COUPON} Cupom \`${couponCode}\` aplicado ao pedido.`,
      }),
    );
  },
};

/**
 * Gerar cobranca.
 *
 * Com uma unica conta PIX ativa, cobra direto; com varias, pergunta qual antes.
 * A cobranca em si e emitida pelo `PaymentService`.
 */
const paymentButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.PAYMENT,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanCreateOrderPayment(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);

    const accounts = await listPaymentAccountsForOrder(guild.id);
    if (accounts.length > 1) {
      await showPanel(interaction, buildOrderAccountPanel(orderId, accounts));
      return;
    }

    await generatePayment(interaction, orderId, null);
  },
};

const paymentAccountSelect: SelectHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.PAYMENT_ACCOUNT,
  async handle(interaction, parsed): Promise<void> {
    const { member } = requireGuildContext(interaction);
    await assertCanCreateOrderPayment(member);

    const orderId = requireArg(parsed, 0, 'pedido');
    const accountId = readSelectedValue(interaction);

    await beginPanel(interaction);
    await generatePayment(interaction, orderId, accountId);
  },
};

/**
 * Emite a cobranca no canal ONDE A EQUIPE ESTA — o mesmo comportamento de
 * `/pagamento criar`. O vendedor gera a cobranca no canal em que o cliente
 * consegue ve-la (tipicamente o ticket do atendimento).
 */
async function generatePayment(
  interaction: ComponentSource,
  orderId: string,
  accountId: string | null,
): Promise<void> {
  const { guild, member } = requireGuildContext(interaction);

  // `interaction.channel` pode ser DM; o cartao da cobranca so faz sentido em
  // canal de servidor, onde o cliente consegue ver o PIX.
  const channel = interaction.channel !== null && !interaction.channel.isDMBased()
    ? interaction.channel
    : null;

  // Aceita TOPICO: e dentro do atendimento que o cliente ve o PIX.
  if (!isSendableConversation(channel)) {
    throw new ValidationError('Canal invalido para publicar a cobranca.', {
      userMessage:
        'Nao e possivel publicar a cobranca aqui. Use o canal ou o topico do atendimento, onde o cliente ve o PIX.',
    });
  }

  const { order, payment } = await createOrderPayment({
    guild,
    staff: member,
    orderId,
    accountId,
    channel,
  });

  await refreshOrderNotice(guild, order);

  /*
   * O cliente precisa RECEBER a cobranca, nao ir procurar por ela: o cartao
   * publicado fica no canal em que o vendedor estava, que nem sempre e um canal
   * que o cliente enxerga. A DM leva o QR e o copia e cola direto para ele.
   *
   * DM fechada nao invalida nada — o PIX tambem aparece em `/meus-pedidos`.
   */
  const dmSent = await notifyOrderCharge(guild, order, payment);

  await showPanel(
    interaction,
    buildOrderStaffView(order, {
      notice:
        `${EMOJIS.PAYMENT} Cobranca gerada pelo sistema de pagamentos da loja e publicada neste canal.` +
        (payment.couponCodeSnapshot !== null
          ? `\nCupom \`${payment.couponCodeSnapshot}\` aplicado na cobranca.`
          : '') +
        (dmSent
          ? '\nO cliente recebeu o QR e o copia e cola por DM.'
          : '\n⚠️ Nao foi possivel enviar a DM ao cliente. Ele ainda consegue pagar por `/meus-pedidos`.'),
    }),
  );
}

const cancelButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.CANCEL,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { member } = requireGuildContext(interaction);
    await assertCanCancelOrder(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    // `showModal` precisa ser a PRIMEIRA resposta da interacao.
    await interaction.showModal(buildOrderCancelModal(orderId));
  },
};

const cancelModal: ModalHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.CANCEL_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanCancelOrder(member);

    const orderId = requireArg(parsed, 0, 'pedido');
    const reason = sanitizeReason(interaction.fields.getTextInputValue('reason'));

    await beginModalReply(interaction);

    /*
     * Cancelar o PEDIDO e cancelar a COBRANCA sao decisoes distintas — mas
     * deixar um PIX pagavel de um pedido morto seria caro. Por isso a cobranca
     * pendente e cancelada junto; cobranca ja aprovada nunca e tocada.
     */
    const current = await requireOrder(guild.id, orderId);
    const chargeCancelled = await cancelOrderPayment(
      guild,
      member,
      current,
      `Pedido #${formatOrderNumber(current.orderNumber)} cancelado pela equipe.`,
    );

    const order = await cancelOrder(guild.id, member, orderId, reason);
    await syncDemandBoard(guild, order);
    await refreshOrderNotice(guild, order);

    await showPanel(
      interaction,
      buildOrderStaffView(order, {
        notice:
          `${EMOJIS.CLOSE} Pedido cancelado.` +
          (chargeCancelled ? '\nA cobranca pendente tambem foi cancelada.' : ''),
      }),
    );
  },
};

const progressButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.PROGRESS,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);

    const order = await startOrderProgress(guild.id, member, orderId);
    await syncDemandBoard(guild, order, { started: true });
    await refreshOrderNotice(guild, order);
    await showPanel(
      interaction,
      buildOrderStaffView(order, { notice: `${EMOJIS.PREPARING} Pedido em preparacao.` }),
    );
  },
};

const deliverButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.DELIVER,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanMarkOrderDelivered(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);

    const order = await deliverOrder(guild.id, member, orderId);
    await syncDemandBoard(guild, order);
    // DM fechada NAO quebra a entrega: o aviso e best-effort.
    const dmSent = await notifyOrderDelivered(guild, order);

    await showPanel(
      interaction,
      buildOrderStaffView(order, {
        notice:
          `${EMOJIS.DELIVER} Pedido marcado como entregue.` +
          (dmSent ? '' : '\n⚠️ Nao foi possivel avisar o cliente por DM.'),
      }),
    );
  },
};

const completeButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.COMPLETE,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);

    const order = await completeOrder(guild.id, member, orderId);
    await syncDemandBoard(guild, order);
    await refreshOrderNotice(guild, order);
    await showPanel(
      interaction,
      buildOrderStaffView(order, { notice: `${EMOJIS.APPROVE} Pedido concluido.` }),
    );
  },
};

// ---------------------------------------------------------------------------
// Painel administrativo de pedidos
// ---------------------------------------------------------------------------

function statusesForFilter(filter: string): readonly OrderStatus[] | undefined {
  if (filter === ALL_STATUS_VALUE) return undefined;
  return [filter as OrderStatus];
}

async function renderAdminOrders(
  interaction: RepliableInteraction,
  guildId: string,
  filter: string,
  page: number,
): Promise<void> {
  const safeFilter = isOrderStatusFilter(filter) ? filter : ALL_STATUS_VALUE;
  const [result, totals] = await Promise.all([
    listOrdersByStatus(guildId, statusesForFilter(safeFilter), page),
    getOrderTotals(guildId),
  ]);

  await showPanel(
    interaction,
    buildOrderAdminPanel({
      orders: result.items,
      status: safeFilter,
      page: result.page,
      totalPages: result.totalPages,
      total: result.total,
      totals,
    }),
  );
}

const adminListButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.ADMIN_LIST,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);

    const filter = parsed.args[0] ?? ALL_STATUS_VALUE;
    const page = parsePage(parsed.args[1]);

    await beginPanel(interaction);
    await renderAdminOrders(interaction, guild.id, filter, page);
  },
};

const adminFilterSelect: SelectHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.ADMIN_FILTER,
  async handle(interaction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    const filter = readSelectedValue(interaction);

    await beginPanel(interaction);
    await renderAdminOrders(interaction, guild.id, filter, 1);
  },
};

const adminSelect: SelectHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.ADMIN_SELECT,
  async handle(interaction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    const orderId = readSelectedValue(interaction);

    await beginPanel(interaction);
    await renderStaffOrder(interaction, guild.id, orderId);
  },
};

async function renderCustomerLookup(
  interaction: RepliableInteraction,
  guildId: string,
  customerId: string,
  page: number,
): Promise<void> {
  const result = await listCustomerOrders(guildId, customerId, page);
  await showPanel(
    interaction,
    buildOrderCustomerLookup({
      customerId,
      orders: result.items,
      page: result.page,
      totalPages: result.totalPages,
      total: result.total,
    }),
  );
}

/**
 * Busca por cliente (§123).
 *
 * Sem argumento abre o seletor de usuario; com `customerId` lista os pedidos
 * daquele cliente. O id vem do componente, mas nao autoriza nada: a permissao
 * de equipe e revalidada aqui e a consulta e sempre filtrada pela guild.
 */
const adminCustomerButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.ADMIN_CUSTOMER,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);

    const customerId = parsed.args[0];
    await beginPanel(interaction);

    if (customerId === undefined || !/^\d{17,20}$/.test(customerId)) {
      await showPanel(interaction, buildOrderCustomerPicker());
      return;
    }

    await renderCustomerLookup(interaction, guild.id, customerId, parsePage(parsed.args[1]));
  },
};

const adminCustomerSelect: SelectHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.ADMIN_CUSTOMER_SELECT,
  async handle(interaction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);

    if (!interaction.isUserSelectMenu()) {
      throw new ValidationError('Select de cliente com tipo inesperado.', {
        userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
      });
    }

    const customerId = interaction.values[0];
    if (customerId === undefined) {
      await replyError(interaction, 'Nenhum cliente selecionado.');
      return;
    }

    await beginPanel(interaction);
    await renderCustomerLookup(interaction, guild.id, customerId, 1);
  },
};

const searchButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.SEARCH,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    await interaction.showModal(buildOrderSearchModal());
  },
};

const searchModal: ModalHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.SEARCH_MODAL,
  async handle(interaction: ModalSubmitInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);

    const raw = interaction.fields.getTextInputValue('numero');
    const number = parseOrderNumberInput(raw);
    if (number === null) {
      await replyError(interaction, 'Numero invalido. Use 184, VK-000184 ou #VK-000184.');
      return;
    }

    await beginModalReply(interaction);

    const order = await getOrderByNumber(guild.id, number);
    if (order === null) {
      await showPanel(interaction, buildOrderNotFound(number));
      return;
    }

    await showPanel(interaction, buildOrderStaffView(order));
  },
};

/** Aceita "184", "VK-000184" e "#VK-000184". */
export function parseOrderNumberInput(raw: string): number | null {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Modal enviado de um painel efemero mantem a mesma mensagem. */
async function beginModalReply(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
    return;
  }
  await deferIfNeeded(interaction, { ephemeral: true });
}

/** Historico aberto por comando (`/meus-pedidos`). */
export async function renderCustomerOrdersForCommand(
  interaction: RepliableInteraction,
  guildId: string,
  customerId: string,
  page: number,
): Promise<void> {
  await renderCustomerList(interaction, guildId, customerId, page);
}

/** Painel da equipe aberto por comando (`/pedidos gerenciar`). */
export async function renderAdminOrdersForCommand(
  interaction: RepliableInteraction,
  guildId: string,
  filter: string,
  page: number,
): Promise<void> {
  await renderAdminOrders(interaction, guildId, filter, page);
}

/** Pedidos de um cliente, abertos por comando (`/pedidos buscar cliente:`). */
export async function renderCustomerLookupForCommand(
  interaction: RepliableInteraction,
  guildId: string,
  customerId: string,
  page: number,
): Promise<void> {
  await renderCustomerLookup(interaction, guildId, customerId, page);
}

/** Pedido especifico aberto por comando (`/pedidos buscar`). */
export async function renderStaffOrderForCommand(
  interaction: RepliableInteraction,
  guildId: string,
  orderId: string,
): Promise<void> {
  await renderStaffOrder(interaction, guildId, orderId);
}

// ---------------------------------------------------------------------------
// Demandas (fila de producao)
// ---------------------------------------------------------------------------

/**
 * Demandas por pagina da fila.
 *
 * A tela e para varrer, nao para paginar: vinte linhas cabem no orcamento de
 * texto e cobrem qualquer dia realista desta loja. O total real vai no
 * cabecalho, entao o corte nunca esconde o tamanho da fila.
 */
const QUEUE_PAGE = 20;

function assigneeFilterFor(view: QueueView, viewerId: string): QueueAssigneeFilter {
  if (view === 'all') return undefined;
  if (view === 'free') return null;
  return viewerId;
}

/** Recorte vindo do customId; valor desconhecido cai em "todas", nunca em erro. */
function queueViewFrom(parsed: ParsedCustomId): QueueView {
  const raw = parsed.args[0];
  return isQueueView(raw) ? raw : 'all';
}

async function renderQueue(
  interaction: RepliableInteraction,
  guildId: string,
  viewerId: string,
  view: QueueView,
  notice?: string,
): Promise<void> {
  const [orders, stats] = await Promise.all([
    listProductionQueue(guildId, QUEUE_PAGE, assigneeFilterFor(view, viewerId)),
    getProductionQueueStats(guildId),
  ]);

  await showPanel(
    interaction,
    buildProductionQueue({
      orders,
      stats,
      view,
      viewerId,
      ...(notice !== undefined ? { notice } : {}),
    }),
  );
}

function claimedNotice(result: ClaimResult): string {
  return (
    `${EMOJIS.CLAIM} Demanda assumida por voce` +
    (result.started ? ' e colocada em preparacao.' : '.')
  );
}

const queueButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.QUEUE,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);

    await beginPanel(interaction);
    await renderQueue(interaction, guild.id, member.id, queueViewFrom(parsed));
  },
};

/**
 * Pegar a proxima demanda livre — a que vence primeiro.
 *
 * Quem clica nao escolhe: a fila escolhe. E isso que impede a demanda chata de
 * ficar para tras enquanto as faceis sao pegas.
 */
const queueNextButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.QUEUE_NEXT,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);

    await beginPanel(interaction);

    const result = await claimNextOrder(guild.id, member);
    if (result === null) {
      await renderQueue(
        interaction,
        guild.id,
        member.id,
        queueViewFrom(parsed),
        `${EMOJIS.INFO} Nenhuma demanda livre agora: tudo que esta em producao ja tem responsavel.`,
      );
      return;
    }

    if (result.started) await refreshOrderNotice(guild, result.order);
    await syncDemandBoard(guild, result.order, { started: result.started });
    await showPanel(
      interaction,
      buildOrderStaffView(result.order, { notice: claimedNotice(result) }),
    );
  },
};

const claimButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.CLAIM,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);

    const result = await claimOrder(guild.id, member, orderId);
    await syncDemandBoard(guild, result.order, { started: result.started });
    if (result.started) await refreshOrderNotice(guild, result.order);
    await showPanel(
      interaction,
      buildOrderStaffView(result.order, { notice: claimedNotice(result) }),
    );
  },
};

const releaseButton: ButtonHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.RELEASE,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    await beginPanel(interaction);

    const order = await releaseOrder(guild.id, member, orderId);
    await syncDemandBoard(guild, order);
    await showPanel(
      interaction,
      buildOrderStaffView(order, {
        notice: `${EMOJIS.BACK} Demanda devolvida a fila, sem responsavel.`,
      }),
    );
  },
};

/**
 * Entregar a demanda a alguem da equipe.
 *
 * O select de usuario do Discord oferece o servidor inteiro, entao quem pode
 * RECEBER e conferido aqui, com o membro real: precisa estar no servidor, nao
 * ser bot e ter a permissao de equipe. Sem isso uma demanda iria parar com um
 * cliente — e sumiria da vista de todo mundo que trabalha.
 */
const assignSelect: SelectHandler = {
  namespace: NAMESPACE.ORDER,
  action: ORDER_ACTION.ASSIGN,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanManageOrders(member);
    const orderId = requireArg(parsed, 0, 'pedido');

    if (!interaction.isUserSelectMenu()) {
      throw new ValidationError('Select de responsavel com tipo inesperado.', {
        userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
      });
    }

    const targetId = interaction.values[0];
    if (targetId === undefined) {
      await replyError(interaction, 'Nenhum membro selecionado.');
      return;
    }

    await beginPanel(interaction);

    const target = await fetchMemberSafe(guild, targetId);
    if (target === null) {
      throw new ValidationError('Responsavel escolhido fora do servidor.', {
        userMessage: 'Este membro nao esta mais no servidor.',
      });
    }
    if (target.user.bot) {
      throw new ValidationError('Bot escolhido como responsavel.', {
        userMessage: 'Bot nao produz pedido. Escolha alguem da equipe.',
      });
    }
    if (!(await canManageOrders(target))) {
      throw new ValidationError('Responsavel escolhido fora da equipe.', {
        userMessage: `${userMention(target.id)} nao e da equipe da loja, entao nao pode receber demanda.`,
      });
    }

    const order = await assignOrderTo(guild.id, member, orderId, target.id);
    await syncDemandBoard(guild, order);
    await showPanel(
      interaction,
      buildOrderStaffView(order, {
        notice: `${EMOJIS.TRANSFER} Demanda atribuida a ${userMention(target.id)}.`,
      }),
    );
  },
};

/** Fila de demandas aberta por comando (`/pedidos fila`). */
export async function renderProductionQueueForCommand(
  interaction: RepliableInteraction,
  guildId: string,
  viewerId: string,
  view: QueueView,
): Promise<void> {
  await renderQueue(interaction, guildId, viewerId, view);
}

export const orderButtons: ButtonHandler[] = [
  listButton,
  viewButton,
  staffButton,
  couponButton,
  paymentButton,
  cancelButton,
  progressButton,
  deliverButton,
  completeButton,
  adminListButton,
  adminCustomerButton,
  searchButton,
  queueButton,
  queueNextButton,
  claimButton,
  releaseButton,
];

export const orderSelects: SelectHandler[] = [
  listSelect,
  couponSelect,
  paymentAccountSelect,
  adminFilterSelect,
  adminSelect,
  adminCustomerSelect,
  assignSelect,
];

export const orderModals: ModalHandler[] = [cancelModal, searchModal];
