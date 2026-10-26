import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import {
  OrderStatus,
  PaymentStatus,
  type Coupon,
  type Order,
  type OrderItem,
  type Payment,
  type PaymentAccount,
} from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { NAMESPACE, ORDER_ACTION, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  buttonRow,
  container,
  fields,
  footerNote,
  mediaGallery,
  selectRow,
  separator,
  text,
} from '../../../components/v2';
import { formatCents } from '../../../utils/money';
import { dueStatusOf } from '../services/DeliveryEstimateService';
import { truncate } from '../../../utils/sanitize';
import { discordTimestamp } from '../../../utils/time';
import { userMention } from '../../../utils/discord';
import { describeCouponValue } from '../../coupons/services/CouponCalculator';
import type { DiscountBreakdown } from '../../coupons/types/coupon';
// A linha da chave vem de pagamentos, e nao copiada para ca: o aviso de que a
// transferencia por chave nao carrega valor precisa ser identico nas tres telas.
import { pixManualTransferLine, type PixReceiver } from '../../payments/builders/PaymentBuilders';
import {
  describeOrderStatus,
  formatOrderNumber,
  orderStatusIcon,
} from '../services/OrderService';
import type {
  OrderWithItems,
  OrderWithItemsAndPayment,
  ProductionQueueOrder,
  ProductionQueueStats,
} from '../repositories/OrderRepository';
import { catalogHomeButton } from './CatalogBuilders';

/**
 * Pedidos (Components V2).
 *
 * Duas visoes distintas, de proposito:
 *  - CLIENTE: acompanha o proprio pedido. Nenhum botao financeiro, nenhum
 *    cupom, nenhuma acao de equipe.
 *  - EQUIPE: painel comercial com cupom, cobranca, entrega e cancelamento.
 *
 * Todo botao aqui e apenas um atalho: o handler revalida permissao e recarrega
 * o pedido no banco antes de qualquer acao.
 */

/** Valor do select que representa "nenhum cupom". */
export const NO_COUPON_VALUE = 'none';

/** Valor do filtro que representa "todos os status". */
export const ALL_STATUS_VALUE = 'all';

function orderButton(
  action: string,
  emoji: string,
  label: string,
  ...args: string[]
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, action, ...args))
    .setEmoji(emoji)
    .setLabel(truncate(label, DISCORD_LIMITS.BUTTON_LABEL))
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Lista de itens do pedido.
 *
 * Pedido de VENDA DE BALCAO nao tem item: ele nasce de `/pagamento criar`, onde
 * nao existe pack do catalogo para fotografar. Nesses casos quem descreve a
 * venda e a descricao da cobranca — sem ela o painel exibia um bloco "Itens"
 * vazio, que o cliente le como pedido corrompido.
 */
function itemLines(items: readonly OrderItem[], chargeDescription?: string | null): string {
  if (items.length === 0) {
    const description = chargeDescription ?? '';
    return description.length > 0 ? `• ${truncate(description, 80)}` : '• Venda avulsa';
  }

  return items
    .map(
      (item) =>
        `• ${truncate(item.nameSnapshot, 60)}${item.skuSnapshot !== null ? ` (\`${item.skuSnapshot}\`)` : ''} — ${formatCents(item.priceSnapshot)}`,
    )
    .join('\n');
}

/**
 * Pedido ainda aguardando pagamento cuja cobranca expirou ou foi cancelada.
 * E um estado real e comum (o PIX vence em minutos), nao um erro — mas o
 * cliente precisa ser informado, senao a tela some com o PIX sem explicacao.
 */
export function isChargeClosed(order: OrderWithItemsAndPayment): boolean {
  const charge = order.payment;
  if (charge === null) return false;
  if (order.status !== OrderStatus.AWAITING_PAYMENT) return false;
  return charge.status === PaymentStatus.EXPIRED || charge.status === PaymentStatus.CANCELLED;
}

function totalsBlock(order: Order): string {
  const lines: Array<[string, string]> = [['Subtotal', formatCents(order.subtotalAmount)]];

  if (order.couponCodeSnapshot !== null) {
    lines.push(['Cupom', `\`${order.couponCodeSnapshot}\``]);
    lines.push(['Desconto', `- ${formatCents(order.discountAmount)}`]);
  } else {
    lines.push(['Cupom', 'Nenhum']);
    lines.push(['Desconto', formatCents(0)]);
  }

  return `${fields(lines)}\n\n**TOTAL**\n# ${formatCents(order.finalAmount)}`;
}

// ---------------------------------------------------------------------------
// Visao do cliente
// ---------------------------------------------------------------------------

/**
 * Pedido na visao do CLIENTE.
 * Sem acoes financeiras: acompanhar, e so. O cliente nao aplica cupom, nao
 * gera cobranca e nao muda status.
 */
/**
 * Linha da previsao de entrega, ou vazio quando nao ha prazo.
 *
 * Tudo na loja e feito sob encomenda, entao "quando chega" e a pergunta que o
 * cliente faz logo depois de pagar. Categoria sem prazo cadastrado nao gera
 * linha nenhuma — melhor silencio que uma data inventada, porque a data vira
 * cobranca depois.
 *
 * O ATRASO E DITO, nao escondido. Um pedido vencido que continua exibindo a
 * data original como se estivesse tudo bem e pior que nao ter prazo: o cliente
 * percebe sozinho e perde a confianca no resto.
 */
function deliveryFields(dueAt: Date | null | undefined): Array<[string, string]> {
  if (dueAt === null || dueAt === undefined) return [];

  const status = dueStatusOf(dueAt);
  const rotulo = status === 'atrasado' ? 'Previsao (atrasado)' : 'Previsao de entrega';

  return [[rotulo, discordTimestamp(dueAt, 'D')]];
}

