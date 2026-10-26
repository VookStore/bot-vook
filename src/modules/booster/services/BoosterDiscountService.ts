import { OrderAuditAction } from '@prisma/client';
import type { GuildConfig } from '@prisma/client';
import type { GuildMember } from 'discord.js';

import { createLogger } from '../../../core/logger/Logger';
import { getPrisma } from '../../../core/database/prisma';
import { recordOrderAudit } from '../../catalog/repositories/CatalogAuditRepository';
import {
  updateOrderPricing,
  type OrderWithItems,
} from '../../catalog/repositories/OrderRepository';
import { priceOrder } from '../../catalog/services/OrderService';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';


/**
 * Desconto automatico de quem impulsiona o servidor.
 *
 * POR QUE EXISTE. O anuncio de booster promete 5% e 10% em canal publico, e ate
 * aqui esse abatimento dependia de um atendente lembrar de aplicar o cupom a
 * mao, em toda cobranca. Promessa publica com aplicacao manual falha em
 * silencio — e quem cobra a diferenca e o cliente, depois.
 *
 * O DESCONTO NAO E REIMPLEMENTADO AQUI. O que este modulo faz e ESCOLHER um
 * cupom; tipo, valor, teto, minimo e limite de uso continuam morando no cupom, e
 * a validacao continua sendo a do modulo central (`priceOrder` ->
 * `validateCouponForPayment`). Um caminho de desconto paralelo seria uma segunda
 * verdade sobre dinheiro, e a primeira divergencia apareceria numa cobranca.
 *
 * A EXCLUSAO E RESPEITADA ITEM A ITEM. O anuncio diz que nao vale para PEDs,
 * roupas e props. Como cupom nao sabe filtrar por categoria, a regra e "ou vale
 * para o pedido inteiro, ou nao se aplica nada": basta UM item de categoria nao
 * elegivel para a automacao ficar de fora e a equipe decidir manualmente.
 * Descontar mesmo assim seria a propria loja quebrando o que anunciou.
 *
 * NUNCA SOBRESCREVE A EQUIPE. Pedido que ja tem cupom fica como esta — inclusive
 * um cupom melhor que o de booster, aplicado a mao numa negociacao.
 */

const logger = createLogger('booster:discount');

/** Por que o desconto nao entrou. Cada motivo vira uma linha de log legivel. */
export type SkipReason =
  | 'desligado'
  | 'nao-e-booster'
  | 'ja-tem-cupom'
  | 'sem-itens'
  | 'categoria-excluida'
  | 'cupom-invalido';

export interface BoosterDiscountResult {
  applied: boolean;
  reason?: SkipReason;
  /** Preenchido quando aplicou: quanto foi abatido, em centavos. */
  discountAmount?: number;
  couponCode?: string;
}

/**
 * Cupom do degrau do membro, do mais alto para o mais baixo.
 *
 * O degrau 2 e conferido primeiro: quem tem os dois cargos merece o maior. O
 * Discord nao expoe QUANTOS boosts um membro tem — so se ele impulsiona — entao
 * o segundo degrau depende de um cargo que a equipe atribui, e nao de um numero
 * que daria para ler da API.
 */
export function boosterCouponFor(member: GuildMember, config: GuildConfig): string | null {
  if (
    config.boosterTier2RoleId !== null &&
    config.boosterTier2CouponId !== null &&
    member.roles.cache.has(config.boosterTier2RoleId)
  ) {
    return config.boosterTier2CouponId;
  }

  if (
    config.boosterRoleId !== null &&
    config.boosterCouponId !== null &&
    member.roles.cache.has(config.boosterRoleId)
  ) {
    return config.boosterCouponId;
  }

  return null;
}

/**
 * True quando TODOS os itens do pedido estao em categorias elegiveis.
 *
 * Uma consulta so, e ela pergunta o contrario do que parece: em vez de listar as
 * categorias elegiveis e conferir uma a uma, procura a existencia de UM pack nao
 * elegivel. Basta um para o pedido inteiro ficar de fora.
 */
export async function orderIsEligible(order: OrderWithItems): Promise<boolean> {
  // `packId` e obrigatorio no OrderItem, entao a lista so e vazia se o pedido
  // nao tiver item nenhum — o que ja e tratado por quem chama.
  const packIds = order.items.map((item) => item.packId);
  if (packIds.length === 0) return false;

  const excluded = await getPrisma().catalogPack.count({
    where: { id: { in: packIds }, category: { boosterEligible: false } },
  });

  return excluded === 0;
}

/**
 * Aplica o desconto de booster ao pedido recem-criado.
 *
 * MELHOR-ESFORCO E SILENCIOSO NO ERRO. Uma falha aqui nao pode impedir a compra:
 * o pedido segue com o preco cheio e a equipe aplica o cupom a mao, que era o
 * comportamento anterior. Derrubar o checkout por causa de um desconto seria
 * trocar uma venda com preco cheio por venda nenhuma.
 */
export async function applyBoosterDiscount(
  member: GuildMember,
  order: OrderWithItems,
): Promise<BoosterDiscountResult> {
  try {
    const config = await getGuildConfig(order.guildId);

    const couponId = boosterCouponFor(member, config);
    if (couponId === null) {
      const ligado = config.boosterRoleId !== null && config.boosterCouponId !== null;
      return { applied: false, reason: ligado ? 'nao-e-booster' : 'desligado' };
    }

    // A equipe manda: um cupom ja aplicado nunca e trocado por este.
    if (order.couponId !== null) return { applied: false, reason: 'ja-tem-cupom' };

    if (order.items.length === 0) return { applied: false, reason: 'sem-itens' };
    if (!(await orderIsEligible(order))) {
      return { applied: false, reason: 'categoria-excluida' };
    }

    /*
     * `priceOrder` roda a validacao central do cupom: vigencia, valor minimo,
     * limite global e por cliente. Se o cupom estiver vencido ou esgotado, ele
     * lanca — e o pedido segue com preco cheio, como se a automacao nao
     * existisse.
     */
    const pricing = await priceOrder(
      order.guildId,
      order.customerId,
      order.subtotalAmount,
      couponId,
    );

    if (!(await updateOrderPricing(order.id, pricing))) {
      // O pedido mudou de estado entre a criacao e aqui. Nao insiste.
      return { applied: false, reason: 'cupom-invalido' };
    }

    await recordOrderAudit({
      guildId: order.guildId,
      orderId: order.id,
      action: OrderAuditAction.ORDER_COUPON_APPLIED,
      // Sem autor: quem aplicou foi o sistema. Registrar o cliente ou um
      // atendente faria a auditoria mentir sobre quem decidiu.
      performedById: null,
      newValue: pricing.couponCodeSnapshot,
      metadata: {
        motivo: 'desconto automatico de booster',
        discountAmount: pricing.discountAmount,
        finalAmount: pricing.finalAmount,
      },
    });

    logger.info('Desconto de booster aplicado.', {
      guildId: order.guildId,
      entityType: 'order',
      entityId: order.id,
      discountAmount: pricing.discountAmount,
    });

    return {
      applied: true,
      discountAmount: pricing.discountAmount,
      ...(pricing.couponCodeSnapshot === null ? {} : { couponCode: pricing.couponCodeSnapshot }),
    };
  } catch (error) {
    logger.warn('Nao foi possivel aplicar o desconto de booster.', {
      guildId: order.guildId,
      entityType: 'order',
      entityId: order.id,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { applied: false, reason: 'cupom-invalido' };
  }
}
