"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseButtons = exports.plansCommand = exports.licenseCommand = void 0;
exports.assertLicenseAdmin = assertLicenseAdmin;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const v2_1 = require("../../components/v2");
const errors_1 = require("../../core/errors");
const prisma_1 = require("../../core/database/prisma");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
const service_1 = require("./service");
const panel_1 = require("./panel");
const customIds_1 = require("../../constants/customIds");
async function assertLicenseAdmin(i) {
    const c = (0, config_1.requireLicenses)();
    if (i.guildId !== c.guildId || !i.guild)
        throw new errors_1.PermissionError('Use o servidor oficial da VOOK.');
    const guild = await i.guild.fetch();
    if (i.user.id === guild.ownerId || c.adminIds.includes(i.user.id))
        return;
    const member = await guild.members.fetch({ user: i.user.id, force: true });
    if (c.roleIds.some(id => member.roles.cache.has(id)))
        return;
    throw new errors_1.PermissionError('Somente o dono e a equipe autorizada de licenças podem usar este comando.');
}
const choices = Object.keys(crypto_1.PLANS).map(value => ({ name: value === 'vitalicio' ? 'Vitalício' : value, value }));
const builder = new discord_js_1.SlashCommandBuilder().setName('licenca').setDescription('Administração de licenças VOOK').setDMPermission(false)
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
exports.licenseCommand = { builder, async execute(i) {
        await i.deferReply({ flags: 64 });
        await assertLicenseAdmin(i);
        const op = i.options.getSubcommand();
        if (op === 'listar') {
            const id = i.options.getString('discord_id', true);
            if (!/^\d{17,20}$/.test(id))
                throw new errors_1.ValidationError('ID Discord inválido.');
            const page = (i.options.getInteger('pagina') || 1) - 1;
            const rows = await (0, prisma_1.getPrisma)().scriptLicense.findMany({ where: { guildId: (0, config_1.requireLicenses)().guildId, ownerId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: Math.min(page, 100000) * 5, take: 5 });
            await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)(`VOOK · Licenças do cliente · Página ${page + 1}`), (0, v2_1.text)(rows.length ? rows.map(panel_1.details).join('\n\n') : 'Nenhuma licença nesta página.')));
            return;
        }
        if (op === 'consultar') {
            const l = await (0, prisma_1.getPrisma)().scriptLicense.findFirst({ where: { id: i.options.getString('id', true), guildId: (0, config_1.requireLicenses)().guildId }, include: { events: { orderBy: { createdAt: 'desc' }, take: 3 } } });
            if (!l)
                throw new errors_1.ValidationError('Licença não encontrada.');
            await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Licença'), (0, v2_1.text)((0, panel_1.details)(l) + `\nCliente: <@${l.ownerId}>\n\n**Últimos avisos**\n` + l.events.map(e => `${e.kind}: ${e.deliveredAt ? 'Entregue' : e.failedAt ? 'Falhou (privado bloqueado ou tentativas esgotadas)' : 'Na fila'}`).join('\n'))));
            return;
        }
        let l;
        if (op === 'criar') {
            const user = i.options.getUser('usuario');
            const id = i.options.getString('discord_id');
            if ((!!user) === (!!id))
                throw new errors_1.ValidationError('Selecione usuário OU informe o ID Discord.');
            const recipient = await i.client.users.fetch(user?.id || id);
            if (recipient.bot)
                throw new errors_1.ValidationError('Escolha uma pessoa, não um bot.');
            const plan = i.options.getString('plano', true);
            if (!(0, crypto_1.isPlan)(plan))
                throw new errors_1.ValidationError('Plano inválido.');
            l = await (0, service_1.createLicense)(recipient.id, plan, i.user.id, !i.options.getBoolean('iniciar_agora'));
        }
        else {
            if (!['renovar', 'suspender', 'reativar', 'desvincular'].includes(op))
                throw new errors_1.ValidationError('Operação inválida.');
            const plan = i.options.getString('plano');
            l = await (0, service_1.changeLicense)(i.options.getString('id', true), i.user.id, op, plan && (0, crypto_1.isPlan)(plan) ? plan : undefined);
        }
        await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Licença atualizada'), (0, v2_1.text)((0, panel_1.details)(l) + `\nCliente: <@${l.ownerId}>\nAviso adicionado à fila do privado. Use /licenca consultar para conferir a entrega.`)));
    } };
exports.plansCommand = { guildOnly: false, builder: new discord_js_1.SlashCommandBuilder().setName('planos').setDescription('Consultar minhas licenças VOOK').setContexts(discord_js_1.InteractionContextType.Guild, discord_js_1.InteractionContextType.BotDM), async execute(i) {
        await i.deferReply(i.inGuild() ? { flags: 64 } : {});
        await (0, reply_1.replyV2)(i, await (0, panel_1.listPanel)(i.user.id));
    } };
exports.licenseButtons = Object.values(customIds_1.LICENSE_ACTION).map(action => ({ namespace: customIds_1.NAMESPACE.LICENSE, action, guildOnly: false, async handle(i, p) {
        // Never edit a public/forwarded panel with a secret. Always create a private reply.
        await i.deferReply(i.inGuild() ? { flags: 64 } : {});
        if (action === 'list') {
            await (0, reply_1.replyV2)(i, await (0, panel_1.listPanel)(i.user.id, Number(p.args[0])));
            return;
        }
        const l = await (0, service_1.ownedLicense)((0, customIds_1.requireArg)(p, 0, 'licença'), i.user.id);
        if (action === 'key') {
            const key = await (0, service_1.revealKey)(l.id, i.user.id);
            await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Código de ativação'), (0, v2_1.text)(`Mantenha este código privado. No server.cfg, antes do ensure:\n\`\`\`cfg\nset vook_plush_license "${key}"\n\`\`\`\nUse somente set, nunca setr ou sets. A licença não precisa de compra.`)));
        }
        else
            await (0, reply_1.replyV2)(i, (0, panel_1.detailPanel)(l));
    } }));
//# sourceMappingURL=commands.js.map