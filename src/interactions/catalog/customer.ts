import { ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

import { deferIfNeeded, replyError } from '../../components/reply';
import { EMOJIS } from '../../constants/branding';
import {
  CATALOG_ACTION,
  NAMESPACE,
  buildCustomId,
  requireArg,
  type ParsedCustomId,
} from '../../constants/customIds';
import { BUSINESS_LIMITS } from '../../constants/limits';
import { ValidationError } from '../../core/errors';
import { getGuildConfig } from '../../modules/configuration/services/GuildConfigService';
import {
  buildCatalogHome,
  buildCatalogList,
  buildPackCard,
  buildPackDetails,
  normalizeImageIndex,
} from '../../modules/catalog/builders/CatalogBuilders';
import { buildBuyNowConfirm } from '../../modules/catalog/builders/CartBuilders';
import { buildCatalogSearchModal } from '../../modules/catalog/builders/CatalogAdminBuilders';
import { showCustomerOrder } from '../orders';
import {
  getCatalogCategoryById,
} from '../../modules/catalog/services/CatalogCategoryService';
import {
  getPackView,
  listCategoriesWithPacks,
  listFeaturedPacks,
  listVisiblePacks,
} from '../../modules/catalog/services/CatalogService';
import { addToCart, getActiveCart } from '../../modules/catalog/services/CartService';
import { createOrderForPack, requireOrder } from '../../modules/catalog/services/OrderService';
import { applyBoosterDiscount } from '../../modules/booster/services/BoosterDiscountService';
import { announceNewOrder } from '../../modules/catalog/services/OrderNotificationService';
import { ALL_CATEGORIES_VALUE } from '../../modules/catalog/types/catalog';
import { sanitizeConfigText } from '../../utils/sanitize';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';
import {
  beginPanel,
  paginate,
  parseIndex,
  parsePage,
  readSelectedValue,
  requireGuildContext,
  showPanel,
  type ComponentSource,
} from './shared';

/**
 * Loja do cliente.
 *
 * PRINCIPIOS APLICADOS AQUI
 *  - O customId NUNCA autoriza: todo pack e recarregado do banco e revalidado
 *    (existe, ativo, categoria ativa, preco valido) antes de qualquer acao.
 *  - A navegacao acontece na MESMA mensagem sempre que possivel: a galeria
 *    atualiza o card em vez de despejar uma mensagem por imagem.
 *  - NAO existe campo de cupom em lugar nenhum desta tela. Desconto e decisao
 *    comercial da equipe, tomada no painel do pedido.
 */

/** Renderiza a home da loja. */
async function renderHome(
  interaction: ComponentSource,
  guildId: string,
  notice?: string,
): Promise<void> {
  const [config, categories, featured, visible] = await Promise.all([
    getGuildConfig(guildId),
    listCategoriesWithPacks(guildId),
    listFeaturedPacks(guildId),
    listVisiblePacks(guildId),
  ]);

  await showPanel(
    interaction,
    buildCatalogHome({
      storeName: config.storeName,
      description: config.catalogDescription,
      categories,
      featured,
      totalPacks: visible.length,
      ...(notice !== undefined ? { notice } : {}),
    }),
  );
}

/** Renderiza a listagem de uma categoria (ou de todos os produtos). */
async function renderCategory(
  interaction: ComponentSource,
  guildId: string,
  categoryValue: string,
  page: number,
): Promise<void> {
  const categoryId = categoryValue === ALL_CATEGORIES_VALUE ? null : categoryValue;

  // Categoria vinda do componente e revalidada: ela pode ter sido desativada
  // entre a montagem do menu e o clique.
  const category = categoryId === null ? null : await getCatalogCategoryById(guildId, categoryId);
  if (categoryId !== null && (category === null || !category.enabled)) {
    await renderHome(interaction, guildId, '⚠️ Esta categoria nao esta mais disponivel.');
    return;
  }

  const [categories, packs] = await Promise.all([
    listCategoriesWithPacks(guildId),
    listVisiblePacks(guildId, { categoryId }),
  ]);

  const pageData = paginate(packs, page, BUSINESS_LIMITS.CATALOG_PAGE_SIZE);

  await showPanel(
    interaction,
    buildCatalogList({
      categories,
      category,
      packs: pageData.items,
      page: pageData.page,
      totalPages: pageData.totalPages,
      total: pageData.total,
    }),
  );
}

/** Renderiza o card do pack com a imagem indicada. */
async function renderPack(
  interaction: ComponentSource,
  guildId: string,
  customerId: string,
  packId: string,
  imageIndex: number,
  notice?: string,
): Promise<void> {
  const view = await getPackView(guildId, packId);
  if (view === null) {
    await renderHome(interaction, guildId, '⚠️ Este pack nao existe mais no catalogo.');
    return;
  }

  const cart = await getActiveCart(guildId, customerId);
  const inCart = cart?.items.some((item) => item.packId === packId) === true;

  await showPanel(
    interaction,
    buildPackCard({
      view,
      imageIndex,
      inCart,
      ...(notice !== undefined ? { notice } : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------

const homeButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.HOME,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    await beginPanel(interaction);
    await renderHome(interaction, guild.id);
  },
};

const categoryPageButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CATEGORY_PAGE,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const categoryValue = requireArg(parsed, 0, 'categoria');
    const page = parsePage(parsed.args[1]);

    await beginPanel(interaction);
    await renderCategory(interaction, guild.id, categoryValue, page);
  },
};

const packViewButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_VIEW,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const packId = requireArg(parsed, 0, 'pack');
    const index = parseIndex(parsed.args[1]);

    await beginPanel(interaction);
    await renderPack(interaction, guild.id, member.id, packId, index);
  },
};

