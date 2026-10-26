import {
  ChannelType,
  ComponentType,
  GuildMember,
  PermissionFlagsBits,
  type AnySelectMenuInteraction,
  type ContainerBuilder,
  type Guild,
  type ModalSubmitInteraction,
  type RepliableInteraction,
} from 'discord.js';
import type { TicketCategory } from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../constants/branding';
import {
  CATEGORY_ACTION,
  DESTINATION_ACTION,
  NAMESPACE,
  TEAM_ACTION,
  requireArg,
} from '../../constants/customIds';
import { BUSINESS_LIMITS } from '../../constants/limits';
import { deferIfNeeded, deferUpdateIfNeeded, editReplyV2, replyWarning, updateV2 } from '../../components/reply';
import { isUniqueConstraintError } from '../../core/database/prisma';
import { PermissionError, ValidationError } from '../../core/errors';
import { createLogger } from '../../core/logger/Logger';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import {
  BACK_TARGET,
  CATEGORY_FIELD,
  MOVE_DIRECTION,
  buildCategoryMenu,
  buildCategoryModal,
  buildCategoryPickerPanel,
  buildDestinationEditPanel,
  buildDestinationPanel,
  buildTeamEditPanel,
  buildTeamPanel,
  normalizeCategoryEmoji,
} from '../../modules/configuration/builders/CategoryBuilders';
import {
  countCategories,
  createCategory,
  findCategoryByIdentifier,
  listCategories,
  normalizeCategoryPositions,
  setCategoryDestination,
  setCategoryEnabled,
  softDeleteCategory,
  swapCategoryPositions,
  updateCategory,
} from '../../modules/tickets/repositories/TicketCategoryRepository';
import {
  clearTeamRoles,
  replaceTeamRoles,
} from '../../modules/tickets/repositories/TicketTeamRoleRepository';
import {
  getCategories,
  getCategoryById,
  getTeamRoleIds,
  invalidateCategories,
  invalidateTeamRoles,
} from '../../modules/tickets/services/TicketConfigService';
import type { ButtonHandler, ModalHandler, SelectHandler } from '../../types';
import { fetchChannelSafe } from '../../utils/discord';
import { sanitizeConfigText, sanitizeIdentifier, truncate } from '../../utils/sanitize';

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

const logger = createLogger('config-categories');

const OK = '✅';
const WARN = '⚠️';
const FAIL = '⛔';

// ---------------------------------------------------------------------------
// Contexto e leitura de entrada
// ---------------------------------------------------------------------------

interface AdminContext {
  member: GuildMember;
  guild: Guild;
  guildId: string;
}

/** Garante guild em cache + permissao de administracao do sistema. */
function requireAdminContext(interaction: RepliableInteraction): AdminContext {
  const { guild, member } = interaction;
  if (guild === null || !(member instanceof GuildMember)) {
    throw new PermissionError('Interacao administrativa fora de uma guild em cache.', {
      userMessage: 'Esta configuracao so pode ser usada dentro do servidor.',
    });
  }
  assertCanManageSystem(member);
  return { member, guild, guildId: guild.id };
}

/** Primeiro valor de um select, com mensagem segura quando vem vazio. */
function firstValue(interaction: AnySelectMenuInteraction): string {
  const value = interaction.values[0];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('Select enviado sem valor.', {
      userMessage: 'Nenhuma opcao foi selecionada. Abra o painel novamente e tente de novo.',
    });
  }
  return value;
}

/** Le um campo de texto do modal sem lancar quando ele veio vazio/opcional. */
function readInput(interaction: ModalSubmitInteraction, customId: string): string {
  const field = interaction.fields.fields.get(customId);
  if (field === undefined || field.type !== ComponentType.TextInput) return '';
  return field.value;
}

/**
 * Modais abertos a partir de um painel voltam como `isFromMessage()`: nesse caso
 * o defer de update preserva a mensagem para ser reescrita com o estado novo.
 */
async function deferModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
    return;
  }
  await deferIfNeeded(interaction, { ephemeral: true });
}

// ---------------------------------------------------------------------------
// Carregamento de estado (reutilizado pelos comandos slash)
// ---------------------------------------------------------------------------

