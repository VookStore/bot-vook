import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  PaymentStatus,
  type Coupon,
  type Payment,
  type PaymentAccount,
  type PixKeyType,
} from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { NAMESPACE, PAYMENT_ACTION, buildCustomId } from '../../../constants/customIds';
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
import { discordTimestamp } from '../../../utils/time';
import { userMention } from '../../../utils/discord';
import { truncate } from '../../../utils/sanitize';
import type { DiscountBreakdown } from '../../coupons/types/coupon';
import { describeCouponValue } from '../../coupons/services/CouponCalculator';
import { describeStatus, linkedOrderId } from '../services/PaymentService';
import { describePixKeyType } from '../validators/PixKeyValidator';

/** Cartao de cobranca PIX, painel de gerenciamento e confirmacao de criacao. */

const NO_COUPON_VALUE = 'none';

function statusAccent(status: PaymentStatus): number {
  switch (status) {
    case PaymentStatus.APPROVED:
      return COLORS.SUCCESS;
    case PaymentStatus.CANCELLED:
      return COLORS.DANGER;
    case PaymentStatus.EXPIRED:
      return COLORS.NEUTRAL;
    default:
      return COLORS.BRAND;
  }
}

function statusIcon(status: PaymentStatus): string {
  switch (status) {
    case PaymentStatus.APPROVED:
      return EMOJIS.APPROVE;
    case PaymentStatus.CANCELLED:
      return EMOJIS.CLOSE;
    case PaymentStatus.EXPIRED:
      return '⌛';
    default:
      return EMOJIS.PENDING;
  }
}

/**
 * Recebedor estampado em TEXTO no cartao.
 *
 * Chega pronto, e nao como a `PaymentAccount` inteira, porque o que entra num
 * cartao PUBLICO precisa ser escolha explicita: a conta carrega tambem o apelido
 * interno ("Conta principal"), a expiracao padrao e o estado, que sao da equipe.
 */
export interface PixReceiver {
  /** Chave completa — e ela que o cliente digita no app do banco. */
  key: string;
  keyType: PixKeyType;
  /** Titular como aparece no extrato de quem paga (`receiverName` da conta). */
  holder: string;
}

export interface PaymentCardOptions {
  /** Nome do arquivo do QR anexado (attachment://). Ausente quando nao ha QR. */
  qrFilename?: string;
  /**
   * Dados para pagar digitando a chave. Ausente apenas omite a linha: quem
   * escaneia o QR ou cola o payload nao depende dela.
   */
  receiver?: PixReceiver;
  /**
   * Numero do pedido que esta cobranca paga, JA formatado (`VK-000185`).
   *
   * Chega pronto de proposito: o formato do numero e regra do catalogo, e este
   * modulo nao conhece catalogo. Quem resolve e o `PaymentCardService`, pelo
   * resolvedor que o catalogo registra no boot.
   */
  orderLabel?: string;
}

/** `**Rotulo** valor` numa linha so, no lugar do bloco de duas do `fields()`. */
function inline(label: string, value: string): string {
  return `**${label}** ${value}`;
}

/**
 * Terceiro caminho de pagamento: copiar a CHAVE.
 *
 * O QR atende quem escaneia e o copia e cola atende quem cola. Faltava quem
 * digita a chave direto no app do banco — e ate aqui esse cliente so tinha a
 * chave se a loja a tivesse DESENHADO na arte do QR. Sem arte cadastrada nao
 * havia chave em lugar nenhum do Discord, e ele voltava ao ticket para pedir.
 *
 * NAO E VAZAMENTO. A mesma chave ja viaja em texto puro dentro do `pixPayload`
 * impresso na linha de cima. A regra de mascarar (`maskPixKey`) vale para os
 * PAINEIS DA EQUIPE, onde a chave e dado administrativo listado ao lado de
 * outras contas; no cartao ela e exatamente o que o cliente precisa para pagar.
 *
 * O aviso do valor nao e enfeite: transferencia por chave NAO carrega valor —
 * quem digita a chave digita o total tambem, e total errado e o defeito mais
 * comum desse caminho (e o que vira comprovante divergente depois).
 *
 * Sem escape de markdown: `pixKey` sai validada pelo `PixKeyValidator` (CPF,
 * CNPJ, e-mail, telefone ou UUID) e `receiverName` sai de `normalizePixText`,
 * que so deixa passar `[A-Za-z0-9 .-]`. Nenhum dos dois carrega marcacao.
 *
 * EXPORTADA porque o copia e cola aparece em tres telas — o cartao do canal, a
 * DM da cobranca e `/meus-pedidos` — e as tres precisam dizer a MESMA coisa. O
 * aviso do valor perde a serventia se so uma delas o der.
 */
