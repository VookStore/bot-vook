import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { DELIVERY_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  buttonRow,
  container,
  footerNote,
  separator,
  text,
} from '../../../components/v2';
import { channelUrl, userMention } from '../../../utils/discord';
import {
  collapseRepeats,
  escapeMarkdownLayout,
  sanitizeMentions,
  stripUnsafeChars,
  truncate,
} from '../../../utils/sanitize';
import { discordTimestamp } from '../../../utils/time';
import { describeProductFormats, describeProductMaxSize } from '../validators/product';

/**
 * Entrega do produto no ticket (Components V2).
 *
 * Duas pecas: o FORMULARIO que o comando `/entregar` abre e o CARTAO que sai
 * com o arquivo. O cartao tem duas versoes — a do ticket e a da DM — porque o
 * que cada uma pode carregar e diferente: na DM o teto de anexo do bot e sempre
 * o padrao de 20 MiB (o impulso do servidor nao vale la), entao ha caso em que
 * o arquivo vai no ticket e a DM leva so o aviso e o caminho de volta.
 */

/** customIds dos campos do formulario. */
export const DELIVERY_FIELD = {
  CUSTOMER: 'cliente',
  FILE: 'arquivo',
  NOTE: 'observacoes',
} as const;

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

function label(title: string, description?: string): LabelBuilder {
  const built = new LabelBuilder().setLabel(truncate(title, DISCORD_LIMITS.TEXT_INPUT_LABEL));
  if (description !== undefined) built.setDescription(truncate(description, 100));
  return built;
}

export interface DeliveryModalData {
  /** `#0042`, so para o titulo dizer de qual atendimento e a entrega. */
  ticketLabel: string;
  /** Nome do cliente do ticket, usado como DICA no rotulo do select. */
  ownerHint: string | null;
  /** Teto efetivo do arquivo neste servidor (`effectiveProductLimit`). */
  maxBytes: number;
}

/**
 * Formulario da entrega.
 *
 * TRES campos, e os dois primeiros sao o pedido inteiro: quem recebe e o que
 * ele recebe. O terceiro existe por causa do formato — pacote costuma ter senha
 * ou ordem de instalacao, e sem lugar para isso a equipe mandaria uma segunda
 * mensagem solta que o cliente perde ao rolar a conversa.
 *
 * O CLIENTE E UM SELECT DE USUARIO, nao um campo de texto: o cartao menciona a
 * pessoa e a DM precisa de um id de verdade. Digitar o nome daria um texto que
 * nao aponta para ninguem.
 *
 * Sem `setDefaultUsers`: o dono do ticket vai na DESCRICAO do rotulo. Pre-marcar
 * no select dependeria de o Discord aceitar `default_values` dentro de modal, o
 * que nao esta documentado — e um 400 aqui nao mostraria formulario nenhum.
 *
 * Todo em `LabelBuilder`: e o unico formato que aceita select e upload no mesmo
 * modal (mesma regra do formulario de ticket e do de lobos).
 */
export function buildDeliveryModal(data: DeliveryModalData): ModalBuilder {
  const customerSelect = new UserSelectMenuBuilder()
    .setCustomId(DELIVERY_FIELD.CUSTOMER)
    .setPlaceholder(truncate('Selecione quem recebe o produto', DISCORD_LIMITS.SELECT_PLACEHOLDER))
    .setMinValues(1)
    .setMaxValues(1);

  return new ModalBuilder()
    .setCustomId(buildCustomId(NAMESPACE.DELIVERY, DELIVERY_ACTION.SEND_MODAL))
    .setTitle(truncate(`Entregar produto — ${data.ticketLabel}`, DISCORD_LIMITS.MODAL_TITLE))
    .addLabelComponents(
      label(
        'Cliente',
        data.ownerHint === null
          ? 'Quem vai receber o arquivo e a mensagem direta.'
          : `Cliente deste atendimento: ${data.ownerHint}`,
      ).setUserSelectMenuComponent(customerSelect),
      label(
        'Arquivo do produto',
        `${describeProductFormats()}, até ${describeProductMaxSize(data.maxBytes)}.`,
      ).setFileUploadComponent(
        new FileUploadBuilder()
          .setCustomId(DELIVERY_FIELD.FILE)
          .setMinValues(1)
          // UM arquivo por entrega: o cartao e a entrega daquele pacote, e dois
          // anexos na mesma mensagem tornam ambiguo o que foi entregue.
          .setMaxValues(1)
          .setRequired(true),
      ),
      label('Observações', 'Opcional. Senha do arquivo, ordem de instalação...').setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(DELIVERY_FIELD.NOTE)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(BUSINESS_LIMITS.DELIVERY_NOTE_MAX)
          .setPlaceholder(
            truncate('Ex.: a senha do arquivo é vook2026', DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER),
          ),
      ),
    );
}

