"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewAutoRoleBackfill = previewAutoRoleBackfill;
exports.runAutoRoleBackfill = runAutoRoleBackfill;
const util_1 = require("@discordjs/util");
const limits_1 = require("../../../constants/limits");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const PermissionService_1 = require("../../../core/permissions/PermissionService");
const discord_1 = require("../../../utils/discord");
const time_1 = require("../../../utils/time");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
/**
 * Aplicacao retroativa do cargo de boas-vindas.
 *
 * O cargo automatico so existia no caminho de ENTRADA: quem entrou antes de ele
 * ser configurado — ou entrou enquanto ele estava desligado, ou escapou por uma
 * falha de rede naquele segundo — ficou sem cargo nenhum para sempre. Este
 * modulo varre o servidor e fecha esse buraco.
 *
 * "SEM NENHUM CARGO" E LITERAL. So recebe quem nao tem NADA alem de @everyone.
 * Quem ja tem qualquer outro cargo fica intocado, mesmo que nao tenha o cargo
 * de boas-vindas: essa pessoa foi classificada por alguem, e sobrescrever uma
 * decisao humana em massa e o tipo de erro que nao da para desfazer com um
 * comando.
 *
 * BOTS NUNCA ENTRAM. Um bot sem cargo e o estado normal de um bot.
 *
 * A OPERACAO E RETOMAVEL. Ela para no teto de membros ou no teto de tempo e diz
 * quantos faltaram; rodar de novo continua de onde parou, porque quem ja
 * recebeu deixa de se encaixar no filtro.
 */
const logger = (0, Logger_1.createLogger)('welcome:backfill');
/** Motivo no log de auditoria do Discord, para a equipe saber de onde veio. */
const BACKFILL_AUDIT_REASON = 'Cargo de boas-vindas aplicado retroativamente (Vook Store Bot)';
/**
 * True quando o membro nao tem NENHUM cargo alem de @everyone.
 *
 * Escrito com `every` em vez de comparar o tamanho da colecao porque
 * `roles.cache` inclui @everyone — um `size === 0` nunca seria verdade, e um
 * `size === 1` dependeria desse detalhe continuar valendo na proxima versao da
 * discord.js.
 */
function hasNoRoles(member) {
    const everyoneId = member.guild.roles.everyone.id;
    return member.roles.cache.every((role) => role.id === everyoneId);
}
/** Carrega o cargo configurado, ou explica por que nao da para seguir. */
async function resolveConfiguredRole(guild) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const roleId = config.autoRoleId;
    if (roleId === null || roleId.length === 0) {
        throw new errors_1.ConfigurationError(`Guild sem autoRoleId: ${guild.id}`, {
            userMessage: 'Nenhum cargo de boas-vindas esta configurado. Defina-o em `/ticket-config geral` antes de aplicar.',
            context: { guildId: guild.id },
        });
    }
    return { roleId, enabled: config.autoRoleEnabled };
}
/**
 * Impedimento que atingiria TODOS os membros, checado UMA vez.
 *
 * Hierarquia e permissao nao mudam de membro para membro. Descobrir isso no
 * primeiro `roles.add` significaria falhar 500 vezes seguidas e escrever 500
 * linhas de log dizendo a mesma coisa.
 */
function findBlocker(guild, roleId) {
    const botMember = guild.members.me;
    if (botMember === null)
        return 'O bot nao esta disponivel neste servidor.';
    const check = (0, PermissionService_1.canBotAssignRole)(botMember, roleId);
    return check.ok ? null : (check.reason ?? 'O bot nao pode atribuir este cargo.');
}
/**
 * True quando o cache local ja contem o servidor inteiro.
 *
 * DEPENDE DE DUAS PROPRIEDADES DO CLIENTE, ambas em `createClient.ts`:
 *
 *  1. `GuildMemberManager` NAO tem teto de cache (o `makeCache` do projeto so
 *     limita mensagens, reacoes e alguns managers que nao sao este);
 *  2. nenhum sweeper poda membros (o padrao da discord.js so poda `threads`).
 *
 * Se algum dia alguem limitar o cache de membros, esta funcao passa a mentir e
 * o backfill silenciosamente ignora quem nao couber. A comparacao com
 * `memberCount` e a protecao: um cache podado fica menor que a contagem e a
 * listagem completa volta a acontecer.
 */
function isMemberCacheComplete(guild) {
    // `memberCount` zerado nao existe num servidor de verdade (o proprio bot
    // conta), entao aqui ele so pode significar "ainda nao sei" — e "nao sei"
    // nunca pode ser lido como "ja tenho todo mundo".
    if (guild.memberCount <= 0)
        return false;
    return guild.members.cache.size >= guild.memberCount;
}
/**
 * Lista TODOS os membros da guild.
 *
 * O CAMINHO BARATO VEM PRIMEIRO. Uma vez que o servidor inteiro esteja em
 * cache, ler dali e melhor que pedir de novo em todos os sentidos: nao gasta
 * gateway, e instantaneo e — o que mais importa aqui — esta MAIS atualizado que
 * um snapshot, porque `guildMemberAdd`, `guildMemberRemove` e
 * `guildMemberUpdate` continuam chegando e mantendo os cargos em dia.
 *
 * O CAMINHO CARO E O OPCODE 8. `fetch()` sem argumentos pede a lista pelo
 * gateway, e essa cota e MUITO mais apertada que a da API REST: em producao ela
 * recusou com 9,9s de espera e, na tentativa seguinte, com 25,6s. Por isso ele
 * so acontece quando nao ha alternativa — na pratica, uma vez por processo.
 *
 * Quando ele e recusado, o proprio Discord informa quantos segundos faltam;
 * esperar e tentar de novo custa uma pausa e salva a operacao. Uma espera
 * absurda, porem, prenderia a interacao ate o token expirar — ai o operador
 * recebe o numero e decide.
 */
