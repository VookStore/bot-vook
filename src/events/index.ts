import { Events, type Client } from 'discord.js';
import { TicketAuditAction } from '@prisma/client';

import { handleBackgroundError } from '../core/errors/interactionErrorHandler';
import { createLogger } from '../core/logger/Logger';
import { routeInteraction } from '../interactions/InteractionRouter';
import { recordTicketAudit } from '../modules/audit/repositories/AuditRepository';
import { registerGuildMemberAdd } from './guild/guildMemberAdd';
import {
  handleBoostLost,
  handleBoostMessage,
  isBoostMessage,
} from '../modules/booster/services/BoosterTierService';
import {
  findTicketByChannelId,
  markOrphaned,
} from '../modules/tickets/repositories/TicketRepository';
import { ensureGuildConfig } from '../modules/configuration/repositories/GuildConfigRepository';
import { invalidateGuildConfig } from '../modules/configuration/services/GuildConfigService';
import { cache } from '../core/cache/CacheService';

/** Registro de todos os listeners de evento do cliente. */

const logger = createLogger('events');

function registerInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction).catch((error: unknown) => {
      void handleBackgroundError('interactionCreate', error, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
      });
    });
  });
}

/**
 * Canal de ticket apagado manualmente: o ticket vira ORPHANED e sai da fila.
 * Sem isso, a fila continuaria contando um atendimento que nao existe mais.
 */
function registerChannelDelete(client: Client): void {
  client.on(Events.ChannelDelete, (channel) => {
    void (async () => {
      if (channel.isDMBased()) return;

      const ticket = await findTicketByChannelId(channel.id);
      if (ticket === null) return;

      const orphaned = await markOrphaned(ticket.id);
      if (!orphaned) return;

      await recordTicketAudit({
        guildId: ticket.guildId,
        ticketId: ticket.id,
        action: TicketAuditAction.ORPHANED,
        oldValue: ticket.status,
        newValue: 'ORPHANED',
        metadata: { channelId: channel.id },
      });

      logger.warn('Canal de ticket removido; ticket marcado como orfao.', {
        guildId: ticket.guildId,
        channelId: channel.id,
        entityType: 'ticket',
        entityId: ticket.id,
        ticketNumber: ticket.ticketNumber,
      });
    })().catch((error: unknown) => {
      void handleBackgroundError('channelDelete', error, { channelId: channel.id });
    });
  });
}

/** Guild nova: garante a linha de configuracao para o admin ja poder configurar. */
function registerGuildCreate(client: Client): void {
  client.on(Events.GuildCreate, (guild) => {
    void (async () => {
      await ensureGuildConfig(guild.id);
      invalidateGuildConfig(guild.id);
      logger.info('Bot adicionado a uma nova guild.', {
        guildId: guild.id,
        guildName: guild.name,
      });
    })().catch((error: unknown) => {
      void handleBackgroundError('guildCreate', error, { guildId: guild.id });
    });
  });
}

/** Guild removida: limpa o cache para nao guardar dados de um servidor perdido. */
function registerGuildDelete(client: Client): void {
  client.on(Events.GuildDelete, (guild) => {
    cache.invalidateGuild(guild.id);
    logger.info('Bot removido de uma guild.', { guildId: guild.id });
  });
}

/** Erros do proprio cliente nunca podem derrubar o processo. */
function registerClientErrors(client: Client): void {
  client.on(Events.Error, (error) => {
    void handleBackgroundError('discordClient', error);
  });
  client.on(Events.Warn, (message) => {
    logger.warn('Aviso do cliente Discord.', { detail: message });
  });
  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn('Shard desconectado.', { shardId, code: event.code });
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    logger.info('Shard reconectando.', { shardId });
  });
  client.on(Events.ShardResume, (shardId, replayed) => {
    logger.info('Shard reconectado.', { shardId, replayed });
  });
}

/**
 * Boost do servidor: cargo do degrau 2.
 *
 * Escuta a MENSAGEM DE SISTEMA do boost porque e a unica fonte que informa
 * QUANTOS boosts a pessoa tem — a API nao expoe essa contagem em lugar nenhum.
 * O `guildMemberUpdate` complementa retirando o cargo de quem parou de
 * impulsionar de vez.
 */
function registerBoostRoles(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (!isBoostMessage(message)) return;
    void handleBoostMessage(message).catch((error: unknown) => {
      void handleBackgroundError('boostMessage', error, {
        guildId: message.guildId,
        userId: message.author.id,
      });
    });
  });

  client.on(Events.GuildMemberUpdate, (before, after) => {
    void (async () => {
      // `before` pode ser parcial quando o membro nao estava em cache; sem o
      // estado anterior nao da para saber que ele DEIXOU de impulsionar.
      if (before.partial) return;
      await handleBoostLost(before, after);
    })().catch((error: unknown) => {
      void handleBackgroundError('guildMemberUpdate', error, {
        guildId: after.guild.id,
        userId: after.id,
      });
    });
  });
}

export function registerEvents(client: Client): void {
  registerInteractionCreate(client);
  registerChannelDelete(client);
  registerGuildCreate(client);
  registerGuildDelete(client);
  registerGuildMemberAdd(client);
  registerBoostRoles(client);
  registerClientErrors(client);
  logger.info('Listeners de evento registrados.');
}
