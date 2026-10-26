import {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type TextDisplayBuilder,
} from 'discord.js';
import type { TicketCategory } from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import {
  CATEGORY_ACTION,
  DESTINATION_ACTION,
  NAMESPACE,
  TEAM_ACTION,
  buildCustomId,
} from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  selectRow,
  separator,
  text,
} from '../../../components/v2';
import { ValidationError } from '../../../core/errors';
import { truncate } from '../../../utils/sanitize';

/**
 * Paineis administrativos de categorias, destinos e equipes (Components V2).
 *
 * Segue o padrao visual do painel publico (TicketPanelBuilder):
 * cabecalho -> descricao -> separador -> conteudo -> separador -> controles.
 *
 * Este arquivo NAO acessa banco nem cache: recebe tudo pronto por parametro.
 * API verificada contra @discordjs/builders 1.14.1 (discord.js 14.27.0).
 */

/** Orcamento de texto da listagem, deixando folga para cabecalho e rodape. */
const LIST_TEXT_BUDGET = 2400;

/**
 * Um Container aceita no maximo 10 componentes filhos (Discord API).
 * Estourar esse numero devolve 400 Invalid Form Body e o painel some.
 */
const CONTAINER_COMPONENTS_MAX = 10;

/** Ids dos campos do modal de categoria (lidos por `ModalSubmitFields#fields`). */
export const CATEGORY_FIELD = {
  NAME: 'name',
  IDENTIFIER: 'identifier',
  DESCRIPTION: 'description',
  EMOJI: 'emoji',
} as const;

export type CategoryModalMode = 'create' | 'edit';

/** Direcao aceita pelo select de reordenacao (`category:move-select:<direcao>`). */
export const MOVE_DIRECTION = {
  UP: CATEGORY_ACTION.MOVE_UP,
  DOWN: CATEGORY_ACTION.MOVE_DOWN,
} as const;

/** Origem para a qual o botao "Voltar" deve retornar. */
export const BACK_TARGET = {
  DESTINATION: 'dest',
  TEAM: 'team',
} as const;

const CUSTOM_EMOJI_PATTERN = /^<a?:[A-Za-z0-9_]{2,32}:\d{15,25}>$/u;

/**
 * UM unico emoji unicode: bandeira (par de regional indicators), keycap, ou
 * pictograma com modificador de tom/VS16 e sequencias ZWJ.
 *
 * Precisa ser exatamente um: `setEmoji('🛒🛒')` serializa `{"name":"🛒🛒"}`,
 * que a API recusa igual a qualquer outro texto.
 */
const UNICODE_EMOJI_PATTERN = new RegExp(
  '^(?:' +
    '\\p{RI}\\p{RI}' + // bandeiras: 🇧🇷
    '|[#*0-9]\\uFE0F?\\u20E3' + // keycaps: 1️⃣
    '|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?' +
    '(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*' + // 🧑‍💻
    ')$',
  'u',
);

/** Teto de tamanho do campo emoji (igual ao `setMaxLength` do modal). */
const EMOJI_INPUT_MAX = 64;

/**
 * Emoji aceito em `setEmoji`: custom no formato oficial ou pictograma unicode.
 *
 * IMPORTANTE: `setEmoji('carrinho')` nao lanca — serializa `{"name":"carrinho"}`
 * e o 400 so aparece quando a mensagem e enviada, inclusive no painel PUBLICO
 * (TicketPanelBuilder envia `category.emoji` direto). Por isso a validacao
 * acontece na entrada (modal) e nao apenas na exibicao.
 */
export function normalizeCategoryEmoji(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > EMOJI_INPUT_MAX) return null;
  if (CUSTOM_EMOJI_PATTERN.test(value)) return value;
  if (UNICODE_EMOJI_PATTERN.test(value)) return value;
  return null;
}

function selectEmoji(raw: string | null): string | undefined {
  return normalizeCategoryEmoji(raw) ?? undefined;
}

