import {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Guild } from 'discord.js';
import type { CatalogCategory, CatalogPack, GuildConfig, PackImage } from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { CATALOG_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  bullets,
  buttonRow,
  container,
  fields,
  footerNote,
  selectRow,
  separator,
  text,
} from '../../../components/v2';
import { ValidationError } from '../../../core/errors';
import { formatCents } from '../../../utils/money';
import { truncate } from '../../../utils/sanitize';
import { formatPackDetails } from '../validators/packValidators';
import {
  CATEGORY_PICK_KIND,
  IMAGE_PICK_KIND,
  PACK_PICK_KIND,
  type CategoryPickKind,
  type ImagePickKind,
  type PackPickKind,
} from '../types/catalog';

/**
 * Administracao do catalogo (Components V2).
 *
 * Formularios respeitam o limite REAL do Discord: 5 campos por modal. Por isso
 * o cadastro e dividido — dados comerciais em um modal, ficha tecnica em outro,
 * imagens em um painel proprio. Espremer tudo em um formulario so seria
 * recusado pela API.
 */

/** Ids dos campos dos formularios (usados no builder e no handler). */
export const PACK_FIELD = {
  NAME: 'nome',
  SKU: 'sku',
  PRICE: 'preco',
  SHORT: 'resumo',
  DESCRIPTION: 'descricao',
  DETAILS: 'detalhes',
  IMAGE_URL: 'url',
  IMAGE_ALT: 'alt',
} as const;

export const CATEGORY_FIELD = {
  NAME: 'nome',
  DESCRIPTION: 'descricao',
  EMOJI: 'emoji',
} as const;

function adminButton(
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

export function adminBackButton(): ButtonBuilder {
  return adminButton(CATALOG_ACTION.ADMIN, EMOJIS.BACK, 'Voltar');
}

function modalField(options: {
  customId: string;
  label: string;
  description: string;
  placeholder: string;
  style: TextInputStyle;
  maxLength: number;
  required: boolean;
  value?: string | null;
}): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(options.customId)
    .setStyle(options.style)
    .setRequired(options.required)
    .setMaxLength(options.maxLength)
    .setPlaceholder(truncate(options.placeholder, DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));

  if (options.value !== undefined && options.value !== null && options.value.length > 0) {
    input.setValue(truncate(options.value, options.maxLength));
  }

  return new LabelBuilder()
    .setLabel(truncate(options.label, DISCORD_LIMITS.TEXT_INPUT_LABEL))
    .setDescription(truncate(options.description, DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER))
    .setTextInputComponent(input);
}

// ---------------------------------------------------------------------------
// Painel principal
// ---------------------------------------------------------------------------

export interface CatalogAdminStats {
  packs: number;
  activePacks: number;
  featured: number;
  categories: number;
  packsWithoutImage: number;
  packsWithoutPrice: number;
}

/**
 * Painel administrativo com diagnostico rapido do catalogo.
 *
 * LIMITE: um Container aceita 10 filhos. Aviso, estatisticas e alertas ficam em
 * UM unico TextDisplay de proposito — cada um em bloco separado, com divisor,
 * estouraria o limite justamente no pior caso (catalogo recem-criado, cheio de
 * alertas) e a mensagem inteira seria recusada com 400.
 */
