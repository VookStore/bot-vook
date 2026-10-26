import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { NAMESPACE, WOLF_ACTION, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  mediaGallery,
  separator,
  text,
} from '../../../components/v2';
import { channelMention } from '../../../utils/discord';
import {
  collapseRepeats,
  escapeMarkdownLayout,
  sanitizeMentions,
  stripUnsafeChars,
  truncate,
} from '../../../utils/sanitize';
import {
  WOLF_EMOJI,
  WOLF_KINDS,
  isWolfKind,
  wolfKindLabel,
  type WolfKind,
} from '../data/wolves';
import { describeRenderFormats, describeRenderMaxSize } from '../validators/render';

/**
 * Portfolio de lobos (Components V2).
 *
 * Tres pecas: o PAINEL que fica no canal da equipe, o FORMULARIO que o botao
 * abre e o POST que sai no canal do portfolio. O post e V2 como o resto da loja
 * — tabela de precos, booster, catalogo —, e nao embed classico: a galeria V2
 * mostra o render na largura inteira da mensagem, que e o motivo do post
 * existir.
 */

/** customIds dos campos do formulario. */
export const WOLF_FIELD = {
  CUSTOMER: 'cliente',
  KIND: 'tipo',
  RENDER: 'render',
  PERSONALIZATION: 'personalizacao',
  ADDITIONAL: 'adicional',
} as const;

// ---------------------------------------------------------------------------
// Painel da equipe
// ---------------------------------------------------------------------------

export interface WolfPanelData {
  /** Canal do portfolio. Nulo desliga o botao. */
  portfolioChannelId: string | null;
  /** Teto efetivo do render neste servidor (`effectiveRenderLimit`). */
  maxRenderBytes: number;
}

