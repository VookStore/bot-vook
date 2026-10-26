import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { CART_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  selectRow,
  separator,
  text,
} from '../../../components/v2';

/** Itens listados na DM de carrinho abandonado; o resto vira "e mais N". */
const CART_DM_ITEM_LIMIT = 6;
import { channelUrl } from '../../../utils/discord';
import { formatCents } from '../../../utils/money';
import { truncate } from '../../../utils/sanitize';
import { catalogHomeButton, ordersButton } from './CatalogBuilders';
import type { CartView } from '../types/catalog';

/**
 * Carrinho (Components V2).
 *
 * O carrinho e SEMPRE efemero: e informacao do cliente e nao pode virar
 * conteudo publico do canal do catalogo.
 *
 * Aqui NAO existe campo de cupom. Cupom e ferramenta interna da equipe — o
 * cliente nunca digita, escolhe nem ve codigo de desconto.
 */

function cartButton(action: string, emoji: string, label: string, ...args: string[]): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CART, action, ...args))
    .setEmoji(emoji)
    .setLabel(truncate(label, DISCORD_LIMITS.BUTTON_LABEL))
    .setStyle(ButtonStyle.Secondary);
}

export function buildCartView(view: CartView, options: { notice?: string } = {}): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CART);

  if (options.notice !== undefined && options.notice.length > 0) {
    root.addTextDisplayComponents(text(options.notice));
  }

  if (view.lines.length === 0) {
    root.addTextDisplayComponents(
      text(
        'Seu carrinho esta vazio.\n\nExplore o catalogo da Vook Store para adicionar packs.',
      ),
    );
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(
      buttonRow(catalogHomeButton('Abrir Catalogo'), ordersButton()),
    );
    return root;
  }

  const lines = view.lines.map((line, index) => {
    const price = line.unavailable ? '—' : formatCents(line.pack.price);
    const suffix = line.unavailable ? `\n⚠️ ${line.reason ?? 'Indisponivel.'}` : '';
    return `**${index + 1}.** ${truncate(line.pack.name, 70)}\n${price}${suffix}`;
  });

  root.addTextDisplayComponents(text(lines.join('\n\n')));
  root.addSeparatorComponents(separator());

  root.addTextDisplayComponents(
    text(
      `**SUBTOTAL**\n# ${formatCents(view.subtotal)}\n\n` +
        `${view.lines.length} item(ns) no carrinho` +
        (view.sellableCount !== view.lines.length
          ? ` • ${view.lines.length - view.sellableCount} indisponivel(is)`
          : ''),
    ),
  );

  root.addActionRowComponents(
    buttonRow(
      cartButton(CART_ACTION.REMOVE, EMOJIS.DELETE, 'Remover Item'),
      cartButton(CART_ACTION.CLEAR, EMOJIS.CLEAR, 'Limpar Carrinho'),
      catalogHomeButton('Continuar Comprando'),
      cartButton(CART_ACTION.CHECKOUT, EMOJIS.PAYMENT, 'Finalizar Compra').setDisabled(
        view.sellableCount === 0,
      ),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(
      'O valor final e confirmado quando o pedido e criado. Descontos sao aplicados pela equipe da Vook Store.',
    ),
  );

  return root;
}

/** Seletor de item a remover (no maximo 25 itens, limite do Discord). */
export function buildCartRemovePanel(view: CartView): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.CART, { subtitle: 'Escolha o item que deseja remover.' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CART, CART_ACTION.REMOVE_SELECT))
    .setPlaceholder('Selecione o item a remover')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    view.lines.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((line) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(line.pack.name, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            line.unavailable
              ? (line.reason ?? 'Indisponivel.')
              : formatCents(line.pack.price),
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        // O valor e o id do ITEM (nao do pack): a remocao confere o carrinho
        // dono antes de apagar, entao um id trocado na mao nao remove nada.
        .setValue(line.item.id),
    ),
  );

  root.addActionRowComponents(selectRow(menu));
  root.addActionRowComponents(
    buttonRow(cartButton(CART_ACTION.VIEW, EMOJIS.BACK, 'Voltar ao Carrinho')),
  );
  return root;
}

