"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnosticIcon = diagnosticIcon;
exports.runDiagnostics = runDiagnostics;
const node_fs_1 = require("node:fs");
const discord_js_1 = require("discord.js");
const PermissionService_1 = require("../../../core/permissions/PermissionService");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const TicketConfigService_1 = require("../../tickets/services/TicketConfigService");
const OrphanThreadService_1 = require("../../tickets/services/OrphanThreadService");
const BackupService_1 = require("./BackupService");
const money_1 = require("../../../utils/money");
const PaymentAccountService_1 = require("../../payments/services/PaymentAccountService");
const WolfPortfolioService_1 = require("../../wolves/services/WolfPortfolioService");
const errors_1 = require("../../../core/errors");
const QrTemplateService_1 = require("../../payments/services/QrTemplateService");
const ICON = { ok: '🟢', warn: '🟡', error: '🔴' };
function diagnosticIcon(level) {
    return ICON[level];
}
async function checkTextChannel(guild, channelId, label, requiredWhenMissing) {
    if (channelId === null || channelId.length === 0) {
        return {
            label,
            level: requiredWhenMissing ? 'error' : 'warn',
            detail: 'Nao configurado.',
        };
    }
    const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
    if (channel === null) {
        return { label, level: 'error', detail: 'Canal configurado nao encontrado.' };
    }
    if (channel.type !== discord_js_1.ChannelType.GuildText) {
        return { label, level: 'error', detail: 'O canal configurado nao e um canal de texto.' };
    }
    const permissions = guild.members.me
        ? channel.permissionsFor(guild.members.me)
        : null;
    if (permissions === null) {
        return { label, level: 'warn', detail: 'Nao foi possivel verificar as permissoes do bot.' };
    }
    if (!permissions.has(discord_js_1.PermissionFlagsBits.ViewChannel)) {
        return { label, level: 'error', detail: `<#${channel.id}> — o bot nao ve este canal.` };
    }
    if (!permissions.has(discord_js_1.PermissionFlagsBits.SendMessages)) {
        return {
            label,
            level: 'error',
            detail: `<#${channel.id}> — o bot nao pode enviar mensagens.`,
        };
    }
    return { label, level: 'ok', detail: `<#${channel.id}>` };
}
/**
 * Destino valido para topicos.
 *
 * Passou a exigir CANAL DE TEXTO: um ticket agora e um topico privado, e
 * categoria do Discord nao hospeda topico. Servidor que ja rodava aponta para
 * uma categoria ate reconfigurar — e este item e o que avisa.
 */
function isDestinationChannel(channel) {
    return channel !== null && channel.type === discord_js_1.ChannelType.GuildText;
}
/**
 * Saude do backup do banco.
 *
 * O job grava um dump por dia e registra falha no `error.log` — que ninguem le
 * por vontade propria. Este item existe porque backup que falha em silencio e
 * pior que backup nenhum: quem confia nele so descobre no dia do resgate, e ate
 * la a rotacao ja apagou os bons.
 *
 * O prazo e lido da data do arquivo mais recente no disco, a mesma fonte que o
 * job usa para decidir se ja e hora.
 */
async function checkBackup() {
    const label = 'Backup do banco';
    const [last, files] = await Promise.all([(0, BackupService_1.lastBackupAt)(), (0, BackupService_1.listBackups)()]);
    if (last === null) {
        return {
            label,
            level: 'warn',
            detail: 'Nenhum backup gravado ainda. Rode `npm run backup` para gerar o primeiro.',
        };
    }
    const hours = (Date.now() - last.getTime()) / 3_600_000;
    const quando = `ha ${(0, money_1.formatDuration)(Date.now() - last.getTime())}`;
    const quantos = `${files.length} arquivo(s)`;
    /*
     * 24h e o prazo normal (o job tenta a cada 20h); 48h significa que ele nao
     * roda ha mais de um ciclo inteiro — nessa altura o bot esta fora do ar ou o
     * `pg_dump` esta falhando, e os dois pedem alguem olhando.
     */
    if (hours >= 48) {
        return { label, level: 'error', detail: `Ultimo backup ${quando} · ${quantos}.` };
    }
    if (hours >= 24) {
        return { label, level: 'warn', detail: `Ultimo backup ${quando} · ${quantos}.` };
    }
    return { label, level: 'ok', detail: `Ultimo backup ${quando} · ${quantos}.` };
}
/**
 * Topicos de ticket que o banco nao conhece.
 *
 * Nascem de aberturas que falharam depois de o topico ser criado. A causa foi
 * corrigida, mas os antigos ficam na lista de canais sem ninguem conseguir
 * fecha-los pelo bot — e so a equipe os enxerga, o que os torna faceis de
 * ignorar por meses.
 */
