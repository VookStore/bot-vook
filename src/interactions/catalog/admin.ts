import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  RepliableInteraction,
} from 'discord.js';

import { deferIfNeeded } from '../../components/reply';
import { EMOJIS } from '../../constants/branding';
import {
  CATALOG_ACTION,
  NAMESPACE,
  requireArg,
  type ParsedCustomId,
} from '../../constants/customIds';
import { DISCORD_LIMITS } from '../../constants/limits';
import { ValidationError } from '../../core/errors';
import { LOCK_NAMESPACE, locks } from '../../core/locks/LockService';
import {
  assertCanManageCatalog,
  assertCanManageCatalogCategories,
} from '../../core/permissions/PermissionService';
import {
  CATEGORY_FIELD,
  PACK_FIELD,
  buildCatalogAdminPanel,
  buildCategoryAdminPanel,
  buildCategoryChooserPanel,
  buildCategoryModal,
  buildCategoryPickerPanel,
  buildImageModal,
  buildImagePickerPanel,
  buildPackDetailsModal,
  buildPackImagesPanel,
  buildPackModal,
  buildOrderChannelPanel,
  buildPackPickerPanel,
  buildPackPriceModal,
} from '../../modules/catalog/builders/CatalogAdminBuilders';
import {
  createCategoryFromInput,
  deleteCategory,
  getCatalogCategories,
  moveCategory,
  requireCatalogCategory,
  toggleCategory,
  updateCategoryFromInput,
} from '../../modules/catalog/services/CatalogCategoryService';
import {
  addImage,
  changeCover,
  listImages,
  moveImage,
  removeImage,
} from '../../modules/catalog/services/CatalogImageService';
import {
  changePackCategory,
  changePackPrice,
  createPackFromInput,
  deletePack,
  getPackDetails,
  getPacks,
  invalidatePackImages,
  replaceDetails,
  requirePack,
  togglePack,
  togglePackFeatured,
  updatePackFromInput,
} from '../../modules/catalog/services/CatalogService';
import { countImagesByPack } from '../../modules/catalog/repositories/PackImageRepository';
import { refreshCatalogPanel } from '../../modules/catalog/services/CatalogPanelService';
import {
  getGuildConfig,
  updateGuildConfig,
} from '../../modules/configuration/services/GuildConfigService';
import {
  CATEGORY_PICK_KIND,
  IMAGE_PICK_KIND,
  PACK_PICK_KIND,
  isCategoryPickKind,
  isImagePickKind,
  isPackPickKind,
  type CategoryPickKind,
  type ImagePickKind,
  type PackPickKind,
} from '../../modules/catalog/types/catalog';
import {
  hasSellablePrice,
  parseCategoryDescription,
  parseCategoryEmoji,
  parseCategoryName,
  parseImageAlt,
  parseImageUrl,
  parseLongDescription,
  parsePackDetails,
  parsePackName,
  parsePackPrice,
  parsePackSku,
  parseShortDescription,
} from '../../modules/catalog/validators/packValidators';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';
import { fetchChannelSafe, isSendableTextChannel } from '../../utils/discord';
import {
  beginPanel,
  optionalField,
  paginate,
  parsePage,
  readSelectedValue,
  requireGuildContext,
  showPanel,
  type ComponentSource,
} from './shared';

/**
 * Administracao do catalogo.
 *
 * REGRAS APLICADAS EM TODOS OS HANDLERS
 *  - `assertCanManageCatalog` roda em CADA acao, com o membro real: o customId
 *    nunca autoriza nada e um id copiado nao vira permissao.
 *  - Escrita roda sob `LOCK_NAMESPACE.CATALOG_ADMIN` por guild, o que impede
 *    duplo clique e edicoes simultaneas do mesmo painel.
 *  - Auditoria, cache e transacoes ficam nos services, que sao quem grava.
 *  - Depois de cada mudanca o painel publico do catalogo e reconstruido, para
 *    a vitrine nunca ficar mostrando um produto que nao existe mais.
 */

const LOCK_BUSY_MESSAGE =
  'Outra alteracao do catalogo esta em andamento neste servidor. Aguarde alguns segundos.';

