"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.influencerButtons = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const customIds_1 = require("../../constants/customIds");
const env_1 = require("../../config/env");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const processingMessages = new Set();
function decisionRow(discordId, decision) {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.INFLUENCER, customIds_1.INFLUENCER_ACTION.APPROVE, discordId))
        .setLabel(decision === 'approved' ? 'Aprovado' : 'Aprovar')
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(true), new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.INFLUENCER, customIds_1.INFLUENCER_ACTION.REJECT, discordId))
        .setLabel(decision === 'rejected' ? 'Reprovado' : 'Reprovar')
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setDisabled(true));
}
function targetId(parsed) {
    const value = (0, customIds_1.requireArg)(parsed, 0, 'candidato');
    if (!DISCORD_SNOWFLAKE.test(value)) {
        throw new errors_1.ValidationError('Discord ID invalido em inscricao de creator.', {
            userMessage: 'Esta inscrição possui um ID do Discord inválido.',
            context: { customId: parsed.raw },
        });
    }
    return value;
}
async function assertCanReview(interaction) {
    if (!interaction.inCachedGuild()) {
        throw new errors_1.PermissionError('Decisao de influencer tentada fora da guild.', {
            userMessage: 'Esta ação só pode ser realizada no servidor da loja.',
        });
    }
    const configuredChannel = (0, env_1.getEnv)().INFLUENCER_APPROVAL_CHANNEL_ID;
    if (configuredChannel === null || interaction.channelId !== configuredChannel) {
        throw new errors_1.PermissionError('Decisao de influencer fora do canal configurado.', {
            userMessage: 'Este botão não pertence ao canal oficial de aprovações.',
            context: { channelId: interaction.channelId, guildId: interaction.guildId },
        });
    }
    await (0, PermissionService_1.assertCanManageOrders)(interaction.member);
    return interaction.member;
}
async function notifyCandidate(interaction, discordId, decision) {
    try {
        const user = await interaction.client.users.fetch(discordId);
        const dm = await user.createDM();
        const root = decision === 'approved'
            ? (0, reply_1.successContainer)('Sua inscrição para o programa de creators da Vook Store foi **aprovada**! A equipe entrará em contato para orientar os próximos passos.', { title: 'INSCRIÇÃO APROVADA', footer: 'Vook Store • Programa de creators' })
            : (0, reply_1.warningContainer)('Sua inscrição para o programa de creators da Vook Store foi analisada e **não foi aprovada neste momento**. Você poderá tentar novamente em uma futura seleção.', { title: 'RESULTADO DA INSCRIÇÃO', footer: 'Vook Store • Programa de creators' });
        await (0, reply_1.sendV2)(dm, root);
        return true;
    }
    catch {
        return false;
    }
}
async function decide(interaction, parsed, decision) {
    await assertCanReview(interaction);
    const discordId = targetId(parsed);
    if (processingMessages.has(interaction.message.id)) {
        await (0, reply_1.replyWarning)(interaction, 'Esta inscrição já está sendo processada por outra pessoa.');
        return;
    }
    processingMessages.add(interaction.message.id);
    try {
        await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
        const dmSent = await notifyCandidate(interaction, discordId, decision);
        const original = interaction.message.embeds[0];
        const label = decision === 'approved' ? 'APROVADA' : 'REPROVADA';
        const result = `**${label}** por <@${interaction.user.id}>\nDM ${dmSent ? 'enviada com sucesso' : 'não entregue'}.`;
        const embed = original === undefined ? new discord_js_1.EmbedBuilder() : discord_js_1.EmbedBuilder.from(original);
        embed
            .setColor(0xffffff)
            .addFields({ name: 'Resultado', value: result })
            .setFooter({
            text: `${original?.footer?.text ?? 'Inscrição de creator'} • ${label}`,
        });
        await interaction.message.edit({
            embeds: [embed],
            components: [decisionRow(discordId, decision)],
            allowedMentions: { parse: [] },
        });
        if (dmSent) {
            await (0, reply_1.replySuccess)(interaction, `Inscrição ${label.toLowerCase()} e candidato notificado por DM.`);
        }
        else {
            await (0, reply_1.replyWarning)(interaction, `Inscrição ${label.toLowerCase()}, mas o Discord bloqueou a DM. Avise o candidato por outro canal.`);
        }
    }
    finally {
        processingMessages.delete(interaction.message.id);
    }
}
const approveButton = {
    namespace: customIds_1.NAMESPACE.INFLUENCER,
    action: customIds_1.INFLUENCER_ACTION.APPROVE,
    async handle(interaction, parsed) {
        await decide(interaction, parsed, 'approved');
    },
};
const rejectButton = {
    namespace: customIds_1.NAMESPACE.INFLUENCER,
    action: customIds_1.INFLUENCER_ACTION.REJECT,
    async handle(interaction, parsed) {
        await decide(interaction, parsed, 'rejected');
    },
};
exports.influencerButtons = [approveButton, rejectButton];
//# sourceMappingURL=index.js.map