/** Confirmacao antes de esvaziar o carrinho. */
export function buildCartClearConfirm(view: CartView): ContainerBuilder {
  const root = container(COLORS.WARNING);
  addHeader(root, TITLES.CART, { subtitle: 'Confirmar limpeza do carrinho' });

  root.addTextDisplayComponents(
    text(
      `Voce esta prestes a remover **${view.lines.length} item(ns)** do seu carrinho.\n` +
        'Esta acao nao pode ser desfeita.',
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(
      cartButton(CART_ACTION.CLEAR_CONFIRM, EMOJIS.CLEAR, 'Confirmar'),
      cartButton(CART_ACTION.VIEW, EMOJIS.BACK, 'Voltar'),
    ),
  );
  return root;
}

/**
 * Confirmacao da compra.
 *
 * Deixa explicito que quem prepara o pagamento e a equipe: o cliente cria o
 * PEDIDO, e a cobranca vem depois, pelo mesmo fluxo de `/pagamento`.
 */
export function buildCheckoutConfirm(view: CartView): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CHECKOUT);

  const lines = view.lines
    .filter((line) => !line.unavailable)
    .map((line) => `• ${truncate(line.pack.name, 70)} — ${formatCents(line.pack.price)}`);

  root.addTextDisplayComponents(
    text(
      `${lines.join('\n')}\n\n` +
        `**Itens**\n${view.sellableCount}\n\n**SUBTOTAL**\n# ${formatCents(view.subtotal)}`,
    ),
  );

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      'Ao confirmar, seu pedido sera registrado e a equipe da Vook Store preparara o pagamento.',
    ),
  );

  root.addActionRowComponents(
    buttonRow(
      cartButton(CART_ACTION.CHECKOUT_CONFIRM, EMOJIS.APPROVE, 'Confirmar'),
      cartButton(CART_ACTION.VIEW, EMOJIS.BACK, 'Voltar'),
    ),
  );
  return root;
}

/** Confirmacao do "Comprar Agora" (um pack, sem passar pelo carrinho). */
export function buildBuyNowConfirm(params: {
  packId: string;
  packName: string;
  price: number;
  buyButton: ButtonBuilder;
  backButton: ButtonBuilder;
}): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CHECKOUT);

  root.addTextDisplayComponents(
    text(
      `• ${truncate(params.packName, 70)}\n\n**TOTAL**\n# ${formatCents(params.price)}`,
    ),
  );

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      'Ao confirmar, seu pedido sera registrado e a equipe da Vook Store preparara o pagamento.',
    ),
  );

  root.addActionRowComponents(buttonRow(params.buyButton, params.backButton));
  return root;
}

/**
 * DM de carrinho abandonado.
 *
 * O carrinho e persistente e o cliente sai do Discord esquecendo dele. Este e o
 * unico lembrete que ele recebe — nunca ha um segundo, e a coluna
 * `abandonedNoticeAt` e o que garante isso.
 *
 * TOM E CONTEUDO. So lista o que o proprio cliente colocou la, com o preco
 * ATUAL, e oferece um caminho de volta. Sem urgencia inventada, sem contagem
 * regressiva e sem desconto: nada aqui promete algo que a loja nao vai cumprir
 * se a pessoa voltar tres dias depois.
 *
 * ITENS INDISPONIVEIS NAO ENTRAM. Um pack que saiu do ar entre a adicao e o
 * lembrete viraria uma promessa quebrada logo no clique — quem chama filtra
 * antes, e um carrinho que so tem indisponivel nem gera DM.
 */
export function buildAbandonedCartDm(params: {
  view: CartView;
  guildId: string;
  /** Canal do catalogo. Sem ele, o botao aponta para o servidor. */
  catalogChannelId: string | null;
  storeName: string;
}): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CART_ABANDONED);

  const disponiveis = params.view.lines.filter((line) => !line.unavailable);

  root.addTextDisplayComponents(
    text(
      `Voce deixou ${disponiveis.length === 1 ? 'um item' : `${disponiveis.length} itens`} ` +
        `no seu carrinho da ${params.storeName}. Esta tudo guardado — e so voltar quando quiser.`,
    ),
  );

  root.addSeparatorComponents(separator());

  const linhas = disponiveis
    .slice(0, CART_DM_ITEM_LIMIT)
    .map((line) => `• **${truncate(line.pack.name, 60)}** — ${formatCents(line.pack.price)}`);

  const restantes = disponiveis.length - linhas.length;
  if (restantes > 0) {
    linhas.push(`-# e mais ${restantes} ${restantes === 1 ? 'item' : 'itens'}`);
  }

  root.addTextDisplayComponents(text(linhas.join('\n')));
  root.addTextDisplayComponents(text(`**Subtotal:** ${formatCents(params.view.subtotal)}`));

  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Voltar ao Catalogo')
        .setEmoji(EMOJIS.CART)
        .setURL(
          params.catalogChannelId === null
            ? `https://discord.com/channels/${params.guildId}`
            : channelUrl(params.guildId, params.catalogChannelId),
        ),
    ),
  );

  root.addTextDisplayComponents(
    // O preco do carrinho nunca e congelado: quem le isto tres dias depois
    // precisa saber que o valor acima e o de hoje, nao uma promessa.
    footerNote('Os precos exibidos sao os atuais e podem mudar ate a finalizacao do pedido.'),
  );

  return root;
}