// ---------------------------------------------------------------------------
// Resumo para quem entregou
// ---------------------------------------------------------------------------

/**
 * Por que a DM nao chegou.
 *
 * `fechada` e escolha do cliente e nao e defeito de ninguem; `erro` e falha
 * tecnica e merece frase diferente, porque a equipe pode tentar de novo em vez
 * de achar que o cliente bloqueou o bot.
 */
export type DeliveryDmFailure = 'fechada' | 'erro';

export interface DeliverySummaryData {
  dmSent: boolean;
  /** False quando a DM saiu sem o arquivo (acima do teto de anexo em DM). */
  dmHadFile: boolean;
  dmFailure: DeliveryDmFailure | null;
  /** True quando o arquivo saiu por link do Worker em vez de anexo. */
  hosted: boolean;
  orderLabel: string | null;
  orderMarked: boolean;
  orderWarning: string | null;
  /**
   * Pedido pago do atendimento que pertence a OUTRA pessoa — so aparece quando
   * o cliente selecionado nao tinha nenhum. E o sinal de que a entrega pode ter
   * ido para a pessoa errada.
   */
  foreignOrder: { label: string; customerId: string } | null;
  reviewChannelMissing: boolean;
  /**
   * Ticket foi para os concluidos: cartao publicado e topico arquivado.
   *
   * False quando o canal de concluidos nao esta configurado (ou falhou) — e ai o
   * topico FICA na lista de ativos, de proposito: arquivar sem o cartao faria o
   * atendimento sumir sem nada apontando para ele.
   */
  ticketMoved: boolean;
}

/**
 * A linha da DM.
 *
 * TRES resultados, nao dois: "sem o arquivo" nao quer dizer "esta no ticket".
 * Com o arquivo hospedado ele nao e anexo em lugar nenhum — a DM leva o botao
 * de download —, e dizer a equipe que a DM aponta para o ticket a faria
 * explicar errado ao cliente.
 */
function dmLine(data: DeliverySummaryData): string {
  if (data.dmSent) {
    if (data.dmHadFile) return 'Cópia enviada na DM do cliente, com o arquivo.';
    if (data.hosted) return 'Cópia enviada na DM do cliente, com o botão de download.';
    return 'DM enviada sem o arquivo (grande demais para mensagem direta): ela aponta para o ticket.';
  }

  return data.dmFailure === 'erro'
    ? '⚠️ A DM falhou por erro técnico (não é DM fechada). O arquivo está no ticket — vale avisar o cliente por lá.'
    : '⚠️ A DM não foi entregue (cliente com mensagens diretas fechadas). O arquivo está no ticket.';
}

/**
 * O que a equipe le depois de entregar.
 *
 * Denso de proposito: ela precisa saber, num olhar, se sobrou tarefa. Uma DM
 * que nao saiu ou um pedido que nao virou ENTREGUE nao sao erros do envio — sao
 * coisas que ficaram para tras, e esconde-las faria o "entregue" mentir.
 */