export function buildOrderCustomerView(
  order: OrderWithItemsAndPayment,
  options: {
    notice?: string;
    qrFilename?: string;
    receiptNote?: string;
    receiver?: PixReceiver;
  } = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, `${TITLES.ORDER} #${formatOrderNumber(order.orderNumber)}`);

  if (options.notice !== undefined && options.notice.length > 0) {
    root.addTextDisplayComponents(text(options.notice));
  }

  // Itens e totais num bloco so: o Container aceita 10 filhos e o caminho com
  // cobranca pendente (galeria + copia e cola) e o mais pesado desta tela.
  root.addTextDisplayComponents(
    text(`**Itens**\n${itemLines(order.items, order.payment?.description)}\n\n${totalsBlock(order)}`),
  );
  root.addSeparatorComponents(separator());

  const charge = order.payment;
  const awaitingPix = charge !== null && charge.status === PaymentStatus.PENDING;

  root.addTextDisplayComponents(
    text(
      fields([
        ['Status', `${orderStatusIcon(order.status)} ${describeOrderStatus(order.status)}`],
        ['Criado em', discordTimestamp(order.createdAt, 'f')],
        ...deliveryFields(order.dueAt),
        ...(awaitingPix
          ? ([['Pague ate', discordTimestamp(charge.expiresAt, 'R')]] as Array<[string, string]>)
          : []),
        // Entra como CAMPO, e nao como bloco proprio: o Container ja esta perto
        // do teto de 10 filhos no caminho com QR + copia e cola.
        ...(options.receiptNote !== undefined
          ? ([['Comprovante', options.receiptNote]] as Array<[string, string]>)
          : []),
        ...(order.status === OrderStatus.CANCELLED && order.cancelReason !== null
          ? ([['Motivo', truncate(order.cancelReason, 200)]] as Array<[string, string]>)
          : []),
      ]),
    ),
  );

  /*
   * COBRANCA PENDENTE: o cliente paga AQUI.
   *
   * Esta mensagem e efemera e o pedido ja foi conferido como sendo dele
   * (`requireCustomerOrder`), entao mostrar o copia e cola aqui e o lugar mais
   * seguro que existe — melhor que um cartao publicado em canal, que qualquer
   * um do canal enxerga.
   */
  if (awaitingPix) {
    if (options.qrFilename !== undefined) {
      root.addMediaGalleryComponents(
        mediaGallery([`attachment://${options.qrFilename}`], 'QR Code do pagamento PIX'),
      );
    }

    const manual = pixManualTransferLine(options.receiver);
    root.addTextDisplayComponents(
      text(
        'Escaneie o QR Code acima ou use o **PIX Copia e Cola** abaixo:\n' +
          `\`\`\`\n${charge.pixPayload}\n\`\`\`\n` +
          (manual !== null ? `${manual}\n` : '') +
          '-# Apos pagar, aguarde a equipe confirmar. O status atualiza no botao **Atualizar**.',
      ),
    );
  } else if (isChargeClosed(order)) {
    /*
     * O pedido continua AGUARDANDO PAGAMENTO, mas a cobranca morreu.
     *
     * Sem este bloco o cliente ve "aguardando pagamento" com o PIX simplesmente
     * DESAPARECIDO da tela — nenhum QR, nenhum copia e cola e nenhuma
     * explicacao. Dizer o que aconteceu e o minimo; a equipe emite outra pelo
     * botao "Gerar Nova Cobranca".
     */
    root.addTextDisplayComponents(
      text(
        charge?.status === PaymentStatus.EXPIRED
          ? '⌛ **A cobranca anterior expirou.**\nA equipe da Vook Store vai gerar uma nova para voce. ' +
            'Toque em **Atualizar** em instantes para ver o novo PIX.'
          : '❌ **A cobranca anterior foi cancelada.**\nFale com a equipe da Vook Store para receber uma nova.',
      ),
    );
  }

  root.addActionRowComponents(
    buttonRow(
      // Atualizar re-le o pedido: o cliente confere sozinho quando a equipe
      // confirma o pagamento ou marca a entrega, sem precisar perguntar.
      orderButton(ORDER_ACTION.VIEW, EMOJIS.REFRESH, 'Atualizar', order.id),
      orderButton(ORDER_ACTION.LIST, EMOJIS.PACKAGE, 'Meus Pedidos', '1'),
      catalogHomeButton('Catalogo'),
    ),
  );

  // Com PIX na tela, a orientacao ja esta no bloco acima: um rodape a mais so
  // consumiria o ultimo filho disponivel do Container.
  if (!awaitingPix) {
    root.addTextDisplayComponents(
      footerNote('A equipe da Vook Store prepara o pagamento e acompanha a entrega.'),
    );
  }

  return root;
}

/**
 * DM enviada ao cliente no momento em que a equipe gera a cobranca.
 *
 * Sem ela o cliente so descobriria que existe cobranca abrindo `/meus-pedidos`
 * por conta propria — e o cartao publicado fica no canal em que o VENDEDOR
 * estava, que nem sempre e um canal que o cliente ve.
 */
export function buildOrderChargeDm(params: {
  order: OrderWithItems;
  payment: Payment;
  storeName: string;
  qrFilename?: string;
  receiver?: PixReceiver;
}): ContainerBuilder {
  const { order, payment } = params;

  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.ORDER_CHARGE);

  root.addTextDisplayComponents(
    text(
      `Sua cobranca do pedido **#${formatOrderNumber(order.orderNumber)}** esta pronta.\n\n` +
        `**Itens**\n${itemLines(order.items, payment.description)}`,
    ),
  );

  if (params.qrFilename !== undefined) {
    root.addMediaGalleryComponents(
      mediaGallery([`attachment://${params.qrFilename}`], 'QR Code do pagamento PIX'),
    );
  }

  const manual = pixManualTransferLine(params.receiver);
  root.addTextDisplayComponents(
    text(
      `**TOTAL**\n# ${formatCents(payment.finalAmount)}\n\n` +
        `Expira ${discordTimestamp(payment.expiresAt, 'R')}\n\n` +
        'Escaneie o QR Code acima ou use o **PIX Copia e Cola** abaixo:\n' +
        `\`\`\`\n${payment.pixPayload}\n\`\`\`` +
        (manual !== null ? `\n${manual}` : ''),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(`${params.storeName} confirma o pagamento e avisa voce por aqui.`),
  );

  return root;
}

