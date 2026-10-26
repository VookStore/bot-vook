"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketSistemaCommand = void 0;
exports.buildDiagnosticsPanel = buildDiagnosticsPanel;
const discord_js_1 = require("discord.js");
const v2_1 = require("../../components/v2");
const reply_1 = require("../../components/reply");
const branding_1 = require("../../constants/branding");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const prisma_1 = require("../../core/database/prisma");
const time_1 = require("../../utils/time");
const TicketQueueService_1 = require("../../modules/tickets/services/TicketQueueService");
const TicketPanelBuilder_1 = require("../../modules/tickets/builders/TicketPanelBuilder");
const DiagnosticsService_1 = require("../../modules/system/services/DiagnosticsService");
const SystemStatusService_1 = require("../../modules/system/services/SystemStatusService");
const WelcomeService_1 = require("../../modules/welcome/services/WelcomeService");
const OrphanCleanupBuilder_1 = require("../../modules/tickets/builders/OrphanCleanupBuilder");
const OrphanThreadService_1 = require("../../modules/tickets/services/OrphanThreadService");
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
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('ticket-sistema')
    .setDescription('Status, diagnostico e testes do sistema')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Mostra o status operacional do bot'))
    .addSubcommand((subcommand) => subcommand
    .setName('diagnostico')
    .setDescription('Verifica a configuracao contra o estado real do servidor'))
    .addSubcommand((subcommand) => subcommand.setName('fila').setDescription('Mostra a fila de atendimento por categoria'))
    .addSubcommand((subcommand) => subcommand
    .setName('orfaos')
    .setDescription('Lista topicos de ticket sem registro no banco e permite remove-los'))
    .addSubcommand((subcommand) => subcommand
    .setName('testar-boas-vindas')
    .setDescription('Envia uma pre-visualizacao do card de boas-vindas (nao aplica cargo)'));