/** `categoryId` -> cargos responsaveis (leitura cacheada). */
export async function loadTeamRoleMap(
  categories: readonly TicketCategory[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const category of categories) {
    map.set(category.id, await getTeamRoleIds(category.id));
  }
  return map;
}

export async function renderCategoryMenu(
  guildId: string,
  notice?: string,
): Promise<ContainerBuilder> {
  const categories = await getCategories(guildId);
  const roleMap = await loadTeamRoleMap(categories);
  const teamRoleCounts = new Map<string, number>();
  for (const [categoryId, roleIds] of roleMap) teamRoleCounts.set(categoryId, roleIds.length);
  return buildCategoryMenu(categories, { teamRoleCounts, notice });
}

export async function renderDestinationPanel(
  guild: Guild,
  notice?: string,
): Promise<ContainerBuilder> {
  const categories = await getCategories(guild.id);
  return buildDestinationPanel(categories, guild, { notice });
}

export async function renderTeamPanel(guild: Guild, notice?: string): Promise<ContainerBuilder> {
  const categories = await getCategories(guild.id);
  const roleMap = await loadTeamRoleMap(categories);
  return buildTeamPanel(categories, roleMap, { notice });
}

/** Nome curto e seguro para usar dentro dos avisos dos paineis. */
function label(category: TicketCategory): string {
  return truncate(category.name, 40);
}

// ---------------------------------------------------------------------------
// Botoes — menu de categorias
// ---------------------------------------------------------------------------

const createCategoryButton: ButtonHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.CREATE,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    const total = await countCategories(ctx.guildId);

    if (total >= BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD) {
      await replyWarning(
        interaction,
        `O servidor ja possui o maximo de ${BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD} categorias. ` +
          'Exclua uma categoria antes de criar outra.',
      );
      return;
    }

    // showModal precisa ser a primeira resposta: nao pode haver defer antes.
    await interaction.showModal(buildCategoryModal('create'));
  },
};

const editCategoryButton: ButtonHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.EDIT,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);
    const categories = await getCategories(ctx.guildId);

    await updateV2(
      interaction,
      buildCategoryPickerPanel({
        title: TITLES.CATEGORIES,
        description: `${EMOJIS.EDIT} Selecione a categoria que deseja editar.`,
        categories,
        action: CATEGORY_ACTION.EDIT_SELECT,
        placeholder: 'Selecionar categoria para editar',
      }),
    );
  },
};

function moveButton(action: string, direction: string): ButtonHandler {
  const up = direction === MOVE_DIRECTION.UP;
  return {
    namespace: NAMESPACE.CATEGORY,
    action,
    async handle(interaction) {
      const ctx = requireAdminContext(interaction);
      await deferUpdateIfNeeded(interaction);
      const categories = await getCategories(ctx.guildId);

      await updateV2(
        interaction,
        buildCategoryPickerPanel({
          title: TITLES.CATEGORIES,
          description: `${up ? EMOJIS.UP : EMOJIS.DOWN} Selecione a categoria que deseja ${
            up ? 'subir' : 'descer'
          } uma posicao.`,
          categories,
          action: CATEGORY_ACTION.MOVE_SELECT,
          args: [direction],
          placeholder: `Selecionar categoria para ${up ? 'subir' : 'descer'}`,
          note: 'A ordem define como as categorias aparecem no painel publico.',
        }),
      );
    },
  };
}

const moveUpButton = moveButton(CATEGORY_ACTION.MOVE_UP, MOVE_DIRECTION.UP);
const moveDownButton = moveButton(CATEGORY_ACTION.MOVE_DOWN, MOVE_DIRECTION.DOWN);

const toggleCategoryButton: ButtonHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.TOGGLE,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);
    const categories = await getCategories(ctx.guildId);

    await updateV2(
      interaction,
      buildCategoryPickerPanel({
        title: TITLES.CATEGORIES,
        description: `${EMOJIS.ENABLE} Selecione a categoria para ativar ou desativar.`,
        categories,
        action: CATEGORY_ACTION.TOGGLE_SELECT,
        placeholder: 'Selecionar categoria para ativar/desativar',
        note: 'Categorias desativadas somem do painel publico, mas nada e apagado.',
      }),
    );
  },
};

