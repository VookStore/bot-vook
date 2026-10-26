import { ChannelType, MessageFlags, OverwriteType, PermissionFlagsBits } from 'discord.js';
import type { Guild, PermissionOverwriteOptions, TextChannel } from 'discord.js';
import type { GuildConfig, Ticket, TicketCategory } from '@prisma/client';

import { sendV2 } from '../../../components/reply';
import { createLogger } from '../../../core/logger/Logger';
import { NO_MENTIONS, fetchChannelSafe, isUnknownResourceError } from '../../../utils/discord';
import {
  getGuildConfig,
  updateGuildConfig,
} from '../../configuration/services/GuildConfigService';
import {
  buildDeliveredLocatorPanel,
  buildTicketLocatorPanel,
  isRecoverableRejoinError,
  type LocatedTicket,
} from '../builders/TicketLocatorBuilder';
import { setCategoryLocatorMessage } from '../repositories/TicketCategoryRepository';
import {
  listDeliveredOpenTickets,
  listOpenTicketsByOwnerAndCategory,
  listOwnersWithDeliveredOpenTickets,
  listUserIdsWithOpenTickets,
} from '../repositories/TicketRepository';
import {
  applyDestinationPermissions,
  grantDestinationAccess,
  isTicketThread,
  missingDestinationPermissions,
  reopenIfArchived,
  resolveDestinationChannel,
  resolveTicketChannel,
} from './TicketChannelService';
import {
  getEnabledCategories,
  getTeamRoleIds,
  invalidateCategories,
} from './TicketConfigService';
import { getQueueInfo } from './TicketQueueService';

/**
 * Painel "Localizar meu ticket" e a busca por tras dele.
 *
 * Com o ticket virando topico privado, o canal de destino deixou de ser uma
 * pasta e virou uma TELA: e nele que o cliente reencontra o proprio
 * atendimento. Publicar o painel e tambem o momento em que as permissoes do
 * canal sao acertadas — as duas coisas so fazem sentido juntas, e separa-las
 * deixaria o painel publicado num canal onde a equipe nao enxerga nada.
 */

const logger = createLogger('ticket:locator');

export interface LocatorPublishEntry {
  categoryName: string;
  channelId: string | null;
  published: boolean;
  /** Permissoes que faltam ao BOT, quando ele nao conseguiu ajustar sozinho. */
  missingPermissions: string[];
  /** Cargos de equipe configurados que ja nao existem. */
  missingRoles: string[];
  reason?: string;
}

/**
 * Publica (ou reescreve) o painel de cada categoria habilitada.
 *
 * REESCREVE em vez de reenviar: a mensagem anterior fica memorizada em
 * `locatorMessageId`, e sem isso cada republicacao empilharia mais uma copia do
 * mesmo painel no canal.
 *
 * Categoria sem destino nao e erro de sistema — e configuracao pendente, e sai
 * na lista para o administrador resolver.
 */
export async function publishLocatorPanels(guild: Guild): Promise<LocatorPublishEntry[]> {
  const config = await getGuildConfig(guild.id);
  const categories = await getEnabledCategories(guild.id);
  const entries: LocatorPublishEntry[] = [];

  for (const category of categories) {
    entries.push(await publishOne(guild, config, category));
  }

  // O canal de entregas entra no mesmo relatorio: e por aqui que o
  // administrador publica localizador, e ele precisa ver se este saiu.
  if (config.deliveredLocatorChannelId !== null) {
    entries.push(await publishDeliveredLocator(guild, config));
  }

  if (entries.some((entry) => entry.published)) invalidateCategories(guild.id);
  return entries;
}