export function buildCatalogAdminPanel(
  stats: CatalogAdminStats,
  options: { notice?: string } = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CATALOG_ADMIN);

  const warnings: string[] = [];
  if (stats.categories === 0) {
    warnings.push('Nenhuma categoria cadastrada — crie uma antes de cadastrar packs.');
  }
  if (stats.packsWithoutImage > 0) {
    warnings.push(`${stats.packsWithoutImage} pack(s) sem imagem de capa.`);
  }
  if (stats.packsWithoutPrice > 0) {
    warnings.push(`${stats.packsWithoutPrice} pack(s) sem preco valido (nao vendem).`);
  }

  const blocks: string[] = [];
  if (options.notice !== undefined && options.notice.length > 0) blocks.push(options.notice);

  blocks.push(
    fields([
      ['Packs cadastrados', String(stats.packs)],
      ['Ativos', String(stats.activePacks)],
      ['Em destaque', String(stats.featured)],
      ['Categorias', String(stats.categories)],
    ]),
  );

  if (warnings.length > 0) blocks.push(`⚠️ **Atencao**\n${bullets(warnings)}`);

  root.addTextDisplayComponents(text(blocks.join('\n\n')));
  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(
      adminButton(CATALOG_ACTION.PACK_NEW, EMOJIS.ADD, 'Criar Pack'),
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.EDIT, 'Editar Pack', PACK_PICK_KIND.EDIT, '1'),
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.IMAGE, 'Imagens', PACK_PICK_KIND.IMAGES, '1'),
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.LIST, 'Ficha Tecnica', PACK_PICK_KIND.DETAILS, '1'),
      adminButton(CATALOG_ACTION.CATEGORIES, EMOJIS.CHANNELS, 'Categorias'),
    ),
  );
  root.addActionRowComponents(
    buttonRow(
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.PRICE, 'Precos', PACK_PICK_KIND.PRICE, '1'),
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.FEATURED, 'Destaques', PACK_PICK_KIND.FEATURE, '1'),
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.ENABLE, 'Ativar/Desativar', PACK_PICK_KIND.TOGGLE, '1'),
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.TRANSFER, 'Mover Categoria', PACK_PICK_KIND.CATEGORY, '1'),
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.DELETE, 'Excluir', PACK_PICK_KIND.DELETE, '1'),
    ),
  );
  root.addActionRowComponents(
    buttonRow(adminButton(CATALOG_ACTION.ORDER_CHANNEL, EMOJIS.CHANNELS, 'Canal de Pedidos')),
  );

  root.addTextDisplayComponents(
    footerNote('Somente administradores do servidor conseguem usar este painel.'),
  );

  return root;
}

/**
 * Canal onde a equipe recebe os novos pedidos.
 *
 * Fica aqui, e nao em `/ticket-config geral`: aquele painel ja usa as 5 action
 * rows que uma mensagem aceita, e um sexto select simplesmente nao chegaria ao
 * Discord.
 */
export function buildOrderChannelPanel(
  config: GuildConfig,
  guild: Guild,
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.CATALOG_ADMIN, { subtitle: 'Canal de pedidos da equipe' });

  const current =
    config.orderChannelId !== null && guild.channels.cache.has(config.orderChannelId)
      ? `<#${config.orderChannelId}>`
      : 'Nao configurado';

  root.addTextDisplayComponents(
    text(
      `${fields([['Canal atual', current]])}\n\n` +
        'Cada novo pedido e publicado neste canal para a equipe assumir. ' +
        'Escolha um canal **interno**: o aviso mostra cliente e valores.\n' +
        'Sem canal configurado, os pedidos continuam acessiveis por `/pedidos gerenciar`.',
    ),
  );

  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.ORDER_CHANNEL_SELECT))
    .setPlaceholder('Canal que recebera os novos pedidos')
    .addChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);

  // So marca o padrao quando o canal ainda existe: a API recusa ID invalido.
  if (config.orderChannelId !== null && guild.channels.cache.has(config.orderChannelId)) {
    menu.setDefaultChannels(config.orderChannelId);
  }

  root.addActionRowComponents(selectRow(menu));
  root.addActionRowComponents(buttonRow(adminBackButton()));
  root.addTextDisplayComponents(
    footerNote('Desmarque o canal atual para deixar de publicar os pedidos.'),
  );

  return root;
}

// ---------------------------------------------------------------------------
// Selecao de pack (paginada)
// ---------------------------------------------------------------------------

