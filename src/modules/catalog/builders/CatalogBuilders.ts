import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { CatalogCategory, CatalogPack, GuildConfig, PackImage } from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { CART_ACTION, CATALOG_ACTION, NAMESPACE, ORDER_ACTION, buildCustomId } from '../../../constants/customIds';
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
import { truncate } from '../../../utils/sanitize';
import { hasSellablePrice } from '../validators/packValidators';
import { ALL_CATEGORIES_VALUE, type PackView } from '../types/catalog';

/**
 * Vitrine do catalogo (Components V2).
 *
 * LIMITES REAIS RESPEITADOS AQUI
 *  - Container aceita 10 componentes filhos; o cabecalho ja consome 2.
 *  - Uma mensagem V2 aceita 4000 caracteres somando TODOS os TextDisplay.
 *  - Um select aceita 25 opcoes; por isso a listagem e paginada.
 *
 * Politica visual da loja: sem barra de cor e todos os botoes cinza.
 */

/** Orcamento de texto da listagem, com folga para cabecalho e rodape. */
const LIST_TEXT_BUDGET = Math.floor(DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL * 0.6);

function catalogButton(
  action: string,
  emoji: string,
  label: string,
  ...args: string[]
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, action, ...args))
    .setEmoji(emoji)
    .setLabel(truncate(label, DISCORD_LIMITS.BUTTON_LABEL))
    .setStyle(ButtonStyle.Secondary);
}

/** Botao "Meu Carrinho" — sempre a mesma rota, venha de onde vier. */
export function cartButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CART, CART_ACTION.VIEW))
    .setEmoji(EMOJIS.CART)
    .setLabel('Meu Carrinho')
    .setStyle(ButtonStyle.Secondary);
}

/** Botao "Meus Pedidos" (pagina 1). */
export function ordersButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ORDER, ORDER_ACTION.LIST, '1'))
    .setEmoji(EMOJIS.PACKAGE)
    .setLabel('Meus Pedidos')
    .setStyle(ButtonStyle.Secondary);
}

export function catalogHomeButton(label = 'Abrir Catalogo'): ButtonBuilder {
  return catalogButton(CATALOG_ACTION.HOME, EMOJIS.STORE, label);
}

/** Preco exibido: produto sem preco valido nunca aparece como comprável. */
function priceLabel(pack: CatalogPack): string {
  return hasSellablePrice(pack.price) ? formatCents(pack.price) : 'Indisponivel';
}

// ---------------------------------------------------------------------------
// Painel publico fixo
// ---------------------------------------------------------------------------

/**
 * Painel publicado no canal do catalogo.
 *
 * Ele NAO lista produtos: quem clica recebe a loja em mensagem efemera, para
 * que carrinho e pedidos (dados do cliente) nunca virem conteudo publico.
 */
export function buildCatalogPanel(
  config: GuildConfig,
  stats: { packs: number; categories: number },
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, config.catalogTitle, { thumbnailUrl: config.panelThumbnailUrl });

  root.addTextDisplayComponents(text(config.catalogDescription));

  if (config.catalogBannerUrl !== null && config.catalogBannerUrl.length > 0) {
    root.addMediaGalleryComponents(
      mediaGallery([config.catalogBannerUrl], `${config.storeName} — catalogo`),
    );
  }

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      fields([
        ['Produtos disponiveis', String(stats.packs)],
        ['Categorias', String(stats.categories)],
      ]),
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(buttonRow(catalogHomeButton(), cartButton(), ordersButton()));
  root.addTextDisplayComponents(
    footerNote('Sua loja, seu carrinho e seus pedidos aparecem apenas para voce.'),
  );

  return root;
}

// ---------------------------------------------------------------------------
// Home do catalogo (efemera)
// ---------------------------------------------------------------------------

export interface CatalogHomeParams {
  storeName: string;
  description: string;
  categories: ReadonlyArray<{ category: CatalogCategory; count: number }>;
  featured: readonly CatalogPack[];
  totalPacks: number;
  notice?: string;
}

/**
 * Tela inicial da loja.
 *
 * Mostra no maximo um destaque com botao proprio: uma home com dez produtos
 * fica ilegivel no Discord mobile, que e onde a maioria dos clientes compra.
 */