const deleteCategoryButton: ButtonHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.DELETE,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);
    const categories = await getCategories(ctx.guildId);

    await updateV2(
      interaction,
      buildCategoryPickerPanel({
        title: TITLES.CATEGORIES,
        description:
          `${EMOJIS.DELETE} Selecione a categoria que deseja excluir.\n` +
          'A exclusao e reversivel: os tickets historicos daquela categoria continuam preservados.',
        categories,
        action: CATEGORY_ACTION.DELETE_SELECT,
        placeholder: 'Selecionar categoria para excluir',
        accent: COLORS.DANGER,
        note: 'Recriar o mesmo identificador restaura a categoria com o historico.',
      }),
    );
  },
};

const backButtonHandler: ButtonHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.BACK,
  async handle(interaction, parsed) {
    const ctx = requireAdminContext(interaction);
    await deferUpdateIfNeeded(interaction);
    const target = parsed.args[0];

    if (target === BACK_TARGET.DESTINATION) {
      await updateV2(interaction, await renderDestinationPanel(ctx.guild));
      return;
    }
    if (target === BACK_TARGET.TEAM) {
      await updateV2(interaction, await renderTeamPanel(ctx.guild));
      return;
    }
    await updateV2(interaction, await renderCategoryMenu(ctx.guildId));
  },
};

// ---------------------------------------------------------------------------
// Botoes — destino e equipe
// ---------------------------------------------------------------------------

const clearDestinationButton: ButtonHandler = {
  namespace: NAMESPACE.DESTINATION,
  action: DESTINATION_ACTION.CLEAR,
  async handle(interaction, parsed) {
    const ctx = requireAdminContext(interaction);
    const categoryId = requireArg(parsed, 0, 'categoria');
    await deferUpdateIfNeeded(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await updateV2(
        interaction,
        await renderDestinationPanel(ctx.guild, `${FAIL} Categoria nao encontrada.`),
      );
      return;
    }

    const updated = await setCategoryDestination(category.id, null);
    invalidateCategories(ctx.guildId);
    logger.info('Destino da categoria removido.', {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      entityType: 'ticket_category',
      entityId: category.id,
    });

    await updateV2(
      interaction,
      buildDestinationEditPanel(updated, ctx.guild, {
        notice: `${OK} Destino removido. Novos canais de **${label(updated)}** serao criados na raiz do servidor.`,
      }),
    );
  },
};

const clearTeamButton: ButtonHandler = {
  namespace: NAMESPACE.TEAM,
  action: TEAM_ACTION.CLEAR,
  async handle(interaction, parsed) {
    const ctx = requireAdminContext(interaction);
    const categoryId = requireArg(parsed, 0, 'categoria');
    await deferUpdateIfNeeded(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await updateV2(
        interaction,
        await renderTeamPanel(ctx.guild, `${FAIL} Categoria nao encontrada.`),
      );
      return;
    }

    const removed = await clearTeamRoles(category.id);
    invalidateTeamRoles(category.id);
    logger.info('Equipe da categoria removida.', {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      entityType: 'ticket_category',
      entityId: category.id,
      removed,
    });

    await updateV2(
      interaction,
      buildTeamEditPanel(category, [], {
        notice:
          `${WARN} Equipe de **${label(category)}** removida (${removed} cargo(s)). ` +
          'Somente administradores conseguem atender esta categoria agora.',
      }),
    );
  },
};

// ---------------------------------------------------------------------------
// Selects — categorias
// ---------------------------------------------------------------------------

const editCategorySelect: SelectHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.EDIT_SELECT,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    const categoryId = firstValue(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await replyWarning(
        interaction,
        'Esta categoria nao existe mais. Abra o painel novamente para ver a lista atualizada.',
      );
      return;
    }

    // showModal precisa ser a primeira resposta: nao pode haver defer antes.
    await interaction.showModal(buildCategoryModal('edit', category));
  },
};

