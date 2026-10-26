import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  type StringSelectMenuBuilder,
  type UserSelectMenuBuilder,
} from 'discord.js';
import { TicketPriority, TicketStatus, type Ticket } from '@prisma/client';

import { COLORS, EMOJIS, STATUS_LABEL, TITLES } from '../../../constants/branding';
import { NAMESPACE, TICKET_ACTION, buildCustomId } from '../../../constants/customIds';
import {
  buttonRow,
  container,
  mediaGallery,
  sectionWithButton,
  sectionWithThumbnail,
  selectRow,
  separator,
  text,
} from '../../../components/v2';
import { sanitizeImageUrl, truncate } from '../../../utils/sanitize';
import { userMention } from '../../../utils/discord';
import { formatCents } from '../../../utils/money';
import { formatDateBR } from '../../../utils/time';
import type { CustomerSummary } from '../../catalog/repositories/CustomerRepository';

/**
 * URL de imagem pronta para entrar no payload, ou null.
 *
 * `isSafeImageUrl(x) ? x : null` valida um texto e envia OUTRO: a validacao
 * roda sobre a forma normalizada e o payload recebe o valor cru, entao
 * `" https://cdn/x.png "` passa e chega a API com os espacos. Aqui o valor
 * enviado e exatamente o valor validado.
 *
 * `attachment://` tambem cai fora: o sanitizador o aceita porque o bot usa
 * esse esquema para anexos que ele mesmo manda (QR code, transcript), mas esta
 * mensagem nao carrega anexo nenhum. Com ele no payload o Discord responde 400
 * e derruba a criacao do ticket e todo refresh de painel; sem ele, o pior caso
 * e um painel sem imagem.
 */
function panelImageUrl(input: string | null | undefined): string | null {
  let url: string | null;
  try {
    url = sanitizeImageUrl(input);
  } catch {
    return null;
  }
  return url === null || url.startsWith('attachment://') ? null : url;
}

/** Numero do ticket formatado: 153 -> "#0153". */
export function formatTicketNumber(ticketNumber: number): string {
  return `#${String(ticketNumber).padStart(4, '0')}`;
}

/**
 * Prepara um valor para ir DENTRO de um bloco de codigo.
 *
 * Sem isso, um assunto contendo ``` fecharia o bloco e o resto do texto
 * (inclusive markdown do usuario) passaria a ser interpretado — quebra de
 * layout e, com um pouco de criatividade, spoofing do painel. A crase e
 * substituida por um sosia visual que nao tem significado em markdown.
 */
