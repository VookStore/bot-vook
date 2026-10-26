"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogAdminModals = exports.catalogAdminSelects = exports.catalogAdminButtons = void 0;
exports.renderAdminPanelForCommand = renderAdminPanelForCommand;
const reply_1 = require("../../components/reply");
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const limits_1 = require("../../constants/limits");
const errors_1 = require("../../core/errors");
const LockService_1 = require("../../core/locks/LockService");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const CatalogAdminBuilders_1 = require("../../modules/catalog/builders/CatalogAdminBuilders");
const CatalogCategoryService_1 = require("../../modules/catalog/services/CatalogCategoryService");
const CatalogImageService_1 = require("../../modules/catalog/services/CatalogImageService");
const CatalogService_1 = require("../../modules/catalog/services/CatalogService");
const PackImageRepository_1 = require("../../modules/catalog/repositories/PackImageRepository");
const CatalogPanelService_1 = require("../../modules/catalog/services/CatalogPanelService");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
const catalog_1 = require("../../modules/catalog/types/catalog");
const packValidators_1 = require("../../modules/catalog/validators/packValidators");
const discord_1 = require("../../utils/discord");
const shared_1 = require("./shared");
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
const LOCK_BUSY_MESSAGE = 'Outra alteracao do catalogo esta em andamento neste servidor. Aguarde alguns segundos.';
/** Reconstroi o painel publico depois de uma mudanca. Nunca lanca. */
async function refreshPublicCatalog(interaction) {
    const { guild } = (0, shared_1.requireGuildContext)(interaction);
    await (0, CatalogPanelService_1.refreshCatalogPanel)(guild).catch(() => undefined);
}
/** Painel administrativo com o diagnostico do catalogo. */
async function renderAdminPanel(interaction, guildId, notice) {
    const [packs, categories] = await Promise.all([
        (0, CatalogService_1.getPacks)(guildId),
        (0, CatalogCategoryService_1.getCatalogCategories)(guildId),
    ]);
    const alive = packs.filter((pack) => pack.deletedAt === null);
    // Uma consulta agregada para TODOS os packs: contar imagem a imagem seria
    // uma consulta por produto toda vez que o painel abrisse.
    const imageCounts = await (0, PackImageRepository_1.countImagesByPack)(alive.map((pack) => pack.id));
    await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildCatalogAdminPanel)({
        packs: alive.length,
        activePacks: alive.filter((pack) => pack.enabled).length,
        featured: alive.filter((pack) => pack.featured).length,
        categories: categories.length,
        packsWithoutImage: alive.filter((pack) => (imageCounts.get(pack.id) ?? 0) === 0).length,
        packsWithoutPrice: alive.filter((pack) => !(0, packValidators_1.hasSellablePrice)(pack.price)).length,
    }, notice === undefined ? {} : { notice }));
}
/** Lista de packs vivos, na ordem oficial da vitrine. */
async function livePacks(guildId) {
    return (await (0, CatalogService_1.getPacks)(guildId)).filter((pack) => pack.deletedAt === null);
}
async function renderPackPicker(interaction, guildId, kind, page) {
    const packs = await livePacks(guildId);
    const pageData = (0, shared_1.paginate)(packs, page, limits_1.DISCORD_LIMITS.SELECT_OPTIONS);
    await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildPackPickerPanel)({
        kind,
        packs: pageData.items,
        page: pageData.page,
        totalPages: pageData.totalPages,
        total: pageData.total,
    }));
}
async function renderImagesPanel(interaction, guildId, packId, notice) {
    const pack = await (0, CatalogService_1.requirePack)(guildId, packId);
    const images = await (0, CatalogImageService_1.listImages)(packId);
    await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildPackImagesPanel)(pack, images, notice === undefined ? {} : { notice }));
}
async function renderCategoryPanel(interaction, guildId, notice) {
    const categories = await (0, CatalogCategoryService_1.getCatalogCategories)(guildId);
    await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildCategoryAdminPanel)(categories, notice === undefined ? {} : { notice }));
}
function requirePackKind(raw) {
    if (!(0, catalog_1.isPackPickKind)(raw)) {
        throw new errors_1.ValidationError(`Acao de pack desconhecida: ${raw}`, {
            userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
        });
    }
    return raw;
}
function requireImageKind(raw) {
    if (!(0, catalog_1.isImagePickKind)(raw)) {
        throw new errors_1.ValidationError(`Acao de imagem desconhecida: ${raw}`, {
            userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
        });
    }
    return raw;
}
function requireCategoryKind(raw) {
    if (!(0, catalog_1.isCategoryPickKind)(raw)) {
        throw new errors_1.ValidationError(`Acao de categoria desconhecida: ${raw}`, {
            userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
        });
    }
    return raw;
}
// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------
const adminButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.ADMIN,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        await (0, shared_1.beginPanel)(interaction);
        await renderAdminPanel(interaction, guild.id);
    },
};
const packNewButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_NEW,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        await (0, shared_1.beginPanel)(interaction);
        const categories = await (0, CatalogCategoryService_1.getCatalogCategories)(guild.id);
        await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildCategoryChooserPanel)({
            categories,
            action: customIds_1.CATALOG_ACTION.PACK_NEW_CATEGORY,
            title: 'VOOK STORE — NOVO PACK',
            instruction: 'Escolha a categoria do novo pack. O formulario abre em seguida.',
        }));
    },
};
const packPickButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_PICK,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const kind = requirePackKind((0, customIds_1.requireArg)(parsed, 0, 'acao'));
        const page = (0, shared_1.parsePage)(parsed.args[1]);
        await (0, shared_1.beginPanel)(interaction);
        await renderPackPicker(interaction, guild.id, kind, page);
    },
};
const imagesPanelButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.IMAGES_PANEL,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        await (0, shared_1.beginPanel)(interaction);
        await renderImagesPanel(interaction, guild.id, packId);
    },
};
const imageAddButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.IMAGE_ADD,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        const pack = await (0, CatalogService_1.requirePack)(guild.id, packId);
        await interaction.showModal((0, CatalogAdminBuilders_1.buildImageModal)(pack));
    },
};
const imagePickButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.IMAGE_PICK,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const kind = requireImageKind((0, customIds_1.requireArg)(parsed, 0, 'acao'));
        const packId = (0, customIds_1.requireArg)(parsed, 1, 'pack');
        await (0, shared_1.beginPanel)(interaction);
        const pack = await (0, CatalogService_1.requirePack)(guild.id, packId);
        const images = await (0, CatalogImageService_1.listImages)(packId);
        if (images.length === 0) {
            await renderImagesPanel(interaction, guild.id, packId, '⚠️ Este pack nao possui imagens.');
            return;
        }
        await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildImagePickerPanel)(pack, images, kind));
    },
};
const categoriesButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CATEGORIES,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalogCategories)(member);
        await (0, shared_1.beginPanel)(interaction);
        await renderCategoryPanel(interaction, guild.id);
    },
};
const categoryNewButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CATEGORY_NEW,
    async handle(interaction) {
        const { member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalogCategories)(member);
        await interaction.showModal((0, CatalogAdminBuilders_1.buildCategoryModal)('create'));
    },
};
const orderChannelButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.ORDER_CHANNEL,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        await (0, shared_1.beginPanel)(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildOrderChannelPanel)(config, guild));
    },
};
const categoryPickButton = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CATEGORY_PICK,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalogCategories)(member);
        const kind = requireCategoryKind((0, customIds_1.requireArg)(parsed, 0, 'acao'));
        await (0, shared_1.beginPanel)(interaction);
        const categories = await (0, CatalogCategoryService_1.getCatalogCategories)(guild.id);
        await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildCategoryPickerPanel)(categories, kind));
    },
};
// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------
const packNewCategorySelect = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_NEW_CATEGORY,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const categoryId = (0, shared_1.readSelectedValue)(interaction);
        await (0, CatalogCategoryService_1.requireCatalogCategory)(guild.id, categoryId);
        await interaction.showModal((0, CatalogAdminBuilders_1.buildPackModal)('create', { categoryId }));
    },
};
/**
 * Roteia a acao administrativa escolhida no seletor de packs.
 * Cada ramo revalida o pack no banco antes de escrever.
 */
