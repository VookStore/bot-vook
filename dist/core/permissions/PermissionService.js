"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_BOT_PERMISSIONS = void 0;
exports.isGuildAdministrator = isGuildAdministrator;
exports.canManageSystem = canManageSystem;
exports.assertCanManageSystem = assertCanManageSystem;
exports.canManageTickets = canManageTickets;
exports.isCategoryStaff = isCategoryStaff;
exports.canClaimTicket = canClaimTicket;
exports.assertCanClaimTicket = assertCanClaimTicket;
exports.canManageTicketMembers = canManageTicketMembers;
exports.assertCanManageTicketMembers = assertCanManageTicketMembers;
exports.canTransferTicket = canTransferTicket;
exports.canCloseTicket = canCloseTicket;
exports.assertCanCloseTicket = assertCanCloseTicket;
exports.canNotifyClient = canNotifyClient;
exports.canCreatePayments = canCreatePayments;
exports.assertCanCreatePayments = assertCanCreatePayments;
exports.canManagePayments = canManagePayments;
exports.assertCanManagePayments = assertCanManagePayments;
exports.canManageCoupons = canManageCoupons;
exports.assertCanManageCoupons = assertCanManageCoupons;
exports.canManagePaymentAccounts = canManagePaymentAccounts;
exports.assertCanManagePaymentAccounts = assertCanManagePaymentAccounts;
exports.canManageCatalog = canManageCatalog;
exports.assertCanManageCatalog = assertCanManageCatalog;
exports.canManageCatalogCategories = canManageCatalogCategories;
exports.assertCanManageCatalogCategories = assertCanManageCatalogCategories;
exports.canManageOrders = canManageOrders;
exports.assertCanManageOrders = assertCanManageOrders;
exports.canCreateOrderPayment = canCreateOrderPayment;
exports.assertCanCreateOrderPayment = assertCanCreateOrderPayment;
exports.canApplyOrderCoupon = canApplyOrderCoupon;
exports.assertCanApplyOrderCoupon = assertCanApplyOrderCoupon;
exports.canCancelOrder = canCancelOrder;
exports.assertCanCancelOrder = assertCanCancelOrder;
exports.canMarkOrderDelivered = canMarkOrderDelivered;
exports.assertCanMarkOrderDelivered = assertCanMarkOrderDelivered;
exports.canPublishWolfPortfolio = canPublishWolfPortfolio;
exports.assertCanPublishWolfPortfolio = assertCanPublishWolfPortfolio;
exports.checkBotPermissions = checkBotPermissions;
exports.canBotAssignRole = canBotAssignRole;
const discord_js_1 = require("discord.js");
const errors_1 = require("../errors");
const TicketConfigService_1 = require("../../modules/tickets/services/TicketConfigService");
/**
 * Autorizacao central.
 *
 * REGRA: nenhum customId, nenhum componente e nenhuma mensagem concede permissao.
 * Toda acao sensivel chama uma funcao daqui, que sempre confere cargos/permissoes
 * reais do membro no momento da acao.
 */
/** Administrador do servidor ou dono da guild. */
function isGuildAdministrator(member) {
    if (member.guild.ownerId === member.id)
        return true;
    return member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator);
}
/**
 * Pode configurar o sistema (canais, categorias, equipes, cupons, contas PIX).
 * Exige Administrator ou Manage Guild — nao basta ser da equipe de atendimento.
 */