function codeSafe(value: string, max = 200): string {
  const cleaned = value
    .replace(/`/g, 'ˋ')
    // Todo terminador de linha, nao so LF e CRLF: um CR solitario sobrevivia a
    // `/\r?\n/` e ia cru para o payload. Nao chega a abrir o bloco (fechar
    // exige crase, e nenhuma sobra), mas o contrato desta funcao e devolver
    // UMA linha limpa — e ela e a ultima defesa antes do markdown.
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .trim();
  return truncate(cleaned.length > 0 ? cleaned : '—', max);
}

/** Campo rotulado com o valor dentro de um bloco de codigo. */
function boxedField(icon: string, label: string, value: string): string {
  return `${icon} **${label}:**\n\`\`\`\n${codeSafe(value)}\n\`\`\``;
}

export interface InternalPanelData {
  ticket: Ticket;
  categoryName: string;
  /** 0 quando o ticket nao esta mais na fila. */
  queuePosition: number;
  participantIds: readonly string[];
  /**
   * Nome de exibicao de quem assumiu, ja resolvido pelo servico.
   *
   * NAO da para usar mencao aqui: o valor vai dentro de um bloco de codigo, e
   * markdown nao renderiza dentro dele — era exatamente por isso que o painel
   * mostrava "Atendente 333333333333333333", o id cru. Tirar o campo do bloco
   * quebraria o alinhamento dos outros; entao o nome chega pronto de fora.
   *
   * `undefined` = quem montou nao tinha guild para consultar; `null` = o membro
   * saiu do servidor. Nos dois casos cai no id, que ao menos e rastreavel.
   */
  claimedByName?: string | null;
  /**
   * Pedidos abertos neste atendimento, JA formatados (`VK-000185 — Status`).
   *
   * Chegam prontos porque numero e status de pedido sao regra do catalogo, e o
   * painel do ticket nao tem por que conhecer catalogo para desenhar uma linha.
   */
  orderRefs?: readonly string[];
  /**
   * Historico comercial do cliente. `null`/ausente quando quem montou o painel
   * nao consultou o catalogo (ou a consulta falhou) — o bloco simplesmente nao
   * aparece, em vez de mostrar zeros que nao sao verdade.
   */
  customer?: CustomerSummary | null;
  /** Logo exibida a direita do cabecalho. */
  thumbnailUrl?: string | null;
  /** Banner exibido acima dos botoes. */
  bannerUrl?: string | null;
  storeName?: string;
  /** Cargos avisados na abertura (ping discreto no rodape). */
  teamRoleIds?: readonly string[];
}

/**
 * True quando ha algo que valha uma linha no painel.
 *
 * Cliente novo — sem compra, sem pedido aberto, sem carrinho — nao gera bloco:
 * "0 pedidos · R$ 0,00" ocuparia espaco para nao informar nada, e esse e o caso
 * mais comum de todos.
 */
export function hasCustomerHistory(customer: CustomerSummary): boolean {
  return customer.paidOrders > 0 || customer.openOrders > 0 || customer.cartItems > 0;
}

/**
 * Resumo do cliente em UMA linha.
 *
 * Cada parte so entra quando tem valor: um cliente sem carrinho nao merece
 * "carrinho: 0", e um pedido aberto e informacao acionavel enquanto zero nao e.
 */
export function describeCustomer(customer: CustomerSummary): string {
  const partes: string[] = [];

  if (customer.paidOrders > 0) {
    const plural = customer.paidOrders === 1 ? 'compra' : 'compras';
    partes.push(`${customer.paidOrders} ${plural} · ${formatCents(customer.spentCents)}`);
  } else {
    partes.push('nunca comprou');
  }

  if (customer.lastPurchaseAt !== null) {
    partes.push(`ultima em ${formatDateBR(customer.lastPurchaseAt)}`);
  }
  if (customer.openOrders > 0) {
    partes.push(`${customer.openOrders} pedido(s) em aberto`);
  }
  if (customer.cartItems > 0) {
    partes.push(`${customer.cartItems} item(ns) no carrinho`);
  }

  return partes.join(' · ');
}

/**
 * Texto do campo "Responsavel".
 *
 * Prefere o nome resolvido; sem ele, cai no id em vez de fingir que ninguem
 * assumiu — o ticket ESTA atribuido, e esconder isso e pior que mostrar o id.
 */
function responsibleLabel(data: InternalPanelData): string {
  const { claimedById } = data.ticket;
  if (claimedById === null) return 'Nao atribuido';
  const name = data.claimedByName;
  return name === null || name === undefined || name.trim().length === 0
    ? `Atendente ${claimedById}`
    : name;
}

function statusLabel(ticket: Ticket, queuePosition: number): string {
  switch (ticket.status) {
    case TicketStatus.CREATING:
      return STATUS_LABEL.CREATING;
    case TicketStatus.OPEN:
      return queuePosition > 0
        ? `${STATUS_LABEL.WAITING} — ${queuePosition}o na fila`
        : STATUS_LABEL.WAITING;
    case TicketStatus.CLAIMED:
      return STATUS_LABEL.IN_PROGRESS;
    case TicketStatus.CLOSING:
      return STATUS_LABEL.CLOSING;
    case TicketStatus.CLOSED:
      return STATUS_LABEL.CLOSED;
    case TicketStatus.ORPHANED:
      return STATUS_LABEL.ORPHANED;
    default:
      return STATUS_LABEL.WAITING;
  }
}

function accentFor(ticket: Ticket): number {
  switch (ticket.status) {
    case TicketStatus.CLAIMED:
      return COLORS.SUCCESS;
    case TicketStatus.CLOSING:
    case TicketStatus.CLOSED:
      return COLORS.NEUTRAL;
    case TicketStatus.ORPHANED:
      return COLORS.DANGER;
    default:
      return COLORS.WARNING;
  }
}

/**
 * Painel interno do ticket (mensagem fixa no canal do atendimento).
 *
 * Layout: cabecalho com a logo -> dados em blocos rotulados -> banner ->
 * botoes. Os botoes usam o id do ticket no customId, entao continuam validos
 * depois de qualquer restart.
 *
 * Orcamento de componentes (limite 10 por container), MEDIDO no pior caso:
 * cabecalho(2) + separador(1) + dados(1) + separador(1) + banner(1) +
 * separador(1) + action row(1) = 8, sobrando dois.
 *
 * O cabecalho custa DOIS componentes quando nao ha logo — titulo e saudacao
 * viram dois TextDisplay em vez de uma Section unica —, entao o arranjo mais
 * caro e justamente "sem logo, com banner", e nao o painel completo.
 * `tests/ticket-internal-panel.test.ts` fixa esse 8: quem adicionar um bloco
 * novo ve o teste quebrar, e nao um 400 no canal do cliente.
 */
export function buildInternalPanel(data: InternalPanelData): ContainerBuilder {
  const { ticket } = data;
  const root = container(accentFor(ticket));

  const heading = `## ${EMOJIS.TICKET_FOLDER} ${TITLES.TICKET_INTERNAL}`;
  const greeting =
    `Ola ${userMention(ticket.ownerId)}, seja bem-vindo ao seu ticket.\n` +
    'Aqui voce podera falar diretamente com a nossa equipe, que ja esta ciente ' +
    'da sua abertura e ira esclarecer suas duvidas o mais rapido possivel.\n' +
    'Basta aguardar e ja sera atendido.';

  const thumbnailUrl = panelImageUrl(data.thumbnailUrl);
  if (thumbnailUrl !== null) {
    root.addSectionComponents(
      sectionWithThumbnail([heading, greeting], thumbnailUrl, data.storeName ?? 'Vook Store'),
    );
  } else {
    root.addTextDisplayComponents(text(heading), text(greeting));
  }

  root.addSeparatorComponents(separator());

  const blocks = [
    boxedField('📂', 'Categoria do Atendimento', data.categoryName),
    boxedField('🎫', 'ID do Ticket', formatTicketNumber(ticket.ticketNumber)),
    boxedField('💬', 'Assunto do Ticket', ticket.subject),
    boxedField('📌', 'Status', statusLabel(ticket, data.queuePosition)),
    boxedField('👤', 'Responsavel', responsibleLabel(data)),
  ];

  if (data.participantIds.length > 0) {
    blocks.push(
      boxedField(
        '👥',
        'Participantes adicionais',
        `${data.participantIds.length} membro(s) com acesso`,
      ),
    );
  }

  /*
   * Pedidos do atendimento.
   *
   * Toda cobranca gerada aqui dentro abre um pedido, e e por este numero que a
   * equipe acha a venda depois — no painel comercial, no comprovante e no
   * historico do cliente. Sem a linha, o numero so existia na mensagem da
   * cobranca, que some canal acima.
   *
   * NAO custa componente: entra no mesmo TextDisplay dos outros blocos, entao o
   * orcamento medido de 8 filhos continua valendo.
   */
  const orderRefs = data.orderRefs ?? [];
  if (orderRefs.length > 0) {
    blocks.push(boxedField('🧾', 'Pedidos deste atendimento', orderRefs.join(' | ')));
  }

  /*
   * Historico do cliente.
   *
   * Diz COM QUEM a equipe esta falando antes da primeira mensagem. Ate aqui o
   * painel so mostrava os pedidos DESTE canal, entao quem comprou dez vezes e
   * quem nunca comprou chegavam identicos na tela.
   *
   * So aparece para quem tem historico: um bloco dizendo "0 pedidos · R$ 0,00"
   * ocuparia espaco para informar nada, e o caso comum e justamente o cliente
   * novo. Tambem NAO custa componente — entra no mesmo TextDisplay.
   */
  const customer = data.customer;
  if (customer !== undefined && customer !== null && hasCustomerHistory(customer)) {
    blocks.push(boxedField('👛', 'Historico do cliente', describeCustomer(customer)));
  }

  root.addTextDisplayComponents(text(blocks.join('\n')));

  const bannerUrl = panelImageUrl(data.bannerUrl);
  if (bannerUrl !== null) {
    root.addSeparatorComponents(separator());
    root.addMediaGalleryComponents(mediaGallery([bannerUrl], data.storeName ?? 'Vook Store'));
  }

  /*
   * Ping da equipe no rodape.
   *
   * Antes existia uma segunda mensagem so para isso. Ao remove-la o ping teve
   * de vir para ca: mensagem V2 nao aceita o campo `content` (a flag
   * IsComponentsV2 faz a API recusar), entao a mencao precisa estar dentro de
   * um TextDisplay para notificar de verdade.
   */
  const equipe = (data.teamRoleIds ?? []).filter((roleId) => roleId.length > 0);
  if (equipe.length > 0) {
    root.addTextDisplayComponents(
      text(`-# ${equipe.map((roleId) => `<@&${roleId}>`).join(' ')}`),
    );
  }

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(buttonRow(...buildPanelButtons(ticket)));

  return root;
}

function buildPanelButtons(ticket: Ticket): ButtonBuilder[] {
  const finished =
    ticket.status === TicketStatus.CLOSED ||
    ticket.status === TicketStatus.CLOSING ||
    ticket.status === TicketStatus.ORPHANED;

  const claimed = ticket.claimedById !== null;

  return [
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CLAIM, ticket.id))
      .setLabel(claimed ? 'Ticket Assumido' : 'Assumir Ticket')
      .setEmoji(claimed ? EMOJIS.APPROVE : EMOJIS.CLAIM)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(finished || claimed),
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.REFRESH, ticket.id))
      .setLabel('Atualizar')
      .setEmoji(EMOJIS.REFRESH)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(finished),
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.ADMIN, ticket.id))
      .setLabel('Painel Admin')
      .setEmoji(EMOJIS.LOCK)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(finished),
    new ButtonBuilder()
      .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CLOSE, ticket.id))
      .setLabel('Finalizar Ticket')
      .setEmoji(EMOJIS.CLOSE)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(finished),
  ];
}

