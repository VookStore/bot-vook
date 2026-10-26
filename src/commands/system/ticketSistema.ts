import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { ContainerBuilder } from 'discord.js';

import {
  addHeader,
  container,
  fields,
  footerNote,
  separator,
  text,
} from '../../components/v2';
import { deferIfNeeded, editReplyV2, replyWarning } from '../../components/reply';
import { COLORS, EMOJIS, TITLES, renderStars } from '../../constants/branding';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { isDatabaseConnected } from '../../core/database/prisma';
import { formatUptime } from '../../utils/time';
import { getQueueOverview } from '../../modules/tickets/services/TicketQueueService';
import { buildQueueSummary } from '../../modules/tickets/builders/TicketPanelBuilder';
import {
  diagnosticIcon,
  runDiagnostics,
} from '../../modules/system/services/DiagnosticsService';
import { collectSystemStatus } from '../../modules/system/services/SystemStatusService';
import { sendWelcomeCard } from '../../modules/welcome/services/WelcomeService';
import { buildOrphanPreview } from '../../modules/tickets/builders/OrphanCleanupBuilder';
import { findOrphanThreads } from '../../modules/tickets/services/OrphanThreadService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/** /ticket-sistema status | diagnostico | testar-boas-vindas | fila */

/**
 * Limites do painel de diagnostico.
 *
 * O Container aceita 10 filhos (cabecalho = 2) e a mensagem V2 aceita 4000
 * caracteres somando todos os TextDisplay. Com 3 blocos + 2 separadores +
 * rodape o painel fica em 8 filhos no pior caso.
 */
const DIAGNOSTICS_MAX_BLOCKS = 3;
const DIAGNOSTICS_BLOCK_MAX = 1200;
const DIAGNOSTICS_TEXT_BUDGET = 3400;

const builder = new SlashCommandBuilder()
  .setName('ticket-sistema')
  .setDescription('Status, diagnostico e testes do sistema')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand.setName('status').setDescription('Mostra o status operacional do bot'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('diagnostico')
      .setDescription('Verifica a configuracao contra o estado real do servidor'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('fila').setDescription('Mostra a fila de atendimento por categoria'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('orfaos')
      .setDescription('Lista topicos de ticket sem registro no banco e permite remove-los'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('testar-boas-vindas')
      .setDescription('Envia uma pre-visualizacao do card de boas-vindas (nao aplica cargo)'),
  );

function buildStatusPanel(
  status: Awaited<ReturnType<typeof collectSystemStatus>>,
): ContainerBuilder {
  const root = container(status.databaseOk ? COLORS.SUCCESS : COLORS.DANGER);
  addHeader(root, TITLES.STATUS);

  root.addTextDisplayComponents(
    text(
      fields([
        ['Discord', `${EMOJIS.ONLINE} Online`],
        ['WebSocket', `${status.websocketPing} ms`],
        [
          'PostgreSQL',
          status.databaseOk
            ? `${EMOJIS.ONLINE} Conectado (${status.databaseLatencyMs} ms)`
            : `${EMOJIS.OFFLINE} Indisponivel`,
        ],
        ['Uptime', formatUptime(status.uptimeSeconds)],
      ]),
    ),
  );

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      fields([
        ['Tickets ativos', String(status.activeTickets)],
        ['Na fila', String(status.queueSize)],
        ['Pagamentos pendentes', String(status.pendingPayments)],
        ['Pagamentos aprovados', String(status.approvedPayments)],
        ['Cupons ativos', String(status.activeCoupons)],
        [
          'Avaliacoes registradas',
          status.averageRating !== null
            ? `${status.reviewCount} • ${renderStars(Math.round(status.averageRating))} (${status.averageRating.toFixed(2)})`
            : String(status.reviewCount),
        ],
        // Catalogo entra NESTE bloco de proposito: um Container aceita 10
        // filhos e o painel ja usa 9. Uma secao propria estouraria o limite e
        // a mensagem inteira seria recusada com 400.
        ['Packs ativos', String(status.activePacks)],
        ['Carrinhos ativos', String(status.activeCarts)],
        [
          'Pedidos',
          `${status.pendingOrders} aguardando vendedor • ${status.ordersAwaitingPayment} aguardando pagamento • ` +
            `${status.paidOrders} pago(s) em processamento`,
        ],
      ]),
    ),
  );

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      fields([
        [
          'Cache',
          `${EMOJIS.ONLINE} ${status.cacheEntries} entrada(s) • ${status.cacheHits} acerto(s) / ${status.cacheMisses} falha(s)`,
        ],
        ['Locks ativos', String(status.activeLocks)],
        ['Rascunhos de cobranca', String(status.paymentDrafts)],
        ['Memoria', `${status.memoryMb} MB`],
        [
          'Erros recentes (24h)',
          status.recentErrors === 0 ? '0' : `${EMOJIS.OFFLINE} ${status.recentErrors}`,
        ],
      ]),
    ),
  );

  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    footerNote(`Servidores atendidos: ${status.guildCount} • Vook Store Bot V2`),
  );
  return root;
}