/** Emoji exibido no texto do painel (cai para o icone padrao de ticket). */
function displayEmoji(raw: string | null): string {
  const value = selectEmoji(raw);
  return value ?? EMOJIS.TICKET;
}

/** Junta blocos respeitando o limite de texto do Components V2. */
function joinWithBudget(entries: readonly string[], budget = LIST_TEXT_BUDGET): string {
  const lines: string[] = [];
  let used = 0;

  for (const [index, entry] of entries.entries()) {
    if (used + entry.length > budget) {
      lines.push(`-# … e mais ${entries.length - index} categoria(s) nao exibida(s) aqui.`);
      break;
    }
    lines.push(entry);
    used += entry.length + 2;
  }

  return lines.join('\n\n');
}

function statusLabel(category: TicketCategory): string {
  return category.enabled ? `${EMOJIS.ENABLE} Ativa` : `${EMOJIS.DISABLE} Inativa`;
}

/**
 * Bloco de abertura: aviso da ultima acao (quando houver) + texto de contexto,
 * sempre em UM unico TextDisplay.
 *
 * O aviso NAO pode virar componente proprio com separador: isso somava 2 filhos
 * ao Container e o painel de categorias passava de 10 (limite do Discord),
 * quebrando exatamente o caso mais comum — o retorno de qualquer acao.
 */
function intro(notice: string | undefined, body: string): TextDisplayBuilder {
  const cleaned = notice === undefined ? '' : truncate(notice.trim(), 400);
  return text(cleaned.length > 0 ? `${cleaned}\n\n${body}` : body);
}

/**
 * Fecha o painel garantindo o teto de componentes do Container.
 * Falha aqui e um bug de montagem: melhor estourar no handler (que responde com
 * mensagem tratada) do que receber 400 da API com o painel em branco.
 */
function sealed(root: ContainerBuilder): ContainerBuilder {
  if (root.components.length > CONTAINER_COMPONENTS_MAX) {
    throw new ValidationError(
      `Painel com ${root.components.length} componentes excede o limite de ${CONTAINER_COMPONENTS_MAX} do Container.`,
      { userMessage: 'Nao foi possivel montar este painel. Avise a administracao.' },
    );
  }
  return root;
}

function backButton(target?: string): ButtonBuilder {
  const customId =
    target === undefined
      ? buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.BACK)
      : buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.BACK, target);

  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel('Voltar')
    .setEmoji('↩️')
    .setStyle(ButtonStyle.Secondary);
}

// ---------------------------------------------------------------------------
// Menu principal de categorias
// ---------------------------------------------------------------------------

export interface CategoryMenuOptions {
  /** Quantidade de cargos de equipe por categoria (`categoryId` -> total). */
  teamRoleCounts?: ReadonlyMap<string, number>;
  /** Aviso exibido no topo apos uma acao (sucesso, erro ou alerta). */
  notice?: string;
}

/**
 * Painel principal: lista as categorias com posicao, emoji, nome, identificador,
 * status e se ja possuem destino e equipe configurados.
 */