const PACK_PICK_TITLES: Record<PackPickKind, { title: string; instruction: string }> = {
  [PACK_PICK_KIND.EDIT]: {
    title: 'EDITAR PACK',
    instruction: 'Escolha o pack a editar. O formulario abre ja preenchido.',
  },
  [PACK_PICK_KIND.PRICE]: {
    title: 'ALTERAR PRECO',
    instruction:
      'Escolha o pack. Alterar o preco NAO muda pedidos ja criados — eles guardam o valor da compra.',
  },
  [PACK_PICK_KIND.TOGGLE]: {
    title: 'ATIVAR / DESATIVAR',
    instruction:
      'Pack desativado some da vitrine e sai dos carrinhos, mas continua nos pedidos historicos.',
  },
  [PACK_PICK_KIND.FEATURE]: {
    title: 'DESTAQUES',
    instruction: 'Packs em destaque aparecem no topo da vitrine e na home do catalogo.',
  },
  [PACK_PICK_KIND.DELETE]: {
    title: 'EXCLUIR PACK',
    instruction:
      'A exclusao e logica: o pack some da loja, mas os pedidos ja emitidos continuam intactos.',
  },
  [PACK_PICK_KIND.IMAGES]: {
    title: 'IMAGENS DO PACK',
    instruction: 'Escolha o pack para gerenciar a galeria de imagens.',
  },
  [PACK_PICK_KIND.DETAILS]: {
    title: 'FICHA TECNICA',
    instruction: 'Escolha o pack para editar compatibilidade, quantidade, formato e afins.',
  },
  [PACK_PICK_KIND.CATEGORY]: {
    title: 'MOVER CATEGORIA',
    instruction: 'Escolha o pack que mudara de categoria.',
  },
};

/**
 * Seletor de packs paginado.
 *
 * Um select aceita 25 opcoes; uma loja com centenas de packs precisa paginar —
 * jogar tudo em um menu so simplesmente nao chega ao Discord.
 */
export function buildPackPickerPanel(params: {
  kind: PackPickKind;
  packs: readonly CatalogPack[];
  page: number;
  totalPages: number;
  total: number;
}): ContainerBuilder {
  const copy = PACK_PICK_TITLES[params.kind];
  const root = container(COLORS.INFO);
  addHeader(root, `VOOK STORE — ${copy.title}`, { subtitle: copy.instruction });

  if (params.packs.length === 0) {
    root.addTextDisplayComponents(
      text('Nenhum pack cadastrado ainda. Use "Criar Pack" para comecar.'),
    );
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(buttonRow(adminBackButton()));
    return root;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PACK_PICK_SELECT, params.kind))
    .setPlaceholder('Selecione o pack')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    params.packs.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((pack) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(truncate(pack.name, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            `${formatCents(pack.price)} • ${pack.enabled ? 'ativo' : 'desativado'}${pack.featured ? ' • destaque' : ''}`,
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(pack.id);
      option.setEmoji(pack.enabled ? EMOJIS.ENABLE : EMOJIS.DISABLE);
      return option;
    }),
  );

  root.addActionRowComponents(selectRow(menu));

  const navigation: ButtonBuilder[] = [];
  if (params.totalPages > 1) {
    navigation.push(
      adminButton(
        CATALOG_ACTION.PACK_PICK,
        EMOJIS.PREVIOUS,
        'Anterior',
        params.kind,
        String(params.page - 1 < 1 ? params.totalPages : params.page - 1),
      ),
      adminButton(
        CATALOG_ACTION.PACK_PICK,
        EMOJIS.NEXT,
        'Proxima',
        params.kind,
        String(params.page + 1 > params.totalPages ? 1 : params.page + 1),
      ),
    );
  }
  navigation.push(adminBackButton());
  root.addActionRowComponents(buttonRow(...navigation));

  root.addTextDisplayComponents(
    footerNote(`Pagina ${params.page}/${params.totalPages} • ${params.total} pack(s)`),
  );

  return root;
}

/** Seletor de categoria usado na criacao e na movimentacao de packs. */
export function buildCategoryChooserPanel(params: {
  categories: readonly CatalogCategory[];
  action: string;
  title: string;
  instruction: string;
  args?: readonly string[];
}): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, params.title, { subtitle: params.instruction });

  if (params.categories.length === 0) {
    root.addTextDisplayComponents(
      text(
        '⚠️ Nenhuma categoria cadastrada.\nCrie uma categoria antes de cadastrar produtos — ' +
          'um pack ativo sem categoria valida nao aparece na vitrine.',
      ),
    );
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(
      buttonRow(
        adminButton(CATALOG_ACTION.CATEGORIES, EMOJIS.CHANNELS, 'Ir para Categorias'),
        adminBackButton(),
      ),
    );
    return root;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, params.action, ...(params.args ?? [])))
    .setPlaceholder('Selecione a categoria')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    params.categories.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((category) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(truncate(category.name, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            category.description ?? (category.enabled ? 'Categoria ativa' : 'Categoria desativada'),
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(category.id);
      if (category.emoji !== null && category.emoji.length > 0) option.setEmoji(category.emoji);
      return option;
    }),
  );

  root.addActionRowComponents(selectRow(menu));
  root.addActionRowComponents(buttonRow(adminBackButton()));
  return root;
}