export function buildCatalogHome(params: CatalogHomeParams): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CATALOG, { subtitle: params.description });

  if (params.notice !== undefined && params.notice.length > 0) {
    root.addTextDisplayComponents(text(params.notice));
  }

  const highlight = params.featured[0];
  if (highlight !== undefined) {
    root.addTextDisplayComponents(
      text(
        `${EMOJIS.FEATURED} **DESTAQUE**\n\n**${highlight.name}**\n` +
          `${truncate(highlight.shortDescription ?? 'Pack disponivel na Vook Store.', BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX)}\n\n` +
          `**A partir de**\n${priceLabel(highlight)}`,
      ),
    );
    root.addActionRowComponents(
      buttonRow(
        catalogButton(CATALOG_ACTION.PACK_VIEW, '👀', 'Visualizar', highlight.id, '0'),
      ),
    );
    root.addSeparatorComponents(separator());
  }

  root.addTextDisplayComponents(
    text(
      fields([
        ['Produtos disponiveis', String(params.totalPacks)],
        ['Categorias', String(params.categories.length)],
      ]),
    ),
  );

  if (params.totalPacks === 0) {
    root.addTextDisplayComponents(
      text(
        'Nenhum pack disponivel no momento. Volte em breve — a Vook Store esta preparando novidades.',
      ),
    );
    root.addActionRowComponents(buttonRow(cartButton(), ordersButton()));
    return root;
  }

  root.addActionRowComponents(selectRow(buildCategorySelect(params.categories, null)));
  root.addActionRowComponents(
    buttonRow(
      catalogButton(CATALOG_ACTION.SEARCH, EMOJIS.SEARCH, 'Buscar'),
      cartButton(),
      ordersButton(),
    ),
  );

  return root;
}

/** Seletor de categorias, sempre com a opcao "todos os produtos". */
export function buildCategorySelect(
  categories: ReadonlyArray<{ category: CatalogCategory; count: number }>,
  selectedId: string | null,
): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.CATEGORY_SELECT))
    .setPlaceholder('Selecione uma categoria')
    .setMinValues(1)
    .setMaxValues(1);

  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel('Todos os produtos')
      .setDescription('Ver o catalogo completo')
      .setValue(ALL_CATEGORIES_VALUE)
      .setEmoji(EMOJIS.STORE)
      .setDefault(selectedId === null),
    ...categories.slice(0, DISCORD_LIMITS.SELECT_OPTIONS - 1).map((entry) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(truncate(entry.category.name, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            entry.category.description ?? `${entry.count} produto(s) disponivel(is)`,
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(entry.category.id)
        .setDefault(entry.category.id === selectedId);
      if (entry.category.emoji !== null && entry.category.emoji.length > 0) {
        option.setEmoji(entry.category.emoji);
      }
      return option;
    }),
  ];

  menu.addOptions(options);
  return menu;
}

// ---------------------------------------------------------------------------
// Listagem por categoria / busca
// ---------------------------------------------------------------------------

export interface CatalogListParams {
  categories: ReadonlyArray<{ category: CatalogCategory; count: number }>;
  category: CatalogCategory | null;
  packs: readonly CatalogPack[];
  page: number;
  totalPages: number;
  total: number;
  searchTerm?: string | null;
}

/**
 * Lista de produtos de uma categoria (ou de uma busca), paginada.
 *
 * A pagina e cortada por ORCAMENTO DE TEXTO, nunca por contagem fixa: um pack
 * com descricao longa consome muito mais que outro, e uma pagina fixa estoura
 * o teto de 4000 caracteres da mensagem V2 — que o Discord recusa com 400.
 */