async function checkOrphanThreads(guild) {
    const label = 'Topicos orfaos';
    try {
        const orphans = await (0, OrphanThreadService_1.findOrphanThreads)(guild);
        if (orphans.length === 0) {
            return { label, level: 'ok', detail: 'Nenhum topico de ticket sem registro.' };
        }
        const nomes = orphans
            .slice(0, 5)
            .map((orphan) => orphan.name)
            .join(', ');
        const resto = orphans.length > 5 ? ` e mais ${orphans.length - 5}` : '';
        return {
            label,
            level: 'warn',
            detail: `${orphans.length} sem registro (${nomes}${resto}). Use \`/ticket-sistema orfaos\`.`,
        };
    }
    catch (error) {
        return {
            label,
            level: 'warn',
            detail: `Nao foi possivel varrer: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
/**
 * Cargo automatico de 2 boosts: a corrente inteira.
 *
 * ESTE ITEM EXISTE POR CAUSA DO MODO DE FALHA. A concessao depende de uma
 * MENSAGEM DE SISTEMA que o Discord publica a cada boost — e a unica fonte que
 * informa quantos boosts a pessoa tem, ja que a API nao expoe essa contagem.
 * Se qualquer elo estiver quebrado (canal de sistema ausente, aviso de boost
 * suprimido, bot sem enxergar o canal, cargo acima do bot na hierarquia), nada
 * acontece e NADA e registrado: o proximo boost simplesmente nao gera evento.
 *
 * Um servidor pode passar meses assim sem ninguem notar, ate um cliente
 * reclamar que impulsionou duas vezes e nao recebeu nada.
 */
function checkBoostRole(guild, config) {
    const label = 'Cargo de 2 boosts';
    const roleId = config.boosterTier2RoleId;
    if (roleId === null) {
        return { label, level: 'ok', detail: 'Desativado. Use `/booster nivel2` para ligar.' };
    }
    const role = guild.roles.cache.get(roleId);
    if (role === undefined) {
        return { label, level: 'error', detail: 'O cargo configurado nao existe mais.' };
    }
    const botMember = guild.members.me;
    if (botMember !== null) {
        const check = (0, PermissionService_1.canBotAssignRole)(botMember, roleId);
        if (!check.ok) {
            return { label, level: 'error', detail: `${role.name} — ${check.reason ?? 'nao atribuivel'}.` };
        }
    }
    const systemChannel = guild.systemChannel;
    if (systemChannel === null) {
        return {
            label,
            level: 'error',
            detail: 'Nenhum canal de sistema definido. Sem ele o Discord nao publica o aviso de boost, ' +
                'que e a unica fonte da contagem.',
        };
    }
    /*
     * A flag de supressao e o elo mais facil de quebrar sem perceber: ela fica na
     * mesma tela do canal de sistema e desliga so o aviso de boost, deixando os
     * outros no ar.
     */
    if (guild.systemChannelFlags.has(discord_js_1.GuildSystemChannelFlags.SuppressPremiumSubscriptions)) {
        return {
            label,
            level: 'error',
            detail: 'Os avisos de boost estao suprimidos em Configuracoes > Visao Geral. ' +
                'Sem a mensagem, o bot nao tem como saber quantos boosts a pessoa deu.',
        };
    }
    if (botMember !== null) {
        const permissions = systemChannel.permissionsFor(botMember);
        if (!permissions.has(discord_js_1.PermissionFlagsBits.ViewChannel)) {
            return {
                label,
                level: 'error',
                detail: `O bot nao enxerga <#${systemChannel.id}> e nao recebe o aviso de boost.`,
            };
        }
    }
    return {
        label,
        level: 'ok',
        detail: `<@&${role.id}> a partir do 2o boost · avisos em <#${systemChannel.id}>`,
    };
}
/**
 * Portfolio de lobos — so entra no relatorio quando esta em uso.
 *
 * Loja que nunca configurou o recurso nao precisa de um aviso permanente de
 * "nao configurado". Mas painel publicado SEM destino e erro de verdade: a
 * equipe ve o botao desligado e ninguem sabe por que.
 *
 * Usa a MESMA conferencia da publicacao (`resolvePortfolioChannel`), e nao
 * `checkTextChannel`: o post precisa de "Anexar arquivos", que aquele nao
 * confere, e o portfolio pode ser canal de anuncios, que aquele recusa. Um
 * diagnostico que diz "ok" para um canal que recusaria o post mente.
 */
