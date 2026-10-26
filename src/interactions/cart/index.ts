import type { ButtonInteraction, RepliableInteraction } from 'discord.js';

import { EMOJIS } from '../../constants/branding';
import { CART_ACTION, NAMESPACE } from '../../constants/customIds';
import {
  buildCartClearConfirm,
  buildCartRemovePanel,
  buildCartView,
  buildCheckoutConfirm,
} from '../../modules/catalog/builders/CartBuilders';
import { showCustomerOrder } from '../orders';
import { clearCart, getCartView, removeFromCart } from '../../modules/catalog/services/CartService';
import { announceNewOrder } from '../../modules/catalog/services/OrderNotificationService';
import { checkoutCart, requireOrder } from '../../modules/catalog/services/OrderService';
import { applyBoosterDiscount } from '../../modules/booster/services/BoosterDiscountService';
import type { ButtonHandler, SelectHandler } from '../../types';
import {
  beginPanel,
  readSelectedValue,
  requireGuildContext,
  showPanel,
} from '../catalog/shared';

/**
 * Carrinho do cliente.
 *
 * O carrinho e SEMPRE privado: mesmo clicando num painel publico, a resposta
 * sai efemera. Ninguem ve o carrinho de ninguem.
 *
 * NAO existe campo de cupom aqui — nem no carrinho, nem no checkout. O desconto
 * e decisao comercial da equipe, aplicada no painel do pedido.
 *
 * O preco exibido e sempre o ATUAL do produto: o carrinho nao congela valor. O
 * snapshot vinculante nasce no pedido.
 */

/** Renderiza o carrinho do proprio cliente. */
async function renderCart(
  interaction: RepliableInteraction,
  guildId: string,
  customerId: string,
  notice?: string,
): Promise<void> {
  const view = await getCartView(guildId, customerId);
  await showPanel(interaction, buildCartView(view, notice === undefined ? {} : { notice }));
}

const viewButton: ButtonHandler = {
  namespace: NAMESPACE.CART,
  action: CART_ACTION.VIEW,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await beginPanel(interaction);
    await renderCart(interaction, guild.id, member.id);
  },
};

const removeButton: ButtonHandler = {
  namespace: NAMESPACE.CART,
  action: CART_ACTION.REMOVE,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await beginPanel(interaction);

    const view = await getCartView(guild.id, member.id);
    if (view.lines.length === 0) {
      await renderCart(interaction, guild.id, member.id, '⚠️ Seu carrinho ja esta vazio.');
      return;
    }

    await showPanel(interaction, buildCartRemovePanel(view));
  },
};

const clearButton: ButtonHandler = {
  namespace: NAMESPACE.CART,
  action: CART_ACTION.CLEAR,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await beginPanel(interaction);

    const view = await getCartView(guild.id, member.id);
    if (view.lines.length === 0) {
      await renderCart(interaction, guild.id, member.id, '⚠️ Seu carrinho ja esta vazio.');
      return;
    }

    await showPanel(interaction, buildCartClearConfirm(view));
  },
};

const clearConfirmButton: ButtonHandler = {
  namespace: NAMESPACE.CART,
  action: CART_ACTION.CLEAR_CONFIRM,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await beginPanel(interaction);

    // `clearCart` so apaga o carrinho ATIVO de quem clicou: nao existe caminho
    // para limpar o carrinho de outra pessoa.
    const removed = await clearCart(guild.id, member.id);
    await renderCart(
      interaction,
      guild.id,
      member.id,
      `${EMOJIS.CLEAR} ${removed} item(ns) removido(s) do carrinho.`,
    );
  },
};

const checkoutButton: ButtonHandler = {
  namespace: NAMESPACE.CART,
  action: CART_ACTION.CHECKOUT,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await beginPanel(interaction);

    const view = await getCartView(guild.id, member.id);
    if (view.sellableCount === 0) {
      await renderCart(
        interaction,
        guild.id,
        member.id,
        '⚠️ Nenhum item disponivel para compra no seu carrinho.',
      );
      return;
    }

    await showPanel(interaction, buildCheckoutConfirm(view));
  },
};

/**
 * Confirmacao do checkout.
 *
 * A criacao do pedido roda sob lock por cliente e revalida tudo no banco. Um
 * duplo clique nao cria dois pedidos: o segundo encontra o carrinho ja
 * encerrado (ou o pedido identico recente) e apenas mostra o resultado.
 */
const checkoutConfirmButton: ButtonHandler = {
  namespace: NAMESPACE.CART,
  action: CART_ACTION.CHECKOUT_CONFIRM,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await beginPanel(interaction);

    const { order, duplicated } = await checkoutCart({
      guildId: guild.id,
      customerId: member.id,
      channelId: interaction.channelId,
    });


    /*
     * Desconto de booster, antes de a equipe ver o pedido.
     *
     * Aqui e o unico ponto do fluxo que tem o `GuildMember` em maos, e sem ele
     * nao da para saber se o cliente impulsiona. Melhor-esforco: o servico
     * engole os proprios erros e o pedido segue com preco cheio.
     */
    if (!duplicated) await applyBoosterDiscount(member, order);

    // Aviso a equipe fica FORA da transacao: falha do Discord nao desfaz venda.
    if (!duplicated) await announceNewOrder(guild, order);

    const full = await requireOrder(guild.id, order.id);
    await showCustomerOrder(
      interaction,
      full,
      duplicated
        ? '⚠️ Este pedido ja tinha sido criado ha instantes. Ele esta abaixo.'
        : `${EMOJIS.APPROVE} Pedido criado. A equipe da Vook Store vai preparar o pagamento.`,
    );
  },
};

const removeSelect: SelectHandler = {
  namespace: NAMESPACE.CART,
  action: CART_ACTION.REMOVE_SELECT,
  async handle(interaction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const itemId = readSelectedValue(interaction);

    await beginPanel(interaction);

    const removed = await removeFromCart(guild.id, member.id, itemId);
    await renderCart(
      interaction,
      guild.id,
      member.id,
      removed
        ? `${EMOJIS.DELETE} Item removido do carrinho.`
        : '⚠️ Este item nao esta mais no seu carrinho.',
    );
  },
};

/** Carrinho aberto por comando (`/carrinho`). */
export async function renderCartForCommand(
  interaction: RepliableInteraction,
  guildId: string,
  customerId: string,
): Promise<void> {
  await renderCart(interaction, guildId, customerId);
}

export const cartButtons: ButtonHandler[] = [
  viewButton,
  removeButton,
  clearButton,
  clearConfirmButton,
  checkoutButton,
  checkoutConfirmButton,
];

export const cartSelects: SelectHandler[] = [removeSelect];