function canManageSystem(member) {
    return isGuildAdministrator(member) || member.permissions.has(discord_js_1.PermissionFlagsBits.ManageGuild);
}
function assertCanManageSystem(member) {
    if (!canManageSystem(member)) {
        throw new errors_1.PermissionError('Sem permissao de administracao do sistema.', {
            userMessage: 'Apenas administradores do servidor podem usar esta configuracao.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
/** Membro possui algum cargo de equipe (qualquer categoria) na guild. */
async function canManageTickets(member) {
    if (canManageSystem(member))
        return true;
    const roleIds = await (0, TicketConfigService_1.getGuildTeamRoleIds)(member.guild.id);
    return roleIds.some((roleId) => member.roles.cache.has(roleId));
}
/** Membro pertence a equipe responsavel por esta categoria. */
async function isCategoryStaff(member, categoryId) {
    if (canManageSystem(member))
        return true;
    const roleIds = await (0, TicketConfigService_1.getTeamRoleIds)(categoryId);
    return roleIds.some((roleId) => member.roles.cache.has(roleId));
}
/** Pode assumir o ticket: equipe da categoria (ou administrador). */
async function canClaimTicket(member, ticket) {
    return isCategoryStaff(member, ticket.categoryId);
}
async function assertCanClaimTicket(member, ticket) {
    if (!(await canClaimTicket(member, ticket))) {
        throw new errors_1.PermissionError('Membro nao pertence a equipe da categoria.', {
            userMessage: 'Apenas a equipe responsavel por esta categoria pode assumir o atendimento.',
            context: { userId: member.id, entityType: 'ticket', entityId: ticket.id },
        });
    }
}
/**
 * Pode operar o painel administrativo do ticket (renomear, membros, transferir).
 * Equipe da categoria, responsavel atual ou administrador.
 */
async function canManageTicketMembers(member, ticket) {
    if (ticket.claimedById === member.id)
        return true;
    return isCategoryStaff(member, ticket.categoryId);
}
async function assertCanManageTicketMembers(member, ticket) {
    if (!(await canManageTicketMembers(member, ticket))) {
        throw new errors_1.PermissionError('Sem permissao para administrar o ticket.', {
            userMessage: 'Apenas a equipe responsavel por este atendimento pode fazer isso.',
            context: { userId: member.id, entityType: 'ticket', entityId: ticket.id },
        });
    }
}
/** Transferir exige ser o responsavel atual ou administrador da categoria. */
async function canTransferTicket(member, ticket) {
    return canManageTicketMembers(member, ticket);
}
/**
 * Pode encerrar o ticket: equipe da categoria, responsavel, administrador
 * ou o proprio cliente que abriu o atendimento.
 */
async function canCloseTicket(member, ticket) {
    if (ticket.ownerId === member.id)
        return true;
    return canManageTicketMembers(member, ticket);
}
async function assertCanCloseTicket(member, ticket) {
    if (!(await canCloseTicket(member, ticket))) {
        throw new errors_1.PermissionError('Sem permissao para encerrar o ticket.', {
            userMessage: 'Voce nao pode encerrar este atendimento.',
            context: { userId: member.id, entityType: 'ticket', entityId: ticket.id },
        });
    }
}
/** Notificar o cliente e uma acao de equipe. */
async function canNotifyClient(member, ticket) {
    return canManageTicketMembers(member, ticket);
}
// ---------------------------------------------------------------------------
// Comercial (pagamentos e cupons)
// ---------------------------------------------------------------------------
/** Vendedor: qualquer membro da equipe de atendimento pode gerar cobranca. */
async function canCreatePayments(member) {
    return canManageTickets(member);
}
async function assertCanCreatePayments(member) {
    if (!(await canCreatePayments(member))) {
        throw new errors_1.PermissionError('Sem permissao para criar cobrancas.', {
            userMessage: 'Apenas a equipe da loja pode gerar cobrancas PIX.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
/** Aprovar/cancelar/alterar cobranca tambem e acao de equipe. */
async function canManagePayments(member) {
    return canManageTickets(member);
}
async function assertCanManagePayments(member) {
    if (!(await canManagePayments(member))) {
        throw new errors_1.PermissionError('Sem permissao para gerenciar cobrancas.', {
            userMessage: 'Apenas a equipe da loja pode gerenciar cobrancas.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
/** Cadastro de cupons e restrito a administracao. */
function canManageCoupons(member) {
    return canManageSystem(member);
}
function assertCanManageCoupons(member) {
    if (!canManageCoupons(member)) {
        throw new errors_1.PermissionError('Sem permissao para gerenciar cupons.', {
            userMessage: 'Apenas administradores podem gerenciar cupons.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
/** Cadastro de contas PIX e restrito a administracao (dado sensivel). */
function canManagePaymentAccounts(member) {
    return canManageSystem(member);
}
function assertCanManagePaymentAccounts(member) {
    if (!canManagePaymentAccounts(member)) {
        throw new errors_1.PermissionError('Sem permissao para gerenciar contas PIX.', {
            userMessage: 'Apenas administradores podem gerenciar contas PIX.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
// ---------------------------------------------------------------------------
// Catalogo e pedidos
// ---------------------------------------------------------------------------
/**
 * Cadastro de produtos e imagens: administracao do servidor.
 *
 * Preco de produto e conteudo publico da loja: quem edita isso decide o que a
 * Vook Store cobra, entao a regra e a mesma dos cupons e das contas PIX.
 */
function canManageCatalog(member) {
    return canManageSystem(member);
}
function assertCanManageCatalog(member) {
    if (!canManageCatalog(member)) {
        throw new errors_1.PermissionError('Sem permissao para gerenciar o catalogo.', {
            userMessage: 'Apenas administradores podem gerenciar o catalogo da loja.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
/** Categorias do catalogo seguem a mesma regra dos produtos. */
function canManageCatalogCategories(member) {
    return canManageCatalog(member);
}
function assertCanManageCatalogCategories(member) {
    if (!canManageCatalogCategories(member)) {
        throw new errors_1.PermissionError('Sem permissao para gerenciar categorias do catalogo.', {
            userMessage: 'Apenas administradores podem gerenciar as categorias do catalogo.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
/** Atender pedidos e trabalho de vendedor: equipe de atendimento. */
async function canManageOrders(member) {
    return canManageTickets(member);
}
async function assertCanManageOrders(member) {
    if (!(await canManageOrders(member))) {
        throw new errors_1.PermissionError('Sem permissao para gerenciar pedidos.', {
            userMessage: 'Apenas a equipe da loja pode gerenciar pedidos.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
/** Gerar a cobranca do pedido usa exatamente a permissao de `/pagamento`. */
async function canCreateOrderPayment(member) {
    return canCreatePayments(member);
}
async function assertCanCreateOrderPayment(member) {
    await assertCanCreatePayments(member);
}
/**
 * Aplicar cupom ao pedido e acao de VENDEDOR — nunca do cliente.
 * Mesma permissao usada para aplicar cupom em uma cobranca PIX.
 */
async function canApplyOrderCoupon(member) {
    return canManagePayments(member);
}
async function assertCanApplyOrderCoupon(member) {
    if (!(await canApplyOrderCoupon(member))) {
        throw new errors_1.PermissionError('Sem permissao para aplicar cupom em pedido.', {
            userMessage: 'Apenas a equipe da loja aplica cupons. O cliente nunca escolhe cupom.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
async function canCancelOrder(member) {
    return canManageOrders(member);
}
async function assertCanCancelOrder(member) {
    if (!(await canCancelOrder(member))) {
        throw new errors_1.PermissionError('Sem permissao para cancelar pedidos.', {
            userMessage: 'Apenas a equipe da loja pode cancelar pedidos.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
async function canMarkOrderDelivered(member) {
    return canManageOrders(member);
}
async function assertCanMarkOrderDelivered(member) {
    if (!(await canMarkOrderDelivered(member))) {
        throw new errors_1.PermissionError('Sem permissao para concluir a entrega.', {
            userMessage: 'Apenas a equipe da loja pode marcar um pedido como entregue.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
// ---------------------------------------------------------------------------
// Portfolio de lobos
// ---------------------------------------------------------------------------
/**
 * Publicar um lobo no portfolio: equipe da loja.
 *
 * Nao exige administracao, ao contrario de `/anunciar` e da tabela de precos:
 * aqueles declaram preco e beneficio, que sao compromisso comercial. O post do
 * portfolio mostra um trabalho entregue — quem produz o lobo e quem sabe o que
 * entregou. Configurar ONDE ele sai (`/lobos`) continua sendo de administrador.
 */
async function canPublishWolfPortfolio(member) {
    return canManageTickets(member);
}
async function assertCanPublishWolfPortfolio(member) {
    if (!(await canPublishWolfPortfolio(member))) {
        throw new errors_1.PermissionError('Sem permissao para publicar no portfolio.', {
            userMessage: 'Apenas a equipe da loja pode publicar lobos no portfólio.',
            context: { userId: member.id, guildId: member.guild.id },
        });
    }
}
// ---------------------------------------------------------------------------
// Permissoes do BOT (nao do usuario)
// ---------------------------------------------------------------------------
/** Permissoes minimas que o bot precisa ter para operar tickets. */
exports.REQUIRED_BOT_PERMISSIONS = [
    discord_js_1.PermissionFlagsBits.ViewChannel,
    discord_js_1.PermissionFlagsBits.SendMessages,
    discord_js_1.PermissionFlagsBits.ManageChannels,
    discord_js_1.PermissionFlagsBits.ManageRoles,
    discord_js_1.PermissionFlagsBits.ReadMessageHistory,
    discord_js_1.PermissionFlagsBits.AttachFiles,
    discord_js_1.PermissionFlagsBits.EmbedLinks,
];
const PERMISSION_LABELS = new Map([
    [discord_js_1.PermissionFlagsBits.ViewChannel, 'Ver canais'],
    [discord_js_1.PermissionFlagsBits.SendMessages, 'Enviar mensagens'],
    [discord_js_1.PermissionFlagsBits.ManageChannels, 'Gerenciar canais'],
    [discord_js_1.PermissionFlagsBits.ManageRoles, 'Gerenciar cargos'],
    [discord_js_1.PermissionFlagsBits.ReadMessageHistory, 'Ver historico de mensagens'],
    [discord_js_1.PermissionFlagsBits.AttachFiles, 'Anexar arquivos'],
    [discord_js_1.PermissionFlagsBits.EmbedLinks, 'Inserir links'],
]);
function checkBotPermissions(botMember) {
    const missing = [];
    for (const flag of exports.REQUIRED_BOT_PERMISSIONS) {
        if (!botMember.permissions.has(flag)) {
            missing.push(PERMISSION_LABELS.get(flag) ?? String(flag));
        }
    }
    return { ok: missing.length === 0, missing };
}
/** O bot consegue atribuir este cargo? (hierarquia + cargo gerenciado) */
function canBotAssignRole(botMember, roleId) {
    const role = botMember.guild.roles.cache.get(roleId);
    if (role === undefined)
        return { ok: false, reason: 'Cargo nao encontrado no servidor.' };
    if (role.managed) {
        return { ok: false, reason: 'Cargo gerenciado por integracao nao pode ser atribuido.' };
    }
    if (role.id === botMember.guild.roles.everyone.id) {
        return { ok: false, reason: 'O cargo @everyone nao pode ser atribuido.' };
    }
    if (!botMember.permissions.has(discord_js_1.PermissionFlagsBits.ManageRoles)) {
        return { ok: false, reason: 'O bot nao possui a permissao Gerenciar Cargos.' };
    }
    if (botMember.roles.highest.comparePositionTo(role) <= 0) {
        return {
            ok: false,
            reason: 'O cargo esta acima do cargo do bot na hierarquia do servidor.',
        };
    }
    return { ok: true };
}
//# sourceMappingURL=PermissionService.js.map