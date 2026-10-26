"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoryModals = exports.categorySelects = exports.categoryButtons = void 0;
exports.loadTeamRoleMap = loadTeamRoleMap;
exports.renderCategoryMenu = renderCategoryMenu;
exports.renderDestinationPanel = renderDestinationPanel;
exports.renderTeamPanel = renderTeamPanel;
const discord_js_1 = require("discord.js");
const branding_1 = require("../../constants/branding");
const customIds_1 = require("../../constants/customIds");
const limits_1 = require("../../constants/limits");
const reply_1 = require("../../components/reply");
const prisma_1 = require("../../core/database/prisma");
const errors_1 = require("../../core/errors");
const Logger_1 = require("../../core/logger/Logger");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const CategoryBuilders_1 = require("../../modules/configuration/builders/CategoryBuilders");
const TicketCategoryRepository_1 = require("../../modules/tickets/repositories/TicketCategoryRepository");
const TicketTeamRoleRepository_1 = require("../../modules/tickets/repositories/TicketTeamRoleRepository");
const TicketConfigService_1 = require("../../modules/tickets/services/TicketConfigService");
const discord_1 = require("../../utils/discord");
const sanitize_1 = require("../../utils/sanitize");
/**
 * Interacoes administrativas de categorias, destinos e equipes.
 *
 * REGRAS aplicadas em CADA handler deste arquivo:
 *  - o customId nunca autoriza nada: a permissao e revalidada com
 *    `assertCanManageSystem` e a entidade e recarregada do banco;
 *  - toda escrita e seguida da invalidacao do cache correspondente;
 *  - o resultado sempre volta como atualizacao do proprio painel, com um aviso
 *    no topo, para o administrador enxergar o estado novo sem abrir outra tela.
 */
const logger = (0, Logger_1.createLogger)('config-categories');
const OK = '✅';
const WARN = '⚠️';
const FAIL = '⛔';
/** Garante guild em cache + permissao de administracao do sistema. */
function requireAdminContext(interaction) {
    const { guild, member } = interaction;
    if (guild === null || !(member instanceof discord_js_1.GuildMember)) {
        throw new errors_1.PermissionError('Interacao administrativa fora de uma guild em cache.', {
            userMessage: 'Esta configuracao so pode ser usada dentro do servidor.',
        });
    }
    (0, PermissionService_1.assertCanManageSystem)(member);
    return { member, guild, guildId: guild.id };
}
/** Primeiro valor de um select, com mensagem segura quando vem vazio. */
function firstValue(interaction) {
    const value = interaction.values[0];
    if (typeof value !== 'string' || value.length === 0) {
        throw new errors_1.ValidationError('Select enviado sem valor.', {
            userMessage: 'Nenhuma opcao foi selecionada. Abra o painel novamente e tente de novo.',
        });
    }
    return value;
}
/** Le um campo de texto do modal sem lancar quando ele veio vazio/opcional. */
function readInput(interaction, customId) {
    const field = interaction.fields.fields.get(customId);
    if (field === undefined || field.type !== discord_js_1.ComponentType.TextInput)
        return '';
    return field.value;
}
/**
 * Modais abertos a partir de um painel voltam como `isFromMessage()`: nesse caso
 * o defer de update preserva a mensagem para ser reescrita com o estado novo.
 */