/** Historico paginado do cliente. */
export function buildOrderListView(params: {
  orders: readonly OrderWithItems[];
  page: number;
  totalPages: number;
  total: number;
}): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.ORDERS);

  if (params.orders.length === 0) {
    root.addTextDisplayComponents(
      text('Voce ainda nao possui pedidos.\n\nExplore o catalogo da Vook Store para comecar.'),
    );
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(buttonRow(catalogHomeButton('Abrir Catalogo')));
    return root;
  }

  root.addTextDisplayComponents(
    text(
      params.orders
        .map((order) => {
          const first = order.items[0];
          const extra = order.items.length > 1 ? ` +${order.items.length - 1}` : '';
          return (
            `**#${formatOrderNumber(order.orderNumber)}**\n` +
            `${truncate(first?.nameSnapshot ?? 'Pedido', 60)}${extra}\n` +
            `${formatCents(order.finalAmount)} • ${orderStatusIcon(order.status)} ${describeOrderStatus(order.status)}`
          );
        })
        .join('\n\n'),
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(selectRow(buildOrderSelect(params.orders, ORDER_ACTION.LIST_SELECT)));

  const navigation: ButtonBuilder[] = [];
  if (params.totalPages > 1) {
    navigation.push(
      orderButton(
        ORDER_ACTION.LIST,
        EMOJIS.PREVIOUS,
        'Anterior',
        String(params.page - 1 < 1 ? params.totalPages : params.page - 1),
      ),
      orderButton(
        ORDER_ACTION.LIST,
        EMOJIS.NEXT,
        'Proxima',
        String(params.page + 1 > params.totalPages ? 1 : params.page + 1),
      ),
    );
  }
  navigation.push(catalogHomeButton('Catalogo'));
  root.addActionRowComponents(buttonRow(...navigation));

  root.addTextDisplayComponents(
    footerNote(`Pagina ${params.page}/${params.totalPages} • ${params.total} pedido(s)`),
  );

  return root;
}

/** Select de pedidos usado tanto pelo cliente quanto pela equipe. */
export function buildOrderSelect(
  orders: readonly OrderWithItems[],
  action: string,
): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, action))
    .setPlaceholder('Selecione um pedido')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    orders.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((order) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(`#${formatOrderNumber(order.orderNumber)}`, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            `${formatCents(order.finalAmount)} • ${describeOrderStatus(order.status)}`,
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(order.id),
    ),
  );

  return menu;
}

// ---------------------------------------------------------------------------
// Visao da equipe
// ---------------------------------------------------------------------------

/**
 * Painel comercial do pedido.
 *
 * As acoes disponiveis dependem do ESTADO: depois de pago, os botoes
 * financeiros somem — valor de pedido pago e historico, nao rascunho.
 */
export function buildOrderStaffView(
  order: OrderWithItemsAndPayment,
  options: { notice?: string } = {},
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, `${TITLES.ORDER} #${formatOrderNumber(order.orderNumber)}`);

  if (options.notice !== undefined && options.notice.length > 0) {
    root.addTextDisplayComponents(text(options.notice));
  }

  root.addTextDisplayComponents(
    text(
      `**Cliente**\n${userMention(order.customerId)}\n\n**Itens**\n${itemLines(order.items, order.payment?.description)}`,
    ),
  );
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text(totalsBlock(order)));
  root.addSeparatorComponents(separator());

  const payment = order.payment;
  root.addTextDisplayComponents(
    text(
      fields([
        ['Status', `${orderStatusIcon(order.status)} ${describeOrderStatus(order.status)}`],
        [
          'Cobranca',
          payment === null
            ? 'Nenhuma cobranca gerada'
            : `${describePaymentLabel(payment.status)} • ${formatCents(payment.finalAmount)}` +
              (payment.status === PaymentStatus.PENDING
                ? ` • expira ${discordTimestamp(payment.expiresAt, 'R')}`
                : ''),
        ],
        ['Criado em', discordTimestamp(order.createdAt, 'f')],
        // A equipe precisa do prazo mais que o cliente: e por ele que a fila de
        // producao se ordena.
        ...deliveryFields(order.dueAt),
        ...assigneeFields(order),
      ]),
    ),
  );

  for (const row of buildStaffActionRows(order)) {
    root.addActionRowComponents(row);
  }

  // O rodape explica a COBRANCA, entao so aparece enquanto ha o que cobrar.
  // Depois do pagamento ele nao dizia nada util — e ocupava o filho do
  // container que o select de responsavel precisa.
  if (order.status === OrderStatus.PENDING || order.status === OrderStatus.AWAITING_PAYMENT) {
    root.addTextDisplayComponents(
      footerNote(
        'A cobranca usa o mesmo sistema de `/pagamento`: conta, PIX, cupons e expiracao configurados na loja.',
      ),
    );
  }

  return root;
}

function isInProduction(order: Order): boolean {
  return order.status === OrderStatus.PAID || order.status === OrderStatus.IN_PROGRESS;
}

/**
 * Responsavel pela demanda.
 *
 * Em producao, "ninguem" tambem e informacao: e o que diz que o pedido esta
 * parado esperando alguem pegar. Depois da entrega o campo fica como registro
 * de quem produziu.
 */
function assigneeFields(order: Order): Array<[string, string]> {
  if (order.assignedToId !== null) {
    const since =
      isInProduction(order) && order.assignedAt !== null
        ? ` · desde ${discordTimestamp(order.assignedAt, 'R')}`
        : '';
    return [['Responsavel', `${userMention(order.assignedToId)}${since}`]];
  }
  return isInProduction(order) ? [['Responsavel', 'ninguem — demanda livre na fila']] : [];
}

/**
 * Entregar a demanda a alguem da equipe.
 *
 * O select de usuario oferece o servidor inteiro; quem pode RECEBER e
 * conferido no handler, com o membro real.
 */
function assignSelect(order: Order): UserSelectMenuBuilder {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.ASSIGN, order.id))
    .setPlaceholder(
      order.assignedToId === null
        ? 'Atribuir a alguem da equipe'
        : 'Transferir para outra pessoa da equipe',
    )
    .setMinValues(1)
    .setMaxValues(1);

  if (order.assignedToId !== null) menu.setDefaultUsers(order.assignedToId);
  return menu;
}