/** Reconstroi o painel publico depois de uma mudanca. Nunca lanca. */
async function refreshPublicCatalog(
  interaction: RepliableInteraction,
): Promise<void> {
  const { guild } = requireGuildContext(interaction);
  await refreshCatalogPanel(guild).catch(() => undefined);
}

/** Painel administrativo com o diagnostico do catalogo. */
async function renderAdminPanel(
  interaction: RepliableInteraction,
  guildId: string,
  notice?: string,
): Promise<void> {
  const [packs, categories] = await Promise.all([
    getPacks(guildId),
    getCatalogCategories(guildId),
  ]);

  const alive = packs.filter((pack) => pack.deletedAt === null);

  // Uma consulta agregada para TODOS os packs: contar imagem a imagem seria
  // uma consulta por produto toda vez que o painel abrisse.
  const imageCounts = await countImagesByPack(alive.map((pack) => pack.id));

  await showPanel(
    interaction,
    buildCatalogAdminPanel(
      {
        packs: alive.length,
        activePacks: alive.filter((pack) => pack.enabled).length,
        featured: alive.filter((pack) => pack.featured).length,
        categories: categories.length,
        packsWithoutImage: alive.filter((pack) => (imageCounts.get(pack.id) ?? 0) === 0).length,
        packsWithoutPrice: alive.filter((pack) => !hasSellablePrice(pack.price)).length,
      },
      notice === undefined ? {} : { notice },
    ),
  );
}

/** Lista de packs vivos, na ordem oficial da vitrine. */
async function livePacks(guildId: string): Promise<Awaited<ReturnType<typeof getPacks>>> {
  return (await getPacks(guildId)).filter((pack) => pack.deletedAt === null);
}

async function renderPackPicker(
  interaction: ComponentSource,
  guildId: string,
  kind: PackPickKind,
  page: number,
): Promise<void> {
  const packs = await livePacks(guildId);
  const pageData = paginate(packs, page, DISCORD_LIMITS.SELECT_OPTIONS);

  await showPanel(
    interaction,
    buildPackPickerPanel({
      kind,
      packs: pageData.items,
      page: pageData.page,
      totalPages: pageData.totalPages,
      total: pageData.total,
    }),
  );
}

async function renderImagesPanel(
  interaction: RepliableInteraction,
  guildId: string,
  packId: string,
  notice?: string,
): Promise<void> {
  const pack = await requirePack(guildId, packId);
  const images = await listImages(packId);
  await showPanel(
    interaction,
    buildPackImagesPanel(pack, images, notice === undefined ? {} : { notice }),
  );
}

async function renderCategoryPanel(
  interaction: RepliableInteraction,
  guildId: string,
  notice?: string,
): Promise<void> {
  const categories = await getCatalogCategories(guildId);
  await showPanel(
    interaction,
    buildCategoryAdminPanel(categories, notice === undefined ? {} : { notice }),
  );
}

function requirePackKind(raw: string): PackPickKind {
  if (!isPackPickKind(raw)) {
    throw new ValidationError(`Acao de pack desconhecida: ${raw}`, {
      userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
    });
  }
  return raw;
}

function requireImageKind(raw: string): ImagePickKind {
  if (!isImagePickKind(raw)) {
    throw new ValidationError(`Acao de imagem desconhecida: ${raw}`, {
      userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
    });
  }
  return raw;
}

function requireCategoryKind(raw: string): CategoryPickKind {
  if (!isCategoryPickKind(raw)) {
    throw new ValidationError(`Acao de categoria desconhecida: ${raw}`, {
      userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
    });
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------

const adminButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.ADMIN,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);
    await beginPanel(interaction);
    await renderAdminPanel(interaction, guild.id);
  },
};

const packNewButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_NEW,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);
    await beginPanel(interaction);

    const categories = await getCatalogCategories(guild.id);
    await showPanel(
      interaction,
      buildCategoryChooserPanel({
        categories,
        action: CATALOG_ACTION.PACK_NEW_CATEGORY,
        title: 'VOOK STORE — NOVO PACK',
        instruction: 'Escolha a categoria do novo pack. O formulario abre em seguida.',
      }),
    );
  },
};

const packPickButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_PICK,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const kind = requirePackKind(requireArg(parsed, 0, 'acao'));
    const page = parsePage(parsed.args[1]);

    await beginPanel(interaction);
    await renderPackPicker(interaction, guild.id, kind, page);
  },
};

const imagesPanelButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.IMAGES_PANEL,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);
    const packId = requireArg(parsed, 0, 'pack');

    await beginPanel(interaction);
    await renderImagesPanel(interaction, guild.id, packId);
  },
};

const imageAddButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.IMAGE_ADD,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);
    const packId = requireArg(parsed, 0, 'pack');

    const pack = await requirePack(guild.id, packId);
    await interaction.showModal(buildImageModal(pack));
  },
};

const imagePickButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.IMAGE_PICK,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const kind = requireImageKind(requireArg(parsed, 0, 'acao'));
    const packId = requireArg(parsed, 1, 'pack');

    await beginPanel(interaction);

    const pack = await requirePack(guild.id, packId);
    const images = await listImages(packId);
    if (images.length === 0) {
      await renderImagesPanel(interaction, guild.id, packId, '⚠️ Este pack nao possui imagens.');
      return;
    }

    await showPanel(interaction, buildImagePickerPanel(pack, images, kind));
  },
};

const categoriesButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CATEGORIES,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalogCategories(member);
    await beginPanel(interaction);
    await renderCategoryPanel(interaction, guild.id);
  },
};

const categoryNewButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CATEGORY_NEW,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { member } = requireGuildContext(interaction);
    assertCanManageCatalogCategories(member);
    await interaction.showModal(buildCategoryModal('create'));
  },
};

const orderChannelButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.ORDER_CHANNEL,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);
    await beginPanel(interaction);

    const config = await getGuildConfig(guild.id);
    await showPanel(interaction, buildOrderChannelPanel(config, guild));
  },
};

const categoryPickButton: ButtonHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CATEGORY_PICK,
  async handle(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalogCategories(member);

    const kind = requireCategoryKind(requireArg(parsed, 0, 'acao'));

    await beginPanel(interaction);
    const categories = await getCatalogCategories(guild.id);
    await showPanel(interaction, buildCategoryPickerPanel(categories, kind));
  },
};

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

const packNewCategorySelect: SelectHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_NEW_CATEGORY,
  async handle(interaction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const categoryId = readSelectedValue(interaction);
    await requireCatalogCategory(guild.id, categoryId);

    await interaction.showModal(buildPackModal('create', { categoryId }));
  },
};

/**
 * Roteia a acao administrativa escolhida no seletor de packs.
 * Cada ramo revalida o pack no banco antes de escrever.
 */
const packPickSelect: SelectHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_PICK_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const kind = requirePackKind(requireArg(parsed, 0, 'acao'));
    const packId = readSelectedValue(interaction);
    const guildId = guild.id;

    // Modal precisa ser a primeira resposta: estes ramos NAO podem deferir.
    if (kind === PACK_PICK_KIND.EDIT) {
      const pack = await requirePack(guildId, packId);
      await interaction.showModal(buildPackModal('edit', { pack }));
      return;
    }
    if (kind === PACK_PICK_KIND.PRICE) {
      const pack = await requirePack(guildId, packId);
      await interaction.showModal(buildPackPriceModal(pack));
      return;
    }
    if (kind === PACK_PICK_KIND.DETAILS) {
      const pack = await requirePack(guildId, packId);
      const details = await getPackDetails(packId);
      await interaction.showModal(buildPackDetailsModal(pack, details));
      return;
    }

    await beginPanel(interaction);

    if (kind === PACK_PICK_KIND.IMAGES) {
      await renderImagesPanel(interaction, guildId, packId);
      return;
    }

    if (kind === PACK_PICK_KIND.CATEGORY) {
      const categories = await getCatalogCategories(guildId);
      await showPanel(
        interaction,
        buildCategoryChooserPanel({
          categories,
          action: CATALOG_ACTION.PACK_CATEGORY_SELECT,
          title: 'VOOK STORE — MOVER CATEGORIA',
          instruction: 'Escolha a nova categoria deste pack.',
          args: [packId],
        }),
      );
      return;
    }

    const notice = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guildId,
      async () => {
        if (kind === PACK_PICK_KIND.TOGGLE) {
          const pack = await togglePack(guildId, member.id, packId);
          return pack.enabled
            ? `${EMOJIS.ENABLE} **${pack.name}** ativado e visivel na vitrine.`
            : `${EMOJIS.DISABLE} **${pack.name}** desativado (saiu da vitrine e dos carrinhos).`;
        }
        if (kind === PACK_PICK_KIND.FEATURE) {
          const pack = await togglePackFeatured(guildId, member.id, packId);
          return pack.featured
            ? `${EMOJIS.FEATURED} **${pack.name}** agora aparece em destaque.`
            : `**${pack.name}** saiu dos destaques.`;
        }
        const pack = await deletePack(guildId, member.id, packId);
        return `${EMOJIS.DELETE} **${pack.name}** excluido. Os pedidos historicos continuam intactos.`;
      },
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshPublicCatalog(interaction);
    await renderAdminPanel(interaction, guildId, notice);
  },
};