// ---------------------------------------------------------------------------
// Formularios de pack
// ---------------------------------------------------------------------------

/** Formulario comercial do pack (5 campos — o maximo permitido). */
export function buildPackModal(
  mode: 'create' | 'edit',
  params: { categoryId?: string; pack?: CatalogPack },
): ModalBuilder {
  if (mode === 'edit' && params.pack === undefined) {
    throw new ValidationError('Modal de edicao exige o pack carregado.', {
      userMessage: 'Nao foi possivel abrir este pack. Atualize o painel e tente novamente.',
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(
      mode === 'create'
        ? buildCustomId(
            NAMESPACE.CATALOG,
            CATALOG_ACTION.PACK_NEW_MODAL,
            params.categoryId ?? '',
          )
        : buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PACK_EDIT_MODAL, params.pack?.id ?? ''),
    )
    .setTitle(mode === 'create' ? 'VOOK STORE — NOVO PACK' : 'VOOK STORE — EDITAR PACK');

  modal.addLabelComponents(
    modalField({
      customId: PACK_FIELD.NAME,
      label: 'Nome do pack',
      description: 'Aparece na vitrine e no pedido do cliente.',
      placeholder: 'Vook Vehicles Collection',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.PACK_NAME_MAX,
      required: true,
      value: params.pack?.name,
    }),
    modalField({
      customId: PACK_FIELD.PRICE,
      label: 'Preco',
      description: 'Aceita 149,90 ou R$ 149,90. Nunca zero.',
      placeholder: '149,90',
      style: TextInputStyle.Short,
      maxLength: 20,
      required: true,
      value:
        params.pack === undefined ? null : formatCents(params.pack.price).replace('R$ ', ''),
    }),
    modalField({
      customId: PACK_FIELD.SKU,
      label: 'SKU (opcional)',
      description: 'Codigo curto e unico no servidor. Ex.: VEH-001.',
      placeholder: 'VEH-001',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.PACK_SKU_MAX,
      required: false,
      value: params.pack?.sku,
    }),
    modalField({
      customId: PACK_FIELD.SHORT,
      label: 'Descricao curta',
      description: 'Uma linha, exibida na listagem e no card.',
      placeholder: 'Pack completo de veiculos exclusivos.',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.PACK_SHORT_DESCRIPTION_MAX,
      required: false,
      value: params.pack?.shortDescription,
    }),
    modalField({
      customId: PACK_FIELD.DESCRIPTION,
      label: 'Descricao completa',
      description: 'Exibida em "Mais Informacoes". Aceita varias linhas.',
      placeholder: 'Inclui 15 veiculos, texturas otimizadas e atualizacoes.',
      style: TextInputStyle.Paragraph,
      maxLength: BUSINESS_LIMITS.PACK_DESCRIPTION_MAX,
      required: false,
      value: params.pack?.description,
    }),
  );

  return modal;
}

/** Formulario rapido de preco. */
export function buildPackPriceModal(pack: CatalogPack): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PACK_PRICE_MODAL, pack.id))
    .setTitle('VOOK STORE — PRECO');

  modal.addLabelComponents(
    modalField({
      customId: PACK_FIELD.PRICE,
      label: `Preco de ${truncate(pack.name, 20)}`,
      description: 'Pedidos ja criados mantem o valor da compra.',
      placeholder: '149,90',
      style: TextInputStyle.Short,
      maxLength: 20,
      required: true,
      value: formatCents(pack.price).replace('R$ ', ''),
    }),
  );

  return modal;
}