export function buildDeliverySummary(data: DeliverySummaryData): string {
  const lines: string[] = [dmLine(data)];

  if (data.orderLabel === null) {
    /*
     * Pedido pago de OUTRA pessoa no mesmo atendimento e o sinal mais provavel
     * de que o cliente errado foi selecionado no formulario — e o arquivo ja
     * saiu. Dizer "nada a marcar" aqui esconderia exatamente isso.
     */
    lines.push(
      data.foreignOrder === null
        ? 'Nenhum pedido pago estava ligado a este atendimento — nada a marcar.'
        : `⚠️ Nenhum pedido pago deste cliente, mas ${data.foreignOrder.label} neste atendimento é de ` +
          `${userMention(data.foreignOrder.customerId)}. Confira se a entrega foi para a pessoa certa.`,
    );
  } else if (data.orderMarked) {
    lines.push(`Pedido ${data.orderLabel} marcado como entregue.`);
  } else {
    lines.push(
      `⚠️ Pedido ${data.orderLabel} NÃO foi marcado: ${data.orderWarning ?? 'motivo desconhecido'}`,
    );
  }

  lines.push(
    data.ticketMoved
      ? 'Ticket movido para os concluídos: fica arquivado até o cliente confirmar o recebimento.'
      : '⚠️ O ticket continua na lista de ativos: o canal de concluídos não está configurado ou não respondeu (`/demandas canais`).',
  );

  if (data.hosted) {
    lines.push('O arquivo não cabia como anexo e foi hospedado: o cartão leva um botão de download.');
  }
  if (data.reviewChannelMissing) {
    lines.push('Sem canal de avaliações configurado, o convite para avaliar não entrou no cartão.');
  }

  return lines.join('\n');
}

/**
 * Limpeza da observacao.
 *
 * O texto vai para o cartao que o cliente le e para a DM dele: mencao
 * neutralizada (alem do `allowedMentions` do envio), controles e invisiveis
 * fora, repeticao de spam colapsada. O markdown de LAYOUT e escapado so na
 * renderizacao — guardar cru mantem o limite contado em caracteres digitados.
 */
export function readDeliveryNote(raw: string): string | null {
  const lines = collapseRepeats(sanitizeMentions(stripUnsafeChars(raw)))
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .slice(0, BUSINESS_LIMITS.DELIVERY_NOTE_MAX_LINES);

  if (lines.length === 0) return null;
  return truncate(lines.join('\n'), BUSINESS_LIMITS.DELIVERY_NOTE_MAX);
}

// ---------------------------------------------------------------------------
// Cartao da entrega
// ---------------------------------------------------------------------------

export interface DeliveryCardData {
  storeName: string;
  /** Ticket da entrega — vai no botao "Confirmar recebimento". */
  ticketId: string;
  customerId: string;
  staffId: string;
  /** `#0042` — o atendimento onde a venda aconteceu. */
  ticketLabel: string;
  /** `VK-000184`; nulo quando nenhum pedido pago estava ligado ao ticket. */
  orderLabel: string | null;
  fileName: string;
  /** "12,4 MB" — ja formatado. */
  fileSize: string;
  deliveredAt: Date;
  note: string | null;
  /**
   * Endereco do arquivo. Duas formas, decididas no envio: `attachment://<nome>`
   * quando ele vai como anexo da propria mensagem, ou a URL do Worker quando
   * passa do maior anexo que o bot envia. A URL vira BOTAO, nao componente de
   * arquivo: o componente de arquivo do Discord so aceita `attachment://`.
   */
  fileUrl: string;
  hosted: boolean;
  guildId: string;
  /** Canal de avaliacoes; nulo simplesmente nao mostra o convite. */
  reviewChannelId: string | null;
}

/** DM do cliente: o mesmo cartao, mais o caminho de volta ao atendimento. */
export interface DeliveryDmData extends DeliveryCardData {
  ticketChannelId: string;
  /**
   * False quando o arquivo ficou SO no ticket — acima de 20 MiB o bot nao
   * anexa em DM, porque o nivel de impulsos do servidor nao vale fora dele.
   */
  fileAttached: boolean;
}

function detailLines(data: DeliveryCardData): string {
  const lines = [
    `${EMOJIS.PACKAGE} **Arquivo:** \`${escapeMarkdownLayout(data.fileName)}\` (${data.fileSize})`,
    `${EMOJIS.TICKET} **Atendimento:** \`${data.ticketLabel}\``,
  ];
  if (data.orderLabel !== null) {
    lines.push(`${EMOJIS.RECEIPT} **Pedido:** \`${data.orderLabel}\``);
  }
  lines.push(
    `${EMOJIS.ROLE} **Entregue por:** ${userMention(data.staffId)} • ${discordTimestamp(data.deliveredAt, 'f')}`,
  );
  return lines.join('\n');
}

