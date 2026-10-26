"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogoPainelCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const limits_1 = require("../../constants/limits");
const sanitize_1 = require("../../utils/sanitize");
const discord_1 = require("../../utils/discord");
const CatalogPanelService_1 = require("../../modules/catalog/services/CatalogPanelService");
const CatalogCategoryService_1 = require("../../modules/catalog/services/CatalogCategoryService");
const CatalogService_1 = require("../../modules/catalog/services/CatalogService");
/**
 * `/catalogo-painel enviar | atualizar | remover`.
 *
 * Espelha o `/ticket-painel`: o par (canal, mensagem) fica salvo, entao
 * "atualizar" EDITA o painel existente em vez de publicar outro. Um catalogo
 * que duplica o painel a cada alteracao vira poluicao no canal.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('catalogo-painel')
    .setDescription('Gerencia o painel publico do catalogo')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
    .setName('enviar')
    .setDescription('Publica o painel do catalogo em um canal')
    .addChannelOption((option) => option
    .setName('canal')
    .setDescription('Canal onde o painel sera publicado (padrao: canal atual)')
    .addChannelTypes(discord_js_1.ChannelType.GuildText)
    .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
    .setName('atualizar')
    .setDescription('Reconstroi o painel publicado (edita a mesma mensagem)'))
    .addSubcommand((subcommand) => subcommand.setName('remover').setDescription('Remove o painel publico do catalogo'))
    .addSubcommand((subcommand) => subcommand
    .setName('prazo')
    .setDescription('Define o prazo de producao de uma categoria, em dias uteis')
    .addStringOption((option) => option
    .setName('categoria')
    .setDescription('Categoria do catalogo')
    .setAutocomplete(true)
    .setRequired(true))
    .addIntegerOption((option) => option
    .setName('dias')
    .setDescription('Dias uteis de producao. 0 remove o prazo da categoria.')
    .setMinValue(0)
    .setMaxValue(365)
    .setRequired(true)));
async function execute(interaction) {
    (0, PermissionService_1.assertCanManageCatalog)(interaction.member);
    const subcommand = interaction.options.getSubcommand(true);
    /*
     * Mesmo motivo do `/ticket-painel`: todo subcomando daqui publica, reescreve
     * ou apaga uma mensagem antes de responder, e a interacao expira em 3
     * segundos. Sem o defer, a operacao dava certo e o operador via
     * "O aplicativo nao respondeu".
     */
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    if (subcommand === 'prazo') {
        const categoryId = interaction.options.getString('categoria', true);
        const dias = interaction.options.getInteger('dias', true);
        /*
         * 0 REMOVE o prazo em vez de significar "entrega hoje". Prometer entrega no
         * mesmo dia por engano de digitacao seria muito pior que ficar sem previsao,
         * e ninguem cadastra producao de zero dia de proposito.
         */
        const aplicado = await (0, CatalogCategoryService_1.setCategoryLeadTime)(interaction.guildId, categoryId, dias === 0 ? null : dias);
        if (!aplicado) {
            throw new errors_1.ValidationError(`Categoria inexistente: ${categoryId}`, {
                userMessage: 'Categoria nao encontrada. Escolha uma da lista.',
            });
        }
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)(dias === 0
            ? 'Prazo removido: esta categoria volta a nao gerar previsao de entrega.'
            : `Prazo definido: **${dias} dia(s) util(eis)** de producao.`, {
            footer: 'Vale para as proximas vendas. Pedidos ja pagos mantem a previsao que foi prometida.',
        }));
        return;
    }
    if (subcommand === 'enviar') {
        const target = interaction.options.getChannel('canal') ?? interaction.channel;
        if (!(0, discord_1.isSendableTextChannel)(target)) {
            throw new errors_1.ValidationError('Canal invalido para o painel do catalogo.', {
                userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
            });
        }
        const [categories, packs] = await Promise.all([
            (0, CatalogCategoryService_1.getEnabledCatalogCategories)(interaction.guildId),
            (0, CatalogService_1.listVisiblePacks)(interaction.guildId),
        ]);
        if (categories.length === 0 || packs.length === 0) {
            throw new errors_1.ConfigurationError('Catalogo vazio.', {
                userMessage: 'Cadastre ao menos uma categoria ativa e um pack ativo em `/catalogo gerenciar` antes de publicar o painel.',
            });
        }
        const message = await (0, CatalogPanelService_1.publishCatalogPanel)(interaction.guild, target);
        await (0, reply_1.replySuccess)(interaction, `Painel do catalogo publicado em <#${target.id}>.\n[Ir para o painel](${message.url})`);
        return;
    }
    if (subcommand === 'atualizar') {
        const result = await (0, CatalogPanelService_1.refreshCatalogPanel)(interaction.guild);
        if (result.updated) {
            await (0, reply_1.replySuccess)(interaction, result.reason ?? 'Painel do catalogo atualizado com os produtos atuais.');
            return;
        }
        await (0, reply_1.replyWarning)(interaction, result.reason ?? 'Nao foi possivel atualizar o painel do catalogo.');
        return;
    }
    const removed = await (0, CatalogPanelService_1.removeCatalogPanel)(interaction.guild);
    if (removed) {
        await (0, reply_1.replySuccess)(interaction, 'Painel do catalogo removido.');
        return;
    }
    await (0, reply_1.replyInfo)(interaction, 'Nenhuma mensagem de painel foi encontrada. A configuracao foi limpa mesmo assim.');
}
/**
 * Autocomplete das categorias, com o prazo atual no rotulo.
 *
 * Mostrar o prazo vigente ao lado do nome evita o erro mais provavel aqui:
 * redefinir uma categoria que ja estava certa por nao lembrar quanto era.
 *
 * Revalida a permissao — autocomplete e uma interacao separada, e o
 * `setDefaultMemberPermissions` e apenas visual.
 */
async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'categoria' || !(0, PermissionService_1.canManageCatalog)(interaction.member)) {
        await interaction.respond([]);
        return;
    }
    const query = focused.value.toLowerCase().trim();
    const categories = await (0, CatalogCategoryService_1.getCatalogCategories)(interaction.guildId);
    await interaction.respond(categories
        .filter((category) => category.deletedAt === null)
        .filter((category) => query.length === 0 || category.name.toLowerCase().includes(query))
        .slice(0, limits_1.DISCORD_LIMITS.AUTOCOMPLETE_CHOICES)
        .map((category) => ({
        name: (0, sanitize_1.truncate)(`${category.name}${category.leadTimeDays === null ? ' (sem prazo)' : ` (${category.leadTimeDays}d)`}`, 100),
        value: category.id,
    })));
}
exports.catalogoPainelCommand = {
    builder,
    guildOnly: true,
    execute,
    autocomplete,
};
//# sourceMappingURL=catalogoPainel.js.map