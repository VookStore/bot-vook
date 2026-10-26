import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ContainerBuilder,
  type Guild,
  type ModalActionRowComponentBuilder,
} from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import {
  addHeader,
  bullets,
  buttonRow,
  container,
  field,
  fields,
  footerNote,
  selectRow,
  separator,
  text,
} from '../../../components/v2';
import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { CONFIG_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import { isSafeImageUrl, sanitizeConfigText, truncate } from '../../../utils/sanitize';

/**
 * Paineis de configuracao geral da guild (Components V2).
 *
 * Segue o padrao visual do painel publico de atendimento:
 * cabecalho -> blocos de estado separados -> controles no rodape.
 *
 * LIMITE RESPEITADO: um Container aceita no maximo 10 componentes filhos e uma
 * mensagem aceita no maximo 5 action rows. Por isso os blocos de estado sao
 * agrupados em poucos TextDisplay em vez de um componente por secao.
 *
 * Nenhum builder daqui concede permissao: quem trata a interacao revalida
 * `assertCanManageSystem` antes de qualquer leitura ou escrita.
 */

// ---------------------------------------------------------------------------
// Contratos compartilhados com os handlers
// ---------------------------------------------------------------------------

/** Chaves aceitas no customId do select de canais. */
export const CONFIG_CHANNEL_KEYS = ['panel', 'log', 'welcome', 'review'] as const;
export type ConfigChannelKey = (typeof CONFIG_CHANNEL_KEYS)[number];

/** customIds dos campos do modal de textos/visual. */
export const VISUAL_FIELD = {
  STORE_NAME: 'store-name',
  PANEL_TITLE: 'panel-title',
  PANEL_DESCRIPTION: 'panel-description',
  PANEL_NOTICE: 'panel-notice',
  IMAGES: 'panel-images',
} as const;

/** customIds dos campos do modal de limites. */
export const LIMITS_FIELD = {
  MAX_PER_USER: 'max-user',
  MAX_GUILD: 'max-guild',
  CREATE_COOLDOWN: 'cooldown-create',
  NOTIFY_COOLDOWN: 'cooldown-notify',
  RENAME_COOLDOWN: 'cooldown-rename',
} as const;

/** Intervalos aceitos nos limites (usados na validacao e nas dicas do painel). */
export const CONFIG_LIMIT_RANGES = {
  MAX_TICKETS_PER_USER: { min: 1, max: 10 },
  MAX_TICKETS_GUILD: { min: 1, max: 10_000 },
  COOLDOWN_SECONDS: { min: 0, max: 3600 },
} as const;

/** Rotulos exibidos ao usuario para cada canal configuravel. */
export const CHANNEL_LABEL: Record<ConfigChannelKey, string> = {
  panel: 'Canal do painel publico',
  log: 'Canal de logs de tickets',
  welcome: 'Canal de boas-vindas',
  review: 'Canal de avaliacoes',
};

/** Separador das tres URLs no campo unico de imagens do modal visual. */
export const IMAGE_FIELD_SEPARATOR = ' | ';

/** Tamanhos maximos aceitos nos textos configuraveis. */
export const CONFIG_TEXT_LIMITS = {
  STORE_NAME: 60,
  PANEL_TITLE: 200,
  PANEL_DESCRIPTION: 1200,
  PANEL_NOTICE: 1000,
  /**
   * O campo de imagens carrega TRES URLs de uma vez, cada uma podendo chegar ao
   * teto de `IMAGE_URL_MAX`. O numero e DERIVADO por necessidade: o `TextInput`
   * do Discord recusa `value` maior que `max_length`, entao `modalInput` trunca
   * o preenchimento para nao tomar 400. Com um teto curto, quem abrisse o modal
   * so para trocar o nome da loja salvaria a terceira URL cortada — o banner do
   * ticket sumia sem nenhum aviso.
   */
  IMAGES: BUSINESS_LIMITS.IMAGE_URL_MAX * 3 + IMAGE_FIELD_SEPARATOR.length * 2,
} as const;

// ---------------------------------------------------------------------------
// Formatacao de estado
// ---------------------------------------------------------------------------

const NOT_CONFIGURED = 'Nao configurado';

/**
 * Prefixo de subtitulo usado dentro de um bloco de texto agrupado.
 * Equivale ao helper `subheading`, mas sem gastar um componente do container.
 */
const SUBHEADING_PREFIX = '### ';

function onOff(enabled: boolean): string {
  return enabled ? `${EMOJIS.ENABLE} Ativado` : `${EMOJIS.DISABLE} Desativado`;
}

/** Menciona o canal ou avisa que ele nao existe mais no servidor. */
function channelState(guild: Guild, channelId: string | null): string {
  if (channelId === null || channelId.length === 0) return NOT_CONFIGURED;
  if (!guild.channels.cache.has(channelId)) return `<#${channelId}> — canal indisponivel`;
  return `<#${channelId}>`;
}

function roleState(guild: Guild, roleId: string | null): string {
  if (roleId === null || roleId.length === 0) return NOT_CONFIGURED;
  if (!guild.roles.cache.has(roleId)) return `<@&${roleId}> — cargo removido`;
  return `<@&${roleId}>`;
}

function textState(value: string | null, max = 90): string {
  if (value === null || value.trim().length === 0) return NOT_CONFIGURED;
  return truncate(value.replace(/\n+/g, ' ').trim(), max);
}

function urlState(value: string | null): string {
  if (value === null || value.length === 0) return NOT_CONFIGURED;
  if (!isSafeImageUrl(value)) return 'URL invalida (sera ignorada)';
  return truncate(value, 90);
}

function seconds(value: number): string {
  return `${value}s`;
}

// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------

function configButton(
  action: string,
  label: string,
  emoji: string | null,
  style: ButtonStyle = ButtonStyle.Secondary,
): ButtonBuilder {
  const button = new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CONFIG, action))
    .setLabel(truncate(label, DISCORD_LIMITS.BUTTON_LABEL))
    .setStyle(style);
  if (emoji !== null) button.setEmoji({ name: emoji });
  return button;
}