/**
 * Galeria: imagem anterior.
 *
 * A navegacao e CIRCULAR — da primeira imagem, "anterior" leva a ultima. O
 * indice viaja no customId, entao a galeria continua funcionando depois de
 * qualquer restart: nao existe estado de sessao em memoria para se perder.
 */
const imagePrevButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.IMAGE_PREV,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    await navigateGallery(interaction, parsed, -1);
  },
};

const imageNextButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.IMAGE_NEXT,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    await navigateGallery(interaction, parsed, 1);
  },
};

async function navigateGallery(
  interaction: ButtonInteraction,
  parsed: ParsedCustomId,
  step: number,
): Promise<void> {
  const { guild, member } = requireGuildContext(interaction);
  const packId = requireArg(parsed, 0, 'pack');
  const current = parseIndex(parsed.args[1]);

  await beginPanel(interaction);

  const view = await getPackView(guild.id, packId);
  if (view === null) {
    await renderHome(interaction, guild.id, '⚠️ Este pack nao existe mais no catalogo.');
    return;
  }

  // O total vem do BANCO a cada clique: uma imagem removida no meio da
  // navegacao nao pode deixar o indice apontando para o vazio.
  const next = normalizeImageIndex(current + step, view.images.length);
  await renderPack(interaction, guild.id, member.id, packId, next);
}

const packInfoButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_INFO,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const packId = requireArg(parsed, 0, 'pack');

    await beginPanel(interaction);

    const view = await getPackView(guild.id, packId);
    if (view === null) {
      await renderHome(interaction, guild.id, '⚠️ Este pack nao existe mais no catalogo.');
      return;
    }

    await showPanel(interaction, buildPackDetails(view));
  },
};

const cartAddButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CART_ADD,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const packId = requireArg(parsed, 0, 'pack');

    await beginPanel(interaction);

    const result = await addToCart(guild.id, member.id, packId);
    const notice = result.alreadyPresent
      ? `${EMOJIS.CART} Este pack **ja esta** no seu carrinho (${result.itemCount} item(ns)).`
      : `${EMOJIS.APPROVE} Adicionado ao carrinho. Voce tem **${result.itemCount} item(ns)**.`;

    await renderPack(interaction, guild.id, member.id, packId, 0, notice);
  },
};

/** "Comprar Agora": confirma antes de criar o pedido. */
const buyButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.BUY,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const packId = requireArg(parsed, 0, 'pack');

    await beginPanel(interaction);

    const view = await getPackView(guild.id, packId);
    if (view === null || !view.pack.enabled) {
      await renderHome(interaction, guild.id, '⚠️ Este pack nao esta mais disponivel.');
      return;
    }

    await showPanel(
      interaction,
      buildBuyNowConfirm({
        packId,
        packName: view.pack.name,
        price: view.pack.price,
        buyButton: new ButtonBuilder()
          .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.BUY_CONFIRM, packId))
          .setEmoji(EMOJIS.APPROVE)
          .setLabel('Confirmar')
          .setStyle(ButtonStyle.Secondary),
        backButton: new ButtonBuilder()
          .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PACK_VIEW, packId, '0'))
          .setEmoji(EMOJIS.BACK)
          .setLabel('Voltar')
          .setStyle(ButtonStyle.Secondary),
      }),
    );
  },
};

const buyConfirmButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.BUY_CONFIRM,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const packId = requireArg(parsed, 0, 'pack');

    await beginPanel(interaction);

    const { order, duplicated } = await createOrderForPack({
      guildId: guild.id,
      customerId: member.id,
      packId,
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

    // O aviso a equipe fica FORA da transacao do pedido: falha de Discord nao
    // pode desfazer uma compra ja registrada.
    if (!duplicated) await announceNewOrder(guild, order);

    const full = await requireOrder(guild.id, order.id);
    await showCustomerOrder(
      interaction,
      full,
      duplicated
        ? '⚠️ Voce ja tinha criado este pedido ha instantes. Ele esta abaixo.'
        : `${EMOJIS.APPROVE} Pedido criado. A equipe da Vook Store vai preparar o pagamento.`,
    );
  },
};

const searchButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.SEARCH,
  async handle(interaction: ButtonInteraction): Promise<void> {
    requireGuildContext(interaction);
    // `showModal` precisa ser a PRIMEIRA resposta da interacao: nada de defer.
    await interaction.showModal(buildCatalogSearchModal());
  },
};

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

const categorySelect: SelectHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CATEGORY_SELECT,
  async handle(interaction): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const value = readSelectedValue(interaction);

    await beginPanel(interaction);
    await renderCategory(interaction, guild.id, value, 1);
  },
};

const packSelect: SelectHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_SELECT,
  async handle(interaction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    const packId = readSelectedValue(interaction);

    await beginPanel(interaction);
    await renderPack(interaction, guild.id, member.id, packId, 0);
  },
};

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

const searchModal: ModalHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.SEARCH_MODAL,
  async handle(interaction: ModalSubmitInteraction): Promise<void> {
    const { guild } = requireGuildContext(interaction);
    const term = sanitizeConfigText(
      interaction.fields.getTextInputValue('termo'),
      BUSINESS_LIMITS.CATALOG_SEARCH_MAX,
    ).trim();

    if (term.length < BUSINESS_LIMITS.CATALOG_SEARCH_MIN) {
      await replyError(
        interaction,
        `Digite pelo menos ${BUSINESS_LIMITS.CATALOG_SEARCH_MIN} caracteres para buscar.`,
      );
      return;
    }

    // Modal sempre abre uma resposta nova: nao existe mensagem de origem para
    // atualizar, entao a busca responde de forma privada.
    await deferIfNeeded(interaction, { ephemeral: true });

    const [categories, packs] = await Promise.all([
      listCategoriesWithPacks(guild.id),
      listVisiblePacks(guild.id, { search: term }),
    ]);

    const pageData = paginate(packs, 1, BUSINESS_LIMITS.CATALOG_PAGE_SIZE);

    await showPanel(
      interaction,
      buildCatalogList({
        categories,
        category: null,
        packs: pageData.items,
        page: pageData.page,
        totalPages: pageData.totalPages,
        total: pageData.total,
        searchTerm: term,
      }),
    );
  },
};

/** Busca disparada pelo comando `/catalogo buscar`. */
export async function renderSearchResults(
  interaction: Parameters<typeof showPanel>[0],
  guildId: string,
  rawTerm: string,
): Promise<void> {
  const term = sanitizeConfigText(rawTerm, BUSINESS_LIMITS.CATALOG_SEARCH_MAX).trim();
  if (term.length < BUSINESS_LIMITS.CATALOG_SEARCH_MIN) {
    throw new ValidationError(`Termo de busca curto: "${term}"`, {
      userMessage: `Digite pelo menos ${BUSINESS_LIMITS.CATALOG_SEARCH_MIN} caracteres para buscar.`,
    });
  }

  const [categories, packs] = await Promise.all([
    listCategoriesWithPacks(guildId),
    listVisiblePacks(guildId, { search: term }),
  ]);

  const pageData = paginate(packs, 1, BUSINESS_LIMITS.CATALOG_PAGE_SIZE);

  await showPanel(
    interaction,
    buildCatalogList({
      categories,
      category: null,
      packs: pageData.items,
      page: pageData.page,
      totalPages: pageData.totalPages,
      total: pageData.total,
      searchTerm: term,
    }),
  );
}

/** Home renderizada a partir de um comando (sem componente de origem). */
export async function renderHomeForCommand(
  interaction: Parameters<typeof showPanel>[0],
  guildId: string,
): Promise<void> {
  const [config, categories, featured, visible] = await Promise.all([
    getGuildConfig(guildId),
    listCategoriesWithPacks(guildId),
    listFeaturedPacks(guildId),
    listVisiblePacks(guildId),
  ]);

  await showPanel(
    interaction,
    buildCatalogHome({
      storeName: config.storeName,
      description: config.catalogDescription,
      categories,
      featured,
      totalPacks: visible.length,
    }),
  );
}

export const catalogCustomerButtons: ButtonHandler[] = [
  homeButton,
  categoryPageButton,
  packViewButton,
  imagePrevButton,
  imageNextButton,
  packInfoButton,
  cartAddButton,
  buyButton,
  buyConfirmButton,
  searchButton,
];

export const catalogCustomerSelects: SelectHandler[] = [categorySelect, packSelect];

export const catalogCustomerModals: ModalHandler[] = [searchModal];