async function publishOne(
  guild: Guild,
  config: Awaited<ReturnType<typeof getGuildConfig>>,
  category: TicketCategory,
): Promise<LocatorPublishEntry> {
  const base: LocatorPublishEntry = {
    categoryName: category.name,
    channelId: category.destinationChannelId,
    published: false,
    missingPermissions: [],
    missingRoles: [],
  };

  const channel = await resolveDestinationChannel(guild, category.destinationChannelId);
  if (channel === null) {
    return {
      ...base,
      reason:
        category.destinationChannelId === null
          ? 'sem canal de atendimento configurado'
          : 'o destino configurado nao e um canal de texto acessivel',
    };
  }

  // As permissoes vem PRIMEIRO: publicar num canal onde a equipe nao enxerga
  // topico seria publicar um painel que nao leva a lugar nenhum.
  const teamRoleIds = await getTeamRoleIds(category.id);
  const permissions = await applyDestinationPermissions(guild, channel, teamRoleIds);
  const missingPermissions = missingDestinationPermissions(guild, channel);

  if (missingPermissions.length > 0) {
    return {
      ...base,
      channelId: channel.id,
      missingPermissions,
      missingRoles: permissions.missingRoles,
      reason: permissions.applied
        ? 'o bot ajustou o que podia, mas ainda faltam permissoes'
        : 'o bot nao tem "Gerenciar Cargos" neste canal para se ajustar sozinho',
    };
  }

  /*
   * BACKFILL. O canal e oculto por padrao e o acesso e concedido na abertura do
   * ticket — mas quem ja estava em atendimento quando esta regra passou a valer
   * nunca recebeu o seu. Sem isto, publicar o painel esconderia a conversa de
   * quem esta no meio dela.
   */
  for (const userId of await listUserIdsWithOpenTickets(guild.id, category.id)) {
    await grantDestinationAccess(channel, userId, 'Atendimento aberto nesta categoria');
  }

  const panel = buildTicketLocatorPanel(config, category);

  if (category.locatorMessageId !== null) {
    try {
      const existing = await channel.messages.fetch(category.locatorMessageId);
      await existing.edit({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: NO_MENTIONS,
      });
      return {
        ...base,
        channelId: channel.id,
        published: true,
        missingRoles: permissions.missingRoles,
      };
    } catch (error) {
      // Mensagem apagada a mao: cai para o envio de uma nova, em vez de deixar
      // a categoria sem painel para sempre.
      if (!isUnknownResourceError(error)) throw error;
    }
  }

  const message = await sendV2(channel, panel);
  await setCategoryLocatorMessage(category.id, message.id);

  logger.info('Painel de localizar publicado.', {
    guildId: guild.id,
    channelId: channel.id,
    entityType: 'category',
    entityId: category.id,
  });

  return {
    ...base,
    channelId: channel.id,
    published: true,
    missingRoles: permissions.missingRoles,
  };
}

/**
 * Tickets abertos do cliente na categoria, ja readmitindo-o nos topicos.
 *
 * A READMISSAO E O PONTO. O modo de falha real nao e "perdi o link" — e "sai do
 * topico e nao consigo voltar", porque link de topico privado nao readmite
 * ninguem. Adicionar de volta e o que transforma este painel numa saida de
 * verdade em vez de uma lista bonita.
 *
 * Falha de readmissao nao derruba a tela: o cliente ainda ve a lista, e o link
 * funciona para quem nunca chegou a sair.
 */
export async function locateTickets(
  guild: Guild,
  ownerId: string,
  categoryId: string,
): Promise<LocatedTicket[]> {
  const tickets = await listOpenTicketsByOwnerAndCategory(guild.id, ownerId, categoryId);
  const located: LocatedTicket[] = [];
  for (const ticket of tickets) located.push(await locateOne(guild, ownerId, ticket));
  return located;
}

/**
 * Tickets ENTREGUES do cliente, de qualquer categoria — a busca do canal de
 * entregas. Mesma readmissao do localizador de categoria.
 */
export async function locateDeliveredTickets(
  guild: Guild,
  ownerId: string,
): Promise<LocatedTicket[]> {
  const tickets = await listDeliveredOpenTickets(guild.id, ownerId);
  const located: LocatedTicket[] = [];
  for (const ticket of tickets) located.push(await locateOne(guild, ownerId, ticket));
  return located;
}