function describePaymentLabel(status: PaymentStatus): string {
  switch (status) {
    case PaymentStatus.PENDING:
      return '🟡 Pendente';
    case PaymentStatus.APPROVED:
      return '✅ Aprovada';
    case PaymentStatus.CANCELLED:
      return '❌ Cancelada';
    case PaymentStatus.EXPIRED:
      return '⌛ Expirada';
    default:
      return String(status);
  }
}

/**
 * Linhas de acao da equipe.
 *
 * Pedido pago NAO mostra "Aplicar Cupom" nem "Gerar Pagamento": alterar valor
 * de uma compra ja paga so pode acontecer por um fluxo administrativo proprio
 * e auditado — jamais por um botao solto no painel.
 */
function buildStaffActionRows(order: OrderWithItemsAndPayment): Array<ReturnType<typeof buttonRow>> {
  const rows: Array<ReturnType<typeof buttonRow>> = [];
  const payment = order.payment;
  const hasPendingCharge = payment !== null && payment.status === PaymentStatus.PENDING;

  if (order.status === OrderStatus.PENDING || order.status === OrderStatus.AWAITING_PAYMENT) {
    const chargeLabel =
      payment === null
        ? 'Gerar Pagamento'
        : payment.status === PaymentStatus.PENDING
          ? 'Cobranca Pendente'
          : 'Gerar Nova Cobranca';

    rows.push(
      buttonRow(
        orderButton(ORDER_ACTION.COUPON, EMOJIS.COUPON, 'Aplicar Cupom', order.id).setDisabled(
          hasPendingCharge,
        ),
        orderButton(
          ORDER_ACTION.PAYMENT,
          payment === null ? EMOJIS.PAYMENT : EMOJIS.REFRESH,
          chargeLabel,
          order.id,
        ).setDisabled(hasPendingCharge),
        orderButton(ORDER_ACTION.CANCEL, EMOJIS.CLOSE, 'Cancelar Pedido', order.id),
        orderButton(ORDER_ACTION.STAFF, EMOJIS.REFRESH, 'Atualizar', order.id),
      ),
    );
    return rows;
  }

  if (isInProduction(order)) {
    rows.push(
      buttonRow(
        orderButton(ORDER_ACTION.PROGRESS, EMOJIS.PREPARING, 'Em Preparacao', order.id).setDisabled(
          order.status === OrderStatus.IN_PROGRESS,
        ),
        // Assumir OU liberar, nunca os dois: com dono, assumir seria tomar a
        // demanda de alguem — e isso e o select de transferir, explicito.
        order.assignedToId === null
          ? orderButton(ORDER_ACTION.CLAIM, EMOJIS.CLAIM, 'Assumir', order.id)
          : orderButton(ORDER_ACTION.RELEASE, EMOJIS.BACK, 'Liberar', order.id),
        orderButton(ORDER_ACTION.DELIVER, EMOJIS.DELIVER, 'Marcar como Entregue', order.id),
        orderButton(ORDER_ACTION.STAFF, EMOJIS.REFRESH, 'Atualizar', order.id),
        orderButton(ORDER_ACTION.QUEUE, EMOJIS.LIST, 'Fila', 'all'),
      ),
      selectRow(assignSelect(order)),
    );
    return rows;
  }

  if (order.status === OrderStatus.DELIVERED) {
    rows.push(
      buttonRow(
        orderButton(ORDER_ACTION.COMPLETE, EMOJIS.APPROVE, 'Concluir Pedido', order.id),
        orderButton(ORDER_ACTION.STAFF, EMOJIS.REFRESH, 'Atualizar', order.id),
      ),
    );
    return rows;
  }

  rows.push(
    buttonRow(
      orderButton(ORDER_ACTION.STAFF, EMOJIS.REFRESH, 'Atualizar', order.id),
    ),
  );
  return rows;
}

/**
 * Aviso publicado no canal de pedidos quando uma compra e criada.
 *
 * `chargeState` deixa o card gritar quando a equipe PRECISA agir — cobranca
 * expirada, por exemplo. Sem isso o aviso continuaria dizendo apenas "aguardando
 * pagamento" e ninguem descobriria que e preciso emitir outra.
 */
export function buildNewOrderNotice(
  order: OrderWithItems,
  options: { chargeState?: string } = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.ORDER_NEW);

  if (options.chargeState !== undefined && options.chargeState.length > 0) {
    root.addTextDisplayComponents(text(options.chargeState));
  }

  // Cinco dados em duas linhas: o total e o que a equipe procura primeiro, e
  // ele abre o bloco em vez de aparecer como quarto rotulo empilhado.
  root.addTextDisplayComponents(
    text(
      `## ${formatCents(order.subtotalAmount)}\n` +
        `**Pedido** \`#${formatOrderNumber(order.orderNumber)}\`  •  ` +
        `**Cliente** ${userMention(order.customerId)}\n` +
        `${orderStatusIcon(order.status)} ${describeOrderStatus(order.status)} • ` +
        `${order.items.length} item(ns)`,
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(orderButton(ORDER_ACTION.STAFF, EMOJIS.LIST, 'Abrir Pedido', order.id)),
  );
  root.addTextDisplayComponents(
    footerNote('Somente a equipe da Vook Store consegue operar este pedido.'),
  );

  return root;
}