/**
 * Painel de diagnostico.
 *
 * Um Container aceita 10 filhos e a mensagem V2 aceita 4000 caracteres somando
 * TODOS os TextDisplay. Um servidor gera 2 itens por categoria ativa (destino +
 * equipe): com 15 categorias a versao anterior (um bloco fixo a cada 8 itens)
 * ja passava de 10 filhos e com 25 passava de 6000 caracteres — a mensagem
 * inteira era recusada com 400 e o operador so via "erro inesperado".
 * Por isso a paginacao aqui e por ORCAMENTO, nunca por contagem fixa.
 */
export function buildDiagnosticsPanel(
  report: Awaited<ReturnType<typeof runDiagnostics>>,
): ContainerBuilder {
  const root = container(
    report.errors > 0 ? COLORS.DANGER : report.warnings > 0 ? COLORS.WARNING : COLORS.SUCCESS,
  );
  addHeader(root, TITLES.DIAGNOSTICS, {
    subtitle:
      report.errors > 0
        ? `${report.errors} problema(s) critico(s) encontrado(s).`
        : report.warnings > 0
          ? `${report.warnings} ponto(s) de atencao.`
          : 'Nenhum problema encontrado.',
  });

  const lines = report.items.map(
    (item) => `${diagnosticIcon(item.level)} **${item.label}**\n${item.detail}`,
  );

  const blocks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  let used = 0;
  let omitted = 0;

  for (const line of lines) {
    const cost = line.length + 2;
    const blockFull = currentLength + cost > DIAGNOSTICS_BLOCK_MAX;
    const noRoomLeft =
      used + cost > DIAGNOSTICS_TEXT_BUDGET ||
      (current.length > 0 && blockFull && blocks.length >= DIAGNOSTICS_MAX_BLOCKS - 1);

    if (noRoomLeft) {
      omitted += 1;
      continue;
    }
    if (current.length > 0 && blockFull) {
      blocks.push(current.join('\n\n'));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += cost;
    used += cost;
  }
  if (current.length > 0) blocks.push(current.join('\n\n'));

  for (const [index, block] of blocks.entries()) {
    root.addTextDisplayComponents(text(block));
    if (index < blocks.length - 1) root.addSeparatorComponents(separator());
  }

  if (omitted > 0) {
    root.addTextDisplayComponents(
      footerNote(
        `… e mais ${omitted} verificacao(oes) nao exibida(s) por limite de tamanho da mensagem.`,
      ),
    );
  }

  return root;
}

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  assertCanManageSystem(interaction.member);
  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === 'status') {
    await deferIfNeeded(interaction, { ephemeral: true });
    if (!isDatabaseConnected()) {
      await replyWarning(
        interaction,
        'O banco de dados nao esta conectado. Algumas metricas podem falhar.',
      );
    }
    const status = await collectSystemStatus(interaction.guild);
    await editReplyV2(interaction, buildStatusPanel(status));
    return;
  }

  if (subcommand === 'diagnostico') {
    await deferIfNeeded(interaction, { ephemeral: true });
    const report = await runDiagnostics(interaction.guild);
    await editReplyV2(interaction, buildDiagnosticsPanel(report));
    return;
  }

  if (subcommand === 'fila') {
    await deferIfNeeded(interaction, { ephemeral: true });
    const overview = await getQueueOverview(interaction.guildId);

    // Usa o builder compartilhado: ele corta a listagem por orcamento de texto.
    // A versao inline anterior concatenava TODAS as categorias em um unico
    // TextDisplay e estourava os 4000 caracteres a partir de ~18 categorias.
    await editReplyV2(interaction, buildQueueSummary(overview));
    return;
  }

  if (subcommand === 'orfaos') {
    await deferIfNeeded(interaction, { ephemeral: true });

    /*
     * O corte e AGORA e vai no botao. Ao confirmar, a varredura roda de novo e
     * so remove o que ja existia neste instante: um ticket aberto entre esta
     * tela e o clique nunca foi mostrado ao operador, e apagar o que ele nao
     * viu e exatamente o que a confirmacao deveria impedir.
     */
    const cutoff = new Date();
    const orphans = await findOrphanThreads(interaction.guild);

    await editReplyV2(interaction, buildOrphanPreview(orphans, cutoff));
    return;
  }

  // testar-boas-vindas
  await deferIfNeeded(interaction, { ephemeral: true });
  const sent = await sendWelcomeCard(interaction.member, {
    preview: true,
    targetChannelId: interaction.channelId ?? undefined,
  });

  await editReplyV2(
    interaction,
    container(sent ? COLORS.SUCCESS : COLORS.WARNING).addTextDisplayComponents(
      text(
        sent
          ? `${EMOJIS.WELCOME} Pre-visualizacao enviada. Nenhum cargo foi aplicado.`
          : '⚠️ Nao foi possivel enviar a pre-visualizacao. Verifique o canal de boas-vindas e as permissoes do bot.',
      ),
    ),
  );
}

export const ticketSistemaCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
