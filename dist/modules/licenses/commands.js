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
const packages_1 = require("./packages");
const releases_1 = require("./releases");
const downloadLinks_1 = require("./downloadLinks");
const download_1 = require("../../utils/download");
const products_1 = require("./products");
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
    .addSubcommand(s => s.setName('criar').setDescription('Nova concessão: Testes e Produção; anteriores são preservadas')
    .addStringOption(o => o.setName('plano').setDescription('Validade da licença').setRequired(true).addChoices(...choices))
    .addStringOption(o => o.setName('produto').setDescription('Produto licenciado; padrão: Sistema Base').addChoices(...(0, products_1.commercialProducts)().map(([value, p]) => ({ name: p.label, value }))))
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
builder.addSubcommand(s => s.setName('pacote_cadastrar').setDescription('Cadastrar ZIP final como rascunho, sem liberar ao cliente')
    .addStringOption(o => o.setName('produto').setDescription('Produto').setRequired(true).addChoices(...Object.entries(products_1.PRODUCTS).map(([value, p]) => ({ name: p.label, value }))))
    .addStringOption(o => o.setName('recurso').setDescription('Nome exato do recurso').setRequired(true).addChoices(...[...new Set(Object.values(products_1.PRODUCTS).flatMap(p => [...p.resources]))].map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName('versao').setDescription('Versão final: 1.2.3').setRequired(true))
    .addAttachmentOption(o => o.setName('arquivo').setDescription('ZIP preparado, sem licenças reais ou arquivos de testes').setRequired(true)));
builder.addSubcommand(s => s.setName('pacote_publicar').setDescription('Liberar versão revisada para clientes licenciados')
    .addStringOption(o => o.setName('id').setDescription('ID do rascunho').setRequired(true))
    .addStringOption(o => o.setName('sha256').setDescription('SHA-256 do arquivo revisado').setRequired(true))
    .addBooleanOption(o => o.setName('revisado').setDescription('Confirmo: versão final, testada, sem dados de clientes, testes ou segredos').setRequired(true)));
builder.addSubcommand(s => s.setName('pacote_retirar').setDescription('Impedir novos downloads de uma versão')
    .addStringOption(o => o.setName('id').setDescription('ID do pacote').setRequired(true)));
builder.addSubcommand(s => s.setName('pacotes').setDescription('Consultar rascunhos e versões publicadas')
    .addIntegerOption(o => o.setName('pagina').setDescription('Página').setMinValue(1)));
exports.licenseCommand = { builder, async execute(i) {
        await i.deferReply({ flags: 64 });
        await assertLicenseAdmin(i);
        const op = i.options.getSubcommand();
        if (op.startsWith('pacote')) {
            await handlePackageCommand(i, op);
            return;
        }
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
            const product = i.options.getString('produto') || 'pelucias_base';
            if (!(0, products_1.isProduct)(product) || !products_1.PRODUCTS[product].commercial)
                throw new errors_1.ValidationError('Escolha um produto comercial. Licenças anteriores são preservadas e administradas por ID.');
            const result = await (0, service_1.createLicense)(recipient.id, plan, i.user.id, !i.options.getBoolean('iniciar_agora'), product);
            await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)(result.created ? 'VOOK · Par de licenças criado' : 'VOOK · Licenças existentes preservadas'), (0, v2_1.text)(result.created ? result.licenses.map(panel_1.details).join('\n\n') : 'Este cliente já possui licença(s) deste produto. Nenhuma chave, validade ou vínculo foi alterado e nenhuma licença adicional foi criada. Consulte /licenca listar.'), (0, v2_1.text)(`Cliente: <@${recipient.id}>\n${result.created ? 'Avisos adicionados à fila do privado. O cliente pode baixar pelo /planos quando houver pacote publicado.' : 'Reenvios e downloads usam as mesmas licenças. Renovação e alterações continuam por ID.'}`)));
            return;
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
        if (action === 'packages') {
            await (0, reply_1.replyV2)(i, await (0, panel_1.packagesPanel)(l.id, i.user.id, Number(p.args[1])));
        }
        else if (action === 'download') {
            await (0, releases_1.withPackageJob)(async () => {
                const releaseId = (0, customIds_1.requireArg)(p, 1, 'versão');
                let file;
                try {
                    file = await (0, releases_1.prepareDownload)(l.id, releaseId, i.user.id, i.attachmentSizeLimit);
                }
                catch (error) {
                    if (!(error instanceof releases_1.AttachmentLimitError))
                        throw error;
                    const url = await (0, downloadLinks_1.issueDownloadLink)(l.id, releaseId, i.user.id);
                    await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Download privado'), (0, v2_1.text)(`${(0, panel_1.details)(l)}\n\nEste pacote excede o limite de anexos do Discord. O link abaixo funciona uma vez e expira em **5 minutos**. A licença será configurada no ZIP. Não compartilhe o link nem o arquivo. Se expirar ou falhar, gere outro em /planos.`))
                        .addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder().setStyle(discord_js_1.ButtonStyle.Link).setLabel('Baixar meu pacote').setURL(url))));
                    return;
                }
                await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Seu script está pronto'), (0, v2_1.text)(`${(0, panel_1.details)(file.license)}\n\nVersão: **${file.release.version}** · Recurso: **${file.release.resource}**\nLicença já configurada. Extraia o ZIP, siga INSTALACAO-VOOK.txt e instale somente no ambiente indicado. Não compartilhe este arquivo.`))
                    .addFileComponents(new discord_js_1.FileBuilder().setURL(`attachment://${file.name}`)), { files: [new discord_js_1.AttachmentBuilder(file.bytes, { name: file.name })] });
            });
        }
        else if (action === 'key') {
            const key = await (0, service_1.revealKey)(l.id, i.user.id);
            await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Código de ativação'), (0, v2_1.text)((0, products_1.activationInstructions)(l.product, key))));
        }
        else
            await (0, reply_1.replyV2)(i, (0, panel_1.detailPanel)(l));
    } }));