const packPickSelect = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_PICK_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const kind = requirePackKind((0, customIds_1.requireArg)(parsed, 0, 'acao'));
        const packId = (0, shared_1.readSelectedValue)(interaction);
        const guildId = guild.id;
        // Modal precisa ser a primeira resposta: estes ramos NAO podem deferir.
        if (kind === catalog_1.PACK_PICK_KIND.EDIT) {
            const pack = await (0, CatalogService_1.requirePack)(guildId, packId);
            await interaction.showModal((0, CatalogAdminBuilders_1.buildPackModal)('edit', { pack }));
            return;
        }
        if (kind === catalog_1.PACK_PICK_KIND.PRICE) {
            const pack = await (0, CatalogService_1.requirePack)(guildId, packId);
            await interaction.showModal((0, CatalogAdminBuilders_1.buildPackPriceModal)(pack));
            return;
        }
        if (kind === catalog_1.PACK_PICK_KIND.DETAILS) {
            const pack = await (0, CatalogService_1.requirePack)(guildId, packId);
            const details = await (0, CatalogService_1.getPackDetails)(packId);
            await interaction.showModal((0, CatalogAdminBuilders_1.buildPackDetailsModal)(pack, details));
            return;
        }
        await (0, shared_1.beginPanel)(interaction);
        if (kind === catalog_1.PACK_PICK_KIND.IMAGES) {
            await renderImagesPanel(interaction, guildId, packId);
            return;
        }
        if (kind === catalog_1.PACK_PICK_KIND.CATEGORY) {
            const categories = await (0, CatalogCategoryService_1.getCatalogCategories)(guildId);
            await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildCategoryChooserPanel)({
                categories,
                action: customIds_1.CATALOG_ACTION.PACK_CATEGORY_SELECT,
                title: 'VOOK STORE — MOVER CATEGORIA',
                instruction: 'Escolha a nova categoria deste pack.',
                args: [packId],
            }));
            return;
        }
        const notice = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guildId, async () => {
            if (kind === catalog_1.PACK_PICK_KIND.TOGGLE) {
                const pack = await (0, CatalogService_1.togglePack)(guildId, member.id, packId);
                return pack.enabled
                    ? `${branding_1.EMOJIS.ENABLE} **${pack.name}** ativado e visivel na vitrine.`
                    : `${branding_1.EMOJIS.DISABLE} **${pack.name}** desativado (saiu da vitrine e dos carrinhos).`;
            }
            if (kind === catalog_1.PACK_PICK_KIND.FEATURE) {
                const pack = await (0, CatalogService_1.togglePackFeatured)(guildId, member.id, packId);
                return pack.featured
                    ? `${branding_1.EMOJIS.FEATURED} **${pack.name}** agora aparece em destaque.`
                    : `**${pack.name}** saiu dos destaques.`;
            }
            const pack = await (0, CatalogService_1.deletePack)(guildId, member.id, packId);
            return `${branding_1.EMOJIS.DELETE} **${pack.name}** excluido. Os pedidos historicos continuam intactos.`;
        }, { userMessage: LOCK_BUSY_MESSAGE });
        await refreshPublicCatalog(interaction);
        await renderAdminPanel(interaction, guildId, notice);
    },
};
const packCategorySelect = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_CATEGORY_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        const categoryId = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        const pack = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, () => (0, CatalogService_1.changePackCategory)(guild.id, member.id, packId, categoryId), { userMessage: LOCK_BUSY_MESSAGE });
        await refreshPublicCatalog(interaction);
        await renderAdminPanel(interaction, guild.id, `${branding_1.EMOJIS.APPROVE} **${pack.name}** movido de categoria.`);
    },
};
const imagePickSelect = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.IMAGE_PICK_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const kind = requireImageKind((0, customIds_1.requireArg)(parsed, 0, 'acao'));
        const packId = (0, customIds_1.requireArg)(parsed, 1, 'pack');
        const imageId = (0, shared_1.readSelectedValue)(interaction);
        await (0, shared_1.beginPanel)(interaction);
        const notice = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, async () => {
            if (kind === catalog_1.IMAGE_PICK_KIND.REMOVE) {
                await (0, CatalogImageService_1.removeImage)(guild.id, member.id, packId, imageId);
                return `${branding_1.EMOJIS.DELETE} Imagem removida e ordem renumerada.`;
            }
            if (kind === catalog_1.IMAGE_PICK_KIND.COVER) {
                await (0, CatalogImageService_1.changeCover)(guild.id, member.id, packId, imageId);
                return `${branding_1.EMOJIS.FEATURED} Capa do pack atualizada.`;
            }
            await (0, CatalogImageService_1.moveImage)(guild.id, member.id, packId, imageId, kind === catalog_1.IMAGE_PICK_KIND.UP ? 'up' : 'down');
            return `${branding_1.EMOJIS.APPROVE} Ordem das imagens atualizada.`;
        }, { userMessage: LOCK_BUSY_MESSAGE });
        (0, CatalogService_1.invalidatePackImages)(packId);
        await renderImagesPanel(interaction, guild.id, packId, notice);
    },
};
const categoryPickSelect = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CATEGORY_PICK_SELECT,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalogCategories)(member);
        const kind = requireCategoryKind((0, customIds_1.requireArg)(parsed, 0, 'acao'));
        const categoryId = (0, shared_1.readSelectedValue)(interaction);
        const guildId = guild.id;
        if (kind === catalog_1.CATEGORY_PICK_KIND.EDIT) {
            const category = await (0, CatalogCategoryService_1.requireCatalogCategory)(guildId, categoryId);
            await interaction.showModal((0, CatalogAdminBuilders_1.buildCategoryModal)('edit', category));
            return;
        }
        await (0, shared_1.beginPanel)(interaction);
        const notice = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guildId, async () => {
            if (kind === catalog_1.CATEGORY_PICK_KIND.TOGGLE) {
                const category = await (0, CatalogCategoryService_1.toggleCategory)(guildId, member.id, categoryId);
                return category.enabled
                    ? `${branding_1.EMOJIS.ENABLE} Categoria **${category.name}** ativada.`
                    : `${branding_1.EMOJIS.DISABLE} Categoria **${category.name}** desativada.`;
            }
            if (kind === catalog_1.CATEGORY_PICK_KIND.DELETE) {
                const category = await (0, CatalogCategoryService_1.deleteCategory)(guildId, member.id, categoryId);
                return `${branding_1.EMOJIS.DELETE} Categoria **${category.name}** excluida.`;
            }
            await (0, CatalogCategoryService_1.moveCategory)(guildId, member.id, categoryId, kind === catalog_1.CATEGORY_PICK_KIND.UP ? 'up' : 'down');
            return `${branding_1.EMOJIS.APPROVE} Ordem das categorias atualizada.`;
        }, { userMessage: LOCK_BUSY_MESSAGE });
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
const orderChannelSelect = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.ORDER_CHANNEL_SELECT,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        if (!interaction.isChannelSelectMenu()) {
            throw new errors_1.ValidationError('Select de canal com tipo inesperado.', {
                userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
            });
        }
        const channelId = interaction.values[0] ?? null;
        await (0, shared_1.beginPanel)(interaction);
        if (channelId !== null) {
            const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
            if (!(0, discord_1.isSendableTextChannel)(channel)) {
                const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
                await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildOrderChannelPanel)(config, guild));
                return;
            }
        }
        const updated = await (0, GuildConfigService_1.updateGuildConfig)(guild.id, { orderChannelId: channelId });
        await (0, shared_1.showPanel)(interaction, (0, CatalogAdminBuilders_1.buildOrderChannelPanel)(updated, guild));
    },
};
// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
const packNewModal = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_NEW_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const categoryId = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        const input = readPackForm(interaction);
        await beginModal(interaction);
        const pack = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, () => (0, CatalogService_1.createPackFromInput)({
            guildId: guild.id,
            actorId: member.id,
            categoryId,
            ...input,
        }), { userMessage: LOCK_BUSY_MESSAGE });
        await refreshPublicCatalog(interaction);
        await renderAdminPanel(interaction, guild.id, `${branding_1.EMOJIS.APPROVE} Pack **${pack.name}** criado. Cadastre as imagens em "Imagens".`);
    },
};
const packEditModal = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_EDIT_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        const input = readPackForm(interaction);
        await beginModal(interaction);
        const pack = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, () => (0, CatalogService_1.updatePackFromInput)({
            guildId: guild.id,
            actorId: member.id,
            packId,
            ...input,
        }), { userMessage: LOCK_BUSY_MESSAGE });
        await refreshPublicCatalog(interaction);
        await renderAdminPanel(interaction, guild.id, `${branding_1.EMOJIS.APPROVE} Pack **${pack.name}** atualizado.`);
    },
};
const packPriceModal = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_PRICE_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        const price = (0, packValidators_1.parsePackPrice)(interaction.fields.getTextInputValue(CatalogAdminBuilders_1.PACK_FIELD.PRICE));
        await beginModal(interaction);
        const pack = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, () => (0, CatalogService_1.changePackPrice)(guild.id, member.id, packId, price), { userMessage: LOCK_BUSY_MESSAGE });
        await refreshPublicCatalog(interaction);
        await renderAdminPanel(interaction, guild.id, `${branding_1.EMOJIS.PRICE} Preco de **${pack.name}** atualizado. Pedidos ja criados mantem o valor da compra.`);
    },
};
const packDetailsModal = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.PACK_DETAILS_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        const details = (0, packValidators_1.parsePackDetails)((0, shared_1.optionalField)(interaction, CatalogAdminBuilders_1.PACK_FIELD.DETAILS));
        await beginModal(interaction);
        await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, () => (0, CatalogService_1.replaceDetails)(guild.id, member.id, packId, details), { userMessage: LOCK_BUSY_MESSAGE });
        await renderAdminPanel(interaction, guild.id, `${branding_1.EMOJIS.APPROVE} Ficha tecnica atualizada com ${details.length} item(ns).`);
    },
};
const imageAddModal = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.IMAGE_ADD_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalog)(member);
        const packId = (0, customIds_1.requireArg)(parsed, 0, 'pack');
        // `parseImageUrl` recusa qualquer coisa que nao seja https: javascript:,
        // data: e file: nunca chegam ao banco.
        const url = (0, packValidators_1.parseImageUrl)(interaction.fields.getTextInputValue(CatalogAdminBuilders_1.PACK_FIELD.IMAGE_URL));
        const altText = (0, packValidators_1.parseImageAlt)((0, shared_1.optionalField)(interaction, CatalogAdminBuilders_1.PACK_FIELD.IMAGE_ALT));
        await beginModal(interaction);
        await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, () => (0, CatalogImageService_1.addImage)(guild.id, member.id, packId, url, altText), { userMessage: LOCK_BUSY_MESSAGE });
        await renderImagesPanel(interaction, guild.id, packId, `${branding_1.EMOJIS.APPROVE} Imagem adicionada ao fim da galeria.`);
    },
};
const categoryNewModal = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CATEGORY_NEW_MODAL,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalogCategories)(member);
        const terms = readCategoryForm(interaction);
        await beginModal(interaction);
        const { category, restored } = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, () => (0, CatalogCategoryService_1.createCategoryFromInput)(guild.id, member.id, terms), { userMessage: LOCK_BUSY_MESSAGE });
        await refreshPublicCatalog(interaction);
        await renderCategoryPanel(interaction, guild.id, restored
            ? `${branding_1.EMOJIS.APPROVE} Categoria **${category.name}** restaurada.`
            : `${branding_1.EMOJIS.APPROVE} Categoria **${category.name}** criada.`);
    },
};
const categoryEditModal = {
    namespace: customIds_1.NAMESPACE.CATALOG,
    action: customIds_1.CATALOG_ACTION.CATEGORY_EDIT_MODAL,
    async handle(interaction, parsed) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageCatalogCategories)(member);
        const categoryId = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        const terms = readCategoryForm(interaction);
        await beginModal(interaction);
        const category = await LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.CATALOG_ADMIN, guild.id, () => (0, CatalogCategoryService_1.updateCategoryFromInput)(guild.id, member.id, categoryId, terms), { userMessage: LOCK_BUSY_MESSAGE });
        await refreshPublicCatalog(interaction);
        await renderCategoryPanel(interaction, guild.id, `${branding_1.EMOJIS.APPROVE} Categoria **${category.name}** atualizada.`);
    },
};
/**
 * Modal enviado de um painel efemero: `deferUpdate` mantem a mesma mensagem e
 * evita abrir uma segunda tela para cada formulario preenchido.
 */