/**
 * Observacao da equipe, como citacao.
 *
 * Cada linha ganha `> ` porque `>>>` transformaria em citacao tudo que viesse
 * depois, inclusive o rodape.
 */
function noteBlock(note: string): string {
  const quoted = note
    .split('\n')
    .map((line) => `> ${escapeMarkdownLayout(line)}`)
    .join('\n');
  return `${EMOJIS.INFO} **Observações da equipe**\n${quoted}`;
}

/** Download direto; so existe quando o arquivo foi hospedado. */
function downloadButton(data: DeliveryCardData): ButtonBuilder | null {
  if (!data.hosted) return null;
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel('Baixar arquivo')
    .setEmoji(EMOJIS.PACKAGE)
    .setURL(data.fileUrl);
}

/**
 * Convite para avaliar. SO existe com canal configurado.
 *
 * Um `ButtonStyle.Link` exige URL valida — sem canal nao ha URL para colocar —,
 * e mandar o cliente para a raiz do servidor sob o rotulo "Avaliar atendimento"
 * seria pior que nao convidar.
 */
function reviewButton(data: DeliveryCardData): ButtonBuilder | null {
  if (data.reviewChannelId === null) return null;
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel('Avaliar atendimento')
    .setEmoji(EMOJIS.REVIEW)
    .setURL(channelUrl(data.guildId, data.reviewChannelId));
}

/**
 * "Confirmar recebimento": o cliente encerra o atendimento.
 *
 * E o que fecha o ticket depois de uma entrega — a equipe arquiva o topico na
 * entrega, mas so o cliente diz que recebeu. Secondary como todo botao da loja
 * (politica visual), e so no cartao do TICKET: na DM nao ha guild, e confirmar
 * fora do atendimento esconderia da equipe que ele foi concluido.
 *
 * Quem pode clicar e conferido no handler, pelo banco — o botao fica visivel
 * para a equipe tambem.
 */
function confirmButton(data: DeliveryCardData): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.DELIVERY, DELIVERY_ACTION.CONFIRM, data.ticketId))
    .setLabel('Confirmar recebimento')
    .setEmoji(EMOJIS.APPROVE)
    .setStyle(ButtonStyle.Secondary);
}

/** Caminho de volta ao atendimento; so faz sentido fora do proprio ticket. */
function ticketButton(guildId: string, channelId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel('Ir ao atendimento')
    .setEmoji(EMOJIS.TICKET)
    .setURL(channelUrl(guildId, channelId));
}

function present(buttons: ReadonlyArray<ButtonBuilder | null>): ButtonBuilder[] {
  return buttons.filter((button): button is ButtonBuilder => button !== null);
}

/** Acrescenta o arquivo: componente quando e anexo, nada quando e link. */
function addFile(root: ContainerBuilder, data: DeliveryCardData): void {
  if (data.hosted) return;
  root.addFileComponents(new FileBuilder().setURL(data.fileUrl));
}

/**
 * O cartao publicado DENTRO do ticket.
 *
 * O arquivo e o conteudo; o resto responde as perguntas de quem recebe: o que
 * e isso, de qual pedido veio, quem entregou e quando. O agradecimento vem
 * primeiro porque e a ultima coisa que a loja diz nesta venda.
 *
 * Quando o arquivo nao coube como anexo, ele vira BOTAO de download em vez de
 * componente de arquivo — o componente de arquivo do Discord so sabe apontar
 * para `attachment://`.
 */