export function buildCatalogList(params: CatalogListParams): ContainerBuilder {
  const root = container(COLORS.BRAND);

  const title =
    params.searchTerm !== null && params.searchTerm !== undefined
      ? `${TITLES.CATALOG} — BUSCA`
      : TITLES.CATALOG;

  addHeader(root, title, {
    subtitle:
      params.searchTerm !== null && params.searchTerm !== undefined
        ? `Resultados para **${truncate(params.searchTerm, 60)}**`
        : `Categoria: **${params.category?.name ?? 'Todos os produtos'}**`,
  });

  if (params.packs.length === 0) {
    root.addTextDisplayComponents(
      text('Nenhum pack encontrado aqui. Tente outra categoria ou outro termo de busca.'),
    );
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(
      buttonRow(catalogHomeButton('Voltar ao Catalogo'), cartButton()),
    );
    return root;
  }

  const blocks: string[] = [];
  let used = 0;

  for (const pack of params.packs) {
    const lines = [
      `**${truncate(pack.name, 80)}**${pack.featured ? ` ${EMOJIS.FEATURED}` : ''}`,
      truncate(pack.shortDescription ?? 'Sem descricao cadastrada.', 120),
      `${EMOJIS.PRICE} ${priceLabel(pack)}${pack.sku !== null ? ` • \`${pack.sku}\`` : ''}`,
    ];
    const block = lines.join('\n');

    if (blocks.length > 0 && used + block.length > LIST_TEXT_BUDGET) break;
    blocks.push(block);
    used += block.length + 2;
  }

  root.addTextDisplayComponents(text(blocks.join('\n\n')));
  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    selectRow(buildPackSelect(params.packs.slice(0, DISCORD_LIMITS.SELECT_OPTIONS))),
  );

  const categoryId = params.category?.id ?? ALL_CATEGORIES_VALUE;
  const navigation: ButtonBuilder[] = [];

  if (params.totalPages > 1) {
    navigation.push(
      catalogButton(
        CATALOG_ACTION.CATEGORY_PAGE,
        EMOJIS.PREVIOUS,
        'Anterior',
        categoryId,
        String(params.page - 1 < 1 ? params.totalPages : params.page - 1),
      ),
      catalogButton(
        CATALOG_ACTION.CATEGORY_PAGE,
        EMOJIS.NEXT,
        'Proxima',
        categoryId,
        String(params.page + 1 > params.totalPages ? 1 : params.page + 1),
      ),
    );
  }

  navigation.push(catalogHomeButton('Inicio'), cartButton());
  root.addActionRowComponents(buttonRow(...navigation));

  root.addTextDisplayComponents(
    footerNote(
      `Pagina ${params.page}/${params.totalPages} • ${params.total} produto(s) • ` +
        `Exibindo ${blocks.length} nesta pagina`,
    ),
  );

  return root;
}

/** Select de packs de uma pagina (no maximo 25 opcoes, limite do Discord). */
export function buildPackSelect(packs: readonly CatalogPack[]): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PACK_SELECT))
    .setPlaceholder('Selecione um pack para ver os detalhes')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    packs.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((pack) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(pack.name, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            `${priceLabel(pack)}${pack.shortDescription !== null ? ` • ${pack.shortDescription}` : ''}`,
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(pack.id),
    ),
  );

  return menu;
}

// ---------------------------------------------------------------------------
// Card do pack (com galeria navegavel)
// ---------------------------------------------------------------------------

export interface PackCardParams {
  view: PackView;
  /** Indice da imagem atualmente exibida (ja normalizado). */
  imageIndex: number;
  notice?: string;
  inCart?: boolean;
}

/** Navegacao CIRCULAR: da ultima imagem, "proxima" volta para a primeira. */
export function normalizeImageIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  return ((safe % total) + total) % total;
}

function currentImage(images: readonly PackImage[], index: number): PackImage | null {
  if (images.length === 0) return null;
  return images[normalizeImageIndex(index, images.length)] ?? null;
}

/**
 * Card do pack.
 *
 * A galeria mostra UMA imagem por vez com ◀️ / ▶️ — dez miniaturas lado a lado
 * nao deixam o cliente ver o produto. O indice viaja no customId, entao a
 * navegacao continua funcionando depois de qualquer restart do bot.
 *
 * Contagem de filhos no pior caso: 2 (cabecalho) + galeria + texto + separador
 * + 2 linhas de botoes + rodape = 8.
 */
export function buildPackCard(params: PackCardParams): ContainerBuilder {
  const { pack, images, category, details } = params.view;
  const total = images.length;
  const index = normalizeImageIndex(params.imageIndex, total);
  const image = currentImage(images, index);

  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CATALOG_PACK);

  if (image !== null) {
    root.addMediaGalleryComponents(
      mediaGallery([image.url], image.altText ?? `${pack.name} — imagem ${index + 1}`),
    );
  }

  const lines: string[] = [`**${pack.name}**`];
  if (params.notice !== undefined && params.notice.length > 0) lines.push(params.notice);

  lines.push(
    truncate(pack.shortDescription ?? 'Sem descricao cadastrada.', BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX),
  );

  if (details.length > 0) {
    lines.push(
      details
        .slice(0, 4)
        .map((detail) => `• **${detail.label}:** ${detail.value}`)
        .join('\n'),
    );
  }

  lines.push(
    fields([
      ['Categoria', category?.name ?? 'Sem categoria'],
      ...(pack.sku !== null ? ([['SKU', `\`${pack.sku}\``]] as Array<[string, string]>) : []),
      ['Imagens', total === 0 ? 'Nenhuma imagem cadastrada' : `Imagem ${index + 1} de ${total}`],
    ]),
  );

  lines.push(`**PRECO**\n# ${priceLabel(pack)}`);

  root.addTextDisplayComponents(text(lines.join('\n\n')));
  root.addSeparatorComponents(separator());

  const sellable = hasSellablePrice(pack.price) && pack.enabled;
  const actions: ButtonBuilder[] = [];

  // Com uma imagem so, a navegacao some: dois botoes que nao levam a lugar
  // nenhum sujam o card e confundem o cliente.
  if (total > 1) {
    actions.push(
      catalogButton(CATALOG_ACTION.IMAGE_PREV, EMOJIS.PREVIOUS, 'Anterior', pack.id, String(index)),
      catalogButton(CATALOG_ACTION.IMAGE_NEXT, EMOJIS.NEXT, 'Proxima', pack.id, String(index)),
    );
  }

  actions.push(
    catalogButton(CATALOG_ACTION.CART_ADD, EMOJIS.CART, 'Adicionar ao Carrinho', pack.id)
      .setDisabled(!sellable || params.inCart === true),
    catalogButton(CATALOG_ACTION.BUY, EMOJIS.BUY_NOW, 'Comprar Agora', pack.id).setDisabled(
      !sellable,
    ),
  );

  root.addActionRowComponents(buttonRow(...actions.slice(0, DISCORD_LIMITS.BUTTONS_PER_ROW)));
  root.addActionRowComponents(
    buttonRow(
      catalogButton(CATALOG_ACTION.PACK_INFO, EMOJIS.INFO, 'Mais Informacoes', pack.id),
      catalogHomeButton('Voltar ao Catalogo'),
      cartButton(),
    ),
  );

  if (!sellable) {
    root.addTextDisplayComponents(
      footerNote('Este pack esta indisponivel para compra no momento.'),
    );
  } else if (params.inCart === true) {
    root.addTextDisplayComponents(footerNote('Este pack ja esta no seu carrinho.'));
  }

  return root;
}