const packCategorySelect: SelectHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_CATEGORY_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const packId = requireArg(parsed, 0, 'pack');
    const categoryId = readSelectedValue(interaction);

    await beginPanel(interaction);

    const pack = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      () => changePackCategory(guild.id, member.id, packId, categoryId),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshPublicCatalog(interaction);
    await renderAdminPanel(
      interaction,
      guild.id,
      `${EMOJIS.APPROVE} **${pack.name}** movido de categoria.`,
    );
  },
};

const imagePickSelect: SelectHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.IMAGE_PICK_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const kind = requireImageKind(requireArg(parsed, 0, 'acao'));
    const packId = requireArg(parsed, 1, 'pack');
    const imageId = readSelectedValue(interaction);

    await beginPanel(interaction);

    const notice = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      async () => {
        if (kind === IMAGE_PICK_KIND.REMOVE) {
          await removeImage(guild.id, member.id, packId, imageId);
          return `${EMOJIS.DELETE} Imagem removida e ordem renumerada.`;
        }
        if (kind === IMAGE_PICK_KIND.COVER) {
          await changeCover(guild.id, member.id, packId, imageId);
          return `${EMOJIS.FEATURED} Capa do pack atualizada.`;
        }
        await moveImage(
          guild.id,
          member.id,
          packId,
          imageId,
          kind === IMAGE_PICK_KIND.UP ? 'up' : 'down',
        );
        return `${EMOJIS.APPROVE} Ordem das imagens atualizada.`;
      },
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    invalidatePackImages(packId);
    await renderImagesPanel(interaction, guild.id, packId, notice);
  },
};

const categoryPickSelect: SelectHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CATEGORY_PICK_SELECT,
  async handle(interaction, parsed): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalogCategories(member);

    const kind = requireCategoryKind(requireArg(parsed, 0, 'acao'));
    const categoryId = readSelectedValue(interaction);
    const guildId = guild.id;

    if (kind === CATEGORY_PICK_KIND.EDIT) {
      const category = await requireCatalogCategory(guildId, categoryId);
      await interaction.showModal(buildCategoryModal('edit', category));
      return;
    }

    await beginPanel(interaction);

    const notice = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guildId,
      async () => {
        if (kind === CATEGORY_PICK_KIND.TOGGLE) {
          const category = await toggleCategory(guildId, member.id, categoryId);
          return category.enabled
            ? `${EMOJIS.ENABLE} Categoria **${category.name}** ativada.`
            : `${EMOJIS.DISABLE} Categoria **${category.name}** desativada.`;
        }
        if (kind === CATEGORY_PICK_KIND.DELETE) {
          const category = await deleteCategory(guildId, member.id, categoryId);
          return `${EMOJIS.DELETE} Categoria **${category.name}** excluida.`;
        }
        await moveCategory(
          guildId,
          member.id,
          categoryId,
          kind === CATEGORY_PICK_KIND.UP ? 'up' : 'down',
        );
        return `${EMOJIS.APPROVE} Ordem das categorias atualizada.`;
      },
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshPublicCatalog(interaction);
    await renderCategoryPanel(interaction, guildId, notice);
  },
};