function backButton(): ButtonBuilder {
  return configButton(CONFIG_ACTION.BACK, 'Voltar', null, ButtonStyle.Secondary);
}

// ---------------------------------------------------------------------------
// Menu principal
// ---------------------------------------------------------------------------

/**
 * Menu principal: mostra o estado completo da configuracao da guild e leva
 * para cada sub-painel.
 */
export function buildConfigMenu(config: GuildConfig, guild: Guild): ContainerBuilder {
  const root = container(COLORS.BRAND);

  // 8 componentes: cabecalho, separador, texto, separador, texto, separador,
  // linha de botoes e rodape.
  addHeader(root, TITLES.CONFIG, {
    thumbnailUrl: isSafeImageUrl(config.panelThumbnailUrl) ? config.panelThumbnailUrl : null,
  });

  root.addTextDisplayComponents(
    text(
      [
        field('Nome visual da loja', config.storeName),
        `${SUBHEADING_PREFIX}${EMOJIS.CHANNELS} Canais`,
        fields([
          [CHANNEL_LABEL.panel, channelState(guild, config.ticketPanelChannelId)],
          [CHANNEL_LABEL.log, channelState(guild, config.ticketLogChannelId)],
          [CHANNEL_LABEL.welcome, channelState(guild, config.welcomeChannelId)],
          [CHANNEL_LABEL.review, channelState(guild, config.reviewChannelId)],
        ]),
      ].join('\n\n'),
    ),
  );
  root.addSeparatorComponents(separator());

  root.addTextDisplayComponents(
    text(
      [
        `${SUBHEADING_PREFIX}${EMOJIS.ROLE} Entrada de membros`,
        fields([
          ['Auto-role', `${onOff(config.autoRoleEnabled)}\n${roleState(guild, config.autoRoleId)}`],
          ['Mensagem de boas-vindas', onOff(config.welcomeEnabled)],
        ]),
        `${SUBHEADING_PREFIX}${EMOJIS.ADMIN} Limites e cooldowns`,
        fields([
          ['Tickets abertos por usuario', String(config.maxOpenTicketsPerUser)],
          ['Tickets abertos no servidor', String(config.maxOpenTicketsGuild)],
          ['Cooldown de criacao', seconds(config.ticketCreateCooldownSeconds)],
          ['Cooldown de notificacao', seconds(config.clientNotifyCooldownSeconds)],
          ['Cooldown de renomear', seconds(config.renameCooldownSeconds)],
        ]),
      ].join('\n\n'),
    ),
  );
  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    buttonRow(
      configButton(CONFIG_ACTION.CHANNELS, 'Canais', EMOJIS.CHANNELS),
      configButton(CONFIG_ACTION.AUTOROLE, 'Auto-Role', EMOJIS.ROLE),
      configButton(CONFIG_ACTION.VISUAL, 'Visual', EMOJIS.VISUAL),
      configButton(CONFIG_ACTION.LIMITS, 'Limites', EMOJIS.ADMIN),
      configButton(
        CONFIG_ACTION.REFRESH_PANEL,
        'Atualizar Painel',
        EMOJIS.REFRESH,
        ButtonStyle.Secondary,
      ),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(
      `Configuracao de ${sanitizeConfigText(guild.name, 60)} — vale apenas para este servidor.`,
    ),
  );

  return root;
}

// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------

function channelSelect(
  key: ConfigChannelKey,
  guild: Guild,
  currentId: string | null,
): ChannelSelectMenuBuilder {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CONFIG, CONFIG_ACTION.CHANNEL_SELECT, key))
    .setPlaceholder(truncate(CHANNEL_LABEL[key], DISCORD_LIMITS.SELECT_PLACEHOLDER))
    .addChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);

  // So marca o padrao quando o canal ainda existe: a API recusa IDs invalidos.
  if (currentId !== null && currentId.length > 0 && guild.channels.cache.has(currentId)) {
    menu.setDefaultChannels(currentId);
  }
  return menu;
}

/**
 * Painel de canais: um select por canal (4 linhas) + a linha de botoes.
 * Sao exatamente 5 action rows — o maximo permitido em uma mensagem.
 */
export function buildChannelsPanel(config: GuildConfig, guild: Guild): ContainerBuilder {
  const root = container(COLORS.INFO);

  // 9 componentes: cabecalho, separador, texto, 4 selects, botoes e rodape.
  addHeader(root, TITLES.CONFIG);

  root.addTextDisplayComponents(
    text(
      [
        `${SUBHEADING_PREFIX}${EMOJIS.CHANNELS} Canais do sistema`,
        bullets([
          `${CHANNEL_LABEL.panel}: ${channelState(guild, config.ticketPanelChannelId)}`,
          `${CHANNEL_LABEL.log}: ${channelState(guild, config.ticketLogChannelId)}`,
          `${CHANNEL_LABEL.welcome}: ${channelState(guild, config.welcomeChannelId)}`,
          `${CHANNEL_LABEL.review}: ${channelState(guild, config.reviewChannelId)}`,
        ]),
        'O painel publico recebe a central de atendimento; os logs guardam cada ticket finalizado; boas-vindas e avaliacoes publicam as mensagens automaticas.',
      ].join('\n\n'),
    ),
  );

  root.addActionRowComponents(selectRow(channelSelect('panel', guild, config.ticketPanelChannelId)));
  root.addActionRowComponents(selectRow(channelSelect('log', guild, config.ticketLogChannelId)));
  root.addActionRowComponents(selectRow(channelSelect('welcome', guild, config.welcomeChannelId)));
  root.addActionRowComponents(selectRow(channelSelect('review', guild, config.reviewChannelId)));
  root.addActionRowComponents(buttonRow(backButton()));

  root.addTextDisplayComponents(
    footerNote('Selecione nenhum canal (desmarcando o atual) para limpar a configuracao.'),
  );

  return root;
}