/**
 * "Mais Informacoes": descricao completa e ficha tecnica.
 * O card principal fica enxuto para o mobile; o detalhe mora aqui.
 */
export function buildPackDetails(view: PackView): ContainerBuilder {
  const { pack, category, details, images } = view;

  const root = container(COLORS.INFO);
  addHeader(root, TITLES.CATALOG_PACK, { subtitle: `**${pack.name}**` });

  root.addTextDisplayComponents(
    text(
      truncate(
        pack.description ?? pack.shortDescription ?? 'Nenhuma descricao cadastrada para este pack.',
        BUSINESS_LIMITS.PACK_DESCRIPTION_MAX,
      ),
    ),
  );

  if (details.length > 0) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(
      text(
        details
          .slice(0, BUSINESS_LIMITS.MAX_DETAILS_PER_PACK)
          .map((detail) => `**${detail.label}**\n${detail.value}`)
          .join('\n\n'),
      ),
    );
  }

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      fields([
        ['Categoria', category?.name ?? 'Sem categoria'],
        ['Preco', priceLabel(pack)],
        ['Imagens', String(images.length)],
      ]),
    ),
  );

  root.addActionRowComponents(
    buttonRow(
      catalogButton(CATALOG_ACTION.PACK_VIEW, EMOJIS.BACK, 'Voltar ao Pack', pack.id, '0'),
      catalogButton(CATALOG_ACTION.CART_ADD, EMOJIS.CART, 'Adicionar ao Carrinho', pack.id)
        .setDisabled(!hasSellablePrice(pack.price) || !pack.enabled),
      catalogHomeButton('Catalogo'),
    ),
  );

  return root;
}