export function buildCategoryMenu(
  categories: readonly TicketCategory[],
  options: CategoryMenuOptions = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CATEGORIES);

  root.addTextDisplayComponents(
    intro(
      options.notice,
      'Cada categoria e um setor de atendimento exibido no painel publico da loja. ' +
        'A ordem abaixo e a mesma que o cliente ve no menu de abertura de ticket.',
    ),
  );
  root.addSeparatorComponents(separator());

  if (categories.length === 0) {
    root.addTextDisplayComponents(
      text(
        `${EMOJIS.DISABLE} **Nenhuma categoria cadastrada.**\n` +
          `Use ${EMOJIS.ADD} **Criar** para cadastrar o primeiro setor de atendimento.`,
      ),
    );
  } else {
    const entries = categories.map((category, index) => {
      const teamCount = options.teamRoleCounts?.get(category.id) ?? 0;
      const destination =
        category.destinationChannelId === null ? 'sem destino' : `destino <#${category.destinationChannelId}>`;
      const team = teamCount === 0 ? 'sem equipe' : `equipe ${teamCount} cargo(s)`;

      return (
        `**${index + 1}. ${displayEmoji(category.emoji)} ${truncate(category.name, 60)}** — ${statusLabel(category)}\n` +
        `-# \`${category.identifier}\` • ${destination} • ${team}`
      );
    });
    root.addTextDisplayComponents(text(joinWithBudget(entries)));
  }

  root.addSeparatorComponents(separator());

  const empty = categories.length === 0;
  const full = categories.length >= BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD;

  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.CREATE))
        .setLabel('Criar')
        .setEmoji(EMOJIS.ADD)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(full),
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.EDIT))
        .setLabel('Editar')
        .setEmoji(EMOJIS.EDIT)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(empty),
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.MOVE_UP))
        .setLabel('Subir')
        .setEmoji(EMOJIS.UP)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(categories.length < 2),
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.MOVE_DOWN))
        .setLabel('Descer')
        .setEmoji(EMOJIS.DOWN)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(categories.length < 2),
    ),
  );

  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.TOGGLE))
        .setLabel('Ativar / Desativar')
        .setEmoji(EMOJIS.ENABLE)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(empty),
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.DELETE))
        .setLabel('Excluir')
        .setEmoji(EMOJIS.DELETE)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(empty),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(
      `${categories.length}/${BUSINESS_LIMITS.MAX_CATEGORIES_PER_GUILD} categorias • ` +
        'a exclusao e reversivel: os tickets historicos sao preservados.',
    ),
  );

  return sealed(root);
}

// ---------------------------------------------------------------------------
// Select de categorias
// ---------------------------------------------------------------------------

export interface CategorySelectOptions {
  /** Namespace do customId. Padrao: `category`. */
  namespace?: string;
  /** Argumentos extras do customId (ex.: direcao do movimento). */
  args?: readonly string[];
}

/**
 * Select com as categorias da guild.
 * O valor de cada opcao e o id da categoria — que continua sendo revalidado no
 * banco a cada acao (customId nunca e autorizacao).
 */
export function buildCategorySelectMenu(
  categories: readonly TicketCategory[],
  action: string,
  placeholder: string,
  options: CategorySelectOptions = {},
): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(
      buildCustomId(options.namespace ?? NAMESPACE.CATEGORY, action, ...(options.args ?? [])),
    )
    .setPlaceholder(truncate(placeholder, DISCORD_LIMITS.SELECT_PLACEHOLDER))
    .setMinValues(1)
    .setMaxValues(1);

  const choices = categories.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((category, index) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(truncate(`${index + 1}. ${category.name}`, DISCORD_LIMITS.SELECT_LABEL))
      .setValue(category.id)
      .setDescription(
        truncate(
          `${category.identifier} • ${category.enabled ? 'ativa' : 'inativa'}`,
          DISCORD_LIMITS.SELECT_DESCRIPTION,
        ),
      );

    const emoji = selectEmoji(category.emoji);
    if (emoji !== undefined) option.setEmoji(emoji);
    return option;
  });

  menu.addOptions(choices);
  return menu;
}

// ---------------------------------------------------------------------------
// Painel intermediario "escolha a categoria"
// ---------------------------------------------------------------------------

export interface CategoryPickerOptions {
  title: string;
  description: string;
  categories: readonly TicketCategory[];
  action: string;
  placeholder: string;
  accent?: number;
  args?: readonly string[];
  note?: string;
}