// ---------------------------------------------------------------------------
// Auto-role e boas-vindas
// ---------------------------------------------------------------------------

/** Painel de auto-role: select de cargo + interruptores de auto-role e boas-vindas. */
export function buildAutoRolePanel(config: GuildConfig, guild: Guild): ContainerBuilder {
  const root = container(COLORS.INFO);

  // 7 componentes: cabecalho, separador, texto, separador, select, botoes e rodape.
  addHeader(root, TITLES.CONFIG);

  root.addTextDisplayComponents(
    text(
      [
        `${SUBHEADING_PREFIX}${EMOJIS.ROLE} Auto-role e boas-vindas`,
        fields([
          ['Cargo automatico', roleState(guild, config.autoRoleId)],
          ['Auto-role', onOff(config.autoRoleEnabled)],
          ['Mensagem de boas-vindas', onOff(config.welcomeEnabled)],
          [CHANNEL_LABEL.welcome, channelState(guild, config.welcomeChannelId)],
        ]),
      ].join('\n\n'),
    ),
  );
  root.addSeparatorComponents(separator());

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CONFIG, CONFIG_ACTION.AUTOROLE_SELECT))
    .setPlaceholder('Cargo entregue a quem entrar no servidor')
    .setMinValues(0)
    .setMaxValues(1);

  if (
    config.autoRoleId !== null &&
    config.autoRoleId.length > 0 &&
    guild.roles.cache.has(config.autoRoleId)
  ) {
    roleSelect.setDefaultRoles(config.autoRoleId);
  }

  root.addActionRowComponents(selectRow(roleSelect));
  root.addActionRowComponents(
    buttonRow(
      configButton(
        CONFIG_ACTION.AUTOROLE_TOGGLE,
        config.autoRoleEnabled ? 'Desativar auto-role' : 'Ativar auto-role',
        config.autoRoleEnabled ? EMOJIS.DISABLE : EMOJIS.ENABLE,
        config.autoRoleEnabled ? ButtonStyle.Secondary : ButtonStyle.Secondary,
      ),
      configButton(
        CONFIG_ACTION.WELCOME_TOGGLE,
        config.welcomeEnabled ? 'Desativar boas-vindas' : 'Ativar boas-vindas',
        config.welcomeEnabled ? EMOJIS.DISABLE : EMOJIS.ENABLE,
        config.welcomeEnabled ? ButtonStyle.Secondary : ButtonStyle.Secondary,
      ),
      backButton(),
    ),
  );

  root.addTextDisplayComponents(
    footerNote('O cargo precisa estar abaixo do cargo do bot na hierarquia do servidor.'),
  );

  return root;
}

// ---------------------------------------------------------------------------
// Visual (textos e imagens do painel publico)
// ---------------------------------------------------------------------------

/** Painel visual: mostra os textos atuais e abre o modal de edicao. */
export function buildVisualPanel(config: GuildConfig): ContainerBuilder {
  const root = container(COLORS.BRAND);

  // 6 componentes: cabecalho, separador, texto, separador, botoes e rodape.
  addHeader(root, TITLES.CONFIG);

  root.addTextDisplayComponents(
    text(
      [
        `${SUBHEADING_PREFIX}${EMOJIS.VISUAL} Identidade do painel publico`,
        fields([
          ['Nome visual da loja', textState(config.storeName)],
          ['Titulo do painel', textState(config.panelTitle)],
          ['Descricao do painel', textState(config.panelDescription, 200)],
          ['Avisos do painel', textState(config.panelNotice, 200)],
          ['Thumbnail', urlState(config.panelThumbnailUrl)],
          ['Banner', urlState(config.panelBannerUrl)],
        ]),
      ].join('\n\n'),
    ),
  );
  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    buttonRow(
      configButton(CONFIG_ACTION.VISUAL_MODAL, 'Editar textos', EMOJIS.EDIT, ButtonStyle.Secondary),
      backButton(),
    ),
  );

  root.addTextDisplayComponents(
    footerNote('Apos salvar, use "Atualizar Painel" para republicar a central de atendimento.'),
  );

  return root;
}

