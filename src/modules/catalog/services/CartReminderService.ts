import { MessageFlags } from 'discord.js';
import type { Client, Guild } from 'discord.js';

import { CART_REMINDER } from '../../../constants/limits';
import { createLogger } from '../../../core/logger/Logger';
import {
  NO_MENTIONS,
  fetchMemberSafe,
  isDmBlockedError,
  isUnknownResourceError,
} from '../../../utils/discord';
import { delay } from '../../../utils/time';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';
import { buildAbandonedCartDm } from '../builders/CartBuilders';
import { listAbandonedCarts, markAbandonedNoticeSent } from '../repositories/CartRepository';
import { getCartView } from './CartService';

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

const logger = createLogger('cart:reminder');

/**
 * Envia o lembrete de um carrinho. `false` quando nao houve DM.
 *
 * Nao lanca por DM fechada nem por cliente que saiu do servidor: sao os dois
 * desfechos NORMAIS deste job, nao erros.
 */
async function remindOne(
  guild: Guild,
  customerId: string,
  storeName: string,
  catalogChannelId: string | null,
): Promise<boolean> {
  const view = await getCartView(guild.id, customerId);

  /*
   * Revalidacao contra o catalogo de AGORA. A consulta do job so sabe que o
   * carrinho tem linhas; se todas viraram indisponiveis desde entao, a DM seria
   * um convite para uma decepcao.
   */
  if (view.sellableCount === 0) return false;

  const member = await fetchMemberSafe(guild, customerId).catch(() => null);
  if (member === null) return false;

  try {
    await member.user.send({
      components: [
        buildAbandonedCartDm({ view, guildId: guild.id, catalogChannelId, storeName }),
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS,
    });
    return true;
  } catch (error) {
    if (isDmBlockedError(error) || isUnknownResourceError(error)) return false;
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
export async function remindAbandonedCarts(client: Client): Promise<number> {
  const corte = new Date(Date.now() - CART_REMINDER.ABANDONED_AFTER_MS);
  const carrinhos = await listAbandonedCarts(corte, CART_REMINDER.BATCH);
  if (carrinhos.length === 0) return 0;

  let enviados = 0;

  for (const cart of carrinhos) {
    const guild = client.guilds.cache.get(cart.guildId);
    if (guild === undefined) {
      /*
       * Bot fora da guild. Marcar aqui tambem: sem isso o carrinho orfao
       * voltaria em toda rodada, gastando consulta para sempre.
       */
      await markAbandonedNoticeSent(cart.id);
      continue;
    }

    try {
      const config = await getGuildConfig(cart.guildId);
      const enviou = await remindOne(
        guild,
        cart.customerId,
        config.storeName,
        config.catalogChannelId,
      );
      if (enviou) enviados += 1;
    } catch (error) {
      // Uma falha inesperada num carrinho nao pode parar os outros.
      logger.warn('Falha ao lembrar carrinho abandonado.', {
        guildId: cart.guildId,
        entityType: 'cart',
        entityId: cart.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    await markAbandonedNoticeSent(cart.id);

    // Respiro entre DMs: um lote inteiro em rajada bate no rate limit global.
    await delay(CART_REMINDER.DM_SPACING_MS);
  }

  if (enviados > 0) {
    logger.info('Lembretes de carrinho abandonado enviados.', {
      enviados,
      processados: carrinhos.length,
    });
  }

  return enviados;
}