const moveCategorySelect: SelectHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.MOVE_SELECT,
  async handle(interaction, parsed) {
    const ctx = requireAdminContext(interaction);
    const direction = requireArg(parsed, 0, 'direcao');
    const categoryId = firstValue(interaction);
    await deferUpdateIfNeeded(interaction);

    // Renumera antes de mover: posicoes com lacunas tornariam a troca inutil.
    await normalizeCategoryPositions(ctx.guildId);
    const ordered = await listCategories(ctx.guildId, { includeDisabled: true });
    const index = ordered.findIndex((entry) => entry.id === categoryId);

    if (index < 0) {
      invalidateCategories(ctx.guildId);
      await updateV2(
        interaction,
        await renderCategoryMenu(ctx.guildId, `${FAIL} Esta categoria nao existe mais.`),
      );
      return;
    }

    const up = direction === MOVE_DIRECTION.UP;
    const targetIndex = up ? index - 1 : index + 1;
    const current = ordered[index];

    if (targetIndex < 0 || targetIndex >= ordered.length) {
      invalidateCategories(ctx.guildId);
      await updateV2(
        interaction,
        await renderCategoryMenu(
          ctx.guildId,
          `${WARN} **${label(current)}** ja esta ${up ? 'na primeira' : 'na ultima'} posicao.`,
        ),
      );
      return;
    }

    const neighbour = ordered[targetIndex];
    await swapCategoryPositions(
      { id: current.id, position: current.position },
      { id: neighbour.id, position: neighbour.position },
    );
    invalidateCategories(ctx.guildId);
    logger.info('Ordem de categorias alterada.', {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      entityType: 'ticket_category',
      entityId: current.id,
      direction,
    });

    await updateV2(
      interaction,
      await renderCategoryMenu(
        ctx.guildId,
        `${OK} **${label(current)}** agora ocupa a posicao ${targetIndex + 1}.`,
      ),
    );
  },
};

const toggleCategorySelect: SelectHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.TOGGLE_SELECT,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    const categoryId = firstValue(interaction);
    await deferUpdateIfNeeded(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await updateV2(
        interaction,
        await renderCategoryMenu(ctx.guildId, `${FAIL} Esta categoria nao existe mais.`),
      );
      return;
    }

    const updated = await setCategoryEnabled(category.id, !category.enabled);
    invalidateCategories(ctx.guildId);
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

    await updateV2(interaction, await renderCategoryMenu(ctx.guildId, notice));
  },
};

const deleteCategorySelect: SelectHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.DELETE_SELECT,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    const categoryId = firstValue(interaction);
    await deferUpdateIfNeeded(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await updateV2(
        interaction,
        await renderCategoryMenu(ctx.guildId, `${FAIL} Esta categoria nao existe mais.`),
      );
      return;
    }

    await softDeleteCategory(category.id);
    await normalizeCategoryPositions(ctx.guildId);
    invalidateCategories(ctx.guildId);
    logger.info('Categoria excluida (soft-delete).', {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      entityType: 'ticket_category',
      entityId: category.id,
    });

    await updateV2(
      interaction,
      await renderCategoryMenu(
        ctx.guildId,
        `${OK} **${label(category)}** foi excluida. Os tickets historicos dela continuam ` +
          `preservados — recriar o identificador \`${category.identifier}\` restaura a categoria.`,
      ),
    );
  },
};

// ---------------------------------------------------------------------------
// Selects — destinos
// ---------------------------------------------------------------------------

const destinationCategorySelect: SelectHandler = {
  namespace: NAMESPACE.DESTINATION,
  action: DESTINATION_ACTION.SELECT_CATEGORY,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    const categoryId = firstValue(interaction);
    await deferUpdateIfNeeded(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await updateV2(
        interaction,
        await renderDestinationPanel(ctx.guild, `${FAIL} Esta categoria nao existe mais.`),
      );
      return;
    }

    await updateV2(interaction, buildDestinationEditPanel(category, ctx.guild));
  },
};