async function deferModal(interaction) {
    if (interaction.isFromMessage()) {
        await interaction.deferUpdate();
        return;
    }
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
}
// ---------------------------------------------------------------------------
// Carregamento de estado (reutilizado pelos comandos slash)
// ---------------------------------------------------------------------------
/** `categoryId` -> cargos responsaveis (leitura cacheada). */
async function loadTeamRoleMap(categories) {
    const map = new Map();
    for (const category of categories) {
        map.set(category.id, await (0, TicketConfigService_1.getTeamRoleIds)(category.id));
    }
    return map;
}
async function renderCategoryMenu(guildId, notice) {
    const categories = await (0, TicketConfigService_1.getCategories)(guildId);
    const roleMap = await loadTeamRoleMap(categories);
    const teamRoleCounts = new Map();
    for (const [categoryId, roleIds] of roleMap)
        teamRoleCounts.set(categoryId, roleIds.length);
    return (0, CategoryBuilders_1.buildCategoryMenu)(categories, { teamRoleCounts, notice });
}
async function renderDestinationPanel(guild, notice) {
    const categories = await (0, TicketConfigService_1.getCategories)(guild.id);
    return (0, CategoryBuilders_1.buildDestinationPanel)(categories, guild, { notice });
}
async function renderTeamPanel(guild, notice) {
    const categories = await (0, TicketConfigService_1.getCategories)(guild.id);
    const roleMap = await loadTeamRoleMap(categories);
    return (0, CategoryBuilders_1.buildTeamPanel)(categories, roleMap, { notice });
}
/** Nome curto e seguro para usar dentro dos avisos dos paineis. */
function label(category) {
    return (0, sanitize_1.truncate)(category.name, 40);
}
// ---------------------------------------------------------------------------
// Botoes — menu de categorias
// ---------------------------------------------------------------------------
const createCategoryButton = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.CREATE,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        const total = await (0, TicketCategoryRepository_1.countCategories)(ctx.guildId);
        if (total >= limits_1.BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD) {
            await (0, reply_1.replyWarning)(interaction, `O servidor ja possui o maximo de ${limits_1.BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD} categorias. ` +
                'Exclua uma categoria antes de criar outra.');
            return;
        }
        // showModal precisa ser a primeira resposta: nao pode haver defer antes.
        await interaction.showModal((0, CategoryBuilders_1.buildCategoryModal)('create'));
    },
};
const editCategoryButton = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.EDIT,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const categories = await (0, TicketConfigService_1.getCategories)(ctx.guildId);
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildCategoryPickerPanel)({
            title: branding_1.TITLES.CATEGORIES,
            description: `${branding_1.EMOJIS.EDIT} Selecione a categoria que deseja editar.`,
            categories,
            action: customIds_1.CATEGORY_ACTION.EDIT_SELECT,
            placeholder: 'Selecionar categoria para editar',
        }));
    },
};
function moveButton(action, direction) {
    const up = direction === CategoryBuilders_1.MOVE_DIRECTION.UP;
    return {
        namespace: customIds_1.NAMESPACE.CATEGORY,
        action,
        async handle(interaction) {
            const ctx = requireAdminContext(interaction);
            await (0, reply_1.deferUpdateIfNeeded)(interaction);
            const categories = await (0, TicketConfigService_1.getCategories)(ctx.guildId);
            await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildCategoryPickerPanel)({
                title: branding_1.TITLES.CATEGORIES,
                description: `${up ? branding_1.EMOJIS.UP : branding_1.EMOJIS.DOWN} Selecione a categoria que deseja ${up ? 'subir' : 'descer'} uma posicao.`,
                categories,
                action: customIds_1.CATEGORY_ACTION.MOVE_SELECT,
                args: [direction],
                placeholder: `Selecionar categoria para ${up ? 'subir' : 'descer'}`,
                note: 'A ordem define como as categorias aparecem no painel publico.',
            }));
        },
    };
}
const moveUpButton = moveButton(customIds_1.CATEGORY_ACTION.MOVE_UP, CategoryBuilders_1.MOVE_DIRECTION.UP);
const moveDownButton = moveButton(customIds_1.CATEGORY_ACTION.MOVE_DOWN, CategoryBuilders_1.MOVE_DIRECTION.DOWN);
const toggleCategoryButton = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.TOGGLE,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const categories = await (0, TicketConfigService_1.getCategories)(ctx.guildId);
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildCategoryPickerPanel)({
            title: branding_1.TITLES.CATEGORIES,
            description: `${branding_1.EMOJIS.ENABLE} Selecione a categoria para ativar ou desativar.`,
            categories,
            action: customIds_1.CATEGORY_ACTION.TOGGLE_SELECT,
            placeholder: 'Selecionar categoria para ativar/desativar',
            note: 'Categorias desativadas somem do painel publico, mas nada e apagado.',
        }));
    },
};
const deleteCategoryButton = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.DELETE,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const categories = await (0, TicketConfigService_1.getCategories)(ctx.guildId);
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildCategoryPickerPanel)({
            title: branding_1.TITLES.CATEGORIES,
            description: `${branding_1.EMOJIS.DELETE} Selecione a categoria que deseja excluir.\n` +
                'A exclusao e reversivel: os tickets historicos daquela categoria continuam preservados.',
            categories,
            action: customIds_1.CATEGORY_ACTION.DELETE_SELECT,
            placeholder: 'Selecionar categoria para excluir',
            accent: branding_1.COLORS.DANGER,
            note: 'Recriar o mesmo identificador restaura a categoria com o historico.',
        }));
    },
};
const backButtonHandler = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.BACK,
    async handle(interaction, parsed) {
        const ctx = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const target = parsed.args[0];
        if (target === CategoryBuilders_1.BACK_TARGET.DESTINATION) {
            await (0, reply_1.updateV2)(interaction, await renderDestinationPanel(ctx.guild));
            return;
        }
        if (target === CategoryBuilders_1.BACK_TARGET.TEAM) {
            await (0, reply_1.updateV2)(interaction, await renderTeamPanel(ctx.guild));
            return;
        }
        await (0, reply_1.updateV2)(interaction, await renderCategoryMenu(ctx.guildId));
    },
};
// ---------------------------------------------------------------------------
// Botoes — destino e equipe
// ---------------------------------------------------------------------------
const clearDestinationButton = {
    namespace: customIds_1.NAMESPACE.DESTINATION,
    action: customIds_1.DESTINATION_ACTION.CLEAR,
    async handle(interaction, parsed) {
        const ctx = requireAdminContext(interaction);
        const categoryId = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.updateV2)(interaction, await renderDestinationPanel(ctx.guild, `${FAIL} Categoria nao encontrada.`));
            return;
        }
        const updated = await (0, TicketCategoryRepository_1.setCategoryDestination)(category.id, null);
        (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
        logger.info('Destino da categoria removido.', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            entityType: 'ticket_category',
            entityId: category.id,
        });
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildDestinationEditPanel)(updated, ctx.guild, {
            notice: `${OK} Destino removido. Novos canais de **${label(updated)}** serao criados na raiz do servidor.`,
        }));
    },
};
const clearTeamButton = {
    namespace: customIds_1.NAMESPACE.TEAM,
    action: customIds_1.TEAM_ACTION.CLEAR,
    async handle(interaction, parsed) {
        const ctx = requireAdminContext(interaction);
        const categoryId = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.updateV2)(interaction, await renderTeamPanel(ctx.guild, `${FAIL} Categoria nao encontrada.`));
            return;
        }
        const removed = await (0, TicketTeamRoleRepository_1.clearTeamRoles)(category.id);
        (0, TicketConfigService_1.invalidateTeamRoles)(category.id);
        logger.info('Equipe da categoria removida.', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            entityType: 'ticket_category',
            entityId: category.id,
            removed,
        });
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildTeamEditPanel)(category, [], {
            notice: `${WARN} Equipe de **${label(category)}** removida (${removed} cargo(s)). ` +
                'Somente administradores conseguem atender esta categoria agora.',
        }));
    },
};
// ---------------------------------------------------------------------------
// Selects — categorias
// ---------------------------------------------------------------------------
const editCategorySelect = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.EDIT_SELECT,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        const categoryId = firstValue(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.replyWarning)(interaction, 'Esta categoria nao existe mais. Abra o painel novamente para ver a lista atualizada.');
            return;
        }
        // showModal precisa ser a primeira resposta: nao pode haver defer antes.
        await interaction.showModal((0, CategoryBuilders_1.buildCategoryModal)('edit', category));
    },
};
const moveCategorySelect = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.MOVE_SELECT,
    async handle(interaction, parsed) {
        const ctx = requireAdminContext(interaction);
        const direction = (0, customIds_1.requireArg)(parsed, 0, 'direcao');
        const categoryId = firstValue(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        // Renumera antes de mover: posicoes com lacunas tornariam a troca inutil.
        await (0, TicketCategoryRepository_1.normalizeCategoryPositions)(ctx.guildId);
        const ordered = await (0, TicketCategoryRepository_1.listCategories)(ctx.guildId, { includeDisabled: true });
        const index = ordered.findIndex((entry) => entry.id === categoryId);
        if (index < 0) {
            (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
            await (0, reply_1.updateV2)(interaction, await renderCategoryMenu(ctx.guildId, `${FAIL} Esta categoria nao existe mais.`));
            return;
        }
        const up = direction === CategoryBuilders_1.MOVE_DIRECTION.UP;
        const targetIndex = up ? index - 1 : index + 1;
        const current = ordered[index];
        if (targetIndex < 0 || targetIndex >= ordered.length) {
            (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
            await (0, reply_1.updateV2)(interaction, await renderCategoryMenu(ctx.guildId, `${WARN} **${label(current)}** ja esta ${up ? 'na primeira' : 'na ultima'} posicao.`));
            return;
        }
        const neighbour = ordered[targetIndex];
        await (0, TicketCategoryRepository_1.swapCategoryPositions)({ id: current.id, position: current.position }, { id: neighbour.id, position: neighbour.position });
        (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
        logger.info('Ordem de categorias alterada.', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            entityType: 'ticket_category',
            entityId: current.id,
            direction,
        });
        await (0, reply_1.updateV2)(interaction, await renderCategoryMenu(ctx.guildId, `${OK} **${label(current)}** agora ocupa a posicao ${targetIndex + 1}.`));
    },
};
const toggleCategorySelect = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.TOGGLE_SELECT,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        const categoryId = firstValue(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.updateV2)(interaction, await renderCategoryMenu(ctx.guildId, `${FAIL} Esta categoria nao existe mais.`));
            return;
        }
        const updated = await (0, TicketCategoryRepository_1.setCategoryEnabled)(category.id, !category.enabled);
        (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
        logger.info('Categoria ativada/desativada.', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            entityType: 'ticket_category',
            entityId: updated.id,
            enabled: updated.enabled,
        });
        const notice = updated.enabled
            ? `${OK} **${label(updated)}** foi ativada e ja aparece no painel publico.`
            : `${WARN} **${label(updated)}** foi desativada e nao aparece mais no painel publico.`;
        await (0, reply_1.updateV2)(interaction, await renderCategoryMenu(ctx.guildId, notice));
    },
};
const deleteCategorySelect = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.DELETE_SELECT,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        const categoryId = firstValue(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.updateV2)(interaction, await renderCategoryMenu(ctx.guildId, `${FAIL} Esta categoria nao existe mais.`));
            return;
        }
        await (0, TicketCategoryRepository_1.softDeleteCategory)(category.id);
        await (0, TicketCategoryRepository_1.normalizeCategoryPositions)(ctx.guildId);
        (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
        logger.info('Categoria excluida (soft-delete).', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            entityType: 'ticket_category',
            entityId: category.id,
        });
        await (0, reply_1.updateV2)(interaction, await renderCategoryMenu(ctx.guildId, `${OK} **${label(category)}** foi excluida. Os tickets historicos dela continuam ` +
            `preservados — recriar o identificador \`${category.identifier}\` restaura a categoria.`));
    },
};
// ---------------------------------------------------------------------------
// Selects — destinos
// ---------------------------------------------------------------------------
const destinationCategorySelect = {
    namespace: customIds_1.NAMESPACE.DESTINATION,
    action: customIds_1.DESTINATION_ACTION.SELECT_CATEGORY,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        const categoryId = firstValue(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.updateV2)(interaction, await renderDestinationPanel(ctx.guild, `${FAIL} Esta categoria nao existe mais.`));
            return;
        }
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildDestinationEditPanel)(category, ctx.guild));
    },
};
const destinationChannelSelect = {
    namespace: customIds_1.NAMESPACE.DESTINATION,
    action: customIds_1.DESTINATION_ACTION.SELECT_CHANNEL,
    async handle(interaction, parsed) {
        const ctx = requireAdminContext(interaction);
        const categoryId = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        const channelId = firstValue(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.updateV2)(interaction, await renderDestinationPanel(ctx.guild, `${FAIL} Esta categoria nao existe mais.`));
            return;
        }
        const channel = await (0, discord_1.fetchChannelSafe)(ctx.guild, channelId);
        if (channel === null) {
            await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildDestinationEditPanel)(category, ctx.guild, {
                notice: `${FAIL} Nao foi possivel acessar esse canal. Ele pode ter sido removido ou o bot nao o enxerga.`,
            }));
            return;
        }
        if (channel.type !== discord_js_1.ChannelType.GuildText) {
            await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildDestinationEditPanel)(category, ctx.guild, {
                notice: `${FAIL} <#${channel.id}> nao e um canal de texto. Os tickets desta categoria viram topicos dentro do canal escolhido.`,
            }));
            return;
        }
        const botMember = ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
        const permissions = channel.permissionsFor(botMember);
        const canManage = permissions !== null &&
            permissions.has(discord_js_1.PermissionFlagsBits.ViewChannel) &&
            permissions.has(discord_js_1.PermissionFlagsBits.ManageChannels);
        if (!canManage) {
            await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildDestinationEditPanel)(category, ctx.guild, {
                notice: `${FAIL} O bot nao pode criar canais em <#${channel.id}>.\n` +
                    '-# Conceda **Ver canais** e **Gerenciar canais** ao cargo do bot nessa categoria e tente de novo.',
            }));
            return;
        }
        const updated = await (0, TicketCategoryRepository_1.setCategoryDestination)(category.id, channel.id);
        (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
        logger.info('Destino da categoria definido.', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            channelId: channel.id,
            entityType: 'ticket_category',
            entityId: updated.id,
        });
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildDestinationEditPanel)(updated, ctx.guild, {
            notice: `${OK} Os proximos tickets de **${label(updated)}** serao criados em <#${channel.id}>.`,
        }));
    },
};
// ---------------------------------------------------------------------------
// Selects — equipes
// ---------------------------------------------------------------------------
const teamCategorySelect = {
    namespace: customIds_1.NAMESPACE.TEAM,
    action: customIds_1.TEAM_ACTION.SELECT_CATEGORY,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        const categoryId = firstValue(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.updateV2)(interaction, await renderTeamPanel(ctx.guild, `${FAIL} Esta categoria nao existe mais.`));
            return;
        }
        const roleIds = await (0, TicketConfigService_1.getTeamRoleIds)(category.id);
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildTeamEditPanel)(category, roleIds));
    },
};
const teamRolesSelect = {
    namespace: customIds_1.NAMESPACE.TEAM,
    action: customIds_1.TEAM_ACTION.SELECT_ROLES,
    async handle(interaction, parsed) {
        const ctx = requireAdminContext(interaction);
        const categoryId = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.updateV2)(interaction, await renderTeamPanel(ctx.guild, `${FAIL} Esta categoria nao existe mais.`));
            return;
        }
        const selected = [...new Set(interaction.values)];
        const roleIds = selected.filter((roleId) => roleId !== ctx.guild.roles.everyone.id);
        const droppedEveryone = roleIds.length !== selected.length;
        if (roleIds.length > limits_1.BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY) {
            const current = await (0, TicketConfigService_1.getTeamRoleIds)(category.id);
            await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildTeamEditPanel)(category, current, {
                notice: `${FAIL} Selecione no maximo ${limits_1.BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY} cargos por categoria.`,
            }));
            return;
        }
        if (roleIds.length === 0) {
            const removed = await (0, TicketTeamRoleRepository_1.clearTeamRoles)(category.id);
            (0, TicketConfigService_1.invalidateTeamRoles)(category.id);
            logger.info('Equipe da categoria removida pelo select.', {
                guildId: ctx.guildId,
                userId: ctx.member.id,
                entityType: 'ticket_category',
                entityId: category.id,
                removed,
            });
            await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildTeamEditPanel)(category, [], {
                notice: `${WARN} Nenhum cargo selecionado: a equipe de **${label(category)}** foi removida.` +
                    (droppedEveryone ? '\n-# O cargo @everyone nao pode ser usado como equipe.' : ''),
            }));
            return;
        }
        await (0, TicketTeamRoleRepository_1.replaceTeamRoles)({
            guildId: ctx.guildId,
            categoryId: category.id,
            roleIds,
            actorId: ctx.member.id,
        });
        (0, TicketConfigService_1.invalidateTeamRoles)(category.id);
        logger.info('Equipe da categoria atualizada.', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            entityType: 'ticket_category',
            entityId: category.id,
            roles: roleIds.length,
        });
        await (0, reply_1.updateV2)(interaction, (0, CategoryBuilders_1.buildTeamEditPanel)(category, roleIds, {
            notice: `${OK} Equipe de **${label(category)}** atualizada: ${roleIds.length} cargo(s).` +
                (droppedEveryone ? '\n-# O cargo @everyone foi ignorado.' : ''),
        }));
    },
};
/** Le e sanitiza o formulario. Retorna `null` quando o nome e invalido. */
function readCategoryForm(interaction) {
    const name = (0, sanitize_1.sanitizeConfigText)(readInput(interaction, CategoryBuilders_1.CATEGORY_FIELD.NAME), limits_1.BUSINESS_LIMITS.CATEGORY_NAME_MAX).trim();
    if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name))
        return null;
    const rawIdentifier = readInput(interaction, CategoryBuilders_1.CATEGORY_FIELD.IDENTIFIER).trim();
    const identifier = (0, sanitize_1.sanitizeIdentifier)(rawIdentifier.length > 0 ? rawIdentifier : name, 'categoria');
    const description = (0, sanitize_1.sanitizeConfigText)(readInput(interaction, CategoryBuilders_1.CATEGORY_FIELD.DESCRIPTION), limits_1.BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX).trim();
    // Texto qualquer no campo emoji nao pode chegar ao banco: o painel PUBLICO
    // manda `category.emoji` direto para `setEmoji`, e `{"name":"carrinho"}` faz
    // a API recusar a mensagem inteira com 400.
    //
    // Aqui NAO passa por `sanitizeConfigText`: ele remove U+200D (ZWJ) junto com
    // os invisiveis e quebraria emoji de sequencia (🧑‍💻). `normalizeCategoryEmoji`
    // e uma lista de permissao estrita — nada fora de emoji atravessa.
    const rawEmoji = readInput(interaction, CategoryBuilders_1.CATEGORY_FIELD.EMOJI).trim();
    const emoji = (0, CategoryBuilders_1.normalizeCategoryEmoji)(rawEmoji.length > 0 ? rawEmoji : null);
    return {
        name,
        identifier,
        description: description.length > 0 ? description : null,
        emoji,
        emojiRejected: rawEmoji.length > 0 && emoji === null,
    };
}
const INVALID_NAME_NOTICE = `${FAIL} Informe um nome com pelo menos 2 caracteres e ao menos uma letra ou numero.`;
const EMOJI_REJECTED_NOTE = `\n-# ${WARN} O emoji informado nao e valido e foi ignorado. ` +
    'Use um emoji do teclado (🛒) ou um emoji do servidor no formato `<:nome:id>`.';