/** Seletor de cupons elegiveis — visivel SOMENTE para a equipe. */
export function buildOrderCouponPanel(
  orderId: string,
  options: ReadonlyArray<{ coupon: Coupon; discount: DiscountBreakdown }>,
  selectedCouponId: string | null,
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.COUPONS, {
    subtitle: 'Somente a equipe aplica cupons. O cliente nunca escolhe desconto.',
  });

  if (options.length === 0) {
    root.addTextDisplayComponents(
      text(
        'Nenhum cupom elegivel para este cliente e este valor agora.\n' +
          'Confira validade, valor minimo e limites de uso em `/cupom gerenciar`.',
      ),
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.COUPON_SELECT, orderId))
    .setPlaceholder('Selecione o cupom a aplicar')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions([
    new StringSelectMenuOptionBuilder()
      .setLabel('Nenhum cupom')
      .setDescription('Cobrar o valor integral')
      .setValue(NO_COUPON_VALUE)
      .setDefault(selectedCouponId === null),
    ...options.slice(0, DISCORD_LIMITS.SELECT_OPTIONS - 1).map((entry) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(
          truncate(
            `${entry.coupon.code} — ${describeCouponValue(entry.coupon)}`,
            DISCORD_LIMITS.SELECT_LABEL,
          ),
        )
        .setDescription(
          truncate(
            `Desconto ${formatCents(entry.discount.discountAmount)} • Total ${formatCents(entry.discount.finalAmount)}`,
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(entry.coupon.id)
        .setDefault(entry.coupon.id === selectedCouponId),
    ),
  ]);

  root.addActionRowComponents(selectRow(menu));
  root.addActionRowComponents(
    buttonRow(orderButton(ORDER_ACTION.STAFF, EMOJIS.BACK, 'Voltar ao Pedido', orderId)),
  );
  return root;
}

/** Seletor da conta PIX que recebera o valor do pedido. */
export function buildOrderAccountPanel(
  orderId: string,
  accounts: readonly PaymentAccount[],
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.PAYMENT_ACCOUNTS, {
    subtitle: 'Escolha a conta que recebera o valor deste pedido.',
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.PAYMENT_ACCOUNT, orderId))
    .setPlaceholder('Selecione a conta PIX')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    accounts.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((account) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(account.name, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            `${account.identifier} • expira em ${account.defaultExpirationMinutes} min`,
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(account.id),
    ),
  );

  root.addActionRowComponents(selectRow(menu));
  root.addActionRowComponents(
    buttonRow(orderButton(ORDER_ACTION.STAFF, EMOJIS.BACK, 'Voltar ao Pedido', orderId)),
  );
  root.addTextDisplayComponents(
    footerNote('A cobranca sera gerada pelo mesmo sistema usado em `/pagamento criar`.'),
  );
  return root;
}

/** Painel administrativo de pedidos com filtro por status. */
export function buildOrderAdminPanel(params: {
  orders: readonly OrderWithItems[];
  status: string;
  page: number;
  totalPages: number;
  total: number;
  totals: ReadonlyMap<OrderStatus, number>;
}): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.ORDERS_ADMIN);

  root.addTextDisplayComponents(
    text(
      fields([
        ['Aguardando vendedor', String(params.totals.get(OrderStatus.PENDING) ?? 0)],
        ['Aguardando pagamento', String(params.totals.get(OrderStatus.AWAITING_PAYMENT) ?? 0)],
        [
          'Pagos / em preparacao',
          String(
            (params.totals.get(OrderStatus.PAID) ?? 0) +
              (params.totals.get(OrderStatus.IN_PROGRESS) ?? 0),
          ),
        ],
        ['Entregues', String(params.totals.get(OrderStatus.DELIVERED) ?? 0)],
      ]),
    ),
  );

  root.addSeparatorComponents(separator());

  if (params.orders.length === 0) {
    root.addTextDisplayComponents(text('Nenhum pedido neste filtro.'));
  } else {
    root.addTextDisplayComponents(
      text(
        params.orders
          .map(
            (order) =>
              `**#${formatOrderNumber(order.orderNumber)}** — ${userMention(order.customerId)}\n` +
              `${formatCents(order.finalAmount)} • ${orderStatusIcon(order.status)} ${describeOrderStatus(order.status)}`,
          )
          .join('\n\n'),
      ),
    );
  }

  root.addActionRowComponents(selectRow(buildOrderStatusFilter(params.status)));

  if (params.orders.length > 0) {
    root.addActionRowComponents(
      selectRow(buildOrderSelect(params.orders, ORDER_ACTION.ADMIN_SELECT)),
    );
  }

  const navigation: ButtonBuilder[] = [];
  if (params.totalPages > 1) {
    navigation.push(
      orderButton(
        ORDER_ACTION.ADMIN_LIST,
        EMOJIS.PREVIOUS,
        'Anterior',
        params.status,
        String(params.page - 1 < 1 ? params.totalPages : params.page - 1),
      ),
      orderButton(
        ORDER_ACTION.ADMIN_LIST,
        EMOJIS.NEXT,
        'Proxima',
        params.status,
        String(params.page + 1 > params.totalPages ? 1 : params.page + 1),
      ),
    );
  }
  navigation.push(
    orderButton(ORDER_ACTION.SEARCH, EMOJIS.SEARCH, 'Buscar Pedido'),
    orderButton(ORDER_ACTION.ADMIN_CUSTOMER, EMOJIS.ROLE, 'Por Cliente'),
  );
  root.addActionRowComponents(buttonRow(...navigation));

  root.addTextDisplayComponents(
    footerNote(`Pagina ${params.page}/${params.totalPages} • ${params.total} pedido(s) no filtro`),
  );

  return root;
}

const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string; description: string }> = [
  { value: ALL_STATUS_VALUE, label: 'Todos', description: 'Todos os pedidos da loja' },
  { value: OrderStatus.PENDING, label: 'Pendentes', description: 'Aguardando o vendedor' },
  {
    value: OrderStatus.AWAITING_PAYMENT,
    label: 'Aguardando pagamento',
    description: 'Cobranca gerada, ainda nao paga',
  },
  { value: OrderStatus.PAID, label: 'Pagos', description: 'Pagos, aguardando preparacao' },
  { value: OrderStatus.IN_PROGRESS, label: 'Em preparacao', description: 'Sendo preparados' },
  { value: OrderStatus.DELIVERED, label: 'Entregues', description: 'Entregues ao cliente' },
  { value: OrderStatus.COMPLETED, label: 'Concluidos', description: 'Ciclo encerrado' },
  { value: OrderStatus.CANCELLED, label: 'Cancelados', description: 'Pedidos cancelados' },
];

export function buildOrderStatusFilter(selected: string): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.ADMIN_FILTER))
    .setPlaceholder('Filtrar por status')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    STATUS_FILTERS.map((filter) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(filter.label)
        .setDescription(filter.description)
        .setValue(filter.value)
        .setDefault(filter.value === selected),
    ),
  );

  return menu;
}