function buildStatusPanel(status) {
    const root = (0, v2_1.container)(status.databaseOk ? branding_1.COLORS.SUCCESS : branding_1.COLORS.DANGER);
    (0, v2_1.addHeader)(root, branding_1.TITLES.STATUS);
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Discord', `${branding_1.EMOJIS.ONLINE} Online`],
        ['WebSocket', `${status.websocketPing} ms`],
        [
            'PostgreSQL',
            status.databaseOk
                ? `${branding_1.EMOJIS.ONLINE} Conectado (${status.databaseLatencyMs} ms)`
                : `${branding_1.EMOJIS.OFFLINE} Indisponivel`,
        ],
        ['Uptime', (0, time_1.formatUptime)(status.uptimeSeconds)],
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Tickets ativos', String(status.activeTickets)],
        ['Na fila', String(status.queueSize)],
        ['Pagamentos pendentes', String(status.pendingPayments)],
        ['Pagamentos aprovados', String(status.approvedPayments)],
        ['Cupons ativos', String(status.activeCoupons)],
        [
            'Avaliacoes registradas',
            status.averageRating !== null
                ? `${status.reviewCount} • ${(0, branding_1.renderStars)(Math.round(status.averageRating))} (${status.averageRating.toFixed(2)})`
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
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        [
            'Cache',
            `${branding_1.EMOJIS.ONLINE} ${status.cacheEntries} entrada(s) • ${status.cacheHits} acerto(s) / ${status.cacheMisses} falha(s)`,
        ],
        ['Locks ativos', String(status.activeLocks)],
        ['Rascunhos de cobranca', String(status.paymentDrafts)],
        ['Memoria', `${status.memoryMb} MB`],
        [
            'Erros recentes (24h)',
            status.recentErrors === 0 ? '0' : `${branding_1.EMOJIS.OFFLINE} ${status.recentErrors}`,
        ],
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Servidores atendidos: ${status.guildCount} • Vook Store Bot V2`));
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
function buildDiagnosticsPanel(report) {
    const root = (0, v2_1.container)(report.errors > 0 ? branding_1.COLORS.DANGER : report.warnings > 0 ? branding_1.COLORS.WARNING : branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, branding_1.TITLES.DIAGNOSTICS, {
        subtitle: report.errors > 0
            ? `${report.errors} problema(s) critico(s) encontrado(s).`
            : report.warnings > 0
                ? `${report.warnings} ponto(s) de atencao.`
                : 'Nenhum problema encontrado.',
    });
    const lines = report.items.map((item) => `${(0, DiagnosticsService_1.diagnosticIcon)(item.level)} **${item.label}**\n${item.detail}`);
    const blocks = [];
    let current = [];
    let currentLength = 0;
    let used = 0;
    let omitted = 0;
    for (const line of lines) {
        const cost = line.length + 2;
        const blockFull = currentLength + cost > DIAGNOSTICS_BLOCK_MAX;
        const noRoomLeft = used + cost > DIAGNOSTICS_TEXT_BUDGET ||
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
    if (current.length > 0)
        blocks.push(current.join('\n\n'));
    for (const [index, block] of blocks.entries()) {
        root.addTextDisplayComponents((0, v2_1.text)(block));
        if (index < blocks.length - 1)
            root.addSeparatorComponents((0, v2_1.separator)());
    }
    if (omitted > 0) {
        root.addTextDisplayComponents((0, v2_1.footerNote)(`… e mais ${omitted} verificacao(oes) nao exibida(s) por limite de tamanho da mensagem.`));
    }
    return root;
}
async function execute(interaction) {
    (0, PermissionService_1.assertCanManageSystem)(interaction.member);
    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === 'status') {
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        if (!(0, prisma_1.isDatabaseConnected)()) {
            await (0, reply_1.replyWarning)(interaction, 'O banco de dados nao esta conectado. Algumas metricas podem falhar.');
        }
        const status = await (0, SystemStatusService_1.collectSystemStatus)(interaction.guild);
        await (0, reply_1.editReplyV2)(interaction, buildStatusPanel(status));
        return;
    }
    if (subcommand === 'diagnostico') {
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const report = await (0, DiagnosticsService_1.runDiagnostics)(interaction.guild);
        await (0, reply_1.editReplyV2)(interaction, buildDiagnosticsPanel(report));
        return;
    }
    if (subcommand === 'fila') {
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const overview = await (0, TicketQueueService_1.getQueueOverview)(interaction.guildId);
        // Usa o builder compartilhado: ele corta a listagem por orcamento de texto.
        // A versao inline anterior concatenava TODAS as categorias em um unico
        // TextDisplay e estourava os 4000 caracteres a partir de ~18 categorias.
        await (0, reply_1.editReplyV2)(interaction, (0, TicketPanelBuilder_1.buildQueueSummary)(overview));
        return;
    }
    if (subcommand === 'orfaos') {
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        /*
         * O corte e AGORA e vai no botao. Ao confirmar, a varredura roda de novo e
         * so remove o que ja existia neste instante: um ticket aberto entre esta
         * tela e o clique nunca foi mostrado ao operador, e apagar o que ele nao
         * viu e exatamente o que a confirmacao deveria impedir.
         */
        const cutoff = new Date();
        const orphans = await (0, OrphanThreadService_1.findOrphanThreads)(interaction.guild);
        await (0, reply_1.editReplyV2)(interaction, (0, OrphanCleanupBuilder_1.buildOrphanPreview)(orphans, cutoff));
        return;
    }
    // testar-boas-vindas
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    const sent = await (0, WelcomeService_1.sendWelcomeCard)(interaction.member, {
        preview: true,
        targetChannelId: interaction.channelId ?? undefined,
    });
    await (0, reply_1.editReplyV2)(interaction, (0, v2_1.container)(sent ? branding_1.COLORS.SUCCESS : branding_1.COLORS.WARNING).addTextDisplayComponents((0, v2_1.text)(sent
        ? `${branding_1.EMOJIS.WELCOME} Pre-visualizacao enviada. Nenhum cargo foi aplicado.`
        : '⚠️ Nao foi possivel enviar a pre-visualizacao. Verifique o canal de boas-vindas e as permissoes do bot.')));
}
exports.ticketSistemaCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=ticketSistema.js.map