export function pixManualTransferLine(receiver: PixReceiver | undefined): string | null {
  if (receiver === undefined) return null;

  const key = `\`${receiver.key}\``;
  return (
    `-# Ou copie a chave **${describePixKeyType(receiver.keyType)}** ${key} — ` +
    `**${receiver.holder}** • por aqui o valor nao vai junto: confira o total acima.`
  );
}

/**
 * Descricao sem o prefixo que o cartao ja mostra na linha do pedido.
 *
 * A cobranca do catalogo nasce descrita como `Pedido #VK-000184 — Cabelos`.
 * Com o numero agora estampado em campo proprio, repetir o prefixo gastava uma
 * linha inteira para dizer duas vezes a mesma coisa.
 */
function describeCharge(payment: Payment, orderLabel: string | undefined): string {
  if (orderLabel === undefined) return payment.description;
  const prefix = `Pedido #${orderLabel} — `;
  return payment.description.startsWith(prefix)
    ? payment.description.slice(prefix.length)
    : payment.description;
}

/**
 * Linha de estado: icone, situacao e o unico prazo que interessa.
 *
 * Cobranca resolvida absorve aqui o proprio desfecho (quem aprovou, por que
 * cancelou) em vez de gastar um TextDisplay so para isso. E o prazo some
 * quando ja nao ha o que esperar — "expirava" numa cobranca aprovada e ruido.
 */
function statusLine(payment: Payment): string {
  const head = `${statusIcon(payment.status)} **${describeStatus(payment.status)}**`;

  switch (payment.status) {
    case PaymentStatus.PENDING:
      return `${head} • expira ${discordTimestamp(payment.expiresAt, 'R')}`;
    case PaymentStatus.APPROVED:
      return payment.approvedById === null
        ? head
        : `${head} • ${userMention(payment.approvedById)}`;
    case PaymentStatus.CANCELLED:
      return `${head}\n-# Motivo: ${payment.cancelReason ?? 'nao informado.'}`;
    case PaymentStatus.EXPIRED:
      return `${head}\n-# Solicite uma nova cobranca a equipe.`;
    default:
      return head;
  }
}

/**
 * Cartao da cobranca.
 *
 * DENSIDADE E REQUISITO, NAO ESTILO. O cartao e lido no celular, dentro de um
 * ticket, por alguem que so quer saber quanto pagar e para onde. A versao
 * anterior gastava dezessete linhas em rotulos empilhados (`**Cliente**` numa
 * linha, o valor na seguinte, linha em branco, repete) e tres divisores; o
 * QR Code so aparecia depois de rolar a tela. Aqui cada dado ocupa UMA linha,
 * o total vem primeiro e o que e secundario (cupom, motivo) desce para
 * subtexto.
 *
 * O que NAO foi cortado: total, prazo, estado e o copia e cola. Sao o contrato
 * do pagamento — compactar nao pode virar esconder. A chave em texto entrou
 * pela mesma regra, como subtexto dentro do bloco que ja existia: quem paga
 * digitando a chave nao tinha por onde, e um caminho a mais nao pode custar um
 * componente a mais.
 *
 * Os botoes administrativos ficam no cartao porque a equipe precisa agir sobre
 * ele a qualquer momento; TODO clique e revalidado no servidor
 * (`assertCanManagePayments`), entao o cliente nunca consegue aprovar,
 * cancelar ou alterar a propria cobranca. O botao de comprovante e a excecao:
 * ele e do CLIENTE e sai revalidado pelo dono da cobranca.
 *
 * LIMITE DO DISCORD: um Container aceita no maximo 10 componentes filhos. O
 * caminho PENDING com QR agora usa 8 (cabecalho 2 + galeria + dados + divisor +
 * PIX + botoes + rodape) e o resolvido usa 3. A folga e de proposito: foi a
 * falta dela que obrigou o comprovante a dividir linha com os botoes da equipe.
 */