function kindsSentence(): string {
  const labels = WOLF_KINDS.map((kind) => kind.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} ou ${labels[labels.length - 1] ?? ''}`;
}

/**
 * Painel fixo no canal da equipe.
 *
 * Diz ANTES do clique o que o formulario vai pedir. O modal do Discord nao
 * guarda nada se o envio falhar, entao quem abre o formulario sem o render
 * exportado perde o que digitou — a lista aqui e o que evita isso.
 *
 * Sem canal de portfolio o botao sai DESLIGADO, com o motivo escrito. Um botao
 * clicavel que so sabe responder "nao configurado" ensina a equipe a ignorar o
 * painel.
 */
export function buildWolfPanel(data: WolfPanelData): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, `${WOLF_EMOJI.LOBO} ${TITLES.WOLF_PANEL}`, {
    subtitle: '-# Publique no portfólio um lobo criado pela loja.',
  });

  const destination =
    data.portfolioChannelId !== null
      ? 'Toque em **Criar anúncio**, preencha o formulário e envie o render — ' +
        `o post sai direto em ${channelMention(data.portfolioChannelId)}.`
      : `${EMOJIS.PENDING} **O canal do portfólio ainda não foi definido.**\n` +
        'Um administrador precisa rodar `/lobos portfolio` — até lá o botão fica desligado.';

  root.addTextDisplayComponents(
    text(
      `${destination}\n\n` +
        '**O formulário pede**\n' +
        `${WOLF_EMOJI.LOBO} **Lobo** — ${kindsSentence()}\n` +
        `${EMOJIS.ROLE} **Cliente** — nome de quem encomendou\n` +
        `${EMOJIS.IMAGE} **Render** — ${describeRenderFormats()}, até ${describeRenderMaxSize(data.maxRenderBytes)}\n` +
        `${WOLF_EMOJI.PERSONALIZACAO} **Personalização** — opcional\n` +
        `${WOLF_EMOJI.ADICIONAL} **Adicional** — opcional`,
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.WOLF, WOLF_ACTION.CREATE))
        .setLabel('Criar anúncio')
        // Unicode de proposito: emoji personalizado em COMPONENTE que o bot nao
        // alcance faz o Discord recusar o painel inteiro (ver `data/wolves`).
        .setEmoji(EMOJIS.WOLF)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(data.portfolioChannelId === null),
    ),
  );

  root.addTextDisplayComponents(
    footerNote(
      'Somente a equipe da loja publica. O render é reenviado pelo bot, ' +
        'então o post não perde a imagem com o tempo.',
    ),
  );

  return root;
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

function label(title: string, description?: string): LabelBuilder {
  const built = new LabelBuilder().setLabel(truncate(title, DISCORD_LIMITS.TEXT_INPUT_LABEL));
  if (description !== undefined) built.setDescription(truncate(description, 100));
  return built;
}

function detailInput(customId: string, placeholder: string): TextInputBuilder {
  return new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(BUSINESS_LIMITS.WOLF_DETAIL_MAX)
    .setPlaceholder(truncate(placeholder, DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));
}

/**
 * Formulario do lobo.
 *
 * CINCO campos, que e o teto de um modal do Discord — e cabem exatos: os tres
 * pedidos (cliente, tipo, render) mais os dois detalhes que o post mostra com
 * emoji proprio (personalizacao e adicional).
 *
 * Todo em `LabelBuilder`: e o unico formato que aceita select e upload no
 * mesmo modal (mesma regra do formulario de ticket).
 */
export function buildWolfModal(maxRenderBytes: number): ModalBuilder {
  const kindSelect = new StringSelectMenuBuilder()
    .setCustomId(WOLF_FIELD.KIND)
    .setPlaceholder(truncate(kindsSentence(), DISCORD_LIMITS.SELECT_PLACEHOLDER))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      WOLF_KINDS.map((kind) =>
        new StringSelectMenuOptionBuilder().setValue(kind.value).setLabel(kind.label),
      ),
    );

  return new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.WOLF, WOLF_ACTION.CREATE_MODAL))
    .setTitle(truncate('Novo lobo no portfólio', DISCORD_LIMITS.MODAL_TITLE))
    .addLabelComponents(
      label('Nome do cliente').setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(WOLF_FIELD.CUSTOMER)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(BUSINESS_LIMITS.WOLF_CUSTOMER_MAX)
          .setPlaceholder('Como o cliente vai aparecer no post'),
      ),
      label('Lobo').setStringSelectMenuComponent(kindSelect),
      label(
        'Render do lobo',
        `${describeRenderFormats()}, até ${describeRenderMaxSize(maxRenderBytes)}.`,
      ).setFileUploadComponent(
        new FileUploadBuilder()
          .setCustomId(WOLF_FIELD.RENDER)
          .setMinValues(1)
          // UM render por post: e a imagem de capa, e o post e dele.
          .setMaxValues(1)
          .setRequired(true),
      ),
      label('Personalização', 'Opcional. Uma por linha.').setTextInputComponent(
        detailInput(WOLF_FIELD.PERSONALIZATION, 'Ex.: com runas'),
      ),
      label('Adicional', 'Opcional. Um por linha.').setTextInputComponent(
        detailInput(WOLF_FIELD.ADDITIONAL, 'Ex.: 2 acessórios'),
      ),
    );
}

// ---------------------------------------------------------------------------
// Leitura do formulario
// ---------------------------------------------------------------------------

/** O formulario ja validado. */
export interface WolfSubmission {
  customer: string;
  kind: WolfKind;
  personalization: string | null;
  additional: string | null;
}

/** Valores crus, como o handler os tirou do modal. */
export interface WolfFormValues {
  customer: string;
  kind: string | undefined;
  personalization: string;
  additional: string;
}

/**
 * Limpeza comum: o texto sai num canal PUBLICO assinado pela loja.
 *
 * Mencao neutralizada (alem do `allowedMentions` do envio), controles e
 * invisiveis fora, repeticao de spam colapsada. O markdown de LAYOUT e escapado
 * so na renderizacao — guardar cru mantem o limite contado em caracteres
 * digitados.
 */
function clean(raw: string): string {
  return collapseRepeats(sanitizeMentions(stripUnsafeChars(raw)));
}

function cleanDetail(raw: string): string | null {
  const lines = clean(raw)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .slice(0, BUSINESS_LIMITS.WOLF_DETAIL_MAX_LINES);

  if (lines.length === 0) return null;
  return truncate(lines.join('\n'), BUSINESS_LIMITS.WOLF_DETAIL_MAX);
}

export function readWolfSubmission(values: WolfFormValues): WolfSubmission {
  const customer = truncate(
    clean(values.customer).replace(/\s+/g, ' ').trim(),
    BUSINESS_LIMITS.WOLF_CUSTOMER_MAX,
  );

  // So pontuacao, ou so emoji, nao e nome: o post diria "Cliente: !!!".
  if (!/[\p{L}\p{N}]/u.test(customer)) {
    throw new ValidationError('Nome de cliente vazio no portfolio.', {
      userMessage: 'Informe o nome do cliente como ele deve aparecer no post.',
    });
  }

  const kind = values.kind ?? '';
  if (!isWolfKind(kind)) {
    throw new ValidationError(`Tipo de lobo desconhecido: ${kind}`, {
      userMessage: `Escolha o tipo do lobo: ${kindsSentence()}.`,
    });
  }

  return {
    customer,
    kind,
    personalization: cleanDetail(values.personalization),
    additional: cleanDetail(values.additional),
  };
}

// ---------------------------------------------------------------------------
// Post do portfolio
// ---------------------------------------------------------------------------

export interface WolfPostData {
  submission: WolfSubmission;
  /**
   * Endereco do render na galeria. Duas formas, decididas no envio:
   * `attachment://<nome>` quando ele vai como anexo da propria mensagem, ou a
   * URL do Worker quando passa do maior anexo que o bot envia no servidor.
   */
  imageUrl: string;
  /** Painel de atendimento, para o convite do rodape. Nulo = texto sem link. */
  ticketChannelId: string | null;
  storeName: string;
}