/**
 * Define (ou limpa) o canal de pedidos.
 *
 * `setMinValues(0)` permite desmarcar: sem canal, o pedido continua existindo e
 * acessivel por `/pedidos gerenciar` — apenas deixa de ser anunciado.
 */
const orderChannelSelect: SelectHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.ORDER_CHANNEL_SELECT,
  async handle(interaction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    if (!interaction.isChannelSelectMenu()) {
      throw new ValidationError('Select de canal com tipo inesperado.', {
        userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
      });
    }

    const channelId = interaction.values[0] ?? null;
    await beginPanel(interaction);

    if (channelId !== null) {
      const channel = await fetchChannelSafe(guild, channelId);
      if (!isSendableTextChannel(channel)) {
        const config = await getGuildConfig(guild.id);
        await showPanel(interaction, buildOrderChannelPanel(config, guild));
        return;
      }
    }

    const updated = await updateGuildConfig(guild.id, { orderChannelId: channelId });
    await showPanel(interaction, buildOrderChannelPanel(updated, guild));
  },
};

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

const packNewModal: ModalHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_NEW_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const categoryId = requireArg(parsed, 0, 'categoria');
    const input = readPackForm(interaction);

    await beginModal(interaction);

    const pack = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      () =>
        createPackFromInput({
          guildId: guild.id,
          actorId: member.id,
          categoryId,
          ...input,
        }),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshPublicCatalog(interaction);
    await renderAdminPanel(
      interaction,
      guild.id,
      `${EMOJIS.APPROVE} Pack **${pack.name}** criado. Cadastre as imagens em "Imagens".`,
    );
  },
};

const packEditModal: ModalHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_EDIT_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const packId = requireArg(parsed, 0, 'pack');
    const input = readPackForm(interaction);

    await beginModal(interaction);

    const pack = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      () =>
        updatePackFromInput({
          guildId: guild.id,
          actorId: member.id,
          packId,
          ...input,
        }),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshPublicCatalog(interaction);
    await renderAdminPanel(interaction, guild.id, `${EMOJIS.APPROVE} Pack **${pack.name}** atualizado.`);
  },
};

const packPriceModal: ModalHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_PRICE_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const packId = requireArg(parsed, 0, 'pack');
    const price = parsePackPrice(interaction.fields.getTextInputValue(PACK_FIELD.PRICE));

    await beginModal(interaction);

    const pack = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      () => changePackPrice(guild.id, member.id, packId, price),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshPublicCatalog(interaction);
    await renderAdminPanel(
      interaction,
      guild.id,
      `${EMOJIS.PRICE} Preco de **${pack.name}** atualizado. Pedidos ja criados mantem o valor da compra.`,
    );
  },
};

const packDetailsModal: ModalHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.PACK_DETAILS_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const packId = requireArg(parsed, 0, 'pack');
    const details = parsePackDetails(optionalField(interaction, PACK_FIELD.DETAILS));

    await beginModal(interaction);

    await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      () => replaceDetails(guild.id, member.id, packId, details),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await renderAdminPanel(
      interaction,
      guild.id,
      `${EMOJIS.APPROVE} Ficha tecnica atualizada com ${details.length} item(ns).`,
    );
  },
};

const imageAddModal: ModalHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.IMAGE_ADD_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalog(member);

    const packId = requireArg(parsed, 0, 'pack');
    // `parseImageUrl` recusa qualquer coisa que nao seja https: javascript:,
    // data: e file: nunca chegam ao banco.
    const url = parseImageUrl(interaction.fields.getTextInputValue(PACK_FIELD.IMAGE_URL));
    const altText = parseImageAlt(optionalField(interaction, PACK_FIELD.IMAGE_ALT));

    await beginModal(interaction);

    await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      () => addImage(guild.id, member.id, packId, url, altText),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await renderImagesPanel(
      interaction,
      guild.id,
      packId,
      `${EMOJIS.APPROVE} Imagem adicionada ao fim da galeria.`,
    );
  },
};