/** Um ticket: confere se a conversa existe e readmite o cliente se ele saiu. */
async function locateOne(guild: Guild, ownerId: string, ticket: Ticket): Promise<LocatedTicket> {
  const channel = await resolveTicketChannel(guild, ticket.channelId);
  if (channel === null) {
    return { ticket, queuePosition: 0, reachable: false, rejoined: false };
  }

  let rejoined = false;
  if (isTicketThread(channel)) {
    try {
      const already = await channel.members.fetch(ownerId).catch(() => null);
      if (already === null) {
        /*
         * Topico de ticket ENTREGUE esta arquivado de proposito, e topico
         * arquivado nao aceita membro novo. Quem volta e porque vai interagir
         * — reabrir aqui e o que o clique pede.
         */
        await reopenIfArchived(channel, `Retorno ao ticket #${ticket.ticketNumber}`);

        /*
         * Reconfirma o acesso ao canal-pai ANTES de readmitir.
         *
         * O gateway so entrega eventos de topico a quem enxerga o pai. Se o
         * overwrite tiver se perdido (canal recriado, permissao revogada a
         * mao), readmitir sozinho devolveria a pessoa ao topico sem ela ver
         * nada aparecer — que e exatamente a queixa que este painel existe
         * para resolver.
         */
        const parent = channel.parent;
        if (parent !== null && parent.type === ChannelType.GuildText) {
          await grantDestinationAccess(
            parent,
            ownerId,
            `Retorno ao ticket #${ticket.ticketNumber}`,
          ).catch(() => false);
        }

        // Sem `reason`: o Discord nao registra motivo em entrada de topico.
        await channel.members.add(ownerId);
        rejoined = true;
      }
    } catch (error) {
      if (!isRecoverableRejoinError(error) && !isUnknownResourceError(error)) throw error;
      logger.warn('Nao foi possivel readicionar o cliente ao topico.', {
        guildId: guild.id,
        userId: ownerId,
        entityType: 'ticket',
        entityId: ticket.id,
      });
    }
  }

  const queue = await getQueueInfo(ticket);
  return { ticket, queuePosition: queue.position, reachable: true, rejoined };
}

// ---------------------------------------------------------------------------
// Canal de entregas
// ---------------------------------------------------------------------------

/**
 * O canal do CLIENTE e o canal dos cartoes da EQUIPE nunca podem ser o mesmo.
 *
 * Os cartoes de ticket entregue mostram cliente, pedido e atendente de cada
 * venda. No mesmo canal, cada cliente com acesso veria as vendas dos outros.
 * A recusa vale aqui, no momento de dar acesso — e nao so no comando de
 * configuracao —, porque e aqui que o vazamento aconteceria.
 */
function sharesStaffChannel(config: GuildConfig): boolean {
  return (
    config.deliveredLocatorChannelId !== null &&
    config.deliveredLocatorChannelId === config.ticketDoneChannelId
  );
}

/**
 * O que o cliente pode no canal de entregas: ver o painel e clicar. Nada mais.
 *
 * O "nao escrever" e explicito de proposito. Sem ele o cliente herdaria o
 * "enviar mensagens" do @everyone do servidor, e o canal de entregas viraria
 * um chat onde um cliente le o outro.
 */
const DELIVERED_CLIENT_OVERWRITE: PermissionOverwriteOptions = {
  ViewChannel: true,
  ReadMessageHistory: true,
  SendMessages: false,
  AddReactions: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  SendMessagesInThreads: false,
};

/** Permissoes do BOT no canal de entregas, com o nome que o administrador ve. */
const DELIVERED_BOT_PERMISSIONS: ReadonlyArray<readonly [bigint, string]> = [
  [PermissionFlagsBits.ViewChannel, 'Ver canal'],
  [PermissionFlagsBits.SendMessages, 'Enviar mensagens'],
  [PermissionFlagsBits.ReadMessageHistory, 'Ver histórico de mensagens'],
  // Sem isto o bot nao consegue dar (nem tirar) o acesso de cada cliente.
  [PermissionFlagsBits.ManageRoles, 'Gerenciar cargos'],
];

async function resolveDeliveredChannel(
  guild: Guild,
  config: GuildConfig,
): Promise<TextChannel | null> {
  const channel = await fetchChannelSafe(guild, config.deliveredLocatorChannelId);
  return channel !== null && channel.type === ChannelType.GuildText ? channel : null;
}

/**
 * Publica (ou reescreve) o painel do canal de entregas.
 *
 * Volta como mais uma linha do relatorio de `/ticket-painel localizadores`: e
 * por la que os localizadores sao publicados, e um painel que saisse por outro
 * caminho deixaria o administrador sem saber se ele existe.
 */