async function fetchAllMembers(guild) {
    if (isMemberCacheComplete(guild))
        return guild.members.cache;
    for (let attempt = 0;; attempt += 1) {
        try {
            return await guild.members.fetch();
        }
        catch (error) {
            if (!(error instanceof util_1.GatewayRateLimitError))
                throw error;
            const retryAfter = Math.ceil(error.data.retry_after);
            const desistir = attempt >= limits_1.AUTO_ROLE_BACKFILL.FETCH_RETRIES ||
                retryAfter > limits_1.AUTO_ROLE_BACKFILL.MAX_RETRY_WAIT_S;
            if (desistir) {
                throw new errors_1.RateLimitError(retryAfter, {
                    userMessage: 'O Discord limitou a listagem de membros deste servidor. ' +
                        `Tente novamente em ${retryAfter} segundo(s).`,
                    context: { guildId: guild.id },
                });
            }
            logger.warn('Listagem de membros limitada pelo gateway; aguardando.', {
                guildId: guild.id,
                retryAfter,
                attempt: attempt + 1,
            });
            // Margem sobre o valor informado: o relogio do gateway nao e o nosso.
            await (0, time_1.delay)(retryAfter * 1000 + limits_1.AUTO_ROLE_BACKFILL.RETRY_MARGIN_MS);
        }
    }
}
/** Membros humanos sem cargo nenhum, na ordem de entrada no servidor. */
async function findTargets(guild) {
    const members = await fetchAllMembers(guild);
    return [...members.values()]
        .filter((member) => !member.user.bot && hasNoRoles(member))
        .sort((a, b) => (a.joinedTimestamp ?? 0) - (b.joinedTimestamp ?? 0));
}
/** Conta o que a operacao faria, sem tocar em ninguem. */
async function previewAutoRoleBackfill(guild) {
    const { roleId, enabled } = await resolveConfiguredRole(guild);
    const members = await fetchAllMembers(guild);
    const humans = members.filter((member) => !member.user.bot);
    const targets = humans.filter(hasNoRoles);
    const role = guild.roles.cache.get(roleId);
    return {
        roleId,
        roleName: role?.name ?? 'cargo removido',
        enabled,
        humans: humans.size,
        targets: targets.size,
        blocker: findBlocker(guild, roleId),
        batch: Math.min(targets.size, limits_1.AUTO_ROLE_BACKFILL.MAX_PER_RUN),
    };
}
/**
 * Aplica o cargo a quem esta sem nenhum.
 *
 * O `onProgress` existe porque a resposta da interacao precisa dar sinal de
 * vida: um servidor grande leva minutos, e uma mensagem parada em "processando"
 * faz o operador rodar o comando de novo em paralelo.
 */
async function runAutoRoleBackfill(guild, onProgress) {
    const { roleId } = await resolveConfiguredRole(guild);
    const blocker = findBlocker(guild, roleId);
    if (blocker !== null) {
        throw new errors_1.ConfigurationError(`Backfill bloqueado na guild ${guild.id}: ${blocker}`, {
            userMessage: blocker,
            context: { guildId: guild.id, entityType: 'role', entityId: roleId },
        });
    }
    const targets = await findTargets(guild);
    const lote = targets.slice(0, limits_1.AUTO_ROLE_BACKFILL.MAX_PER_RUN);
    const deadline = Date.now() + limits_1.AUTO_ROLE_BACKFILL.BUDGET_MS;
    let applied = 0;
    let failed = 0;
    let firstError = null;
    let processed = 0;
    for (const member of lote) {
        if (Date.now() >= deadline)
            break;
        processed += 1;
        try {
            await member.roles.add(roleId, BACKFILL_AUDIT_REASON);
            applied += 1;
        }
        catch (error) {
            failed += 1;
            const detalhe = (0, discord_1.isUnknownResourceError)(error)
                ? 'O cargo ou o membro nao existe mais.'
                : (0, discord_1.isMissingAccessError)(error)
                    ? 'O bot perdeu a permissao para gerenciar este cargo.'
                    : error instanceof Error
                        ? error.message
                        : String(error);
            firstError ??= detalhe;
            /*
             * Perder a permissao no meio da varredura atinge todo mundo dali para
             * frente. Insistir so produziria centenas de falhas identicas e gastaria
             * o orcamento de rate limit a toa.
             */
            if ((0, discord_1.isMissingAccessError)(error))
                break;
        }
        if (onProgress !== undefined &&
            processed % limits_1.AUTO_ROLE_BACKFILL.PROGRESS_EVERY === 0 &&
            processed < lote.length) {
            await onProgress(applied, lote.length).catch(() => undefined);
        }
        // Espacamento entre escritas: a discord.js respeita o rate limit sozinha,
        // mas uma rajada de centenas de PUTs seguidos come a cota compartilhada
        // com o resto do bot — cobranca, ticket e catalogo ficariam na fila atras.
        await (0, time_1.delay)(limits_1.AUTO_ROLE_BACKFILL.SPACING_MS);
    }
    const remaining = targets.length - applied - failed;
    logger.info('Backfill de cargo automatico concluido.', {
        guildId: guild.id,
        entityType: 'role',
        entityId: roleId,
        applied,
        failed,
        remaining,
    });
    return { roleId, applied, failed, remaining: Math.max(0, remaining), firstError };
}
//# sourceMappingURL=AutoRoleBackfillService.js.map