function modalRow(input: TextInputBuilder): ActionRowBuilder<ModalActionRowComponentBuilder> {
  return new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
}

function modalInput(params: {
  customId: string;
  label: string;
  style: TextInputStyle;
  required: boolean;
  maxLength: number;
  value?: string | null;
  placeholder?: string;
}): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(params.customId)
    .setLabel(truncate(params.label, DISCORD_LIMITS.TEXT_INPUT_LABEL))
    .setStyle(params.style)
    .setRequired(params.required)
    .setMaxLength(Math.min(params.maxLength, DISCORD_LIMITS.TEXT_INPUT_SHORT_VALUE));

  if (params.placeholder !== undefined) {
    input.setPlaceholder(truncate(params.placeholder, DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));
  }
  if (params.value !== undefined && params.value !== null && params.value.length > 0) {
    input.setValue(truncate(params.value, params.maxLength));
  }
  return input;
}

/** Modal de textos: nome da loja, titulo, descricao, avisos e as duas imagens. */
export function buildVisualModal(config: GuildConfig): ModalBuilder {
  const partes = [
    config.panelThumbnailUrl ?? '',
    config.panelBannerUrl ?? '',
    config.ticketBannerUrl ?? '',
  ];
  const images = partes.some((parte) => parte.length > 0)
    ? partes.join(IMAGE_FIELD_SEPARATOR)
    : '';

  return new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CONFIG, CONFIG_ACTION.VISUAL_MODAL))
    .setTitle(truncate('Vook Store — Textos do painel', DISCORD_LIMITS.MODAL_TITLE))
    .addComponents(
      modalRow(
        modalInput({
          customId: VISUAL_FIELD.STORE_NAME,
          label: 'Nome visual da loja',
          style: TextInputStyle.Short,
          required: true,
          maxLength: CONFIG_TEXT_LIMITS.STORE_NAME,
          value: config.storeName,
        }),
      ),
      modalRow(
        modalInput({
          customId: VISUAL_FIELD.PANEL_TITLE,
          label: 'Titulo do painel',
          style: TextInputStyle.Short,
          required: true,
          maxLength: CONFIG_TEXT_LIMITS.PANEL_TITLE,
          value: config.panelTitle,
        }),
      ),
      modalRow(
        modalInput({
          customId: VISUAL_FIELD.PANEL_DESCRIPTION,
          label: 'Descricao do painel',
          style: TextInputStyle.Paragraph,
          required: true,
          maxLength: CONFIG_TEXT_LIMITS.PANEL_DESCRIPTION,
          value: config.panelDescription,
        }),
      ),
      modalRow(
        modalInput({
          customId: VISUAL_FIELD.PANEL_NOTICE,
          label: 'Avisos do painel',
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: CONFIG_TEXT_LIMITS.PANEL_NOTICE,
          value: config.panelNotice,
          placeholder: 'Deixe vazio para nao exibir avisos.',
        }),
      ),
      modalRow(
        modalInput({
          customId: VISUAL_FIELD.IMAGES,
          label: 'Thumbnail | Banner painel | Banner ticket',
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: CONFIG_TEXT_LIMITS.IMAGES,
          value: images,
          placeholder: 'https://.../logo.png | https://.../painel.png | https://.../ticket.gif',
        }),
      ),
    );
}

