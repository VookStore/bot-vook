"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMemberJoin = handleMemberJoin;
exports.sendWelcomeCard = sendWelcomeCard;
exports.applyAutoRole = applyAutoRole;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../../components/reply");
const Logger_1 = require("../../../core/logger/Logger");
const PermissionService_1 = require("../../../core/permissions/PermissionService");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const WelcomeBuilder_1 = require("../builders/WelcomeBuilder");
/**
 * Boas-vindas e auto-role.
 *
 * REGRA CENTRAL: nada aqui pode derrubar a entrada de um membro. Cada efeito
 * (cargo automatico e cartao de boas-vindas) e independente; a falha de um
 * nunca impede o outro e nenhuma funcao publica lanca por problema de
 * configuracao, permissao ou canal removido.
 */
const logger = (0, Logger_1.createLogger)('welcome');
/** Motivo registrado no audit log do Discord ao aplicar o cargo. */
const AUTO_ROLE_AUDIT_REASON = 'Cargo automatico de boas-vindas (Vook Store Bot)';
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
// ---------------------------------------------------------------------------
// Entrada de membro
// ---------------------------------------------------------------------------
/**
 * Trata a entrada de um membro: cargo automatico + cartao de boas-vindas.
 * A configuracao e lida uma unica vez (cache) e reaproveitada nos dois fluxos.
 */
async function handleMemberJoin(member) {
    if (member.user.bot) {
        logger.debug('Entrada de bot ignorada.', { guildId: member.guild.id, userId: member.id });
        return;
    }
    let config;
    try {
        config = await (0, GuildConfigService_1.getGuildConfig)(member.guild.id);
    }
    catch (error) {
        // Banco indisponivel: registra e desiste. A entrada do membro nunca pode
        // virar excecao — nem para quem chama esta funcao fora do evento.
        logger.warn('Nao foi possivel carregar a configuracao da guild na entrada do membro.', {
            guildId: member.guild.id,
            userId: member.id,
            detail: describeError(error),
        });
        return;
    }
    // 1) Cargo automatico — falhar aqui nao pode impedir as boas-vindas.
    try {
        const result = await applyAutoRoleWithConfig(member, config);
        if (result.applied) {
            logger.info('Cargo automatico aplicado.', {
                guildId: member.guild.id,
                userId: member.id,
                entityType: 'role',
                entityId: config.autoRoleId,
            });
        }
        else if (result.reason !== undefined) {
            logger.debug('Cargo automatico nao aplicado.', {
                guildId: member.guild.id,
                userId: member.id,
                detail: result.reason,
            });
        }
    }
    catch (error) {
        logger.warn('Falha inesperada no cargo automatico.', {
            guildId: member.guild.id,
            userId: member.id,
            detail: describeError(error),
        });
    }
    // 2) Cartao de boas-vindas — independente do resultado acima.
    try {
        await sendWelcomeCardWithConfig(member, config, {});
    }
    catch (error) {
        logger.warn('Falha inesperada ao enviar as boas-vindas.', {
            guildId: member.guild.id,
            userId: member.id,
            detail: describeError(error),
        });
    }
}
// ---------------------------------------------------------------------------
// Cartao de boas-vindas
// ---------------------------------------------------------------------------
/**
 * Envia o cartao de boas-vindas. Retorna `true` somente quando a mensagem foi
 * publicada. Nunca lanca: canal removido, sem permissao ou modulo desativado
 * viram `false` + log de aviso.
 */