export function isOrderStatusFilter(value: string): boolean {
  return STATUS_FILTERS.some((filter) => filter.value === value);
}

/** Modal do motivo de cancelamento do pedido. */
export function buildOrderCancelModal(orderId: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.CANCEL_MODAL, orderId))
    .setTitle('Cancelar pedido');

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Motivo do cancelamento')
      .setDescription('Fica registrado na auditoria do pedido.')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(BUSINESS_LIMITS.CLOSE_REASON_MAX)
          .setPlaceholder('Ex.: cliente desistiu da compra.'),
      ),
  );

  return modal;
}

/** Modal de busca de pedido (numero ou id do cliente). */
export function buildOrderSearchModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.SEARCH_MODAL))
    .setTitle('Buscar pedido');

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Numero do pedido')
      .setDescription('Aceita 184, VK-000184 ou #VK-000184.')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('numero')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20)
          .setPlaceholder('VK-000184'),
      ),
  );

  return modal;
}

/**
 * Seletor de cliente para a busca da equipe.
 *
 * Usa `UserSelectMenu` em vez de pedir o ID digitado: o vendedor conhece o
 * cliente pelo nome, nao pelo snowflake, e digitar ID errado devolveria "nenhum
 * pedido" sem dizer que o erro foi de digitacao.
 */
export function buildOrderCustomerPicker(): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.ORDERS_ADMIN, { subtitle: 'Buscar pedidos por cliente' });

  root.addTextDisplayComponents(
    text('Escolha o cliente para ver todos os pedidos dele neste servidor.'),
  );

  root.addActionRowComponents(
    selectRow(
      new UserSelectMenuBuilder()
        .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.ADMIN_CUSTOMER_SELECT))
        .setPlaceholder('Selecione o cliente')
        .setMinValues(1)
        .setMaxValues(1),
    ),
  );

  root.addActionRowComponents(
    buttonRow(
      orderButton(ORDER_ACTION.ADMIN_LIST, EMOJIS.BACK, 'Voltar', ALL_STATUS_VALUE, '1'),
    ),
  );
  return root;
}

/** Pedidos de um cliente especifico, na visao da equipe. */
export function buildOrderCustomerLookup(params: {
  customerId: string;
  orders: readonly OrderWithItems[];
  page: number;
  totalPages: number;
  total: number;
}): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.ORDERS_ADMIN, {
    subtitle: `Pedidos de ${userMention(params.customerId)}`,
  });

  if (params.orders.length === 0) {
    root.addTextDisplayComponents(text('Este cliente ainda nao possui pedidos neste servidor.'));
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(
      buttonRow(
        orderButton(ORDER_ACTION.ADMIN_CUSTOMER, EMOJIS.ROLE, 'Outro Cliente'),
        orderButton(ORDER_ACTION.ADMIN_LIST, EMOJIS.BACK, 'Voltar', ALL_STATUS_VALUE, '1'),
      ),
    );
    return root;
  }

  root.addTextDisplayComponents(
    text(
      params.orders
        .map(
          (order) =>
            `**#${formatOrderNumber(order.orderNumber)}** — ${formatCents(order.finalAmount)}\n` +
            `${orderStatusIcon(order.status)} ${describeOrderStatus(order.status)} • ${discordTimestamp(order.createdAt, 'd')}`,
        )
        .join('\n\n'),
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(selectRow(buildOrderSelect(params.orders, ORDER_ACTION.ADMIN_SELECT)));

  const navigation: ButtonBuilder[] = [];
  if (params.totalPages > 1) {
    navigation.push(
      orderButton(
        ORDER_ACTION.ADMIN_CUSTOMER,
        EMOJIS.PREVIOUS,
        'Anterior',
        params.customerId,
        String(params.page - 1 < 1 ? params.totalPages : params.page - 1),
      ),
      orderButton(
        ORDER_ACTION.ADMIN_CUSTOMER,
        EMOJIS.NEXT,
        'Proxima',
        params.customerId,
        String(params.page + 1 > params.totalPages ? 1 : params.page + 1),
      ),
    );
  }
  navigation.push(
    orderButton(ORDER_ACTION.ADMIN_CUSTOMER, EMOJIS.ROLE, 'Outro Cliente'),
    orderButton(ORDER_ACTION.ADMIN_LIST, EMOJIS.BACK, 'Voltar', ALL_STATUS_VALUE, '1'),
  );
  root.addActionRowComponents(buttonRow(...navigation));

  root.addTextDisplayComponents(
    footerNote(`Pagina ${params.page}/${params.totalPages} • ${params.total} pedido(s)`),
  );
  return root;
}

/** Resposta da busca quando o numero informado nao existe na guild. */
export function buildOrderNotFound(orderNumber: number): ContainerBuilder {
  const root = container(COLORS.WARNING);
  addHeader(root, TITLES.ORDERS_ADMIN, { subtitle: 'Pedido nao encontrado' });

  root.addTextDisplayComponents(
    text(
      `Nenhum pedido **#${formatOrderNumber(orderNumber)}** existe neste servidor.\n` +
        'Confira o numero e tente novamente.',
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(
      orderButton(ORDER_ACTION.ADMIN_LIST, EMOJIS.LIST, 'Ver Pedidos', ALL_STATUS_VALUE, '1'),
      orderButton(ORDER_ACTION.SEARCH, EMOJIS.SEARCH, 'Buscar Outro'),
    ),
  );
  return root;
}

/**
 * DM avisando que a cobranca expirou ou foi cancelada.
 *
 * Existe porque o cliente recebeu o PIX por DM: se a cobranca morre em silencio,
 * ele fica com um QR invalido no historico da conversa achando que ainda vale.
 */
export function buildOrderChargeClosedDm(params: {
  order: OrderWithItems;
  expired: boolean;
  storeName: string;
}): ContainerBuilder {
  const root = container(COLORS.WARNING);
  addHeader(root, TITLES.ORDER_CHARGE);

  root.addTextDisplayComponents(
    text(
      params.expired
        ? `⌛ O PIX do pedido **#${formatOrderNumber(params.order.orderNumber)}** **expirou** e nao pode mais ser pago.\n\n` +
          'Seu pedido continua reservado. A equipe vai gerar uma nova cobranca — ' +
          'voce recebe o novo QR Code por aqui.'
        : `❌ A cobranca do pedido **#${formatOrderNumber(params.order.orderNumber)}** foi **cancelada**.\n\n` +
          'Se voce ja pagou, fale com a equipe antes de pagar de novo.',
    ),
  );

  root.addTextDisplayComponents(
    text(`-# Total do pedido: **${formatCents(params.order.finalAmount)}**`),
  );
  root.addTextDisplayComponents(
    footerNote(`${params.storeName} — use \`/meus-pedidos\` para acompanhar.`),
  );

  return root;
}

/** DM enviada ao cliente quando o pagamento e confirmado. */
export function buildOrderPaidDm(order: OrderWithItems, storeName: string): ContainerBuilder {
  const root = container(COLORS.SUCCESS);
  addHeader(root, TITLES.ORDER_PAID);

  root.addTextDisplayComponents(
    text(
      `Seu pagamento referente ao pedido **#${formatOrderNumber(order.orderNumber)}** foi confirmado.`,
    ),
  );
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      `## ${formatCents(order.finalAmount)}\n` +
        `**Itens**\n${itemLines(order.items)}\n` +
        `${EMOJIS.PREPARING} Preparando a entrega.`,
    ),
  );
  root.addTextDisplayComponents(footerNote(`${storeName} agradece a sua compra.`));
  return root;
}

