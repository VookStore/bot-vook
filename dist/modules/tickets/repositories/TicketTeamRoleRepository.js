"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTeamRoles = listTeamRoles;
exports.listTeamRoleIds = listTeamRoleIds;
exports.listTeamRolesForGuild = listTeamRolesForGuild;
exports.replaceTeamRoles = replaceTeamRoles;
exports.clearTeamRoles = clearTeamRoles;
const prisma_1 = require("../../../core/database/prisma");
/**
 * Cargos responsaveis por cada categoria.
 * Uma categoria pode ter varios cargos (ex.: Compras -> @Vendas + @Administracao).
 */
async function listTeamRoles(categoryId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketTeamRole.findMany({
        where: { categoryId },
        orderBy: { createdAt: 'asc' },
    });
}
async function listTeamRoleIds(categoryId, db = (0, prisma_1.getPrisma)()) {
    const roles = await db.ticketTeamRole.findMany({
        where: { categoryId },
        select: { roleId: true },
        orderBy: { createdAt: 'asc' },
    });
    return roles.map((role) => role.roleId);
}
async function listTeamRolesForGuild(guildId, db = (0, prisma_1.getPrisma)()) {
    return db.ticketTeamRole.findMany({ where: { guildId } });
}
/**
 * Substitui integralmente os cargos da categoria.
 * Executa em transacao para nunca deixar a categoria momentaneamente sem equipe.
 */
async function replaceTeamRoles(params, db = (0, prisma_1.getPrisma)()) {
    const unique = [...new Set(params.roleIds)];
    await db.ticketTeamRole.deleteMany({
        where: { categoryId: params.categoryId, roleId: { notIn: unique.length > 0 ? unique : [''] } },
    });
    for (const roleId of unique) {
        await db.ticketTeamRole.upsert({
            where: { categoryId_roleId: { categoryId: params.categoryId, roleId } },
            create: {
                guildId: params.guildId,
                categoryId: params.categoryId,
                roleId,
                createdById: params.actorId,
            },
            update: {},
        });
    }
    return listTeamRoles(params.categoryId, db);
}
async function clearTeamRoles(categoryId, db = (0, prisma_1.getPrisma)()) {
    const result = await db.ticketTeamRole.deleteMany({ where: { categoryId } });
    return result.count;
}
//# sourceMappingURL=TicketTeamRoleRepository.js.map