const destinationChannelSelect: SelectHandler = {
  namespace: NAMESPACE.DESTINATION,
  action: DESTINATION_ACTION.SELECT_CHANNEL,
  async handle(interaction, parsed) {
    const ctx = requireAdminContext(interaction);
    const categoryId = requireArg(parsed, 0, 'categoria');
    const channelId = firstValue(interaction);
    await deferUpdateIfNeeded(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await updateV2(
        interaction,
        await renderDestinationPanel(ctx.guild, `${FAIL} Esta categoria nao existe mais.`),
      );
      return;
    }

    const channel = await fetchChannelSafe(ctx.guild, channelId);
    if (channel === null) {
      await updateV2(
        interaction,
        buildDestinationEditPanel(category, ctx.guild, {
          notice: `${FAIL} Nao foi possivel acessar esse canal. Ele pode ter sido removido ou o bot nao o enxerga.`,
        }),
      );
      return;
    }

    if (channel.type !== ChannelType.GuildText) {
      await updateV2(
        interaction,
        buildDestinationEditPanel(category, ctx.guild, {
          notice: `${FAIL} <#${channel.id}> nao e um canal de texto. Os tickets desta categoria viram topicos dentro do canal escolhido.`,
        }),
      );
      return;
    }

    const botMember = ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
    const permissions = channel.permissionsFor(botMember);
    const canManage =
      permissions !== null &&
      permissions.has(PermissionFlagsBits.ViewChannel) &&
      permissions.has(PermissionFlagsBits.ManageChannels);

    if (!canManage) {
      await updateV2(
        interaction,
        buildDestinationEditPanel(category, ctx.guild, {
          notice:
            `${FAIL} O bot nao pode criar canais em <#${channel.id}>.\n` +
            '-# Conceda **Ver canais** e **Gerenciar canais** ao cargo do bot nessa categoria e tente de novo.',
        }),
      );
      return;
    }

    const updated = await setCategoryDestination(category.id, channel.id);
    invalidateCategories(ctx.guildId);
    logger.info('Destino da categoria definido.', {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      channelId: channel.id,
      entityType: 'ticket_category',
      entityId: updated.id,
    });

    await updateV2(
      interaction,
      buildDestinationEditPanel(updated, ctx.guild, {
        notice: `${OK} Os proximos tickets de **${label(updated)}** serao criados em <#${channel.id}>.`,
      }),
    );
  },
};

// ---------------------------------------------------------------------------
// Selects — equipes
// ---------------------------------------------------------------------------

const teamCategorySelect: SelectHandler = {
  namespace: NAMESPACE.TEAM,
  action: TEAM_ACTION.SELECT_CATEGORY,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    const categoryId = firstValue(interaction);
    await deferUpdateIfNeeded(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await updateV2(
        interaction,
        await renderTeamPanel(ctx.guild, `${FAIL} Esta categoria nao existe mais.`),
      );
      return;
    }

    const roleIds = await getTeamRoleIds(category.id);
    await updateV2(interaction, buildTeamEditPanel(category, roleIds));
  },
};

const teamRolesSelect: SelectHandler = {
  namespace: NAMESPACE.TEAM,
  action: TEAM_ACTION.SELECT_ROLES,
  async handle(interaction, parsed) {
    const ctx = requireAdminContext(interaction);
    const categoryId = requireArg(parsed, 0, 'categoria');
    await deferUpdateIfNeeded(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await updateV2(
        interaction,
        await renderTeamPanel(ctx.guild, `${FAIL} Esta categoria nao existe mais.`),
      );
      return;
    }

    const selected = [...new Set(interaction.values)];
    const roleIds = selected.filter((roleId) => roleId !== ctx.guild.roles.everyone.id);
    const droppedEveryone = roleIds.length !== selected.length;

    if (roleIds.length > BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY) {
      const current = await getTeamRoleIds(category.id);
      await updateV2(
        interaction,
        buildTeamEditPanel(category, current, {
          notice: `${FAIL} Selecione no maximo ${BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY} cargos por categoria.`,
        }),
      );
      return;
    }

    if (roleIds.length === 0) {
      const removed = await clearTeamRoles(category.id);
      invalidateTeamRoles(category.id);
      logger.info('Equipe da categoria removida pelo select.', {
        guildId: ctx.guildId,
        userId: ctx.member.id,
        entityType: 'ticket_category',
        entityId: category.id,
        removed,
      });

      await updateV2(
        interaction,
        buildTeamEditPanel(category, [], {
          notice:
            `${WARN} Nenhum cargo selecionado: a equipe de **${label(category)}** foi removida.` +
            (droppedEveryone ? '\n-# O cargo @everyone nao pode ser usado como equipe.' : ''),
        }),
      );
      return;
    }

    await replaceTeamRoles({
      guildId: ctx.guildId,
      categoryId: category.id,
      roleIds,
      actorId: ctx.member.id,
    });
    invalidateTeamRoles(category.id);
    logger.info('Equipe da categoria atualizada.', {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      entityType: 'ticket_category',
      entityId: category.id,
      roles: roleIds.length,
    });

    await updateV2(
      interaction,
      buildTeamEditPanel(category, roleIds, {
        notice:
          `${OK} Equipe de **${label(category)}** atualizada: ${roleIds.length} cargo(s).` +
          (droppedEveryone ? '\n-# O cargo @everyone foi ignorado.' : ''),
      }),
    );
  },
};

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