/** Painel de escolha usado por editar, mover, ativar/desativar e excluir. */
export function buildCategoryPickerPanel(options: CategoryPickerOptions): ContainerBuilder {
  const root = container(options.accent ?? COLORS.BRAND);
  addHeader(root, options.title);
  root.addTextDisplayComponents(text(options.description));
  root.addSeparatorComponents(separator());

  if (options.categories.length === 0) {
    root.addTextDisplayComponents(
      text(`${EMOJIS.DISABLE} **Nenhuma categoria disponivel para esta acao.**`),
    );
  } else {
    root.addActionRowComponents(
      selectRow(
        buildCategorySelectMenu(options.categories, options.action, options.placeholder, {
          args: options.args ?? [],
        }),
      ),
    );
  }

  root.addActionRowComponents(buttonRow(backButton()));

  if (options.note !== undefined) {
    root.addTextDisplayComponents(footerNote(options.note));
  }
  if (options.categories.length > DISCORD_LIMITS.SELECT_OPTIONS) {
    root.addTextDisplayComponents(
      footerNote(
        `Exibindo as primeiras ${DISCORD_LIMITS.SELECT_OPTIONS} de ${options.categories.length} categorias.`,
      ),
    );
  }

  return sealed(root);
}

// ---------------------------------------------------------------------------
// Modal de categoria
// ---------------------------------------------------------------------------

function labeled(
  label: string,
  description: string | null,
  input: TextInputBuilder,
): LabelBuilder {
  const builder = new LabelBuilder().setLabel(
    truncate(label, DISCORD_LIMITS.TEXT_INPUT_LABEL),
  );
  if (description !== null) builder.setDescription(truncate(description, 100));
  return builder.setTextInputComponent(input);
}

function categoryFields(current: TicketCategory | null): LabelBuilder[] {
  const nameInput = new TextInputBuilder()
    .setCustomId(CATEGORY_FIELD.NAME)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(BUSINESS_LIMITS.CATEGORY_NAME_MAX)
    .setPlaceholder('Ex.: Compras');

  const identifierInput = new TextInputBuilder()
    .setCustomId(CATEGORY_FIELD.IDENTIFIER)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(40)
    .setPlaceholder('Ex.: compras (deixe vazio para gerar do nome)');

  const descriptionInput = new TextInputBuilder()
    .setCustomId(CATEGORY_FIELD.DESCRIPTION)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX)
    .setPlaceholder('Texto curto exibido no menu do cliente.');

  const emojiInput = new TextInputBuilder()
    .setCustomId(CATEGORY_FIELD.EMOJI)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(64)
    .setPlaceholder('Ex.: 🛒 ou <:vook:123456789012345678>');

  if (current !== null) {
    nameInput.setValue(truncate(current.name, BUSINESS_LIMITS.CATEGORY_NAME_MAX));
    identifierInput.setValue(truncate(current.identifier, 40));
    if (current.description !== null && current.description.length > 0) {
      descriptionInput.setValue(
        truncate(current.description, BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX),
      );
    }
    if (current.emoji !== null && current.emoji.length > 0) {
      emojiInput.setValue(truncate(current.emoji, 64));
    }
  }

  return [
    labeled('Nome', 'Nome exibido ao cliente no menu de atendimento.', nameInput),
    labeled('Identificador', 'Chave tecnica unica. Gerada do nome se vazia.', identifierInput),
    labeled('Descricao', 'Opcional. Aparece abaixo do nome no menu.', descriptionInput),
    labeled('Emoji', 'Opcional. Um emoji unicode ou emoji do servidor.', emojiInput),
  ];
}

/**
 * Modal de criacao/edicao de categoria.
 * No modo `edit` a categoria e obrigatoria: o id vai no customId do modal e e
 * revalidado no submit.
 */
export function buildCategoryModal(
  mode: CategoryModalMode,
  category: TicketCategory | null = null,
): ModalBuilder {
  if (mode === 'edit') {
    if (category === null) {
      throw new ValidationError('Categoria ausente ao montar o modal de edicao.', {
        userMessage: 'Categoria nao encontrada. Atualize o painel e tente novamente.',
      });
    }
    return new ModalBuilder()
      .setCustomId(buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.EDIT_MODAL, category.id))
      .setTitle('VOOK STORE — EDITAR CATEGORIA')
      .addLabelComponents(categoryFields(category));
  }

  return new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATEGORY, CATEGORY_ACTION.CREATE_MODAL))
    .setTitle('VOOK STORE — NOVA CATEGORIA')
    .addLabelComponents(categoryFields(null));
}