// ---------------------------------------------------------------------------
// Painel administrativo (efemero, somente equipe)
// ---------------------------------------------------------------------------

export interface AdminPanelData {
  ticket: Ticket;
  categoryName: string;
  actorId: string;
  addMemberSelect: UserSelectMenuBuilder;
  transferSelect: UserSelectMenuBuilder;
  /** Ausente quando o ticket nao tem participante adicional para remover. */
  removeMemberSelect: StringSelectMenuBuilder | null;
  thumbnailUrl?: string | null;
  storeName?: string;
}

/**
 * Rotulo da prioridade, para a equipe.
 *
 * So aparece no painel ADMINISTRATIVO, nunca no painel do canal. Quem decide
 * qual ticket pegar e a equipe, entao e ali que o sinal e acionavel; mostrar
 * "Prioridade: Normal" para o cliente so convidaria a pergunta de por que o
 * dele nao e mais alta.
 */
const PRIORITY_LABEL: Record<TicketPriority, string> = {
  [TicketPriority.NORMAL]: 'Normal',
  [TicketPriority.HIGH]: 'Alta — parado na fila',
  [TicketPriority.URGENT]: 'Urgente — parado na fila ha bastante tempo',
  [TicketPriority.VIP]: 'VIP — cliente com pedido em aberto',
};