/** Formulario da ficha tecnica: uma linha por item, `Rotulo: valor`. */
export function buildPackDetailsModal(
  pack: CatalogPack,
  details: ReadonlyArray<{ label: string; value: string }>,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PACK_DETAILS_MODAL, pack.id))
    .setTitle('VOOK STORE — FICHA TECNICA');

  modal.addLabelComponents(
    modalField({
      customId: PACK_FIELD.DETAILS,
      label: 'Ficha tecnica',
      description: `Uma linha por item: "Rotulo: valor". Ate ${BUSINESS_LIMITS.MAX_DETAILS_PER_PACK} itens.`,
      placeholder: 'Compatibilidade: FiveM\nQuantidade: 15 veiculos\nFormato: Ready-to-use',
      style: TextInputStyle.Paragraph,
      maxLength: 1000,
      required: false,
      value: formatPackDetails(details),
    }),
  );

  return modal;
}

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------

/** Painel da galeria do pack. */
export function buildPackImagesPanel(
  pack: CatalogPack,
  images: readonly PackImage[],
  options: { notice?: string } = {},
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.CATALOG_IMAGES, { subtitle: `**${truncate(pack.name, 60)}**` });

  if (options.notice !== undefined && options.notice.length > 0) {
    root.addTextDisplayComponents(text(options.notice));
  }

  if (images.length === 0) {
    root.addTextDisplayComponents(
      text(
        '⚠️ Nenhuma imagem cadastrada.\nA vitrine mostra o pack sem foto — cadastre ao menos a capa.',
      ),
    );
  } else {
    root.addTextDisplayComponents(
      text(
        `**${images.length} imagem(ns) cadastrada(s)**\n\n` +
          images
            .map(
              (image, index) =>
                `**${index + 1}.** ${image.isCover ? `${EMOJIS.FEATURED} capa • ` : ''}` +
                `${truncate(image.altText ?? image.url, 70)}`,
            )
            .join('\n'),
      ),
    );
  }

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(
      adminButton(CATALOG_ACTION.IMAGE_ADD, EMOJIS.ADD, 'Adicionar Imagem', pack.id).setDisabled(
        images.length >= BUSINESS_LIMITS.MAX_IMAGES_PER_PACK,
      ),
      adminButton(
        CATALOG_ACTION.IMAGE_PICK,
        EMOJIS.DELETE,
        'Remover',
        IMAGE_PICK_KIND.REMOVE,
        pack.id,
      ).setDisabled(images.length === 0),
      adminButton(CATALOG_ACTION.IMAGE_PICK, EMOJIS.UP, 'Mover Cima', IMAGE_PICK_KIND.UP, pack.id)
        .setDisabled(images.length < 2),
      adminButton(
        CATALOG_ACTION.IMAGE_PICK,
        EMOJIS.DOWN,
        'Mover Baixo',
        IMAGE_PICK_KIND.DOWN,
        pack.id,
      ).setDisabled(images.length < 2),
      adminButton(
        CATALOG_ACTION.IMAGE_PICK,
        EMOJIS.FEATURED,
        'Definir Capa',
        IMAGE_PICK_KIND.COVER,
        pack.id,
      ).setDisabled(images.length === 0),
    ),
  );
  root.addActionRowComponents(
    buttonRow(
      adminButton(CATALOG_ACTION.PACK_PICK, EMOJIS.IMAGE, 'Outro Pack', PACK_PICK_KIND.IMAGES, '1'),
      adminBackButton(),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(
      `A ordem define a navegacao ◀️ ▶️ do cliente. Maximo de ${BUSINESS_LIMITS.MAX_IMAGES_PER_PACK} imagens por pack.`,
    ),
  );

  return root;
}

const IMAGE_PICK_TITLES: Record<ImagePickKind, string> = {
  [IMAGE_PICK_KIND.REMOVE]: 'Escolha a imagem a remover.',
  [IMAGE_PICK_KIND.UP]: 'Escolha a imagem que subira uma posicao.',
  [IMAGE_PICK_KIND.DOWN]: 'Escolha a imagem que descera uma posicao.',
  [IMAGE_PICK_KIND.COVER]: 'Escolha a imagem que sera a capa do pack.',
};