export function buildPaymentCard(
  payment: Payment,
  options: PaymentCardOptions = {},
): ContainerBuilder {
  const pending = payment.status === PaymentStatus.PENDING;

  const root = container(statusAccent(payment.status));
  addHeader(root, TITLES.PAYMENT); // 1 texto + 1 separador

  if (options.qrFilename !== undefined && pending) {
    root.addMediaGalleryComponents(
      mediaGallery([`attachment://${options.qrFilename}`], 'QR Code do pagamento PIX'),
    );
  }

  const lines: string[] = [
    // O total abre o bloco: e a primeira pergunta de quem vai pagar, e um `##`
    // responde sem custar as duas linhas do rotulo + `#` de antes.
    `## ${formatCents(payment.finalAmount)}`,
  ];

  // Pedido e cliente dividem a linha: sao duas identificacoes curtas, e o
  // numero e o que liga a cobranca ao historico e ao comprovante.
  const identity = [
    ...(options.orderLabel !== undefined
      ? [inline('Pedido', `\`#${options.orderLabel}\``)]
      : []),
    inline('Cliente', userMention(payment.customerId)),
  ];
  lines.push(identity.join('  •  '));

  const description = describeCharge(payment, options.orderLabel);
  if (description.length > 0) lines.push(inline('Descricao', description));

  /*
   * O cupom so aparece quando existe.
   *
   * "Cupom: Nenhum" era uma linha inteira para informar ausencia — ruido puro
   * para o cliente. Quando existe, o desconto entra como subtexto: o cliente
   * precisa poder conferir a conta, mas o numero que ele paga ja esta no topo.
   */
  if (payment.couponCodeSnapshot !== null) {
    lines.push(
      `-# Cupom \`${payment.couponCodeSnapshot}\` • de ${formatCents(payment.originalAmount)} ` +
        `• desconto -${formatCents(payment.discountAmount)}`,
    );
  }

  lines.push(statusLine(payment));
  root.addTextDisplayComponents(text(lines.join('\n')));

  if (!pending) return root;

  root.addSeparatorComponents(separator());

  // A chave sobe no MESMO TextDisplay do copia e cola em vez de ganhar um
  // componente proprio: e o mesmo assunto ("como pagar"), e a folga do
  // container existe para uma segunda linha de botoes, nao para mais texto.
  const howToPay = [
    `Escaneie o QR acima ou copie o **PIX Copia e Cola**:`,
    `\`\`\`\n${payment.pixPayload}\n\`\`\``,
  ];
  const manual = pixManualTransferLine(options.receiver);
  if (manual !== null) howToPay.push(manual);
  root.addTextDisplayComponents(text(howToPay.join('\n')));

  root.addActionRowComponents(buttonRow(...buildPaymentButtons(payment)));
  root.addTextDisplayComponents(footerNote(actionsNote(payment)));

  return root;
}