export async function publishDeliveredLocator(
  guild: Guild,
  config: GuildConfig,
): Promise<LocatorPublishEntry> {
  const base: LocatorPublishEntry = {
    categoryName: 'Entregas',
    channelId: config.deliveredLocatorChannelId,
    published: false,
    missingPermissions: [],
    missingRoles: [],
  };

  if (sharesStaffChannel(config)) {
    return {
      ...base,
      reason:
        'é o mesmo canal dos cartões da equipe — cada cliente veria as vendas dos outros. ' +
        'Aponte os dois para canais diferentes em `/demandas canais`',
    };
  }

  const channel = await resolveDeliveredChannel(guild, config);
  if (channel === null) {
    return { ...base, reason: 'o canal configurado não é um canal de texto acessível' };
  }

  const me = guild.members.me;
  const permissions = me === null ? null : channel.permissionsFor(me);
  const missingPermissions = DELIVERED_BOT_PERMISSIONS.filter(
    ([flag]) => permissions === null || !permissions.has(flag),
  ).map(([, label]) => label);

  if (missingPermissions.length > 0) {
    return {
      ...base,
      channelId: channel.id,
      missingPermissions,
      reason: 'faltam permissões ao bot neste canal',
    };
  }

  /*
   * BACKFILL. O acesso e dado na entrega — mas quem recebeu antes de o canal
   * existir nunca ganhou o seu. Sem isto o painel nasceria invisivel para
   * exatamente quem tem entrega esperando.
   */
  for (const userId of await listOwnersWithDeliveredOpenTickets(guild.id)) {
    await grantDeliveredLocatorAccess(guild, userId);
  }

  const panel = buildDeliveredLocatorPanel(config);

  if (config.deliveredLocatorMessageId !== null) {
    try {
      const existing = await channel.messages.fetch(config.deliveredLocatorMessageId);
      await existing.edit({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: NO_MENTIONS,
      });
      return { ...base, channelId: channel.id, published: true };
    } catch (error) {
      // Mensagem apagada a mao: cai para o envio de uma nova.
      if (!isUnknownResourceError(error)) throw error;
    }
  }

  const message = await sendV2(channel, panel);
  await updateGuildConfig(guild.id, { deliveredLocatorMessageId: message.id });

  logger.info('Painel de entregas publicado.', { guildId: guild.id, channelId: channel.id });

  return { ...base, channelId: channel.id, published: true };
}

/**
 * Da ao cliente acesso ao canal de entregas. Chamado na entrega.
 *
 * NUNCA LANCA: o produto ja foi entregue quando isto roda, e o cliente ainda
 * tem a DM e o link do proprio ticket.
 */
export async function grantDeliveredLocatorAccess(guild: Guild, userId: string): Promise<boolean> {
  try {
    const config = await getGuildConfig(guild.id);
    if (config.deliveredLocatorChannelId === null) return false;

    if (sharesStaffChannel(config)) {
      logger.warn('Canal de entregas e o mesmo dos cartoes da equipe: acesso NAO concedido.', {
        guildId: guild.id,
        channelId: config.deliveredLocatorChannelId,
        userId,
      });
      return false;
    }

    const channel = await resolveDeliveredChannel(guild, config);
    if (channel === null) return false;

    /*
     * `type: Member` e obrigatorio aqui. Sem ele o discord.js procura o id no
     * cache de usuarios para descobrir se e membro ou cargo — e o dono do
     * ticket nem sempre esta em cache. A busca falhava com "User nor a Role",
     * o `catch` abaixo virava WARN, e o cliente ficava sem acesso ao canal sem
     * ninguem saber.
     */
    await channel.permissionOverwrites.edit(userId, DELIVERED_CLIENT_OVERWRITE, {
      reason: 'Entrega aguardando a confirmacao do cliente',
      type: OverwriteType.Member,
    });
    return true;
  } catch (error) {
    logger.warn('Nao foi possivel dar acesso ao canal de entregas.', {
      guildId: guild.id,
      userId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Tira o acesso ao canal de entregas, se nao restar entrega pendente.
 *
 * Chamado no fechamento de um ticket entregue. Quem tem OUTRA entrega
 * esperando continua vendo o canal — o painel ainda leva a ela.
 *
 * NUNCA LANCA: o ticket ja fechou no banco quando isto roda.
 */
export async function revokeDeliveredLocatorAccess(
  guild: Guild,
  userId: string,
  closedTicketId: string,
): Promise<void> {
  try {
    const config = await getGuildConfig(guild.id);
    const channel = await resolveDeliveredChannel(guild, config);
    if (channel === null) return;

    const pendentes = await listDeliveredOpenTickets(guild.id, userId, closedTicketId);
    if (pendentes.length > 0) return;

    await channel.permissionOverwrites.delete(userId, 'Nenhuma entrega aguardando confirmacao');
  } catch (error) {
    if (isUnknownResourceError(error)) return;
    logger.warn('Nao foi possivel tirar o acesso ao canal de entregas.', {
      guildId: guild.id,
      userId,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Reexportado para o handler nao precisar conhecer o builder. */
export type { LocatedTicket };