export function buildImagePickerPanel(
  pack: CatalogPack,
  images: readonly PackImage[],
  kind: ImagePickKind,
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.CATALOG_IMAGES, { subtitle: IMAGE_PICK_TITLES[kind] });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(
      buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.IMAGE_PICK_SELECT, kind, pack.id),
    )
    .setPlaceholder('Selecione a imagem')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    images.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((image, index) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(`${index + 1}. ${image.altText ?? 'Imagem'}`, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(truncate(image.url, DISCORD_LIMITS.SELECT_DESCRIPTION))
        .setValue(image.id),
    ),
  );

  root.addActionRowComponents(selectRow(menu));
  root.addActionRowComponents(
    buttonRow(
      adminButton(CATALOG_ACTION.IMAGES_PANEL, EMOJIS.BACK, 'Voltar', pack.id),
      adminBackButton(),
    ),
  );
  return root;
}

/** Formulario de cadastro de imagem (URL https + texto alternativo). */
export function buildImageModal(pack: CatalogPack): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.IMAGE_ADD_MODAL, pack.id))
    .setTitle('VOOK STORE — NOVA IMAGEM');

  modal.addLabelComponents(
    modalField({
      customId: PACK_FIELD.IMAGE_URL,
      label: 'URL da imagem',
      description: 'Somente https://. Links inseguros sao recusados.',
      placeholder: 'https://cdn.exemplo.com/pack.png',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.IMAGE_URL_MAX,
      required: true,
    }),
    modalField({
      customId: PACK_FIELD.IMAGE_ALT,
      label: 'Descricao da imagem (opcional)',
      description: 'Ajuda o cliente a entender o que a foto mostra.',
      placeholder: 'Vista frontal do veiculo',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.PACK_IMAGE_ALT_MAX,
      required: false,
    }),
  );

  return modal;
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export function buildCategoryAdminPanel(
  categories: readonly CatalogCategory[],
  options: { notice?: string } = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.CATALOG_CATEGORIES);

  if (options.notice !== undefined && options.notice.length > 0) {
    root.addTextDisplayComponents(text(options.notice));
  }

  if (categories.length === 0) {
    root.addTextDisplayComponents(
      text('Nenhuma categoria cadastrada.\nCrie a primeira para organizar a vitrine.'),
    );
  } else {
    root.addTextDisplayComponents(
      text(
        categories
          .map(
            (category, index) =>
              `**${index + 1}.** ${category.emoji ?? ''} ${category.name} — ` +
              `${category.enabled ? `${EMOJIS.ENABLE} ativa` : `${EMOJIS.DISABLE} desativada`}`,
          )
          .join('\n'),
      ),
    );
  }

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(
      adminButton(CATALOG_ACTION.CATEGORY_NEW, EMOJIS.ADD, 'Criar'),
      adminButton(CATALOG_ACTION.CATEGORY_PICK, EMOJIS.EDIT, 'Editar', CATEGORY_PICK_KIND.EDIT),
      adminButton(
        CATALOG_ACTION.CATEGORY_PICK,
        EMOJIS.ENABLE,
        'Ativar/Desativar',
        CATEGORY_PICK_KIND.TOGGLE,
      ),
      adminButton(CATALOG_ACTION.CATEGORY_PICK, EMOJIS.UP, 'Subir', CATEGORY_PICK_KIND.UP),
      adminButton(CATALOG_ACTION.CATEGORY_PICK, EMOJIS.DOWN, 'Descer', CATEGORY_PICK_KIND.DOWN),
    ),
  );
  root.addActionRowComponents(
    buttonRow(
      adminButton(CATALOG_ACTION.CATEGORY_PICK, EMOJIS.DELETE, 'Excluir', CATEGORY_PICK_KIND.DELETE),
      adminBackButton(),
    ),
  );

  root.addTextDisplayComponents(
    footerNote('Categoria desativada some da vitrine, mas nao afeta pedidos historicos.'),
  );

  return root;
}

