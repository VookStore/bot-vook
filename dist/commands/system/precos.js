"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.precosCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const PricingBuilder_1 = require("../../modules/pricing/builders/PricingBuilder");
const PricingPanelService_1 = require("../../modules/pricing/services/PricingPanelService");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
const discord_1 = require("../../utils/discord");
/**
 * /precos previa | enviar | atualizar
 *
 * A tabela de precos vive em `src/modules/pricing/data/priceTable.ts`. Mudou um
 * valor? Edita o arquivo, `npm run build`, reinicia e roda `/precos atualizar` —
 * a mensagem publicada e reescrita no lugar.
 *
 * `previa` existe para conferir o texto antes de ele virar publico: a tabela vai
 * para um canal aberto e um erro de digitacao ali e uma cobranca errada.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('precos')
    .setDescription('Publica e atualiza a tabela de precos da loja')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
    .setName('previa')
    .setDescription('Mostra a tabela so para voce, sem publicar nada'))
    .addSubcommand((subcommand) => subcommand
    .setName('enviar')
    .setDescription('Publica a tabela em um canal')
    .addChannelOption((option) => option
    .setName('canal')
    .setDescription('Canal onde a tabela sera publicada (padrao: canal atual)')
    .addChannelTypes(discord_js_1.ChannelType.GuildText)
    .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
    .setName('atualizar')
    .setDescription('Reescreve a tabela ja publicada com os valores atuais'));
async function execute(interaction) {
    // O customId/permissao do Discord pode ser afrouxado por um admin na
    // interface; a checagem que vale e esta.
    (0, PermissionService_1.assertCanManageSystem)(interaction.member);
    const subcommand = interaction.options.getSubcommand();
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    if (subcommand === 'previa') {
        const config = await (0, GuildConfigService_1.getGuildConfig)(interaction.guildId);
        await (0, reply_1.editReplyV2)(interaction, (0, PricingBuilder_1.buildPricingPanel)(config));
        return;
    }
    if (subcommand === 'enviar') {
        const target = interaction.options.getChannel('canal') ?? interaction.channel;
        if (!(0, discord_1.isSendableTextChannel)(target)) {
            throw new errors_1.ValidationError('Canal invalido para a tabela de precos.', {
                userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
            });
        }
        await (0, PricingPanelService_1.publishPricingPanel)(interaction.guild, target);
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)(`Tabela publicada em ${(0, discord_1.channelUrl)(interaction.guildId, target.id)}`, {
            footer: 'Para mudar um valor: edite priceTable.ts, refaca o build e rode /precos atualizar.',
        }));
        return;
    }
    // atualizar
    const result = await (0, PricingPanelService_1.refreshPricingPanel)(interaction.guild);
    await (0, reply_1.editReplyV2)(interaction, result.updated
        ? (0, reply_1.successContainer)('Tabela atualizada com os valores atuais.')
        : (0, reply_1.warningContainer)(result.reason ?? 'Nao foi possivel atualizar a tabela.'));
}
exports.precosCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=precos.js.map