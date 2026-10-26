import { Events, type Client, type GuildMember } from 'discord.js';

import { handleBackgroundError } from '../../core/errors/interactionErrorHandler';
import { createLogger } from '../../core/logger/Logger';
import { handleMemberJoin } from '../../modules/welcome/services/WelcomeService';

/**
 * Evento de entrada de membro (boas-vindas + cargo automatico).
 *
 * Requer a intent GuildMembers habilitada no portal do Discord.
 * Nenhuma falha aqui pode virar unhandled rejection: o erro e registrado e o
 * processo segue normalmente.
 */

const logger = createLogger('welcome');

export function registerGuildMemberAdd(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member: GuildMember): Promise<void> => {
    try {
      await handleMemberJoin(member);
    } catch (error) {
      try {
        await handleBackgroundError('welcome.guildMemberAdd', error, {
          guildId: member.guild.id,
          userId: member.id,
        });
      } catch {
        // Persistir o erro tambem falhou (banco fora): nao ha mais o que fazer.
        logger.warn('Nao foi possivel registrar a falha de entrada de membro.', {
          guildId: member.guild.id,
          userId: member.id,
        });
      }
    }
  });
}