// ---------------------------------------------------------------------------
// Destinos (categoria fisica do Discord)
// ---------------------------------------------------------------------------

/** Descreve o destino atual da categoria, sinalizando canais removidos. */
function destinationLabel(category: TicketCategory, guild: Guild): string {
  if (category.destinationChannelId === null) return `${EMOJIS.PENDING} destino nao definido`;

  const channel = guild.channels.cache.get(category.destinationChannelId);
  if (channel === undefined) {
    return `${EMOJIS.DISABLE} canal removido ou inacessivel (\`${category.destinationChannelId}\`)`;
  }
  if (channel.type !== ChannelType.GuildText) {
    return `${EMOJIS.DISABLE} <#${channel.id}> nao e uma categoria do Discord`;
  }
  return `${EMOJIS.ENABLE} <#${channel.id}>`;
}

export interface PanelNoticeOptions {
  notice?: string;
}

/** Painel raiz de destinos: onde os canais de cada categoria serao criados. */
export function buildDestinationPanel(
  categories: readonly TicketCategory[],
  guild: Guild,
  options: PanelNoticeOptions = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.DESTINATIONS);

  root.addTextDisplayComponents(
    intro(
      options.notice,
      `${EMOJIS.CHANNELS} O destino e a **categoria do Discord** onde os canais de ticket ` +
        'daquele setor serao criados. Sem destino, o canal e criado na raiz do servidor.',
    ),
  );
  root.addSeparatorComponents(separator());

  if (categories.length === 0) {
    root.addTextDisplayComponents(
      text(
        `${EMOJIS.DISABLE} **Nenhuma categoria cadastrada.**\n` +
          'Cadastre uma categoria em `/ticket-categorias gerenciar` antes de definir destinos.',
      ),
    );
    return sealed(root);
  }

  const entries = categories.map(
    (category, index) =>
      `**${index + 1}. ${displayEmoji(category.emoji)} ${truncate(category.name, 60)}**\n` +
      `-# ${destinationLabel(category, guild)}`,
  );
  root.addTextDisplayComponents(text(joinWithBudget(entries)));
  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    selectRow(
      buildCategorySelectMenu(
        categories,
        DESTINATION_ACTION.SELECT_CATEGORY,
        'Selecionar categoria para configurar o destino',
        { namespace: NAMESPACE.DESTINATION },
      ),
    ),
  );

  root.addTextDisplayComponents(
    footerNote('O bot precisa da permissao Gerenciar Canais na categoria escolhida.'),
  );

  return sealed(root);
}

/** Painel de edicao do destino de UMA categoria. */
export function buildDestinationEditPanel(
  category: TicketCategory,
  guild: Guild,
  options: PanelNoticeOptions = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.DESTINATIONS);

  root.addTextDisplayComponents(
    intro(
      options.notice,
      `**Categoria**\n${displayEmoji(category.emoji)} ${truncate(category.name, 60)} (\`${category.identifier}\`)\n\n` +
        `**Destino atual**\n${destinationLabel(category, guild)}`,
    ),
  );
  root.addSeparatorComponents(separator());

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(
      buildCustomId(NAMESPACE.DESTINATION, DESTINATION_ACTION.SELECT_CHANNEL, category.id),
    )
    .setPlaceholder('Selecionar o canal onde os tickets viram topicos')
    .addChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  const current =
    category.destinationChannelId === null
      ? undefined
      : guild.channels.cache.get(category.destinationChannelId);
  if (current !== undefined && current.type === ChannelType.GuildText) {
    channelSelect.setDefaultChannels(current.id);
  }

  root.addActionRowComponents(selectRow(channelSelect));
  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.DESTINATION, DESTINATION_ACTION.CLEAR, category.id))
        .setLabel('Limpar destino')
        .setEmoji(EMOJIS.REMOVE)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(category.destinationChannelId === null),
      backButton(BACK_TARGET.DESTINATION),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(
      'Cada ticket vira um TOPICO PRIVADO neste canal. Tickets ja abertos continuam ' +
        'onde estao; a mudanca vale para os proximos.',
    ),
  );

  return sealed(root);
}