/** Sufixo do aviso quando o emoji digitado foi descartado. */
function emojiNote(form) {
    return form.emojiRejected ? EMOJI_REJECTED_NOTE : '';
}
const createCategoryModal = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.CREATE_MODAL,
    async handle(interaction) {
        const ctx = requireAdminContext(interaction);
        await deferModal(interaction);
        const form = readCategoryForm(interaction);
        if (form === null) {
            await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, INVALID_NAME_NOTICE));
            return;
        }
        if ((await (0, TicketCategoryRepository_1.countCategories)(ctx.guildId)) >= limits_1.BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD) {
            await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, `${FAIL} Limite de ${limits_1.BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD} categorias atingido.`));
            return;
        }
        const existing = await (0, TicketCategoryRepository_1.findCategoryByIdentifier)(ctx.guildId, form.identifier);
        if (existing !== null && existing.deletedAt === null) {
            await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, `${FAIL} Ja existe uma categoria com o identificador \`${form.identifier}\`. Escolha outro.`));
            return;
        }
        const created = await (0, TicketCategoryRepository_1.createCategory)({
            guildId: ctx.guildId,
            name: form.name,
            identifier: form.identifier,
            description: form.description,
            emoji: form.emoji,
        });
        (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
        logger.info('Categoria criada.', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            entityType: 'ticket_category',
            entityId: created.id,
            revived: existing !== null,
        });
        const notice = existing !== null
            ? `${OK} **${label(created)}** foi restaurada com o historico do identificador \`${created.identifier}\`.`
            : `${OK} **${label(created)}** criada. Defina o destino e a equipe dela para comecar a atender.`;
        await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, notice + emojiNote(form)));
    },
};
const editCategoryModal = {
    namespace: customIds_1.NAMESPACE.CATEGORY,
    action: customIds_1.CATEGORY_ACTION.EDIT_MODAL,
    async handle(interaction, parsed) {
        const ctx = requireAdminContext(interaction);
        const categoryId = (0, customIds_1.requireArg)(parsed, 0, 'categoria');
        await deferModal(interaction);
        const category = await (0, TicketConfigService_1.getCategoryById)(ctx.guildId, categoryId);
        if (category === null) {
            await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, `${FAIL} Esta categoria nao existe mais.`));
            return;
        }
        const form = readCategoryForm(interaction);
        if (form === null) {
            await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, INVALID_NAME_NOTICE));
            return;
        }
        if (form.identifier !== category.identifier) {
            const clash = await (0, TicketCategoryRepository_1.findCategoryByIdentifier)(ctx.guildId, form.identifier);
            if (clash !== null && clash.id !== category.id) {
                await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, `${FAIL} O identificador \`${form.identifier}\` ja pertence a outra categoria (inclusive excluidas).`));
                return;
            }
        }
        let updated;
        try {
            updated = await (0, TicketCategoryRepository_1.updateCategory)(category.id, {
                name: form.name,
                identifier: form.identifier,
                description: form.description,
                emoji: form.emoji,
            });
        }
        catch (error) {
            if (!(0, prisma_1.isUniqueConstraintError)(error))
                throw error;
            await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, `${FAIL} O identificador \`${form.identifier}\` ja esta em uso. Escolha outro.`));
            return;
        }
        (0, TicketConfigService_1.invalidateCategories)(ctx.guildId);
        logger.info('Categoria atualizada.', {
            guildId: ctx.guildId,
            userId: ctx.member.id,
            entityType: 'ticket_category',
            entityId: category.id,
        });
        // O aviso usa o registro devolvido pelo update: depois de renomear, o nome
        // antigo no aviso faria o admin achar que editou a categoria errada.
        await (0, reply_1.editReplyV2)(interaction, await renderCategoryMenu(ctx.guildId, `${OK} **${label(updated)}** foi atualizada.` + emojiNote(form)));
    },
};
// ---------------------------------------------------------------------------
// Exportacoes para o agregador de interacoes
// ---------------------------------------------------------------------------
exports.categoryButtons = [
    createCategoryButton,
    editCategoryButton,
    moveUpButton,
    moveDownButton,
    toggleCategoryButton,
    deleteCategoryButton,
    backButtonHandler,
    clearDestinationButton,
    clearTeamButton,
];
exports.categorySelects = [
    editCategorySelect,
    moveCategorySelect,
    toggleCategorySelect,
    deleteCategorySelect,
    destinationCategorySelect,
    destinationChannelSelect,
    teamCategorySelect,
    teamRolesSelect,
];
exports.categoryModals = [createCategoryModal, editCategoryModal];
//# sourceMappingURL=index.js.map