const categoryNewModal: ModalHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CATEGORY_NEW_MODAL,
  async handle(interaction: ModalSubmitInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalogCategories(member);

    const terms = readCategoryForm(interaction);
    await beginModal(interaction);

    const { category, restored } = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      () => createCategoryFromInput(guild.id, member.id, terms),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshPublicCatalog(interaction);
    await renderCategoryPanel(
      interaction,
      guild.id,
      restored
        ? `${EMOJIS.APPROVE} Categoria **${category.name}** restaurada.`
        : `${EMOJIS.APPROVE} Categoria **${category.name}** criada.`,
    );
  },
};

const categoryEditModal: ModalHandler = {
  namespace: NAMESPACE.CATALOG,
  action: CATALOG_ACTION.CATEGORY_EDIT_MODAL,
  async handle(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageCatalogCategories(member);

    const categoryId = requireArg(parsed, 0, 'categoria');
    const terms = readCategoryForm(interaction);

    await beginModal(interaction);

    const category = await locks.withLock(
      LOCK_NAMESPACE.CATALOG_ADMIN,
      guild.id,
      () => updateCategoryFromInput(guild.id, member.id, categoryId, terms),
      { userMessage: LOCK_BUSY_MESSAGE },
    );

    await refreshPublicCatalog(interaction);
    await renderCategoryPanel(
      interaction,
      guild.id,
      `${EMOJIS.APPROVE} Categoria **${category.name}** atualizada.`,
    );
  },
};

/**
 * Modal enviado de um painel efemero: `deferUpdate` mantem a mesma mensagem e
 * evita abrir uma segunda tela para cada formulario preenchido.
 */
async function beginModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
    return;
  }
  await deferIfNeeded(interaction, { ephemeral: true });
}

function readPackForm(interaction: ModalSubmitInteraction): {
  name: string;
  sku: string | null;
  price: number;
  shortDescription: string | null;
  description: string | null;
} {
  return {
    name: parsePackName(interaction.fields.getTextInputValue(PACK_FIELD.NAME)),
    sku: parsePackSku(optionalField(interaction, PACK_FIELD.SKU)),
    price: parsePackPrice(interaction.fields.getTextInputValue(PACK_FIELD.PRICE)),
    shortDescription: parseShortDescription(optionalField(interaction, PACK_FIELD.SHORT)),
    description: parseLongDescription(optionalField(interaction, PACK_FIELD.DESCRIPTION)),
  };
}

function readCategoryForm(interaction: ModalSubmitInteraction): {
  name: string;
  description: string | null;
  emoji: string | null;
} {
  return {
    name: parseCategoryName(interaction.fields.getTextInputValue(CATEGORY_FIELD.NAME)),
    description: parseCategoryDescription(optionalField(interaction, CATEGORY_FIELD.DESCRIPTION)),
    emoji: parseCategoryEmoji(optionalField(interaction, CATEGORY_FIELD.EMOJI)),
  };
}

/** Painel administrativo aberto por comando (sem componente de origem). */
export async function renderAdminPanelForCommand(
  interaction: RepliableInteraction,
  guildId: string,
): Promise<void> {
  await renderAdminPanel(interaction, guildId);
}

export const catalogAdminButtons: ButtonHandler[] = [
  adminButton,
  packNewButton,
  packPickButton,
  imagesPanelButton,
  imageAddButton,
  imagePickButton,
  categoriesButton,
  categoryNewButton,
  categoryPickButton,
  orderChannelButton,
];

export const catalogAdminSelects: SelectHandler[] = [
  packNewCategorySelect,
  packPickSelect,
  packCategorySelect,
  imagePickSelect,
  categoryPickSelect,
  orderChannelSelect,
];

export const catalogAdminModals: ModalHandler[] = [
  packNewModal,
  packEditModal,
  packPriceModal,
  packDetailsModal,
  imageAddModal,
  categoryNewModal,
  categoryEditModal,
];
