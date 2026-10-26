"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remindAbandonedCarts = remindAbandonedCarts;
const discord_js_1 = require("discord.js");
const limits_1 = require("../../../constants/limits");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const time_1 = require("../../../utils/time");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const CartBuilders_1 = require("../builders/CartBuilders");
const CartRepository_1 = require("../repositories/CartRepository");
const CartService_1 = require("./CartService");
/**
 * Lembrete de carrinho abandonado.
 *
 * O carrinho e persistente e vive no banco, entao o cliente sai do Discord
 * simplesmente esquecendo dele — e ninguem nunca cutucava. Este job manda UMA
 * DM depois de 24h de inatividade, o classico de e-commerce que mais converte.
 *
 * UMA VEZ SO, E SO ISSO. A trava e a coluna `abandonedNoticeAt`, gravada mesmo
 * quando a DM nao chega. Retentar seria transformar recuperacao de venda em
 * spam, e o custo do spam aqui nao e a irritacao: e o cliente bloquear as DMs
 * do bot, o que leva junto os avisos de cobranca, pagamento e entrega — que sao
 * os que ele realmente precisa receber.
 *
 * SO CARRINHO QUE VALE A PENA. Carrinho vazio nao entra (isso e o estado normal
 * de quem so abriu a vitrine), e carrinho cujos itens todos sairam do ar
 * tambem nao: o lembrete viraria uma promessa quebrada no primeiro clique.
 */
const logger = (0, Logger_1.createLogger)('cart:reminder');
/**
 * Envia o lembrete de um carrinho. `false` quando nao houve DM.
 *
 * Nao lanca por DM fechada nem por cliente que saiu do servidor: sao os dois
 * desfechos NORMAIS deste job, nao erros.
 */
async function remindOne(guild, customerId, storeName, catalogChannelId) {
    const view = await (0, CartService_1.getCartView)(guild.id, customerId);
    /*
     * Revalidacao contra o catalogo de AGORA. A consulta do job so sabe que o
     * carrinho tem linhas; se todas viraram indisponiveis desde entao, a DM seria
     * um convite para uma decepcao.
     */
    if (view.sellableCount === 0)
        return false;
    const member = await (0, discord_1.fetchMemberSafe)(guild, customerId).catch(() => null);
    if (member === null)
        return false;
    try {
        await member.user.send({
            components: [
                (0, CartBuilders_1.buildAbandonedCartDm)({ view, guildId: guild.id, catalogChannelId, storeName }),
            ],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
            allowedMentions: discord_1.NO_MENTIONS,
        });
        return true;
    }
    catch (error) {
        if ((0, discord_1.isDmBlockedError)(error) || (0, discord_1.isUnknownResourceError)(error))
            return false;
        throw error;
    }
}
/**
 * Varre os carrinhos parados e manda o lembrete.
 *
 * Devolve quantas DMs sairam de fato. A marcacao acontece para TODO carrinho
 * processado, inclusive os que nao renderam DM: um cliente com DM fechada
 * continuaria voltando na consulta a cada meia hora, para sempre.
 */
async function remindAbandonedCarts(client) {
    const corte = new Date(Date.now() - limits_1.CART_REMINDER.ABANDONED_AFTER_MS);
    const carrinhos = await (0, CartRepository_1.listAbandonedCarts)(corte, limits_1.CART_REMINDER.BATCH);
    if (carrinhos.length === 0)
        return 0;
    let enviados = 0;
    for (const cart of carrinhos) {
        const guild = client.guilds.cache.get(cart.guildId);
        if (guild === undefined) {
            /*
             * Bot fora da guild. Marcar aqui tambem: sem isso o carrinho orfao
             * voltaria em toda rodada, gastando consulta para sempre.
             */
            await (0, CartRepository_1.markAbandonedNoticeSent)(cart.id);
            continue;
        }
        try {
            const config = await (0, GuildConfigService_1.getGuildConfig)(cart.guildId);
            const enviou = await remindOne(guild, cart.customerId, config.storeName, config.catalogChannelId);
            if (enviou)
                enviados += 1;
        }
        catch (error) {
            // Uma falha inesperada num carrinho nao pode parar os outros.
            logger.warn('Falha ao lembrar carrinho abandonado.', {
                guildId: cart.guildId,
                entityType: 'cart',
                entityId: cart.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
        await (0, CartRepository_1.markAbandonedNoticeSent)(cart.id);
        // Respiro entre DMs: um lote inteiro em rajada bate no rate limit global.
        await (0, time_1.delay)(limits_1.CART_REMINDER.DM_SPACING_MS);
    }
    if (enviados > 0) {
        logger.info('Lembretes de carrinho abandonado enviados.', {
            enviados,
            processados: carrinhos.length,
        });
    }
    return enviados;
}
//# sourceMappingURL=CartReminderService.js.map