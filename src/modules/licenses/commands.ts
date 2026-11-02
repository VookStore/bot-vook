import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { replyV2 } from '../../components/reply';
import { container, heading, text } from '../../components/v2';
import { PermissionError, ValidationError } from '../../core/errors';
import { getPrisma } from '../../core/database/prisma';
import type { ButtonHandler, SlashCommandDefinition } from '../../types';
import { requireLicenses } from './config';
import { PLANS, isPlan } from './crypto';
import { changeLicense, createLicense, ownedLicense, revealKey } from './service';
import { detailPanel, details, listPanel } from './panel';
import { requireArg, NAMESPACE, LICENSE_ACTION } from '../../constants/customIds';
export async function assertLicenseAdmin(i: ChatInputCommandInteraction): Promise<void> {
    const c = requireLicenses();
    if (i.guildId !== c.guildId || !i.guild)
        throw new PermissionError('Use o servidor oficial da VOOK.');
    const guild = await i.guild.fetch();
    if (i.user.id === guild.ownerId || c.adminIds.includes(i.user.id))
        return;
    const member = await guild.members.fetch({ user: i.user.id, force: true });
    if (c.roleIds.some(id => member.roles.cache.has(id)))
        return;
    throw new PermissionError('Somente o dono e a equipe autorizada de licenças podem usar este comando.');
}
const choices = Object.keys(PLANS).map(value => ({ name: value === 'vitalicio' ? 'Vitalício' : value, value }));
const builder = new SlashCommandBuilder().setName('licenca').setDescription('Administração de licenças VOOK').setDMPermission(false)
    .addSubcommand(s => s.setName('criar').setDescription('Conceder uma licença manualmente')
    .addStringOption(o => o.setName('plano').setDescription('Validade da licença').setRequired(true).addChoices(...choices))
    .addUserOption(o => o.setName('usuario').setDescription('Cliente'))
    .addStringOption(o => o.setName('discord_id').setDescription('ID do cliente, se não selecionou usuário'))
    .addBooleanOption(o => o.setName('iniciar_agora').setDescription('Iniciar validade agora; padrão: primeiro uso')))
    .addSubcommand(s => s.setName('consultar').setDescription('Consultar licença e entrega dos avisos')
    .addStringOption(o => o.setName('id').setDescription('ID da licença').setRequired(true)))
    .addSubcommand(s => s.setName('listar').setDescription('Consultar licenças de um cliente')
    .addStringOption(o => o.setName('discord_id').setDescription('ID Discord do cliente').setRequired(true))
    .addIntegerOption(o => o.setName('pagina').setDescription('Página').setMinValue(1)))
    .addSubcommand(s => s.setName('renovar').setDescription('Adicionar validade sem alterar o código')
    .addStringOption(o => o.setName('id').setDescription('ID da licença').setRequired(true))
    .addStringOption(o => o.setName('plano').setDescription('Período a adicionar').setRequired(true).addChoices(...choices)));
for (const op of ['suspender', 'reativar', 'desvincular'])
    builder.addSubcommand(s => s.setName(op).setDescription(`${op} licença`)
        .addStringOption(o => o.setName('id').setDescription('ID da licença').setRequired(true)));
export const licenseCommand: SlashCommandDefinition = { builder, async execute(i) {
        await i.deferReply({ flags: 64 });
        await assertLicenseAdmin(i);
        const op = i.options.getSubcommand();
        if (op === 'listar') {
            const id = i.options.getString('discord_id', true);
            if (!/^\d{17,20}$/.test(id))
                throw new ValidationError('ID Discord inválido.');
            const page = (i.options.getInteger('pagina') || 1) - 1;
            const rows = await getPrisma().scriptLicense.findMany({ where: { guildId: requireLicenses().guildId, ownerId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: Math.min(page, 100000) * 5, take: 5 });
            await replyV2(i, container().addTextDisplayComponents(heading(`VOOK · Licenças do cliente · Página ${page + 1}`), text(rows.length ? rows.map(details).join('\n\n') : 'Nenhuma licença nesta página.')));
            return;
        }
        if (op === 'consultar') {
            const l = await getPrisma().scriptLicense.findFirst({ where: { id: i.options.getString('id', true), guildId: requireLicenses().guildId }, include: { events: { orderBy: { createdAt: 'desc' }, take: 3 } } });
            if (!l)
                throw new ValidationError('Licença não encontrada.');
            await replyV2(i, container().addTextDisplayComponents(heading('VOOK · Licença'), text(details(l) + `\nCliente: <@${l.ownerId}>\n\n**Últimos avisos**\n` + l.events.map(e => `${e.kind}: ${e.deliveredAt ? 'Entregue' : e.failedAt ? 'Falhou (privado bloqueado ou tentativas esgotadas)' : 'Na fila'}`).join('\n'))));
            return;
        }
        let l;
        if (op === 'criar') {
            const user = i.options.getUser('usuario');
            const id = i.options.getString('discord_id');
            if ((!!user) === (!!id))
                throw new ValidationError('Selecione usuário OU informe o ID Discord.');
            const recipient = await i.client.users.fetch(user?.id || id!);
            if (recipient.bot)
                throw new ValidationError('Escolha uma pessoa, não um bot.');
            const plan = i.options.getString('plano', true);
            if (!isPlan(plan))
                throw new ValidationError('Plano inválido.');
            l = await createLicense(recipient.id, plan, i.user.id, !i.options.getBoolean('iniciar_agora'));
        }
        else {
            if (!['renovar', 'suspender', 'reativar', 'desvincular'].includes(op))
                throw new ValidationError('Operação inválida.');
            const plan = i.options.getString('plano');
            l = await changeLicense(i.options.getString('id', true), i.user.id, op as 'renovar' | 'suspender' | 'reativar' | 'desvincular', plan && isPlan(plan) ? plan : undefined);
        }
        await replyV2(i, container().addTextDisplayComponents(heading('VOOK · Licença atualizada'), text(details(l) + `\nCliente: <@${l.ownerId}>\nAviso adicionado à fila do privado. Use /licenca consultar para conferir a entrega.`)));
    } };
export const plansCommand: SlashCommandDefinition = { guildOnly: false, builder: new SlashCommandBuilder().setName('planos').setDescription('Consultar minhas licenças VOOK').setContexts(InteractionContextType.Guild, InteractionContextType.BotDM), async execute(i) {
        await i.deferReply(i.inGuild() ? { flags: 64 } : {});
        await replyV2(i, await listPanel(i.user.id));
    } };
export const licenseButtons: ButtonHandler[] = Object.values(LICENSE_ACTION).map(action => ({ namespace: NAMESPACE.LICENSE, action, guildOnly: false, async handle(i, p) {
        // Never edit a public/forwarded panel with a secret. Always create a private reply.
        await i.deferReply(i.inGuild() ? { flags: 64 } : {});
        if (action === 'list') {
            await replyV2(i, await listPanel(i.user.id, Number(p.args[0])));
            return;
        }
        const l = await ownedLicense(requireArg(p, 0, 'licença'), i.user.id);
        if (action === 'key') {
            const key = await revealKey(l.id, i.user.id);
            await replyV2(i, container().addTextDisplayComponents(heading('VOOK · Código de ativação'), text(`Mantenha este código privado. No server.cfg, antes do ensure:\n\`\`\`cfg\nset vook_plush_license "${key}"\n\`\`\`\nUse somente set, nunca setr ou sets. A licença não precisa de compra.`)));
        }
        else
            await replyV2(i, detailPanel(l));
    } }));