async function checkWolfPortfolio(guild, config) {
    const label = 'Portfolio de lobos';
    if (config.wolfPortfolioChannelId === null) {
        if (config.wolfPanelChannelId === null)
            return null;
        return {
            label,
            level: 'error',
            detail: 'Painel publicado, mas sem canal de destino. Use `/lobos portfolio`.',
        };
    }
    try {
        const channel = await (0, WolfPortfolioService_1.resolvePortfolioChannel)(guild, config.wolfPortfolioChannelId);
        return { label, level: 'ok', detail: `<#${channel.id}>` };
    }
    catch (error) {
        if (error instanceof errors_1.ConfigurationError) {
            return { label, level: 'error', detail: error.userMessage };
        }
        throw error;
    }
}
async function runDiagnostics(guild) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const items = [];
    // --- Permissoes do bot ---
    if (guild.members.me !== null) {
        const botCheck = (0, PermissionService_1.checkBotPermissions)(guild.members.me);
        items.push({
            label: 'Permissoes do bot',
            level: botCheck.ok ? 'ok' : 'error',
            detail: botCheck.ok
                ? 'Todas as permissoes necessarias estao concedidas.'
                : `Faltando: ${botCheck.missing.join(', ')}.`,
        });
    }
    // --- Canais ---
    items.push(await checkTextChannel(guild, config.ticketPanelChannelId, 'Painel publico', false));
    items.push(await checkTextChannel(guild, config.ticketLogChannelId, 'Canal de logs', false));
    items.push(await checkTextChannel(guild, config.welcomeEnabled ? config.welcomeChannelId : null, 'Canal de boas-vindas', config.welcomeEnabled));
    items.push(await checkTextChannel(guild, config.reviewChannelId, 'Canal de avaliacoes', false));
    const wolfPortfolio = await checkWolfPortfolio(guild, config);
    if (wolfPortfolio !== null)
        items.push(wolfPortfolio);
    // --- Mensagem do painel ---
    if (config.ticketPanelChannelId !== null && config.ticketPanelMessageId !== null) {
        const channel = await (0, discord_1.fetchChannelSafe)(guild, config.ticketPanelChannelId);
        if (channel !== null && channel.type === discord_js_1.ChannelType.GuildText) {
            try {
                await channel.messages.fetch(config.ticketPanelMessageId);
                items.push({
                    label: 'Mensagem do painel',
                    level: 'ok',
                    detail: 'Publicada e acessivel.',
                });
            }
            catch {
                items.push({
                    label: 'Mensagem do painel',
                    level: 'warn',
                    detail: 'A mensagem do painel nao existe mais. Use `/ticket-painel enviar`.',
                });
            }
        }
    }
    else {
        items.push({
            label: 'Mensagem do painel',
            level: 'warn',
            detail: 'Painel nunca publicado. Use `/ticket-painel enviar`.',
        });
    }
    // --- Auto-role ---
    if (config.autoRoleEnabled) {
        if (config.autoRoleId === null) {
            items.push({
                label: 'Auto-Role',
                level: 'error',
                detail: 'Ativado, mas nenhum cargo foi selecionado.',
            });
        }
        else {
            const role = guild.roles.cache.get(config.autoRoleId);
            if (role === undefined) {
                items.push({ label: 'Auto-Role', level: 'error', detail: 'Cargo configurado nao existe mais.' });
            }
            else if (role.managed) {
                items.push({
                    label: 'Auto-Role',
                    level: 'error',
                    detail: `${role.name} e gerenciado por integracao e nao pode ser atribuido.`,
                });
            }
            else if (guild.members.me !== null &&
                guild.members.me.roles.highest.comparePositionTo(role) <= 0) {
                items.push({
                    label: 'Auto-Role',
                    level: 'error',
                    detail: `${role.name} esta acima do cargo do bot na hierarquia.`,
                });
            }
            else {
                items.push({ label: 'Auto-Role', level: 'ok', detail: `<@&${role.id}>` });
            }
        }
    }
    else {
        items.push({ label: 'Auto-Role', level: 'ok', detail: 'Desativado.' });
    }
    // --- Categorias, destinos e equipes ---
    const categories = (await (0, TicketConfigService_1.getCategories)(guild.id)).filter((category) => category.deletedAt === null);
    const enabled = categories.filter((category) => category.enabled);
    if (categories.length === 0) {
        items.push({
            label: 'Categorias',
            level: 'error',
            detail: 'Nenhuma categoria cadastrada. Use `/ticket-categorias gerenciar`.',
        });
    }
    else {
        items.push({
            label: 'Categorias',
            level: enabled.length > 0 ? 'ok' : 'error',
            detail: enabled.length > 0
                ? `${enabled.length} ativa(s) de ${categories.length} cadastrada(s).`
                : 'Todas as categorias estao desativadas.',
        });
    }
    for (const category of enabled) {
        const destination = await (0, discord_1.fetchChannelSafe)(guild, category.destinationChannelId);
        if (category.destinationChannelId === null) {
            items.push({
                label: `Destino • ${category.name}`,
                level: 'warn',
                detail: 'Sem canal de atendimento definido. Nenhum ticket desta categoria pode ser aberto.',
            });
        }
        else if (!isDestinationChannel(destination)) {
            items.push({
                label: `Destino • ${category.name}`,
                level: 'error',
                detail: 'O destino configurado nao e um canal de texto acessivel. Reconfigure em ' +
                    '`/ticket-destinos configurar`.',
            });
        }
        const roleIds = await (0, TicketConfigService_1.getTeamRoleIds)(category.id);
        if (roleIds.length === 0) {
            items.push({
                label: `Equipe • ${category.name}`,
                level: 'error',
                detail: 'Sem cargo responsavel: nao e possivel abrir tickets nesta categoria.',
            });
            continue;
        }
        const missing = roleIds.filter((roleId) => !guild.roles.cache.has(roleId));
        if (missing.length > 0) {
            items.push({
                label: `Equipe • ${category.name}`,
                level: 'error',
                detail: `${missing.length} cargo(s) configurado(s) nao existe(m) mais.`,
            });
        }
    }
    // --- Contas PIX ---
    const accounts = (await (0, PaymentAccountService_1.getAccounts)(guild.id)).filter((account) => account.deletedAt === null);
    const enabledAccounts = accounts.filter((account) => account.enabled);
    items.push({
        label: 'Contas PIX',
        level: enabledAccounts.length > 0 ? 'ok' : 'warn',
        detail: enabledAccounts.length > 0
            ? `${enabledAccounts.length} conta(s) ativa(s).`
            : 'Nenhuma conta PIX ativa. Cobrancas nao poderao ser geradas.',
    });
    /*
     * Arte do QR: opcional, mas quando o arquivo existe e nao pode ser usado, o
     * operador precisa saber AQUI — e nao pelo cliente recebendo um QR simples
     * onde ele esperava o card da loja.
     */
    for (const account of enabledAccounts) {
        const path = (0, QrTemplateService_1.resolveTemplatePath)(guild.id, account.identifier);
        if (path === null)
            continue;
        if (!(0, node_fs_1.existsSync)(path)) {
            items.push({
                label: `Arte do QR • ${account.name}`,
                level: 'ok',
                detail: 'Sem arte cadastrada: o cartao usa o QR simples.',
            });
            continue;
        }
        const usable = await (0, QrTemplateService_1.hasUsableTemplate)(guild.id, account.identifier);
        items.push({
            label: `Arte do QR • ${account.name}`,
            level: usable ? 'ok' : 'warn',
            detail: usable
                ? 'Arte carregada e quadrado branco localizado.'
                : 'Arquivo encontrado, mas sem quadrado branco valido. O cartao usa o QR simples.',
        });
    }
    items.push(checkBoostRole(guild, config));
    // --- Operacao (backup e sujeira deixada por falhas antigas) ---
    items.push(await checkBackup());
    items.push(await checkOrphanThreads(guild));
    return {
        items,
        errors: items.filter((item) => item.level === 'error').length,
        warnings: items.filter((item) => item.level === 'warn').length,
    };
}
//# sourceMappingURL=DiagnosticsService.js.map