/** DM enviada ao cliente quando o pedido e entregue. */
export function buildOrderDeliveredDm(
  order: OrderWithItems,
  storeName: string,
): ContainerBuilder {
  const root = container(COLORS.SUCCESS);
  addHeader(root, TITLES.ORDER_DELIVERED);

  root.addTextDisplayComponents(
    text(
      `Seu pedido **#${formatOrderNumber(order.orderNumber)}** foi marcado como entregue.\n\n` +
        `Obrigado por comprar na ${storeName}.`,
    ),
  );
  return root;
}

/**
 * Prazo de um pedido, em texto.
 *
 * TEXTO E NAO COR, pela politica visual da loja: nenhuma cor carrega
 * significado aqui. O atraso e dito com todas as letras porque e a unica
 * informacao da linha que exige acao hoje.
 */
function dueLabel(dueAt: Date | null | undefined): string {
  switch (dueStatusOf(dueAt)) {
    case 'atrasado':
      return `**ATRASADO** — venceu ${discordTimestamp(dueAt as Date, 'R')}`;
    case 'hoje':
      return '**VENCE HOJE**';
    case 'no-prazo':
      return `vence ${discordTimestamp(dueAt as Date, 'D')}`;
    default:
      // Nao e erro: e categoria sem prazo cadastrado. Dizer isso na fila e o
      // que faz alguem ir configurar.
      return 'sem prazo definido';
  }
}

/** Categorias distintas dos itens, na ordem em que aparecem. */
function categoriesOf(order: ProductionQueueOrder): string {
  const nomes = [
    ...new Set(
      order.items.flatMap((item) =>
        item.pack.category === null ? [] : [item.pack.category.name],
      ),
    ),
  ];
  return nomes.length === 0 ? 'sem categoria' : nomes.join(', ');
}

/**
 * Fila de producao ordenada por vencimento.
 *
 * O QUE ESTA TELA RESPONDE: "o que vence primeiro?". Ate aqui o bot mostrava a
 * previsao de entrega um pedido por vez — a data existia, era exibida, e nenhuma
 * listagem ordenava por ela. Na pratica o prazo era controlado de cabeca ou numa
 * anotacao paralela, e o atraso chegava pela reclamacao do cliente.
 *
 * UMA LINHA POR PEDIDO, densa de proposito: quem abre isto quer varrer a lista,
 * nao ler cada item. Numero, cliente, categoria e prazo cabem numa linha; o
 * detalhe fica a um `/pedidos buscar` de distancia.
 */
export function buildProductionQueue(params: {
  orders: readonly ProductionQueueOrder[];
  stats: ProductionQueueStats;
  view: QueueView;
  /** Quem abriu a tela — define o que e "Minhas". */
  viewerId: string;
  notice?: string;
}): ContainerBuilder {
  const { orders, stats, view } = params;
  const root = container(COLORS.INFO);
  addHeader(root, 'VOOK STORE — FILA DE PRODUCAO');

  if (params.notice !== undefined && params.notice.length > 0) {
    root.addTextDisplayComponents(text(params.notice));
  }

  // Os botoes aparecem mesmo com a lista vazia: "Minhas" vazio e exatamente a
  // hora de trocar de recorte ou pegar a proxima.
  if (orders.length === 0) {
    root.addTextDisplayComponents(text(emptyQueueText(view, stats)));
    root.addActionRowComponents(queueButtons(view, stats));
    return root;
  }

  const atrasados = orders.filter((order) => dueStatusOf(order.dueAt) === 'atrasado').length;
  const semPrazo = orders.filter((order) => dueStatusOf(order.dueAt) === 'sem-prazo').length;

  const resumo = [`**${stats.total}** em producao`];
  if (stats.unassigned > 0) resumo.push(`**${stats.unassigned} livre(s)**`);
  if (atrasados > 0) resumo.push(`**${atrasados} atrasado(s)**`);
  if (semPrazo > 0) resumo.push(`${semPrazo} sem prazo`);

  const cabecalho = [resumo.join(' · ')];
  const carga = workloadLine(stats);
  if (carga !== null) cabecalho.push(carga);
  cabecalho.push(
    `-# Mostrando ${QUEUE_VIEW_LABEL[view]} (${viewTotal(params)}), ` +
      'do vencimento mais proximo ao mais distante.',
  );

  root.addTextDisplayComponents(text(cabecalho.join('\n')));
  root.addSeparatorComponents(separator());

  const linhas = orders.map(
    (order) =>
      `${orderStatusIcon(order.status)} **${formatOrderNumber(order.orderNumber)}** · ` +
      `${userMention(order.customerId)} · ${categoriesOf(order)}\n` +
      `-# ${dueLabel(order.dueAt)} · ${assigneeLabel(order.assignedToId)}`,
  );

  root.addTextDisplayComponents(text(linhas.join('\n')));

  // Rodapes num bloco so: o container tem dez filhos, e o select e os botoes
  // precisam caber mesmo com aviso no topo.
  const rodape: string[] = [];
  const restantes = viewTotal(params) - orders.length;
  if (restantes > 0) {
    rodape.push(`-# e mais ${restantes} pedido(s) neste recorte, fora desta pagina.`);
  }
  if (semPrazo > 0) {
    rodape.push(
      '-# Pedido sem prazo vem de categoria sem prazo cadastrado. ' +
        'Defina em `/catalogo-painel prazo`.',
    );
  }
  if (rodape.length > 0) root.addTextDisplayComponents(text(rodape.join('\n')));

  root.addActionRowComponents(selectRow(queueSelect(orders)));
  root.addActionRowComponents(queueButtons(view, stats));

  return root;
}

