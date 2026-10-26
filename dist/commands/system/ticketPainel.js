"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketPainelCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const TicketLocatorService_1 = require("../../modules/tickets/services/TicketLocatorService");
const discord_1 = require("../../utils/discord");
const TicketConfigService_1 = require("../../modules/tickets/services/TicketConfigService");
const TicketPanelService_1 = require("../../modules/tickets/services/TicketPanelService");
/** /ticket-painel enviar | atualizar | remover */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('ticket-painel')
    .setDescription('Gerencia o painel publico de atendimento')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
    .setName('enviar')
    .setDescription('Publica o painel publico em um canal')
    .addChannelOption((option) => option
    .setName('canal')
    .setDescription('Canal onde o painel sera publicado (padrao: canal atual)')
    .addChannelTypes(discord_js_1.ChannelType.GuildText)
    .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
    .setName('atualizar')
    .setDescription('Reconstroi o painel ja publicado (edita a mesma mensagem)'))
    .addSubcommand((subcommand) => subcommand.setName('remover').setDescription('Remove o painel publico'))
    .addSubcommand((subcommand) => subcommand
    .setName('localizadores')
    .setDescription('Publica o painel "Localizar meu ticket" no canal de cada categoria e acerta as permissoes'));
/**
 * Relatorio do `localizadores`.
 *
 * Uma linha por categoria, dizendo o que aconteceu com cada uma. Um "pronto"
 * generico esconderia justamente o caso que importa — a categoria que ficou de
 * fora por falta de canal ou de permissao.
 */
function describeLocatorReport(entries) {
    if (entries.length === 0) {
        return 'Nenhuma categoria ativa. Cadastre uma em `/ticket-categorias gerenciar`.';
    }
    const lines = entries.map((entry) => {
        if (entry.published) {
            const roles = entry.missingRoles.length > 0
                ? ` — ${entry.missingRoles.length} cargo(s) de equipe ja nao existem`
                : '';
            return `✅ **${entry.categoryName}** — painel em <#${entry.channelId ?? ''}>${roles}`;
        }
        const faltando = entry.missingPermissions.length > 0
            ? `\n-# Faltam ao bot: ${entry.missingPermissions.join(', ')}.`
            : '';
        return `⚠️ **${entry.categoryName}** — ${entry.reason ?? 'nao publicado'}${faltando}`;
    });
    return lines.join('\n');
}
async function execute(interaction) {
    (0, PermissionService_1.assertCanManageSystem)(interaction.member);
    const subcommand = interaction.options.getSubcommand(true);
    /*
     * DEFER ANTES DE QUALQUER SUBCOMANDO.
     *
     * O Discord invalida a interacao em 3 segundos, e TODO caminho daqui faz
     * chamada REST: publicar, editar ou apagar mensagem, e no caso de
     * `localizadores` uma volta inteira por categoria — permissoes do canal,
     * um overwrite por cliente com ticket aberto e a mensagem do painel. Isso
     * passa dos 3s com facilidade, e a resposta morria com 10062 DEPOIS de o
     * trabalho ja ter sido feito: os paineis iam para o canal e o operador via
     * "O aplicativo nao respondeu", sem saber que dera certo.
     *
     * `replySuccess`/`replyWarning` enxergam o defer e caem em `editReply`.
     */
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    if (subcommand === 'localizadores') {
        /*
         * Este e o comando que tambem ACERTA AS PERMISSOES do canal de destino.
         * As duas coisas andam juntas de proposito: um painel publicado num canal
         * onde a equipe nao enxerga topico nao leva a lugar nenhum, e mexer em
         * permissao de canal alheio so pode acontecer por acao explicita do
         * administrador — nunca no meio de um atendimento.
         */
        const entries = await (0, TicketLocatorService_1.publishLocatorPanels)(interaction.guild);
        const ok = entries.filter((entry) => entry.published).length;
        if (ok === entries.length && ok > 0) {
            await (0, reply_1.replySuccess)(interaction, describeLocatorReport(entries));
            return;
        }
        await (0, reply_1.replyWarning)(interaction, describeLocatorReport(entries));
        return;
    }
    if (subcommand === 'enviar') {
        const target = interaction.options.getChannel('canal') ?? interaction.channel;
        if (!(0, discord_1.isSendableTextChannel)(target)) {
            throw new errors_1.ValidationError('Canal invalido para o painel.', {
                userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
            });
        }
        const categories = await (0, TicketConfigService_1.getEnabledCategories)(interaction.guildId);
        if (categories.length === 0) {
            throw new errors_1.ConfigurationError('Nenhuma categoria ativa.', {
                userMessage: 'Cadastre ao menos uma categoria ativa em `/ticket-categorias gerenciar` antes de publicar o painel.',
            });
        }
        const message = await (0, TicketPanelService_1.publishPanel)(interaction.guild, target);
        await (0, reply_1.replySuccess)(interaction, `Painel publicado em <#${target.id}>.\n[Ir para o painel](${message.url})`);
        return;
    }
    if (subcommand === 'atualizar') {
        const result = await (0, TicketPanelService_1.refreshPublicPanel)(interaction.guild);
        if (result.updated) {
            await (0, reply_1.replySuccess)(interaction, result.reason ?? 'Painel publico atualizado com a configuracao atual.');
            return;
        }
        await (0, reply_1.replyWarning)(interaction, result.reason ?? 'Nao foi possivel atualizar o painel publico.');
        return;
    }
    const removed = await (0, TicketPanelService_1.removePanel)(interaction.guild);
    if (removed) {
        await (0, reply_1.replySuccess)(interaction, 'Painel publico removido.');
        return;
    }
    await (0, reply_1.replyInfo)(interaction, 'Nenhuma mensagem de painel foi encontrada. A configuracao foi limpa mesmo assim.');
}
exports.ticketPainelCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=ticketPainel.js.map