"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGuildMemberAdd = registerGuildMemberAdd;
const discord_js_1 = require("discord.js");
const interactionErrorHandler_1 = require("../../core/errors/interactionErrorHandler");
const Logger_1 = require("../../core/logger/Logger");
const WelcomeService_1 = require("../../modules/welcome/services/WelcomeService");
/**
 * Evento de entrada de membro (boas-vindas + cargo automatico).
 *
 * Requer a intent GuildMembers habilitada no portal do Discord.
 * Nenhuma falha aqui pode virar unhandled rejection: o erro e registrado e o
 * processo segue normalmente.
 */
const logger = (0, Logger_1.createLogger)('welcome');
function registerGuildMemberAdd(client) {
    client.on(discord_js_1.Events.GuildMemberAdd, async (member) => {
        try {
            await (0, WelcomeService_1.handleMemberJoin)(member);
        }
        catch (error) {
            try {
                await (0, interactionErrorHandler_1.handleBackgroundError)('welcome.guildMemberAdd', error, {
                    guildId: member.guild.id,
                    userId: member.id,
                });
            }
            catch {
                // Persistir o erro tambem falhou (banco fora): nao ha mais o que fazer.
                logger.warn('Nao foi possivel registrar a falha de entrada de membro.', {
                    guildId: member.guild.id,
                    userId: member.id,
                });
            }
        }
    });
}
//# sourceMappingURL=guildMemberAdd.js.map