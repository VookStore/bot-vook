"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.anunciarCommand = void 0;
const discord_js_1 = require("discord.js");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const errors_1 = require("../../core/errors");
const discord_1 = require("../../utils/discord");
const AnnouncementBuilders_1 = require("../../modules/announcements/builders/AnnouncementBuilders");
const AnnouncementDraftService_1 = require("../../modules/announcements/services/AnnouncementDraftService");
const AnnouncementService_1 = require("../../modules/announcements/services/AnnouncementService");
/**
 * `/anunciar [canal] [embed]`
 *
 * Abre o formulario do anuncio e devolve uma PREVIA efemera, onde o autor
 * acrescenta botoes de link e publica. Nada e enviado ao canal antes do clique
 * em "Publicar": um anuncio publicado nao tem como ser desfeito, e a mensagem
 * ja fica lida por quem estava no canal.
 *
 * O canal e conferido AQUI, antes de o formulario abrir. Descobrir que o bot
 * nao pode escrever no canal depois de digitar o anuncio inteiro custaria o
 * texto — o modal nao guarda nada se o envio falhar.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('anunciar')
    .setDescription('Monta e publica um anuncio, com ou sem embed')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) => option
    .setName('canal')
    .setDescription('Canal onde o anuncio sera publicado (padrao: canal atual)')
    .addChannelTypes(discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement)
    .setRequired(false))
    .addBooleanOption((option) => option
    .setName('embed')
    .setDescription('Com embed (titulo, imagens, rodape) ou mensagem de texto simples')
    .setRequired(false));
async function execute(interaction) {
    (0, PermissionService_1.assertCanManageSystem)(interaction.member);
    const target = interaction.options.getChannel('canal') ?? interaction.channel;
    if (!(0, discord_1.isSendableTextChannel)(target)) {
        throw new errors_1.ValidationError('Canal invalido para anuncio.', {
            userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
        });
    }
    // Revalida existencia e permissoes do bot antes de abrir o formulario.
    await (0, AnnouncementService_1.resolveAnnouncementChannel)(interaction.guild, target.id);
    const draft = (0, AnnouncementDraftService_1.createDraft)({
        guildId: interaction.guildId,
        channelId: target.id,
        createdById: interaction.user.id,
        // Embed e o padrao: e o formato que o pedido descreve e o que a loja usa.
        withEmbed: interaction.options.getBoolean('embed') ?? true,
    });
    // `showModal` precisa ser a PRIMEIRA resposta da interacao — nada de defer.
    await interaction.showModal((0, AnnouncementBuilders_1.buildAnnouncementModal)(draft));
}
exports.anunciarCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=anunciar.js.map