/**
 * Botoes do cartao PENDENTE.
 *
 * O comprovante fica AQUI, no mesmo lugar onde o cliente acabou de ler o PIX —
 * antes ele precisava sair da tela e digitar `/comprovante enviar` com o numero
 * do pedido na mao, e quem paga fecha o Discord antes de fazer isso.
 *
 * So aparece com pedido vinculado: o comprovante e gravado NO PEDIDO
 * (`OrderReceipt.orderId`), entao numa cobranca manual nao existe onde guardar
 * a evidencia — e botao que so sabe responder "nao da" e pior que botao nenhum.
 *
 * Aparecer nao autoriza: `payment:receipt` reconfere no servidor que quem
 * clicou e o cliente desta cobranca, exatamente como as acoes de equipe
 * reconferem a permissao.
 */
function buildPaymentButtons(payment: Payment): ButtonBuilder[] {
  const buttons: ButtonBuilder[] = [];

  if (linkedOrderId(payment) !== null) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.RECEIPT, payment.id))
        .setLabel('Enviar Comprovante')
        .setEmoji(EMOJIS.RECEIPT)
        .setStyle(ButtonStyle.Secondary),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.APPROVE, payment.id))
      .setLabel('Aprovar')
      .setEmoji(EMOJIS.APPROVE)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.MANAGE, payment.id))
      .setLabel('Gerenciar')
      .setEmoji(EMOJIS.ADMIN)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.CANCEL, payment.id))
      .setLabel('Cancelar')
      .setEmoji(EMOJIS.CLOSE)
      .setStyle(ButtonStyle.Secondary),
  );

  return buttons;
}

/**
 * Rodape do cartao.
 *
 * Com o comprovante na linha, o cartao passa a ter DOIS publicos: uma acao do
 * cliente e tres da equipe. Manter o aviso antigo ("as acoes acima sao
 * restritas a equipe") espantaria o cliente justamente do unico botao que e
 * dele.
 */
function actionsNote(payment: Payment): string {
  return linkedOrderId(payment) === null
    ? 'As acoes acima sao restritas a equipe da Vook Store.'
    : 'Comprovante e do cliente; as demais acoes sao restritas a equipe.';
}

/** Painel efemero de gerenciamento da cobranca (somente equipe). */
export function buildPaymentManagePanel(payment: Payment): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.PAYMENT_MANAGE);

  root.addTextDisplayComponents(
    text(
      fields([
        ['Cliente', userMention(payment.customerId)],
        ['Descricao', payment.description],
        ['Valor original', formatCents(payment.originalAmount)],
        [
          'Cupom aplicado',
          payment.couponCodeSnapshot !== null
            ? `\`${payment.couponCodeSnapshot}\` (- ${formatCents(payment.discountAmount)})`
            : 'Nenhum',
        ],
        ['Total atual', formatCents(payment.finalAmount)],
      ]),
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.COUPON, 'payment', payment.id))
        .setLabel('Alterar Cupom')
        .setEmoji(EMOJIS.COUPON)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.COUPON_REMOVE, payment.id))
        .setLabel('Remover Cupom')
        .setEmoji(EMOJIS.DELETE)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(payment.couponId === null),
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.AMOUNT, payment.id))
        .setLabel('Alterar Valor')
        .setEmoji(EMOJIS.EDIT)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  root.addTextDisplayComponents(
    footerNote('Alterar cupom ou valor regenera automaticamente o QR Code e o Copia e Cola.'),
  );
  return root;
}

/**
 * Painel de confirmacao exibido ao vendedor ANTES de gerar a cobranca.
 * E aqui que o vendedor — nunca o cliente — escolhe o cupom.
 */
