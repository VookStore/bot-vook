import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { Ticket } from '@prisma/client';

import { PermissionError } from '../errors';
import {
  getGuildTeamRoleIds,
  getTeamRoleIds,
} from '../../modules/tickets/services/TicketConfigService';

/**
 * Autorizacao central.
 *
 * REGRA: nenhum customId, nenhum componente e nenhuma mensagem concede permissao.
 * Toda acao sensivel chama uma funcao daqui, que sempre confere cargos/permissoes
 * reais do membro no momento da acao.
 */

/** Administrador do servidor ou dono da guild. */
export function isGuildAdministrator(member: GuildMember): boolean {
  if (member.guild.ownerId === member.id) return true;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Pode configurar o sistema (canais, categorias, equipes, cupons, contas PIX).
 * Exige Administrator ou Manage Guild — nao basta ser da equipe de atendimento.
 */
export function canManageSystem(member: GuildMember): boolean {
  return isGuildAdministrator(member) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

export function assertCanManageSystem(member: GuildMember): void {
  if (!canManageSystem(member)) {
    throw new PermissionError('Sem permissao de administracao do sistema.', {
      userMessage:
        'Apenas administradores do servidor podem usar esta configuracao.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

/** Membro possui algum cargo de equipe (qualquer categoria) na guild. */
export async function canManageTickets(member: GuildMember): Promise<boolean> {
  if (canManageSystem(member)) return true;
  const roleIds = await getGuildTeamRoleIds(member.guild.id);
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

/** Membro pertence a equipe responsavel por esta categoria. */
export async function isCategoryStaff(
  member: GuildMember,
  categoryId: string,
): Promise<boolean> {
  if (canManageSystem(member)) return true;
  const roleIds = await getTeamRoleIds(categoryId);
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

/** Pode assumir o ticket: equipe da categoria (ou administrador). */
export async function canClaimTicket(member: GuildMember, ticket: Ticket): Promise<boolean> {
  return isCategoryStaff(member, ticket.categoryId);
}

export async function assertCanClaimTicket(
  member: GuildMember,
  ticket: Ticket,
): Promise<void> {
  if (!(await canClaimTicket(member, ticket))) {
    throw new PermissionError('Membro nao pertence a equipe da categoria.', {
      userMessage: 'Apenas a equipe responsavel por esta categoria pode assumir o atendimento.',
      context: { userId: member.id, entityType: 'ticket', entityId: ticket.id },
    });
  }
}

/**
 * Pode operar o painel administrativo do ticket (renomear, membros, transferir).
 * Equipe da categoria, responsavel atual ou administrador.
 */
export async function canManageTicketMembers(
  member: GuildMember,
  ticket: Ticket,
): Promise<boolean> {
  if (ticket.claimedById === member.id) return true;
  return isCategoryStaff(member, ticket.categoryId);
}

export async function assertCanManageTicketMembers(
  member: GuildMember,
  ticket: Ticket,
): Promise<void> {
  if (!(await canManageTicketMembers(member, ticket))) {
    throw new PermissionError('Sem permissao para administrar o ticket.', {
      userMessage: 'Apenas a equipe responsavel por este atendimento pode fazer isso.',
      context: { userId: member.id, entityType: 'ticket', entityId: ticket.id },
    });
  }
}

/** Transferir exige ser o responsavel atual ou administrador da categoria. */
export async function canTransferTicket(
  member: GuildMember,
  ticket: Ticket,
): Promise<boolean> {
  return canManageTicketMembers(member, ticket);
}

/**
 * Pode encerrar o ticket: equipe da categoria, responsavel, administrador
 * ou o proprio cliente que abriu o atendimento.
 */
export async function canCloseTicket(member: GuildMember, ticket: Ticket): Promise<boolean> {
  if (ticket.ownerId === member.id) return true;
  return canManageTicketMembers(member, ticket);
}

export async function assertCanCloseTicket(
  member: GuildMember,
  ticket: Ticket,
): Promise<void> {
  if (!(await canCloseTicket(member, ticket))) {
    throw new PermissionError('Sem permissao para encerrar o ticket.', {
      userMessage: 'Voce nao pode encerrar este atendimento.',
      context: { userId: member.id, entityType: 'ticket', entityId: ticket.id },
    });
  }
}

/** Notificar o cliente e uma acao de equipe. */
export async function canNotifyClient(member: GuildMember, ticket: Ticket): Promise<boolean> {
  return canManageTicketMembers(member, ticket);
}

// ---------------------------------------------------------------------------
// Comercial (pagamentos e cupons)
// ---------------------------------------------------------------------------

/** Vendedor: qualquer membro da equipe de atendimento pode gerar cobranca. */
export async function canCreatePayments(member: GuildMember): Promise<boolean> {
  return canManageTickets(member);
}

export async function assertCanCreatePayments(member: GuildMember): Promise<void> {
  if (!(await canCreatePayments(member))) {
    throw new PermissionError('Sem permissao para criar cobrancas.', {
      userMessage: 'Apenas a equipe da loja pode gerar cobrancas PIX.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

/** Aprovar/cancelar/alterar cobranca tambem e acao de equipe. */
export async function canManagePayments(member: GuildMember): Promise<boolean> {
  return canManageTickets(member);
}

export async function assertCanManagePayments(member: GuildMember): Promise<void> {
  if (!(await canManagePayments(member))) {
    throw new PermissionError('Sem permissao para gerenciar cobrancas.', {
      userMessage: 'Apenas a equipe da loja pode gerenciar cobrancas.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

/** Cadastro de cupons e restrito a administracao. */
export function canManageCoupons(member: GuildMember): boolean {
  return canManageSystem(member);
}

export function assertCanManageCoupons(member: GuildMember): void {
  if (!canManageCoupons(member)) {
    throw new PermissionError('Sem permissao para gerenciar cupons.', {
      userMessage: 'Apenas administradores podem gerenciar cupons.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

/** Cadastro de contas PIX e restrito a administracao (dado sensivel). */
export function canManagePaymentAccounts(member: GuildMember): boolean {
  return canManageSystem(member);
}

export function assertCanManagePaymentAccounts(member: GuildMember): void {
  if (!canManagePaymentAccounts(member)) {
    throw new PermissionError('Sem permissao para gerenciar contas PIX.', {
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
export function canManageCatalog(member: GuildMember): boolean {
  return canManageSystem(member);
}

export function assertCanManageCatalog(member: GuildMember): void {
  if (!canManageCatalog(member)) {
    throw new PermissionError('Sem permissao para gerenciar o catalogo.', {
      userMessage: 'Apenas administradores podem gerenciar o catalogo da loja.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

/** Categorias do catalogo seguem a mesma regra dos produtos. */
export function canManageCatalogCategories(member: GuildMember): boolean {
  return canManageCatalog(member);
}

export function assertCanManageCatalogCategories(member: GuildMember): void {
  if (!canManageCatalogCategories(member)) {
    throw new PermissionError('Sem permissao para gerenciar categorias do catalogo.', {
      userMessage: 'Apenas administradores podem gerenciar as categorias do catalogo.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

/** Atender pedidos e trabalho de vendedor: equipe de atendimento. */
export async function canManageOrders(member: GuildMember): Promise<boolean> {
  return canManageTickets(member);
}

export async function assertCanManageOrders(member: GuildMember): Promise<void> {
  if (!(await canManageOrders(member))) {
    throw new PermissionError('Sem permissao para gerenciar pedidos.', {
      userMessage: 'Apenas a equipe da loja pode gerenciar pedidos.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

/** Gerar a cobranca do pedido usa exatamente a permissao de `/pagamento`. */
export async function canCreateOrderPayment(member: GuildMember): Promise<boolean> {
  return canCreatePayments(member);
}

export async function assertCanCreateOrderPayment(member: GuildMember): Promise<void> {
  await assertCanCreatePayments(member);
}

/**
 * Aplicar cupom ao pedido e acao de VENDEDOR — nunca do cliente.
 * Mesma permissao usada para aplicar cupom em uma cobranca PIX.
 */
export async function canApplyOrderCoupon(member: GuildMember): Promise<boolean> {
  return canManagePayments(member);
}

export async function assertCanApplyOrderCoupon(member: GuildMember): Promise<void> {
  if (!(await canApplyOrderCoupon(member))) {
    throw new PermissionError('Sem permissao para aplicar cupom em pedido.', {
      userMessage: 'Apenas a equipe da loja aplica cupons. O cliente nunca escolhe cupom.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

export async function canCancelOrder(member: GuildMember): Promise<boolean> {
  return canManageOrders(member);
}

export async function assertCanCancelOrder(member: GuildMember): Promise<void> {
  if (!(await canCancelOrder(member))) {
    throw new PermissionError('Sem permissao para cancelar pedidos.', {
      userMessage: 'Apenas a equipe da loja pode cancelar pedidos.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

export async function canMarkOrderDelivered(member: GuildMember): Promise<boolean> {
  return canManageOrders(member);
}

export async function assertCanMarkOrderDelivered(member: GuildMember): Promise<void> {
  if (!(await canMarkOrderDelivered(member))) {
    throw new PermissionError('Sem permissao para concluir a entrega.', {
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
export async function canPublishWolfPortfolio(member: GuildMember): Promise<boolean> {
  return canManageTickets(member);
}

export async function assertCanPublishWolfPortfolio(member: GuildMember): Promise<void> {
  if (!(await canPublishWolfPortfolio(member))) {
    throw new PermissionError('Sem permissao para publicar no portfolio.', {
      userMessage: 'Apenas a equipe da loja pode publicar lobos no portfólio.',
      context: { userId: member.id, guildId: member.guild.id },
    });
  }
}

// ---------------------------------------------------------------------------
// Permissoes do BOT (nao do usuario)
// ---------------------------------------------------------------------------

/** Permissoes minimas que o bot precisa ter para operar tickets. */
export const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
] as const;

export interface BotPermissionCheck {
  ok: boolean;
  missing: string[];
}

const PERMISSION_LABELS = new Map<bigint, string>([
  [PermissionFlagsBits.ViewChannel, 'Ver canais'],
  [PermissionFlagsBits.SendMessages, 'Enviar mensagens'],
  [PermissionFlagsBits.ManageChannels, 'Gerenciar canais'],
  [PermissionFlagsBits.ManageRoles, 'Gerenciar cargos'],
  [PermissionFlagsBits.ReadMessageHistory, 'Ver historico de mensagens'],
  [PermissionFlagsBits.AttachFiles, 'Anexar arquivos'],
  [PermissionFlagsBits.EmbedLinks, 'Inserir links'],
]);

export function checkBotPermissions(botMember: GuildMember): BotPermissionCheck {
  const missing: string[] = [];
  for (const flag of REQUIRED_BOT_PERMISSIONS) {
    if (!botMember.permissions.has(flag)) {
      missing.push(PERMISSION_LABELS.get(flag) ?? String(flag));
    }
  }
  return { ok: missing.length === 0, missing };
}

/** O bot consegue atribuir este cargo? (hierarquia + cargo gerenciado) */
export function canBotAssignRole(
  botMember: GuildMember,
  roleId: string,
): { ok: boolean; reason?: string } {
  const role = botMember.guild.roles.cache.get(roleId);
  if (role === undefined) return { ok: false, reason: 'Cargo nao encontrado no servidor.' };
  if (role.managed) {
    return { ok: false, reason: 'Cargo gerenciado por integracao nao pode ser atribuido.' };
  }
  if (role.id === botMember.guild.roles.everyone.id) {
    return { ok: false, reason: 'O cargo @everyone nao pode ser atribuido.' };
  }
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
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