/**
 * Um detalhe do lobo.
 *
 * Uma linha fica na propria linha do rotulo; varias viram citacao embaixo dele.
 * Espremer varios itens numa linha so esconde a lista — e cada item e uma
 * escolha que o cliente fez e que o proximo cliente pode pedir.
 */
function detailBlock(emoji: string, title: string, value: string | null): string | null {
  if (value === null) return null;

  const lines = value.split('\n').map((line) => escapeMarkdownLayout(line));
  if (lines.length === 1) return `${emoji} **${title}:** ${lines[0] ?? ''}`;
  return `${emoji} **${title}:**\n${lines.map((line) => `> ${line}`).join('\n')}`;
}

/**
 * O post publicado no portfolio.
 *
 * O render e o conteudo; o resto responde as perguntas de quem ve o render:
 * que lobo e esse, de quem, o que ele tem de especial e como pedir um igual.
 * Por isso os detalhes opcionais somem quando vazios — "Personalizacao:
 * nenhuma" ocuparia uma linha para dizer nada — e o convite para abrir ticket
 * esta sempre la.
 *
 * NAO leva preco. Post de portfolio fica no canal para sempre e ninguem o
 * reescreve; um "a partir de" gravado aqui viraria compromisso comercial que
 * envelhece a cada reajuste da tabela.
 */
export function buildWolfPortfolioPost(data: WolfPostData): ContainerBuilder {
  const { submission } = data;
  const kind = wolfKindLabel(submission.kind);
  const customer = escapeMarkdownLayout(submission.customer);

  const root = container(COLORS.BRAND);
  addHeader(root, `${WOLF_EMOJI.LOBO} ${TITLES.WOLF_PORTFOLIO}`, {
    subtitle: `-# Lobo criado sob encomenda pela ${escapeMarkdownLayout(data.storeName)}.`,
  });

  root.addMediaGalleryComponents(
    mediaGallery([data.imageUrl], `${kind} de ${submission.customer}`),
  );

  const lines = [
    `${WOLF_EMOJI.LOBO} **Lobo:** ${kind}`,
    `${EMOJIS.ROLE} **Cliente:** ${customer}`,
    detailBlock(WOLF_EMOJI.PERSONALIZACAO, 'Personalização', submission.personalization),
    detailBlock(WOLF_EMOJI.ADICIONAL, 'Adicional', submission.additional),
  ].filter((line): line is string => line !== null);

  root.addTextDisplayComponents(text(lines.join('\n')));
  root.addSeparatorComponents(separator());

  const where =
    data.ticketChannelId !== null
      ? `Abra um ticket em ${channelMention(data.ticketChannelId)}`
      : 'Abra um ticket no atendimento da loja';

  root.addTextDisplayComponents(
    text(
      `${WOLF_EMOJI.TICKET} **Quer um lobo assim?**\n` +
        `${where} — todo lobo da ${escapeMarkdownLayout(data.storeName)} é feito sob encomenda.`,
    ),
  );

  return root;
}