// ---------------------------------------------------------------------------
// Equipes (cargos responsaveis por categoria)
// ---------------------------------------------------------------------------

function teamLabel(roleIds: readonly string[]): string {
  if (roleIds.length === 0) return `${EMOJIS.PENDING} nenhum cargo definido`;
  const shown = roleIds
    .slice(0, BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY)
    .map((roleId) => `<@&${roleId}>`)
    .join(' ');
  return `${EMOJIS.ENABLE} ${shown}`;
}

/** Painel raiz de equipes: quais cargos atendem cada categoria. */
export function buildTeamPanel(
  categories: readonly TicketCategory[],
  roleIdsByCategory: ReadonlyMap<string, string[]>,
  options: PanelNoticeOptions = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.TEAM);

  root.addTextDisplayComponents(
    intro(
      options.notice,
      `${EMOJIS.ROLE} A equipe de uma categoria e quem pode assumir, administrar e encerrar ` +
        'os atendimentos daquele setor — e quem recebe acesso ao canal do ticket.',
    ),
  );
  root.addSeparatorComponents(separator());

  if (categories.length === 0) {
    root.addTextDisplayComponents(
      text(
        `${EMOJIS.DISABLE} **Nenhuma categoria cadastrada.**\n` +
          'Cadastre uma categoria em `/ticket-categorias gerenciar` antes de definir equipes.',
      ),
    );
    return sealed(root);
  }

  const entries = categories.map(
    (category, index) =>
      `**${index + 1}. ${displayEmoji(category.emoji)} ${truncate(category.name, 60)}**\n` +
      `-# ${teamLabel(roleIdsByCategory.get(category.id) ?? [])}`,
  );
  root.addTextDisplayComponents(text(joinWithBudget(entries)));
  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    selectRow(
      buildCategorySelectMenu(
        categories,
        TEAM_ACTION.SELECT_CATEGORY,
        'Selecionar categoria para configurar a equipe',
        { namespace: NAMESPACE.TEAM },
      ),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(
      `Ate ${BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY} cargos por categoria • ` +
        'administradores do servidor sempre tem acesso.',
    ),
  );

  return sealed(root);
}

/** Painel de edicao da equipe de UMA categoria. */
export function buildTeamEditPanel(
  category: TicketCategory,
  roleIds: readonly string[],
  options: PanelNoticeOptions = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.TEAM);

  root.addTextDisplayComponents(
    intro(
      options.notice,
      `**Categoria**\n${displayEmoji(category.emoji)} ${truncate(category.name, 60)} (\`${category.identifier}\`)\n\n` +
        `**Equipe atual**\n${teamLabel(roleIds)}`,
    ),
  );
  root.addSeparatorComponents(separator());

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.TEAM, TEAM_ACTION.SELECT_ROLES, category.id))
    .setPlaceholder('Selecionar os cargos responsaveis por esta categoria')
    .setMinValues(0)
    .setMaxValues(BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY);

  const defaults = roleIds.slice(0, BUSINESS_LIMITS.MAX_TEAM_ROLES_PER_CATEGORY);
  if (defaults.length > 0) roleSelect.setDefaultRoles(defaults);

  root.addActionRowComponents(selectRow(roleSelect));
  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.TEAM, TEAM_ACTION.CLEAR, category.id))
        .setLabel('Limpar equipe')
        .setEmoji(EMOJIS.REMOVE)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(roleIds.length === 0),
      backButton(BACK_TARGET.TEAM),
    ),
  );

  root.addTextDisplayComponents(
    footerNote('Selecionar nenhum cargo remove toda a equipe desta categoria.'),
  );

  return sealed(root);
}