// ---------------------------------------------------------------------------
// Limites e cooldowns
// ---------------------------------------------------------------------------

function rangeHint(range: { min: number; max: number }): string {
  return `permitido de ${range.min} a ${range.max}`;
}

/** Painel de limites: mostra os valores atuais e abre o modal de edicao. */
export function buildLimitsPanel(config: GuildConfig): ContainerBuilder {
  const root = container(COLORS.WARNING);

  // 6 componentes: cabecalho, separador, texto, separador, botoes e rodape.
  addHeader(root, TITLES.CONFIG);

  root.addTextDisplayComponents(
    text(
      `${SUBHEADING_PREFIX}${EMOJIS.ADMIN} Limites e cooldowns\n\n` +
      fields([
        [
          'Tickets abertos por usuario',
          `${config.maxOpenTicketsPerUser} (${rangeHint(CONFIG_LIMIT_RANGES.MAX_TICKETS_PER_USER)})`,
        ],
        [
          'Tickets abertos no servidor',
          `${config.maxOpenTicketsGuild} (${rangeHint(CONFIG_LIMIT_RANGES.MAX_TICKETS_GUILD)})`,
        ],
        [
          'Cooldown de criacao',
          `${seconds(config.ticketCreateCooldownSeconds)} (${rangeHint(CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS)})`,
        ],
        [
          'Cooldown de notificacao',
          `${seconds(config.clientNotifyCooldownSeconds)} (${rangeHint(CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS)})`,
        ],
        [
          'Cooldown de renomear',
          `${seconds(config.renameCooldownSeconds)} (${rangeHint(CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS)})`,
        ],
      ]),
    ),
  );
  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    buttonRow(
      configButton(CONFIG_ACTION.LIMITS_MODAL, 'Editar limites', EMOJIS.EDIT, ButtonStyle.Secondary),
      backButton(),
    ),
  );

  root.addTextDisplayComponents(footerNote('Use 0 para desativar um cooldown.'));

  return root;
}

/** Modal de limites: cinco campos numericos inteiros. */
export function buildLimitsModal(config: GuildConfig): ModalBuilder {
  const numberInput = (
    customId: string,
    label: string,
    value: number,
    range: { min: number; max: number },
  ): ActionRowBuilder<ModalActionRowComponentBuilder> =>
    modalRow(
      modalInput({
        customId,
        label,
        style: TextInputStyle.Short,
        required: true,
        maxLength: 5,
        value: String(value),
        placeholder: `Numero inteiro de ${range.min} a ${range.max}`,
      }),
    );

  return new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CONFIG, CONFIG_ACTION.LIMITS_MODAL))
    .setTitle(truncate('Vook Store — Limites', DISCORD_LIMITS.MODAL_TITLE))
    .addComponents(
      numberInput(
        LIMITS_FIELD.MAX_PER_USER,
        'Max tickets por usuario',
        config.maxOpenTicketsPerUser,
        CONFIG_LIMIT_RANGES.MAX_TICKETS_PER_USER,
      ),
      numberInput(
        LIMITS_FIELD.MAX_GUILD,
        'Max tickets no servidor',
        config.maxOpenTicketsGuild,
        CONFIG_LIMIT_RANGES.MAX_TICKETS_GUILD,
      ),
      numberInput(
        LIMITS_FIELD.CREATE_COOLDOWN,
        'Cooldown de criacao (s)',
        config.ticketCreateCooldownSeconds,
        CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS,
      ),
      numberInput(
        LIMITS_FIELD.NOTIFY_COOLDOWN,
        'Cooldown de notificacao (s)',
        config.clientNotifyCooldownSeconds,
        CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS,
      ),
      numberInput(
        LIMITS_FIELD.RENAME_COOLDOWN,
        'Cooldown de rename (s)',
        config.renameCooldownSeconds,
        CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS,
      ),
    );
}
