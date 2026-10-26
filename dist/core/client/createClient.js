"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDiscordClient = createDiscordClient;
const discord_js_1 = require("discord.js");
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
function createDiscordClient() {
    return new discord_js_1.Client({
        intents: [
            discord_js_1.GatewayIntentBits.Guilds,
            discord_js_1.GatewayIntentBits.GuildMembers,
            discord_js_1.GatewayIntentBits.GuildMessages,
            discord_js_1.GatewayIntentBits.MessageContent,
        ],
        partials: [discord_js_1.Partials.Channel],
        allowedMentions: { parse: [], users: [], roles: [] },
        // O bot roda 24/7: limitar caches evita crescimento de memoria sem fim.
        makeCache: discord_js_1.Options.cacheWithLimits({
            ...discord_js_1.Options.DefaultMakeCacheSettings,
            MessageManager: 50,
            ReactionManager: 0,
            GuildStickerManager: 0,
            GuildScheduledEventManager: 0,
            AutoModerationRuleManager: 0,
        }),
        sweepers: {
            ...discord_js_1.Options.DefaultSweeperSettings,
            messages: { interval: 600, lifetime: 900 },
        },
    });
}
//# sourceMappingURL=createClient.js.map