// ---------------------------------------------------------------------------
// Demandas: recortes e acoes da fila
// ---------------------------------------------------------------------------

/**
 * Recorte da fila: todas, so as de quem abriu a tela, ou so as sem responsavel.
 */
export type QueueView = 'all' | 'mine' | 'free';

export function isQueueView(value: string | null | undefined): value is QueueView {
  return value === 'all' || value === 'mine' || value === 'free';
}

const QUEUE_VIEW_LABEL: Record<QueueView, string> = {
  all: 'todas as demandas',
  mine: 'suas demandas',
  free: 'as demandas livres',
};

/** Carga maxima listada por pessoa antes de resumir em "e mais N". */
const WORKLOAD_SHOWN = 8;

/** Total do recorte atual, vindo do banco — nunca o tamanho da pagina. */
function viewTotal(params: {
  stats: ProductionQueueStats;
  view: QueueView;
  viewerId: string;
}): number {
  if (params.view === 'all') return params.stats.total;
  if (params.view === 'free') return params.stats.unassigned;
  return params.stats.workload.find((item) => item.assigneeId === params.viewerId)?.count ?? 0;
}

function assigneeLabel(assignedToId: string | null): string {
  return assignedToId === null ? '**livre**' : `${EMOJIS.CLAIM} ${userMention(assignedToId)}`;
}

/**
 * Quem esta com quantas demandas.
 *
 * E o que torna a fila GERENCIAVEL: sem a carga, distribuir trabalho e
 * perguntar no chat quem esta livre.
 */
function workloadLine(stats: ProductionQueueStats): string | null {
  if (stats.workload.length === 0) return null;

  const shown = stats.workload
    .slice(0, WORKLOAD_SHOWN)
    .map((item) => `${userMention(item.assigneeId)} ${item.count}`);
  const hidden = stats.workload.length - WORKLOAD_SHOWN;
  if (hidden > 0) shown.push(`e mais ${hidden} pessoa(s)`);

  return `Carga da equipe: ${shown.join(' · ')}`;
}

function emptyQueueText(view: QueueView, stats: ProductionQueueStats): string {
  if (view === 'mine') {
    return (
      'Nenhuma demanda com voce agora.\n-# ' +
      (stats.unassigned > 0
        ? `Ha ${stats.unassigned} livre(s): **Pegar Proxima** assume a que vence primeiro.`
        : 'E nao ha demanda livre na fila.')
    );
  }
  if (view === 'free') {
    return (
      'Nenhuma demanda livre.\n-# ' +
      (stats.total > 0
        ? 'Tudo que esta em producao ja tem responsavel.'
        : 'Nao ha pedido em producao.')
    );
  }
  return (
    'Nenhum pedido em producao.\n' +
    '-# Entram aqui os pedidos pagos e em preparacao. Pedido entregue sai da fila.'
  );
}

/**
 * Prazo em texto puro para a descricao do select, que nao renderiza markdown
 * nem timestamp do Discord.
 */
function plainDue(dueAt: Date | null | undefined): string {
  switch (dueStatusOf(dueAt)) {
    case 'atrasado':
      return 'ATRASADO';
    case 'hoje':
      return 'Vence hoje';
    case 'no-prazo':
      return `Vence ${(dueAt as Date).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })}`;
    default:
      return 'Sem prazo';
  }
}

/**
 * Select para abrir uma demanda da pagina.
 *
 * Reusa a rota do painel de pedidos (`admin-sel`): o destino e a mesma tela da
 * equipe, com os mesmos botoes — nao ha segunda versao dela para manter.
 */
function queueSelect(orders: readonly ProductionQueueOrder[]): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.ADMIN_SELECT))
    .setPlaceholder('Abrir uma demanda')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      orders.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((order) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(
            truncate(
              `${formatOrderNumber(order.orderNumber)} · ${categoriesOf(order)}`,
              DISCORD_LIMITS.SELECT_LABEL,
            ),
          )
          .setDescription(
            truncate(
              `${plainDue(order.dueAt)} · ${order.assignedToId === null ? 'livre' : 'com responsavel'}`,
              DISCORD_LIMITS.SELECT_DESCRIPTION,
            ),
          )
          .setValue(order.id),
      ),
    );
}

function queueButtons(
  view: QueueView,
  stats: ProductionQueueStats,
): ReturnType<typeof buttonRow> {
  const filter = (target: QueueView, emoji: string, label: string): ButtonBuilder =>
    orderButton(ORDER_ACTION.QUEUE, emoji, label, target).setDisabled(view === target);

  return buttonRow(
    orderButton(ORDER_ACTION.QUEUE_NEXT, EMOJIS.BUY_NOW, 'Pegar Proxima', view).setDisabled(
      stats.unassigned === 0,
    ),
    filter('all', EMOJIS.LIST, 'Todas'),
    filter('mine', EMOJIS.CLAIM, 'Minhas'),
    filter('free', EMOJIS.PACKAGE, 'Livres'),
    // Arg extra so para o id nao repetir o do filtro atual: o Discord recusa a
    // mensagem INTEIRA quando dois componentes tem o mesmo customId.
    orderButton(ORDER_ACTION.QUEUE, EMOJIS.REFRESH, 'Atualizar', view, 'r'),
  );
}