const CATEGORY_PICK_TITLES: Record<CategoryPickKind, string> = {
  [CATEGORY_PICK_KIND.EDIT]: 'Escolha a categoria a editar.',
  [CATEGORY_PICK_KIND.TOGGLE]: 'Escolha a categoria para alternar o estado.',
  [CATEGORY_PICK_KIND.DELETE]: 'Escolha a categoria a excluir (precisa estar sem produtos).',
  [CATEGORY_PICK_KIND.UP]: 'Escolha a categoria que subira uma posicao.',
  [CATEGORY_PICK_KIND.DOWN]: 'Escolha a categoria que descera uma posicao.',
};

export function buildCategoryPickerPanel(
  categories: readonly CatalogCategory[],
  kind: CategoryPickKind,
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.CATALOG_CATEGORIES, { subtitle: CATEGORY_PICK_TITLES[kind] });

  if (categories.length === 0) {
    root.addTextDisplayComponents(text('Nenhuma categoria cadastrada.'));
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(
      buttonRow(adminButton(CATALOG_ACTION.CATEGORIES, EMOJIS.BACK, 'Voltar')),
    );
    return root;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.CATEGORY_PICK_SELECT, kind))
    .setPlaceholder('Selecione a categoria')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    categories.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((category) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(truncate(category.name, DISCORD_LIMITS.SELECT_LABEL))
        .setDescription(
          truncate(
            category.enabled ? 'Categoria ativa' : 'Categoria desativada',
            DISCORD_LIMITS.SELECT_DESCRIPTION,
          ),
        )
        .setValue(category.id);
      if (category.emoji !== null && category.emoji.length > 0) option.setEmoji(category.emoji);
      return option;
    }),
  );

  root.addActionRowComponents(selectRow(menu));
  root.addActionRowComponents(
    buttonRow(adminButton(CATALOG_ACTION.CATEGORIES, EMOJIS.BACK, 'Voltar')),
  );
  return root;
}

export function buildCategoryModal(
  mode: 'create' | 'edit',
  category?: CatalogCategory,
): ModalBuilder {
  if (mode === 'edit' && category === undefined) {
    throw new ValidationError('Modal de edicao exige a categoria carregada.', {
      userMessage: 'Nao foi possivel abrir esta categoria. Atualize o painel.',
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(
      mode === 'create'
        ? buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.CATEGORY_NEW_MODAL)
        : buildCustomId(
            NAMESPACE.CATALOG,
            CATALOG_ACTION.CATEGORY_EDIT_MODAL,
            category?.id ?? '',
          ),
    )
    .setTitle(mode === 'create' ? 'VOOK STORE — NOVA CATEGORIA' : 'VOOK STORE — EDITAR CATEGORIA');

  modal.addLabelComponents(
    modalField({
      customId: CATEGORY_FIELD.NAME,
      label: 'Nome da categoria',
      description: 'Aparece no seletor do catalogo.',
      placeholder: 'Veiculos',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.CATEGORY_NAME_MAX,
      required: true,
      value: category?.name,
    }),
    modalField({
      customId: CATEGORY_FIELD.DESCRIPTION,
      label: 'Descricao (opcional)',
      description: 'Uma linha exibida junto ao nome no menu.',
      placeholder: 'Veiculos exclusivos para FiveM',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.CATEGORY_DESCRIPTION_MAX,
      required: false,
      value: category?.description,
    }),
    modalField({
      customId: CATEGORY_FIELD.EMOJI,
      label: 'Emoji (opcional)',
      description: 'Um emoji unicode ou emoji customizado do servidor.',
      placeholder: '🚗',
      style: TextInputStyle.Short,
      maxLength: 32,
      required: false,
      value: category?.emoji,
    }),
  );

  return modal;
}

/** Formulario de busca do catalogo. */
export function buildCatalogSearchModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.SEARCH_MODAL))
    .setTitle('VOOK STORE — BUSCAR');

  modal.addLabelComponents(
    modalField({
      customId: 'termo',
      label: 'O que voce procura?',
      description: 'Busca por nome, SKU ou descricao curta.',
      placeholder: 'veiculos',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.CATALOG_SEARCH_MAX,
      required: true,
    }),
  );

  return modal;
}