interface CategoryFormData {
  name: string;
  identifier: string;
  description: string | null;
  emoji: string | null;
  /** True quando o admin digitou algo no campo emoji que nao e um emoji. */
  emojiRejected: boolean;
}

/** Le e sanitiza o formulario. Retorna `null` quando o nome e invalido. */
function readCategoryForm(interaction: ModalSubmitInteraction): CategoryFormData | null {
  const name = sanitizeConfigText(
    readInput(interaction, CATEGORY_FIELD.NAME),
    BUSINESS_LIMITS.CATEGORY_NAME_MAX,
  ).trim();

  if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name)) return null;

  const rawIdentifier = readInput(interaction, CATEGORY_FIELD.IDENTIFIER).trim();
  const identifier = sanitizeIdentifier(rawIdentifier.length > 0 ? rawIdentifier : name, 'categoria');

  const description = sanitizeConfigText(
    readInput(interaction, CATEGORY_FIELD.DESCRIPTION),
    BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX,
  ).trim();

  // Texto qualquer no campo emoji nao pode chegar ao banco: o painel PUBLICO
  // manda `category.emoji` direto para `setEmoji`, e `{"name":"carrinho"}` faz
  // a API recusar a mensagem inteira com 400.
  //
  // Aqui NAO passa por `sanitizeConfigText`: ele remove U+200D (ZWJ) junto com
  // os invisiveis e quebraria emoji de sequencia (🧑‍💻). `normalizeCategoryEmoji`
  // e uma lista de permissao estrita — nada fora de emoji atravessa.
  const rawEmoji = readInput(interaction, CATEGORY_FIELD.EMOJI).trim();
  const emoji = normalizeCategoryEmoji(rawEmoji.length > 0 ? rawEmoji : null);

  return {
    name,
    identifier,
    description: description.length > 0 ? description : null,
    emoji,
    emojiRejected: rawEmoji.length > 0 && emoji === null,
  };
}

const INVALID_NAME_NOTICE = `${FAIL} Informe um nome com pelo menos 2 caracteres e ao menos uma letra ou numero.`;

const EMOJI_REJECTED_NOTE =
  `\n-# ${WARN} O emoji informado nao e valido e foi ignorado. ` +
  'Use um emoji do teclado (🛒) ou um emoji do servidor no formato `<:nome:id>`.';

/** Sufixo do aviso quando o emoji digitado foi descartado. */
function emojiNote(form: CategoryFormData): string {
  return form.emojiRejected ? EMOJI_REJECTED_NOTE : '';
}

