import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';

/**
 * Cliente do Discord.
 *
 * INTENTS PRIVILEGIADAS NECESSARIAS (habilitar no Developer Portal):
 *  - Server Members Intent  -> evento guildMemberAdd (boas-vindas e auto-role)
 *  - Message Content Intent -> conteudo das mensagens no transcript do ticket
 *
 * Sem MessageContent o transcript sairia sem o texto das mensagens; sem
 * GuildMembers as boas-vindas nunca disparam.
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
    allowedMentions: { parse: [], users: [], roles: [] },
    // O bot roda 24/7: limitar caches evita crescimento de memoria sem fim.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 50,
      ReactionManager: 0,
      GuildStickerManager: 0,
      GuildScheduledEventManager: 0,
      AutoModerationRuleManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 600, lifetime: 900 },
    },
  });
}
