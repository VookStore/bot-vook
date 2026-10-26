"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wolfModals = exports.wolfButtons = void 0;
const reply_1 = require("../../components/reply");
const customIds_1 = require("../../constants/customIds");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const discord_1 = require("../../utils/discord");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
const WolfBuilders_1 = require("../../modules/wolves/builders/WolfBuilders");
const WolfPortfolioService_1 = require("../../modules/wolves/services/WolfPortfolioService");
const render_1 = require("../../modules/wolves/validators/render");
const AssetHostingService_1 = require("../../modules/hosting/AssetHostingService");
const shared_1 = require("../catalog/shared");
/**
 * Painel de lobos: botao -> formulario -> post no portfolio.
 *
 * A permissao e conferida nos DOIS passos. O botao confere para nao abrir um
 * formulario inutil; o envio confere de novo porque e outra interacao — entre
 * abrir e enviar, o cargo pode ter sido retirado, e o customId nunca autoriza
 * nada.
 */
/** Texto de um campo; ausente e vazio significam a mesma coisa. */
function readText(interaction, customId) {
    try {
        return interaction.fields.getTextInputValue(customId);
    }
    catch {
        // Campo opcional nao preenchido pode nem chegar no payload.
        return '';
    }
}
const createButton = {
    namespace: customIds_1.NAMESPACE.WOLF,
    action: customIds_1.WOLF_ACTION.CREATE,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanPublishWolfPortfolio)(member);
        /*
         * O destino e conferido ANTES do formulario.
         *
         * O modal nao guarda nada se o envio falhar. Descobrir que o portfolio
         * sumiu (ou perdeu a permissao de anexo) depois de digitar tudo e anexar o
         * render custaria o formulario inteiro.
         */
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await (0, WolfPortfolioService_1.resolvePortfolioChannel)(guild, config.wolfPortfolioChannelId);
        // `showModal` precisa ser a PRIMEIRA resposta da interacao — nada de defer.
        // O teto no formulario e o que o BOT consegue reenviar neste servidor (nivel
        // de impulsos) — nunca o `attachmentSizeLimit` da interacao, que inclui o
        // Nitro de quem clicou (ver `guildUploadLimit`).
        await interaction.showModal((0, WolfBuilders_1.buildWolfModal)((0, render_1.effectiveRenderLimit)(guild, (0, AssetHostingService_1.isAssetHostingEnabled)())));
    },
};
const createModal = {
    namespace: customIds_1.NAMESPACE.WOLF,
    action: customIds_1.WOLF_ACTION.CREATE_MODAL,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        await (0, PermissionService_1.assertCanPublishWolfPortfolio)(member);
        // Valida ANTES do defer: erro de preenchimento responde direto, sem a
        // mensagem "pensando..." que o defer deixaria na tela.
        const submission = (0, WolfBuilders_1.readWolfSubmission)({
            customer: readText(interaction, WolfBuilders_1.WOLF_FIELD.CUSTOMER),
            kind: interaction.fields.getStringSelectValues(WolfBuilders_1.WOLF_FIELD.KIND)[0],
            personalization: readText(interaction, WolfBuilders_1.WOLF_FIELD.PERSONALIZATION),
            additional: readText(interaction, WolfBuilders_1.WOLF_FIELD.ADDITIONAL),
        });
        const file = interaction.fields.getUploadedFiles(WolfBuilders_1.WOLF_FIELD.RENDER)?.first();
        if (file === undefined) {
            throw new errors_1.ValidationError('Formulario de lobo sem render.', {
                userMessage: 'Anexe o render do lobo e envie de novo.',
            });
        }
        // Download + reenvio do render passam facil dos 3 segundos da interacao —
        // com 100 MB, podem levar minutos. O defer segura a resposta por ate 15.
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const message = await (0, WolfPortfolioService_1.publishWolfPost)({
            guild,
            actorId: member.id,
            submission,
            render: {
                url: file.url,
                name: file.name,
                contentType: file.contentType,
                size: file.size,
            },
            maxRenderBytes: (0, render_1.effectiveRenderLimit)(guild, (0, AssetHostingService_1.isAssetHostingEnabled)()),
        });
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)(`Lobo publicado no portfólio: ${(0, discord_1.messageUrl)(guild.id, message.channelId, message.id)}`, { footer: 'Errou algo? Apague a mensagem no canal e publique de novo pelo painel.' }));
    },
};
exports.wolfButtons = [createButton];
exports.wolfModals = [createModal];
//# sourceMappingURL=index.js.map