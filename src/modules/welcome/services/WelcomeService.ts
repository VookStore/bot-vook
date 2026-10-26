import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { GuildConfig } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { createLogger } from '../../../core/logger/Logger';
import { canBotAssignRole } from '../../../core/permissions/PermissionService';
import {
  isMissingAccessError,
  isUnknownResourceError,
  fetchChannelSafe,
  isSendableTextChannel,
  mentionOnly,
  NO_MENTIONS,
} from '../../../utils/discord';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { buildWelcomeCard } from '../builders/WelcomeBuilder';

/**
 * Boas-vindas e auto-role.
 *
 * REGRA CENTRAL: nada aqui pode derrubar a entrada de um membro. Cada efeito
 * (cargo automatico e cartao de boas-vindas) e independente; a falha de um
 * nunca impede o outro e nenhuma funcao publica lanca por problema de
 * configuracao, permissao ou canal removido.
 */

const logger = createLogger('welcome');

/** Motivo registrado no audit log do Discord ao aplicar o cargo. */
const AUTO_ROLE_AUDIT_REASON = 'Cargo automatico de boas-vindas (Vook Store Bot)';

export interface AutoRoleResult {
  applied: boolean;
  reason?: string;
}

export interface SendWelcomeOptions {
  /**
   * Pre-visualizacao administrativa: nunca aplica cargo, marca o cartao e nao
   * dispara notificacao (a mencao aparece, mas sem ping).
   * Quem chama precisa ter validado a permissao do usuario antes (o servico
   * nao conhece a interacao de origem).
   */
  preview?: boolean;
  /** Canal alternativo (ex.: onde o administrador executou o comando). */
  targetChannelId?: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Entrada de membro
// ---------------------------------------------------------------------------

/**
 * Trata a entrada de um membro: cargo automatico + cartao de boas-vindas.
 * A configuracao e lida uma unica vez (cache) e reaproveitada nos dois fluxos.
 */
export async function handleMemberJoin(member: GuildMember): Promise<void> {
  if (member.user.bot) {
    logger.debug('Entrada de bot ignorada.', { guildId: member.guild.id, userId: member.id });
    return;
  }

  let config: GuildConfig;
  try {
    config = await getGuildConfig(member.guild.id);
  } catch (error) {
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
    } else if (result.reason !== undefined) {
      logger.debug('Cargo automatico nao aplicado.', {
        guildId: member.guild.id,
        userId: member.id,
        detail: result.reason,
      });
    }
  } catch (error) {
    logger.warn('Falha inesperada no cargo automatico.', {
      guildId: member.guild.id,
      userId: member.id,
      detail: describeError(error),
    });
  }

  // 2) Cartao de boas-vindas — independente do resultado acima.
  try {
    await sendWelcomeCardWithConfig(member, config, {});
  } catch (error) {
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
export async function sendWelcomeCard(
  member: GuildMember,
  options: SendWelcomeOptions = {},
): Promise<boolean> {
  let config: GuildConfig;
  try {
    config = await getGuildConfig(member.guild.id);
  } catch (error) {
    logger.warn('Nao foi possivel carregar a configuracao de boas-vindas.', {
      guildId: member.guild.id,
      userId: member.id,
      detail: describeError(error),
    });
    return false;
  }
  return sendWelcomeCardWithConfig(member, config, options);
}

async function sendWelcomeCardWithConfig(
  member: GuildMember,
  config: GuildConfig,
  options: SendWelcomeOptions,
): Promise<boolean> {
  const preview = options.preview === true;

  if (!preview) {
    if (member.user.bot) return false;
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
    const channel = await fetchChannelSafe(member.guild, channelId);
    if (!isSendableTextChannel(channel)) {
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
    if (
      permissions === null ||
      !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    ) {
      logger.warn('Sem permissao para publicar no canal de boas-vindas.', {
        guildId: member.guild.id,
        channelId,
        userId: member.id,
      });
      return false;
    }

    const card = buildWelcomeCard({
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
    await sendV2(channel, card, {
      allowedMentions: preview ? NO_MENTIONS : mentionOnly(member.id),
    });

    logger.info(preview ? 'Pre-visualizacao de boas-vindas enviada.' : 'Boas-vindas enviadas.', {
      guildId: member.guild.id,
      channelId,
      userId: member.id,
    });
    return true;
  } catch (error) {
    if (isUnknownResourceError(error) || isMissingAccessError(error)) {
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
export async function applyAutoRole(member: GuildMember): Promise<AutoRoleResult> {
  let config: GuildConfig;
  try {
    config = await getGuildConfig(member.guild.id);
  } catch (error) {
    logger.warn('Nao foi possivel carregar a configuracao do cargo automatico.', {
      guildId: member.guild.id,
      userId: member.id,
      detail: describeError(error),
    });
    return { applied: false, reason: 'Nao foi possivel carregar a configuracao do servidor.' };
  }
  return applyAutoRoleWithConfig(member, config);
}

async function applyAutoRoleWithConfig(
  member: GuildMember,
  config: GuildConfig,
): Promise<AutoRoleResult> {
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
  const check = canBotAssignRole(botMember, roleId);
  if (!check.ok) {
    return { applied: false, reason: check.reason ?? 'O bot nao pode atribuir este cargo.' };
  }

  try {
    await member.roles.add(roleId, AUTO_ROLE_AUDIT_REASON);
    return { applied: true };
  } catch (error) {
    if (isUnknownResourceError(error)) {
      return { applied: false, reason: 'O cargo ou o membro nao existe mais.' };
    }
    if (isMissingAccessError(error)) {
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