export function buildDeliveryCard(data: DeliveryCardData): ContainerBuilder {
  const root = container(COLORS.SUCCESS);
  addHeader(root, `${EMOJIS.DELIVER} ${TITLES.DELIVERY}`, {
    subtitle: `-# Sua compra na ${escapeMarkdownLayout(data.storeName)}, entregue.`,
  });

  root.addTextDisplayComponents(
    text(
      `${userMention(data.customerId)}, seu produto está aqui! ` +
        'Agradecemos a confiança — foi um prazer atender você.\n\n' +
        detailLines(data),
    ),
  );

  // A observacao dispensa separador proprio: ela ja e um bloco de citacao, e o
  // separador so gastaria um dos 10 filhos do Container.
  if (data.note !== null) root.addTextDisplayComponents(text(noteBlock(data.note)));

  root.addSeparatorComponents(separator());
  addFile(root, data);

  // Baixar vem antes de confirmar: confirma-se o que ja se conferiu.
  root.addActionRowComponents(
    buttonRow(...present([downloadButton(data), confirmButton(data), reviewButton(data)])),
  );

  root.addTextDisplayComponents(
    footerNote(
      (data.hosted
        ? 'Baixe o arquivo pelo botão acima e guarde uma cópia. '
        : 'Guarde uma cópia do arquivo. ') +
        'Deu tudo certo? Toque em **Confirmar recebimento** — se algo der errado, responda aqui antes.',
    ),
  );

  /*
   * Pior caso dos 10 filhos do Container: titulo, subtitulo e separador (3),
   * texto (4), observacao (5), separador (6), arquivo (7), botoes (8) e rodape
   * (9). Uma folga de um filho, de proposito — quem acrescentar um bloco aqui
   * ainda cabe, e o limite do Discord e recusa da mensagem inteira.
   */
  return root;
}

/**
 * A mesma entrega, na DM do cliente.
 *
 * Existe porque o ticket e um topico privado que o cliente perde de vista assim
 * que sai do servidor — e porque ele fecha, e o topico e arquivado. A DM e a
 * copia que fica com ele.
 *
 * Quando o arquivo ficou so no ticket (acima do teto de anexo em DM), o cartao
 * DIZ isso e o botao leva ao atendimento. O silencio seria pior: o cliente
 * leria que o produto esta ali sem nada anexado.
 */
export function buildDeliveryDm(data: DeliveryDmData): ContainerBuilder {
  const root = container(COLORS.SUCCESS);
  addHeader(root, `${EMOJIS.DELIVER} ${TITLES.DELIVERY}`, {
    subtitle: `-# Sua compra na ${escapeMarkdownLayout(data.storeName)} foi entregue.`,
  });

  /*
   * TRES casos, nao dois.
   *
   * Sem anexo na DM nao significa "esta no ticket": quando o arquivo foi
   * HOSPEDADO, ele nao e anexo em lugar nenhum — esta no botao de download
   * desta propria mensagem. Mandar o cliente ao ticket nesse caso o faria
   * procurar um anexo que nao existe la.
   *
   * O agradecimento vem ANTES da logistica: "o arquivo e grande demais... foi
   * um prazer atender voce" le-se como desculpa, nao como entrega.
   */
  const whereIsIt = data.fileAttached
    ? 'Seu produto está anexado nesta mensagem.'
    : data.hosted
      ? 'Baixe o seu produto pelo botão abaixo.'
      : `O arquivo é grande demais para a mensagem direta e ficou no seu atendimento \`${data.ticketLabel}\` — abra pelo botão abaixo.`;

  root.addTextDisplayComponents(
    text(
      `Olá, ${userMention(data.customerId)}! Agradecemos a confiança — ` +
        `foi um prazer atender você. ${whereIsIt}\n\n` +
        detailLines(data),
    ),
  );

  if (data.note !== null) root.addTextDisplayComponents(text(noteBlock(data.note)));

  root.addSeparatorComponents(separator());
  if (data.fileAttached) addFile(root, data);

  /*
   * O DOWNLOAD VEM PRIMEIRO quando existe: nesse caso ele e o motivo da
   * mensagem, e o atendimento vira o lugar de tirar duvida. Sem download, o
   * botao do atendimento assume a frente — e por ele que o cliente chega ao
   * arquivo que ficou no ticket.
   */
  root.addActionRowComponents(
    buttonRow(
      ...present([
        downloadButton(data),
        ticketButton(data.guildId, data.ticketChannelId),
        reviewButton(data),
      ]),
    ),
  );

  // A confirmacao e no TICKET, nao aqui: e la que a equipe ve que o
  // atendimento foi concluido.
  root.addTextDisplayComponents(
    footerNote(
      'Conferiu o arquivo? Confirme o recebimento no seu atendimento. ' +
        `A ${escapeMarkdownLayout(data.storeName)} agradece a preferência.`,
    ),
  );

  return root;
}