async function handlePackageCommand(i, op) {
    if (op === 'pacotes') {
        const page = (i.options.getInteger('pagina') || 1) - 1;
        const rows = await (0, prisma_1.getPrisma)().scriptRelease.findMany({ where: { guildId: (0, config_1.requireLicenses)().guildId }, select: releases_1.releaseMetadata, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: Math.min(page, 100000) * 5, take: 5 });
        await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)(`VOOK · Pacotes · Página ${page + 1}`), (0, v2_1.text)(rows.length ? rows.map(r => `**${r.resource} · ${r.version} · ${r.status}**\nID: \`${r.id}\`\nSHA-256: \`${r.sha256}\``).join('\n\n') : 'Nenhum pacote cadastrado nesta página.')));
        return;
    }
    if (op === 'pacote_retirar') {
        await (0, releases_1.withdrawRelease)(i.options.getString('id', true), i.user.id);
        await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.text)('Versão retirada dos downloads. As licenças e os arquivos já recebidos permanecem inalterados.')));
        return;
    }
    await (0, releases_1.withPackageJob)(async () => {
        if (op === 'pacote_publicar') {
            const r = await (0, releases_1.publishRelease)(i.options.getString('id', true), i.options.getString('sha256', true), i.user.id, i.options.getBoolean('revisado', true));
            await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.text)(`**${r.resource} · ${r.version}** publicado. Clientes com licença válida do produto podem baixar em /planos.`)));
            return;
        }
        if (op !== 'pacote_cadastrar')
            (0, packages_1.packageError)('Operação desconhecida.');
        const attachment = i.options.getAttachment('arquivo', true);
        const limit = (0, packages_1.archiveLimit)(i.options.getString('produto', true));
        if (!attachment.name.toLowerCase().endsWith('.zip') || attachment.size > limit)
            (0, packages_1.packageError)(`Envie um ZIP de até ${limit / 1024 / 1024} MiB.`);
        const { bytes } = await (0, download_1.downloadDiscordAttachment)(attachment.url, limit, 120000);
        const r = await (0, releases_1.registerRelease)(i.options.getString('produto', true), i.options.getString('recurso', true), i.options.getString('versao', true), bytes, i.user.id);
        await (0, reply_1.replyV2)(i, (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Pacote cadastrado'), (0, v2_1.text)(`**${r.resource} · ${r.version} · ${r.status}**\n${r.fileCount} arquivos\nID: \`${r.id}\`\nSHA-256: \`${r.sha256}\`\n\nRascunhos não são entregues. Revise o conteúdo e teste a instalação antes de usar /licenca pacote_publicar com este ID e SHA-256.`)));
    });
}
//# sourceMappingURL=commands.js.map