import type { Guild } from 'discord.js';

import { createLogger } from '../../../core/logger/Logger';
import { hasOpenTicketAccess } from '../repositories/TicketRepository';
import {
  grantDestinationAccess,
  resolveDestinationChannel,
  revokeDestinationAccess,
} from './TicketChannelService';
import { getCategoryById } from './TicketConfigService';

/**
 * Acesso ao canal de atendimento da categoria.
 *
 * O canal (ex.: `#duvidas`) e OCULTO por padrao: quem nao tem atendimento
 * aberto nao o ve na lista de canais. Quem entra num ticket ganha acesso, e
 * perde quando o ultimo atendimento dele naquela categoria termina.
 *
 * POR QUE O ACESSO AO PAI E OBRIGATORIO. Ser membro do topico privado nao
 * basta: sem `ViewChannel` no canal-pai o Discord nao mostra a conversa nem
 * para quem foi adicionado a ela. Entao toda entrada em ticket concede as duas
 * coisas, e toda saida so retira a segunda quando nao ha mais nada a enxergar.
 *
 * NADA AQUI DERRUBA A OPERACAO. Uma falha de permissao vira warning: e melhor
 * um ticket criado com o canal invisivel (consertavel com um clique no painel
 * de localizar) do que uma abertura recusada por causa de um overwrite.
 */

const logger = createLogger('ticket:access');

/** Canal de destino da categoria; null quando nao configurado ou inacessivel. */
async function destinationFor(guild: Guild, categoryId: string) {
  const category = await getCategoryById(guild.id, categoryId);
  if (category === null) return null;
  return resolveDestinationChannel(guild, category.destinationChannelId);
}

/** Concede acesso ao canal da categoria (dono ou participante adicional). */
export async function grantCategoryAccess(
  guild: Guild,
  categoryId: string,
  userId: string,
  reason: string,
): Promise<void> {
  try {
    const channel = await destinationFor(guild, categoryId);
    if (channel === null) return;
    await grantDestinationAccess(channel, userId, reason);
  } catch (error) {
    logger.warn('Falha ao conceder acesso ao canal de atendimento.', {
      guildId: guild.id,
      userId,
      entityType: 'category',
      entityId: categoryId,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Retira o acesso — mas SO se nao houver mais nenhum atendimento aberto dessa
 * pessoa na categoria.
 *
 * `exceptTicketId` e o ticket que esta sendo encerrado agora: ele ainda pode
 * constar como aberto no banco no instante desta checagem, e contaria a favor
 * de si mesmo.
 */
export async function revokeCategoryAccessIfLast(
  guild: Guild,
  categoryId: string,
  userId: string,
  exceptTicketId: string | null,
  reason: string,
): Promise<void> {
  try {
    if (await hasOpenTicketAccess(guild.id, categoryId, userId, exceptTicketId)) return;

    const channel = await destinationFor(guild, categoryId);
    if (channel === null) return;
    await revokeDestinationAccess(channel, userId, reason);
  } catch (error) {
    logger.warn('Falha ao retirar acesso ao canal de atendimento.', {
      guildId: guild.id,
      userId,
      entityType: 'category',
      entityId: categoryId,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