async function beginModal(interaction) {
    if (interaction.deferred || interaction.replied)
        return;
    if (interaction.isFromMessage()) {
        await interaction.deferUpdate();
        return;
    }
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
}
function readPackForm(interaction) {
    return {
        name: (0, packValidators_1.parsePackName)(interaction.fields.getTextInputValue(CatalogAdminBuilders_1.PACK_FIELD.NAME)),
        sku: (0, packValidators_1.parsePackSku)((0, shared_1.optionalField)(interaction, CatalogAdminBuilders_1.PACK_FIELD.SKU)),
        price: (0, packValidators_1.parsePackPrice)(interaction.fields.getTextInputValue(CatalogAdminBuilders_1.PACK_FIELD.PRICE)),
        shortDescription: (0, packValidators_1.parseShortDescription)((0, shared_1.optionalField)(interaction, CatalogAdminBuilders_1.PACK_FIELD.SHORT)),
        description: (0, packValidators_1.parseLongDescription)((0, shared_1.optionalField)(interaction, CatalogAdminBuilders_1.PACK_FIELD.DESCRIPTION)),
    };
}
function readCategoryForm(interaction) {
    return {
        name: (0, packValidators_1.parseCategoryName)(interaction.fields.getTextInputValue(CatalogAdminBuilders_1.CATEGORY_FIELD.NAME)),
        description: (0, packValidators_1.parseCategoryDescription)((0, shared_1.optionalField)(interaction, CatalogAdminBuilders_1.CATEGORY_FIELD.DESCRIPTION)),
        emoji: (0, packValidators_1.parseCategoryEmoji)((0, shared_1.optionalField)(interaction, CatalogAdminBuilders_1.CATEGORY_FIELD.EMOJI)),
    };
}
/** Painel administrativo aberto por comando (sem componente de origem). */
async function renderAdminPanelForCommand(interaction, guildId) {
    await renderAdminPanel(interaction, guildId);
}
exports.catalogAdminButtons = [
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
exports.catalogAdminSelects = [
    packNewCategorySelect,
    packPickSelect,
    packCategorySelect,
    imagePickSelect,
    categoryPickSelect,
    orderChannelSelect,
];
exports.catalogAdminModals = [
    packNewModal,
    packEditModal,
    packPriceModal,
    packDetailsModal,
    imageAddModal,
    categoryNewModal,
    categoryEditModal,
];
//# sourceMappingURL=admin.js.map