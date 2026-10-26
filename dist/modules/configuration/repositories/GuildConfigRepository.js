"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findGuildConfig = findGuildConfig;
exports.ensureGuildConfig = ensureGuildConfig;
exports.updateGuildConfig = updateGuildConfig;
exports.listGuildConfigs = listGuildConfigs;
exports.listGuildConfigsWithPanel = listGuildConfigsWithPanel;
const prisma_1 = require("../../../core/database/prisma");
async function findGuildConfig(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.guildConfig.findUnique({ where: { guildId } });
}
/**
 * Retorna a configuracao da guild, criando-a com os padroes na primeira vez.
 * Idempotente e seguro sob concorrencia (upsert).
 */
async function ensureGuildConfig(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.guildConfig.upsert({
        where: { guildId },
        update: {},
        create: { guildId },
    });
}
async function updateGuildConfig(guildId, data, db = (0, prisma_1.getPrisma)()) {
    await ensureGuildConfig(guildId, db);
    return db.guildConfig.update({ where: { guildId }, data });
}
async function listGuildConfigs(db = (0, prisma_1.getPrisma)()) {
    return db.guildConfig.findMany({ orderBy: { createdAt: 'asc' } });
}
/** Guilds que possuem painel publico publicado (usado no recovery). */
async function listGuildConfigsWithPanel(db = (0, prisma_1.getPrisma)()) {
    return db.guildConfig.findMany({
        where: { ticketPanelChannelId: { not: null }, ticketPanelMessageId: { not: null } },
    });
}
//# sourceMappingURL=GuildConfigRepository.js.map