const createCategoryModal: ModalHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.CREATE_MODAL,
  async handle(interaction) {
    const ctx = requireAdminContext(interaction);
    await deferModal(interaction);

    const form = readCategoryForm(interaction);
    if (form === null) {
      await editReplyV2(interaction, await renderCategoryMenu(ctx.guildId, INVALID_NAME_NOTICE));
      return;
    }

    if ((await countCategories(ctx.guildId)) >= BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD) {
      await editReplyV2(
        interaction,
        await renderCategoryMenu(
          ctx.guildId,
          `${FAIL} Limite de ${BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD} categorias atingido.`,
        ),
      );
      return;
    }

    const existing = await findCategoryByIdentifier(ctx.guildId, form.identifier);
    if (existing !== null && existing.deletedAt === null) {
      await editReplyV2(
        interaction,
        await renderCategoryMenu(
          ctx.guildId,
          `${FAIL} Ja existe uma categoria com o identificador \`${form.identifier}\`. Escolha outro.`,
        ),
      );
      return;
    }

    const created = await createCategory({
      guildId: ctx.guildId,
      name: form.name,
      identifier: form.identifier,
      description: form.description,
      emoji: form.emoji,
    });
    invalidateCategories(ctx.guildId);
    logger.info('Categoria criada.', {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      entityType: 'ticket_category',
      entityId: created.id,
      revived: existing !== null,
    });

    const notice =
      existing !== null
        ? `${OK} **${label(created)}** foi restaurada com o historico do identificador \`${created.identifier}\`.`
        : `${OK} **${label(created)}** criada. Defina o destino e a equipe dela para comecar a atender.`;

    await editReplyV2(
      interaction,
      await renderCategoryMenu(ctx.guildId, notice + emojiNote(form)),
    );
  },
};

const editCategoryModal: ModalHandler = {
  namespace: NAMESPACE.CATEGORY,
  action: CATEGORY_ACTION.EDIT_MODAL,
  async handle(interaction, parsed) {
    const ctx = requireAdminContext(interaction);
    const categoryId = requireArg(parsed, 0, 'categoria');
    await deferModal(interaction);

    const category = await getCategoryById(ctx.guildId, categoryId);
    if (category === null) {
      await editReplyV2(
        interaction,
        await renderCategoryMenu(ctx.guildId, `${FAIL} Esta categoria nao existe mais.`),
      );
      return;
    }

    const form = readCategoryForm(interaction);
    if (form === null) {
      await editReplyV2(interaction, await renderCategoryMenu(ctx.guildId, INVALID_NAME_NOTICE));
      return;
    }

    if (form.identifier !== category.identifier) {
      const clash = await findCategoryByIdentifier(ctx.guildId, form.identifier);
      if (clash !== null && clash.id !== category.id) {
        await editReplyV2(
          interaction,
          await renderCategoryMenu(
            ctx.guildId,
            `${FAIL} O identificador \`${form.identifier}\` ja pertence a outra categoria (inclusive excluidas).`,
          ),
        );
        return;
      }
    }

    let updated: TicketCategory;
    try {
      updated = await updateCategory(category.id, {
        name: form.name,
        identifier: form.identifier,
        description: form.description,
        emoji: form.emoji,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      await editReplyV2(
        interaction,
        await renderCategoryMenu(
          ctx.guildId,
          `${FAIL} O identificador \`${form.identifier}\` ja esta em uso. Escolha outro.`,
        ),
      );
      return;
    }

    invalidateCategories(ctx.guildId);
    logger.info('Categoria atualizada.', {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      entityType: 'ticket_category',
      entityId: category.id,
    });

    // O aviso usa o registro devolvido pelo update: depois de renomear, o nome
    // antigo no aviso faria o admin achar que editou a categoria errada.
    await editReplyV2(
      interaction,
      await renderCategoryMenu(
        ctx.guildId,
        `${OK} **${label(updated)}** foi atualizada.` + emojiNote(form),
      ),
    );
  },
};

// ---------------------------------------------------------------------------
// Exportacoes para o agregador de interacoes
// ---------------------------------------------------------------------------

export const categoryButtons: ButtonHandler[] = [
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

export const categorySelects: SelectHandler[] = [
  editCategorySelect,
  moveCategorySelect,
  toggleCategorySelect,
  deleteCategorySelect,
  destinationCategorySelect,
  destinationChannelSelect,
  teamCategorySelect,
  teamRolesSelect,
];

export const categoryModals: ModalHandler[] = [createCategoryModal, editCategoryModal];