async function sendWelcomeCard(member, options = {}) {
    let config;
    try {
        config = await (0, GuildConfigService_1.getGuildConfig)(member.guild.id);
    }
    catch (error) {
        logger.warn('Nao foi possivel carregar a configuracao de boas-vindas.', {
            guildId: member.guild.id,
            userId: member.id,
            detail: describeError(error),
        });
        return false;
    }
    return sendWelcomeCardWithConfig(member, config, options);
}
async function sendWelcomeCardWithConfig(member, config, options) {
    const preview = options.preview === true;
    if (!preview) {
        if (member.user.bot)
            return false;
        if (!config.welcomeEnabled) {
            logger.debug('Boas-vindas desativadas nesta guild.', { guildId: member.guild.id });
            return false;
        }
    }
    const channelId = options.targetChannelId ?? config.welcomeChannelId;
    if (channelId === null || channelId.length === 0) {
        logger.warn('Canal de boas-vindas nao configurado.', {
            guildId: member.guild.id,
            userId: member.id,
        });
        return false;
    }
    try {
        const channel = await (0, discord_1.fetchChannelSafe)(member.guild, channelId);
        if (!(0, discord_1.isSendableTextChannel)(channel)) {
            logger.warn('Canal de boas-vindas indisponivel (removido, sem acesso ou nao textual).', {
                guildId: member.guild.id,
                channelId,
                userId: member.id,
            });
            return false;
        }
        // Mesma checagem do modulo de avaliacoes: sem ViewChannel + SendMessages a
        // publicacao falharia na API a cada entrada de membro.
        const botMember = member.guild.members.me;
        const permissions = botMember === null ? null : channel.permissionsFor(botMember);
        if (permissions === null ||
            !permissions.has([discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages])) {
            logger.warn('Sem permissao para publicar no canal de boas-vindas.', {
                guildId: member.guild.id,
                channelId,
                userId: member.id,
            });
            return false;
        }
        const card = (0, WelcomeBuilder_1.buildWelcomeCard)({
            storeName: config.storeName,
            userId: member.id,
            memberCount: member.guild.memberCount,
            accountCreatedAt: member.user.createdAt,
            joinedAt: member.joinedAt ?? new Date(),
            bannerUrl: config.welcomeBannerUrl,
            guildIconUrl: member.guild.iconURL({ size: 256 }),
            isPreview: preview,
        });
        // Na pre-visualizacao o cartao afirma que ninguem foi notificado: a mencao
        // continua visivel, mas sem ping. Somente a entrada real notifica o membro.
        await (0, reply_1.sendV2)(channel, card, {
            allowedMentions: preview ? discord_1.NO_MENTIONS : (0, discord_1.mentionOnly)(member.id),
        });
        logger.info(preview ? 'Pre-visualizacao de boas-vindas enviada.' : 'Boas-vindas enviadas.', {
            guildId: member.guild.id,
            channelId,
            userId: member.id,
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error) || (0, discord_1.isMissingAccessError)(error)) {
            logger.warn('Canal de boas-vindas inacessivel no momento do envio.', {
                guildId: member.guild.id,
                channelId,
                userId: member.id,
                detail: describeError(error),
            });
            return false;
        }
        logger.warn('Falha ao publicar o cartao de boas-vindas.', {
            guildId: member.guild.id,
            channelId,
            userId: member.id,
            detail: describeError(error),
        });
        return false;
    }
}
// ---------------------------------------------------------------------------
// Auto-role
// ---------------------------------------------------------------------------
/**
 * Aplica o cargo automatico configurado. Nunca lanca: qualquer impedimento
 * volta como `{ applied: false, reason }` legivel para log e diagnostico.
 */
async function applyAutoRole(member) {
    let config;
    try {
        config = await (0, GuildConfigService_1.getGuildConfig)(member.guild.id);
    }
    catch (error) {
        logger.warn('Nao foi possivel carregar a configuracao do cargo automatico.', {
            guildId: member.guild.id,
            userId: member.id,
            detail: describeError(error),
        });
        return { applied: false, reason: 'Nao foi possivel carregar a configuracao do servidor.' };
    }
    return applyAutoRoleWithConfig(member, config);
}
async function applyAutoRoleWithConfig(member, config) {
    if (member.user.bot) {
        return { applied: false, reason: 'Bots nao recebem o cargo automatico.' };
    }
    if (!config.autoRoleEnabled) {
        return { applied: false, reason: 'O cargo automatico esta desativado nesta guild.' };
    }
    const roleId = config.autoRoleId;
    if (roleId === null || roleId.length === 0) {
        return { applied: false, reason: 'Nenhum cargo automatico configurado.' };
    }
    if (member.roles.cache.has(roleId)) {
        return { applied: false, reason: 'O membro ja possui o cargo automatico.' };
    }
    const botMember = member.guild.members.me;
    if (botMember === null) {
        return { applied: false, reason: 'O bot nao esta disponivel nesta guild.' };
    }
    // canBotAssignRole confere: cargo existe, nao e gerenciado, nao e @everyone,
    // o bot tem Gerenciar Cargos e a hierarquia permite a atribuicao.
    const check = (0, PermissionService_1.canBotAssignRole)(botMember, roleId);
    if (!check.ok) {
        return { applied: false, reason: check.reason ?? 'O bot nao pode atribuir este cargo.' };
    }
    try {
        await member.roles.add(roleId, AUTO_ROLE_AUDIT_REASON);
        return { applied: true };
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error)) {
            return { applied: false, reason: 'O cargo ou o membro nao existe mais.' };
        }
        if ((0, discord_1.isMissingAccessError)(error)) {
            return { applied: false, reason: 'O bot perdeu a permissao para gerenciar este cargo.' };
        }
        logger.warn('Falha ao aplicar o cargo automatico.', {
            guildId: member.guild.id,
            userId: member.id,
            entityType: 'role',
            entityId: roleId,
            detail: describeError(error),
        });
        return { applied: false, reason: 'Falha inesperada ao aplicar o cargo automatico.' };
    }
}
//# sourceMappingURL=WelcomeService.js.map