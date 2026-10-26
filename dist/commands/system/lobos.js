"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lobosCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
const WolfPortfolioService_1 = require("../../modules/wolves/services/WolfPortfolioService");
const render_1 = require("../../modules/wolves/validators/render");
const AssetHostingService_1 = require("../../modules/hosting/AssetHostingService");
const discord_1 = require("../../utils/discord");
/**
 * /lobos painel | portfolio | atualizar
 *
 * Configuracao do portfolio de lobos. Quem PUBLICA um lobo e a equipe, pelo
 * botao do painel; este comando so decide onde o painel fica e para onde os
 * posts vao — e por isso exige administracao.
 *
 * Ordem da primeira vez: `/lobos portfolio` (destino) e `/lobos painel` (no
 * canal da equipe). Em qualquer ordem funciona: o painel publicado antes do
 * destino sai com o botao desligado e se liga sozinho quando o destino e
 * definido.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('lobos')
    .setDescription('Painel da equipe e canal do portfolio de lobos')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
    .setName('painel')
    .setDescription('Publica o painel de criacao de anuncios de lobos')
    .addChannelOption((option) => option
    .setName('canal')
    .setDescription('Canal da equipe onde o painel fica (padrao: canal atual)')
    .addChannelTypes(discord_js_1.ChannelType.GuildText)
    .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
    .setName('portfolio')
    .setDescription('Define o canal onde os lobos sao publicados')
    .addChannelOption((option) => option
    .setName('canal')
    .setDescription('Canal publico do portfolio')
    .addChannelTypes(discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement)
    .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
    .setName('atualizar')
    .setDescription('Reescreve o painel ja publicado'));
async function execute(interaction) {
    // A permissao do comando pode ser afrouxada por um admin na interface do
    // Discord; a checagem que vale e esta.
    (0, PermissionService_1.assertCanManageSystem)(interaction.member);
    const subcommand = interaction.options.getSubcommand();
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    // Teto do render NESTE servidor (loja x nivel de impulsos), para o painel
    // mostrar o numero que o formulario vai de fato aceitar.
    const maxRenderBytes = (0, render_1.effectiveRenderLimit)(interaction.guild, (0, AssetHostingService_1.isAssetHostingEnabled)());
    if (subcommand === 'painel') {
        const target = interaction.options.getChannel('canal') ?? interaction.channel;
        if (!(0, discord_1.isSendableTextChannel)(target)) {
            throw new errors_1.ValidationError('Canal invalido para o painel de lobos.', {
                userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
            });
        }
        await (0, WolfPortfolioService_1.publishWolfPanel)(interaction.guild, target, maxRenderBytes);
        const config = await (0, GuildConfigService_1.getGuildConfig)(interaction.guildId);
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)(`Painel publicado em ${(0, discord_1.channelUrl)(interaction.guildId, target.id)}`, {
            footer: config.wolfPortfolioChannelId === null
                ? 'O botao esta desligado: defina o destino com /lobos portfolio e ele se liga sozinho.'
                : 'Os posts saem no canal do portfolio. Para trocar, use /lobos portfolio.',
        }));
        return;
    }
    if (subcommand === 'portfolio') {
        const target = interaction.options.getChannel('canal', true);
        if (!(0, discord_1.isSendableTextChannel)(target)) {
            throw new errors_1.ValidationError('Canal invalido para o portfolio de lobos.', {
                userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
            });
        }
        const refresh = await (0, WolfPortfolioService_1.setPortfolioChannel)(interaction.guild, target, maxRenderBytes);
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)(`Os lobos passam a ser publicados em ${(0, discord_1.channelMention)(target.id)}.`, {
            footer: refresh.updated
                ? 'O painel da equipe foi atualizado com o novo destino.'
                : 'O painel ainda nao foi publicado. Use /lobos painel no canal da equipe.',
        }));
        return;
    }
    // atualizar
    const result = await (0, WolfPortfolioService_1.refreshWolfPanel)(interaction.guild, maxRenderBytes);
    await (0, reply_1.editReplyV2)(interaction, result.updated
        ? (0, reply_1.successContainer)('Painel de lobos atualizado.', {
            footer: `Renders de ate ${(0, render_1.describeRenderMaxSize)(maxRenderBytes)} neste servidor.`,
        })
        : (0, reply_1.warningContainer)(result.reason ?? 'Nao foi possivel atualizar o painel.'));
}
exports.lobosCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=lobos.js.map