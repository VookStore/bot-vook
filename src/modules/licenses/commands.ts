import { AttachmentBuilder, ButtonBuilder, ButtonStyle, FileBuilder, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { replyV2 } from '../../components/reply';
import { container, heading, text, buttonRow } from '../../components/v2';
import { PermissionError, ValidationError } from '../../core/errors';
import { getPrisma } from '../../core/database/prisma';
import type { ButtonHandler, SlashCommandDefinition } from '../../types';
import { requireLicenses } from './config';
import { PLANS, isPlan } from './crypto';
import { changeLicense, createLicense, ownedLicense, revealKey } from './service';
import { detailPanel, details, listPanel, packagesPanel } from './panel';
import { archiveLimit, packageError } from './packages';
import { registerRelease, publishRelease, withdrawRelease, releaseMetadata, prepareDownload, withPackageJob, AttachmentLimitError } from './releases';
import { issueDownloadLink } from './downloadLinks';
import { downloadDiscordAttachment } from '../../utils/download';
import { PRODUCTS, commercialProducts, isProduct, activationInstructions } from './products';
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
    .addSubcommand(s => s.setName('criar').setDescription('Nova concessão: Testes e Produção; anteriores são preservadas')
    .addStringOption(o => o.setName('plano').setDescription('Validade da licença').setRequired(true).addChoices(...choices))
    .addStringOption(o => o.setName('produto').setDescription('Produto licenciado; padrão: Sistema Base').addChoices(...commercialProducts().map(([value, p]) => ({ name: p.label, value }))))
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
    .addStringOption(o => o.setName('produto').setDescription('Produto').setRequired(true).addChoices(...Object.entries(PRODUCTS).map(([value, p]) => ({ name: p.label, value }))))
    .addStringOption(o => o.setName('recurso').setDescription('Nome exato do recurso').setRequired(true).addChoices(...[...new Set(Object.values(PRODUCTS).flatMap(p => [...p.resources]))].map(value => ({ name: value, value }))))
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
export const licenseCommand: SlashCommandDefinition = { builder, async execute(i) {
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
            const product = i.options.getString('produto') || 'pelucias_base';
            if (!isProduct(product) || !PRODUCTS[product].commercial) throw new ValidationError('Escolha um produto comercial. Licenças anteriores são preservadas e administradas por ID.');
            const result = await createLicense(recipient.id, plan, i.user.id, !i.options.getBoolean('iniciar_agora'), product);
            await replyV2(i, container().addTextDisplayComponents(heading(result.created ? 'VOOK · Par de licenças criado' : 'VOOK · Licenças existentes preservadas'),
                text(result.created ? result.licenses.map(details).join('\n\n') : 'Este cliente já possui licença(s) deste produto. Nenhuma chave, validade ou vínculo foi alterado e nenhuma licença adicional foi criada. Consulte /licenca listar.'),
                text(`Cliente: <@${recipient.id}>\n${result.created ? 'Avisos adicionados à fila do privado. O cliente pode baixar pelo /planos quando houver pacote publicado.' : 'Reenvios e downloads usam as mesmas licenças. Renovação e alterações continuam por ID.'}`)));
            return;
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
        if (action === 'packages') {
            await replyV2(i, await packagesPanel(l.id, i.user.id, Number(p.args[1])));
        }
        else if (action === 'download') {
            await withPackageJob(async () => {
                const releaseId = requireArg(p, 1, 'versão');
                let file;
                try { file = await prepareDownload(l.id, releaseId, i.user.id, i.attachmentSizeLimit); }
                catch (error) {
                    if (!(error instanceof AttachmentLimitError)) throw error;
                    const url = await issueDownloadLink(l.id, releaseId, i.user.id);
                    await replyV2(i, container().addTextDisplayComponents(heading('VOOK · Download privado'),
                        text(`${details(l)}\n\nEste pacote excede o limite de anexos do Discord. O link abaixo funciona uma vez e expira em **5 minutos**. A licença será configurada no ZIP. Não compartilhe o link nem o arquivo. Se expirar ou falhar, gere outro em /planos.`))
                        .addActionRowComponents(buttonRow(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Baixar meu pacote').setURL(url))));
                    return;
                }
                await replyV2(i, container().addTextDisplayComponents(heading('VOOK · Seu script está pronto'), text(`${details(file.license)}\n\nVersão: **${file.release.version}** · Recurso: **${file.release.resource}**\nLicença já configurada. Extraia o ZIP, siga INSTALACAO-VOOK.txt e instale somente no ambiente indicado. Não compartilhe este arquivo.`))
                    .addFileComponents(new FileBuilder().setURL(`attachment://${file.name}`)), { files: [new AttachmentBuilder(file.bytes, { name: file.name })] });
            });
        }
        else if (action === 'key') {
            const key = await revealKey(l.id, i.user.id);
            await replyV2(i, container().addTextDisplayComponents(heading('VOOK · Código de ativação'), text(activationInstructions(l.product, key))));
        }
        else
            await replyV2(i, detailPanel(l));
    } }));

async function handlePackageCommand(i: ChatInputCommandInteraction, op: string): Promise<void> {
    if (op === 'pacotes') {
        const page = (i.options.getInteger('pagina') || 1) - 1;
        const rows = await getPrisma().scriptRelease.findMany({ where: { guildId: requireLicenses().guildId }, select: releaseMetadata, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: Math.min(page, 100000) * 5, take: 5 });
        await replyV2(i, container().addTextDisplayComponents(heading(`VOOK · Pacotes · Página ${page + 1}`), text(rows.length ? rows.map(r => `**${r.resource} · ${r.version} · ${r.status}**\nID: \`${r.id}\`\nSHA-256: \`${r.sha256}\``).join('\n\n') : 'Nenhum pacote cadastrado nesta página.')));
        return;
    }
    if (op === 'pacote_retirar') {
        await withdrawRelease(i.options.getString('id', true), i.user.id);
        await replyV2(i, container().addTextDisplayComponents(text('Versão retirada dos downloads. As licenças e os arquivos já recebidos permanecem inalterados.')));
        return;
    }
    await withPackageJob(async () => {
        if (op === 'pacote_publicar') {
            const r = await publishRelease(i.options.getString('id', true), i.options.getString('sha256', true), i.user.id, i.options.getBoolean('revisado', true));
            await replyV2(i, container().addTextDisplayComponents(text(`**${r.resource} · ${r.version}** publicado. Clientes com licença válida do produto podem baixar em /planos.`)));
            return;
        }
        if (op !== 'pacote_cadastrar') packageError('Operação desconhecida.');
        const attachment = i.options.getAttachment('arquivo', true);
        const limit = archiveLimit(i.options.getString('produto', true));
        if (!attachment.name.toLowerCase().endsWith('.zip') || attachment.size > limit) packageError(`Envie um ZIP de até ${limit / 1024 / 1024} MiB.`);
        const { bytes } = await downloadDiscordAttachment(attachment.url, limit, 120000);
        const r = await registerRelease(i.options.getString('produto', true), i.options.getString('recurso', true), i.options.getString('versao', true), bytes, i.user.id);
        await replyV2(i, container().addTextDisplayComponents(heading('VOOK · Pacote cadastrado'), text(`**${r.resource} · ${r.version} · ${r.status}**\n${r.fileCount} arquivos\nID: \`${r.id}\`\nSHA-256: \`${r.sha256}\`\n\nRascunhos não são entregues. Revise o conteúdo e teste a instalação antes de usar /licenca pacote_publicar com este ID e SHA-256.`)));
    });
}