/** Bloco "• Titulo" + descricao curta, no estilo do painel de referencia. */
function adminItem(title: string, description: string): string {
  return `• **${title}**\n-# ${description}`;
}

/**
 * Painel administrativo do ticket.
 *
 * Devolve DOIS containers porque um container aceita no maximo 10 filhos, e as
 * seis acoes juntas passam disso. Contagem MEDIDA no pior caso (sem logo, que
 * gasta dois TextDisplay no lugar de uma Section):
 *
 *   membros = cabecalho(2) + separador(1) + 3 x [titulo + controle](6) = 9
 *   canal   = 3 sections com botao                                     = 3
 *
 * Num container so seriam 12. Separado, o maior fica em 9 de 10 — sobra UM
 * componente, entao uma setima acao pede um terceiro container, nao mais uma
 * linha no de membros. A mensagem suporta: sao 2 de 10 componentes de topo,
 * 25 de 40 no total e 3 de 5 action rows.
 */
export function buildAdminPanel(data: AdminPanelData): ContainerBuilder[] {
  const { ticket } = data;

  // --- Container 1: membros ---
  const membros = container(COLORS.INFO);

  const heading = `## ${EMOJIS.LOCK} ${TITLES.TICKET_ADMIN}`;
  const intro =
    `Ola ${userMention(data.actorId)}, seja bem-vindo ao painel administrativo do ticket ` +
    // Nome da categoria em trecho de codigo: o valor vem da configuracao e
    // `sanitizeConfigText` nao mexe em markdown, entao cru ele renderizaria
    // `# titulo` e `[texto](link)` dentro do painel. `codeSafe` tira as crases,
    // o que mantem o trecho fechado.
    `${formatTicketNumber(ticket.ticketNumber)} (\`${codeSafe(data.categoryName, 60)}\`).\n` +
    `-# Prioridade na fila: ${PRIORITY_LABEL[ticket.priority]}\n` +
    'Aqui estao todas as opcoes de gerenciamento deste atendimento.';

  const thumbnailUrl = panelImageUrl(data.thumbnailUrl);
  if (thumbnailUrl !== null) {
    membros.addSectionComponents(
      sectionWithThumbnail([heading, intro], thumbnailUrl, data.storeName ?? 'Vook Store'),
    );
  } else {
    membros.addTextDisplayComponents(text(heading), text(intro));
  }

  membros.addSeparatorComponents(separator());

  membros.addTextDisplayComponents(
    text(adminItem('Adicionar Membro', 'Concede acesso a este ticket.')),
  );
  membros.addActionRowComponents(selectRow(data.addMemberSelect));

  if (data.removeMemberSelect !== null) {
    membros.addTextDisplayComponents(
      text(adminItem('Remover Membro', 'Retira o acesso de um participante.')),
    );
    membros.addActionRowComponents(selectRow(data.removeMemberSelect));
  } else {
    membros.addTextDisplayComponents(
      text(adminItem('Remover Membro', 'Nenhum participante adicional neste ticket.')),
    );
  }

  membros.addTextDisplayComponents(
    text(adminItem('Transferir Atendimento', 'Passa o ticket para outro atendente da equipe.')),
  );
  membros.addActionRowComponents(selectRow(data.transferSelect));

  // --- Container 2: acoes sobre o canal ---
  const acoes = container(COLORS.INFO);

  acoes.addSectionComponents(
    sectionWithButton(
      [adminItem('Renomear Canal', 'Altera o nome do canal deste ticket.')],
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.RENAME, ticket.id))
        .setLabel('Renomear')
        .setEmoji(EMOJIS.EDIT)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  acoes.addSectionComponents(
    sectionWithButton(
      [adminItem('Notificar Cliente', 'Avisa o autor no canal e por mensagem direta.')],
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.NOTIFY, ticket.id))
        .setLabel('Notificar')
        .setEmoji(EMOJIS.NOTIFY)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  acoes.addSectionComponents(
    sectionWithButton(
      [adminItem('Finalizar Ticket', 'Inicia o encerramento e gera o transcript.')],
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CLOSE, ticket.id))
        .setLabel('Finalizar Ticket')
        .setEmoji(EMOJIS.CLOSE)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return [membros, acoes];
}
