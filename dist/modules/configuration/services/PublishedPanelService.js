"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishBoundPanel = publishBoundPanel;
exports.refreshBoundPanel = refreshBoundPanel;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../../components/reply");
const LockService_1 = require("../../../core/locks/LockService");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("./GuildConfigService");
/**
 * Paineis fixos publicados num canal e reescritos no lugar.
 *
 * A tabela de precos e o anuncio de booster fazem a mesma coisa: publicam UMA
 * mensagem, guardam (canal, mensagem) na configuracao e depois EDITAM essa
 * mensagem quando o conteudo muda. Isto aqui e essa mecanica, uma vez so.
 *
 * POR QUE EDITAR E NAO REPUBLICAR. Sao mensagens que declaram compromisso —
 * preco e beneficio. Publicar uma segunda versao deixaria a antiga visivel
 * acima dela, e nao ha como saber qual o cliente leu; num canal desses, a
 * versao velha e uma promessa que a loja nao quer cumprir.
 *
 * O QUE ESTE MODULO NAO SABE. Ele nao conhece preco, booster nem nada do
 * conteudo: recebe uma funcao que desenha e duas funcoes que leem e escrevem as
 * colunas certas. E por isso que ligar um painel novo custa um `PanelBinding` e
 * nao outra copia deste arquivo.
 */
const logger = (0, Logger_1.createLogger)('config:panel');
/** Apaga a mensagem publicada anteriormente, se ainda existir. */
async function removePublishedMessage(guild, binding) {
    const { channelId, messageId } = binding.read(await (0, GuildConfigService_1.getGuildConfig)(guild.id));
    if (channelId === null || messageId === null)
        return false;
    const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
    if (!(0, discord_1.isSendableTextChannel)(channel))
        return false;
    try {
        const message = await channel.messages.fetch(messageId);
        await message.delete();
        return true;
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return false;
        throw error;
    }
}
/**
 * Publica o painel num canal e memoriza a mensagem.
 *
 * Apaga a anterior antes: sem isso, republicar em outro canal deixaria duas
 * versoes vivas no servidor, cada uma dizendo uma coisa.
 */
async function publishBoundPanel(guild, channel, binding, render) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PANEL_UPDATE, `${guild.id}:${binding.name}`, async () => {
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        const content = render(config);
        await removePublishedMessage(guild, binding).catch(() => undefined);
        const message = await (0, reply_1.sendV2)(channel, content.root, {
            ...(content.files !== undefined ? { files: content.files } : {}),
        });
        await (0, GuildConfigService_1.updateGuildConfig)(guild.id, binding.write(channel.id, message.id));
        logger.info('Painel publicado.', {
            guildId: guild.id,
            channelId: channel.id,
            entityType: 'message',
            entityId: message.id,
            panel: binding.name,
        });
        return message;
    });
}
/**
 * Reescreve o painel ja publicado.
 *
 * NUNCA publica um novo. Se a mensagem sumiu, devolve o motivo e deixa a
 * decisao com quem chamou: republicar sozinho poderia jogar o painel num canal
 * que a equipe tinha esvaziado de proposito.
 */
async function refreshBoundPanel(guild, binding, render) {
    return LockService_1.locks.withLock(LockService_1.LOCK_NAMESPACE.PANEL_UPDATE, `${guild.id}:${binding.name}`, async () => {
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        const { channelId, messageId } = binding.read(config);
        if (channelId === null || messageId === null) {
            return { updated: false, reason: `${binding.name} ainda nao foi publicado.` };
        }
        const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
        if (!(0, discord_1.isSendableTextChannel)(channel)) {
            return {
                updated: false,
                reason: 'O canal do painel nao existe mais ou o bot perdeu acesso a ele.',
            };
        }
        const content = render(config);
        try {
            const message = await channel.messages.fetch(messageId);
            await message.edit({
                components: [content.root],
                flags: discord_js_1.MessageFlags.IsComponentsV2,
                allowedMentions: discord_1.NO_MENTIONS,
                // Reenviado sempre: `edit` substitui a lista de anexos, e omitir aqui
                // apagaria a imagem que o painel referencia por `attachment://`.
                ...(content.files !== undefined ? { files: [...content.files] } : {}),
            });
            logger.info('Painel atualizado.', {
                guildId: guild.id,
                channelId: channel.id,
                entityType: 'message',
                entityId: message.id,
                panel: binding.name,
            });
            return { updated: true };
        }
        catch (error) {
            if ((0, discord_1.isUnknownResourceError)(error)) {
                return {
                    updated: false,
                    reason: 'A mensagem do painel foi apagada. Publique novamente.',
                };
            }
            throw error;
        }
    });
}
//# sourceMappingURL=PublishedPanelService.js.map