export function buildChargeDraftPanel(params: {
  draftId: string;
  customerId: string;
  description: string;
  account: PaymentAccount;
  pricing: DiscountBreakdown;
  couponCode: string | null;
  expirationMinutes: number;
}): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.PAYMENT, { subtitle: 'Confira os dados antes de gerar a cobranca.' });

  root.addTextDisplayComponents(
    text(
      fields([
        ['Cliente', userMention(params.customerId)],
        ['Descricao', params.description],
        ['Conta PIX', `${params.account.name} • ${params.account.receiverName}`],
        ['Valor original', formatCents(params.pricing.originalAmount)],
        [
          'Cupom',
          params.couponCode !== null
            ? `\`${params.couponCode}\` (- ${formatCents(params.pricing.discountAmount)})`
            : 'Nenhum',
        ],
      ]),
    ),
  );

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(text(`**TOTAL**\n# ${formatCents(params.pricing.finalAmount)}`));
  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.COUPON, 'draft', params.draftId))
        .setLabel('Selecionar Cupom')
        .setEmoji(EMOJIS.COUPON)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.CONFIRM, params.draftId))
        .setLabel('Gerar Cobranca')
        .setEmoji(EMOJIS.PAYMENT)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.DISCARD, params.draftId))
        .setLabel('Descartar')
        .setEmoji(EMOJIS.CLOSE)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(`A cobranca expira em ${params.expirationMinutes} minuto(s) apos ser gerada.`),
  );
  return root;
}

/**
 * Seletor de cupons elegiveis.
 * `target` e o draftId (criacao) ou o paymentId (gerenciamento).
 */
export type CouponTarget = 'draft' | 'payment';

export function buildCouponSelectMenu(
  kind: CouponTarget,
  target: string,
  options: ReadonlyArray<{ coupon: Coupon; discount: DiscountBreakdown }>,
  selectedCouponId: string | null,
): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.COUPON_SELECT, kind, target))
    .setPlaceholder('Selecione o cupom a aplicar')
    .setMinValues(1)
    .setMaxValues(1);

  const items = [
    new StringSelectMenuOptionBuilder()
      .setLabel('Nenhum cupom')
      .setDescription('Cobrar o valor integral')
      .setValue(NO_COUPON_VALUE)
      .setDefault(selectedCouponId === null),
    ...options.slice(0, DISCORD_LIMITS.SELECT_OPTIONS - 1).map((entry) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(`${entry.coupon.code} — ${describeCouponValue(entry.coupon)}`, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            `Desconto ${formatCents(entry.discount.discountAmount)} • Total ${formatCents(entry.discount.finalAmount)}`,
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(entry.coupon.id)
        .setDefault(entry.coupon.id === selectedCouponId),
    ),
  ];

  menu.addOptions(items);
  return menu;
}

export const NO_COUPON_SELECT_VALUE = NO_COUPON_VALUE;

/** Painel com o seletor de cupons. */
export function buildCouponSelectionPanel(
  kind: CouponTarget,
  target: string,
  options: ReadonlyArray<{ coupon: Coupon; discount: DiscountBreakdown }>,
  selectedCouponId: string | null,
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.COUPONS, { subtitle: 'Somente a equipe aplica cupons.' });

  if (options.length === 0) {
    root.addTextDisplayComponents(
      text(
        'Nenhum cupom elegivel para este cliente e este valor no momento.\n' +
          'Verifique validade, valor minimo e limites de uso em `/cupom gerenciar`.',
      ),
    );
  }

  root.addActionRowComponents(
    selectRow(buildCouponSelectMenu(kind, target, options, selectedCouponId)),
  );
  return root;
}

/** Modal do motivo de cancelamento. */
export function buildCancelModal(paymentId: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.CANCEL_MODAL, paymentId))
    .setTitle('Cancelar cobranca');

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Motivo do cancelamento')
    .setPlaceholder('Ex.: cliente desistiu da compra.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(BUSINESS_LIMITS.CLOSE_REASON_MAX);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason));
  return modal;
}

/** Modal de alteracao do valor da cobranca. */
export function buildAmountModal(paymentId: string, currentAmount: number): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.PAYMENT, PAYMENT_ACTION.AMOUNT_MODAL, paymentId))
    .setTitle('Alterar valor da cobranca');

  const amount = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Novo valor original (sem desconto)')
    .setPlaceholder('Ex.: 250,00')
    .setValue(formatCents(currentAmount).replace('R$ ', ''))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amount));
  return modal;
}
