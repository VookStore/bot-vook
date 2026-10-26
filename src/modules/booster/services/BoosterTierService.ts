import { MessageType } from 'discord.js';
import type { GuildMember, Message } from 'discord.js';

import { createLogger } from '../../../core/logger/Logger';
import { canBotAssignRole } from '../../../core/permissions/PermissionService';
import { isMissingAccessError, isUnknownResourceError } from '../../../utils/discord';
import { getGuildConfig } from '../../configuration/services/GuildConfigService';

/**
 * Cargo automatico de quem impulsiona o servidor mais de uma vez.
 *
 * O PROBLEMA. A API do Discord NAO diz quantos boosts um membro tem. O objeto de
 * membro carrega apenas `premium_since` — um instante, que responde "esta
 * impulsionando?" e nao "quantas vezes?". Nao existe rota, campo nem intent que
 * devolva essa contagem; foi conferido nos tipos da versao instalada.
 *
 * O CAMINHO QUE EXISTE. A cada boost o Discord publica uma MENSAGEM DE SISTEMA
 * no canal de sistema (tipos 8 a 11), e o numero de boosts daquela pessoa vai no
 * `content` dessa mensagem — e dali que o proprio cliente tira o "impulsionou o
 * servidor 2 vezes". Lendo essa mensagem, da para saber a contagem no unico
 * momento em que ela e publicada.
 *
 * DUAS LIMITACOES QUE VEM DE BRINDE, e nao ha como contornar:
 *
 *  1. So funciona NO MOMENTO do boost. Quem ja tinha 2 boosts antes disto
 *     existir nao dispara nada — precisa de uma passada manual, uma vez.
 *  2. Cair de 2 para 1 boost e INVISIVEL: o Discord nao anuncia redução. Da para
 *     detectar apenas quem parou de impulsionar por completo, e e o que
 *     `handleBoostLost` faz.
 *
 * Nenhuma falha aqui derruba nada: cargo e reconhecimento, nao operacao.
 */

const logger = createLogger('booster:tier');

/** Mensagens de sistema publicadas quando alguem impulsiona. */
const BOOST_MESSAGE_TYPES: readonly MessageType[] = [
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
];

/** A partir de quantos boosts o cargo do degrau 2 e concedido. */
export const TIER_2_THRESHOLD = 2;

/** True quando a mensagem e um anuncio de boost. */
export function isBoostMessage(message: Message): boolean {
  return BOOST_MESSAGE_TYPES.includes(message.type);
}

/**
 * Quantos boosts a pessoa tem, segundo a mensagem de sistema.
 *
 * O `content` traz o numero a partir do SEGUNDO boost; no primeiro ele vem
 * vazio. Por isso a ausencia vale 1, e nao 0 — "impulsionou e nao disse quantas
 * vezes" significa exatamente uma.
 */
export function boostCountFromMessage(message: Message): number {
  /*
   * `content` e tipado como `string` pela discord.js, mas isto roda dentro de um
   * listener de `messageCreate`: uma excecao aqui derruba o tratamento do
   * evento e, desde os alertas, ainda publica um erro no canal. Nao vale
   * arriscar por um campo que so precisa virar um numero.
   */
  const raw = typeof message.content === 'string' ? message.content : '';
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** Concede o cargo, silenciando o que for esperado. */
async function grantRole(member: GuildMember, roleId: string, reason: string): Promise<boolean> {
  if (member.roles.cache.has(roleId)) return false;

  const botMember = member.guild.members.me;
  if (botMember === null) return false;

  const check = canBotAssignRole(botMember, roleId);
  if (!check.ok) {
    logger.warn('Nao foi possivel conceder o cargo de degrau 2.', {
      guildId: member.guild.id,
      userId: member.id,
      entityType: 'role',
      entityId: roleId,
      detail: check.reason,
    });
    return false;
  }

  try {
    await member.roles.add(roleId, reason);
    return true;
  } catch (error) {
    if (!isUnknownResourceError(error) && !isMissingAccessError(error)) throw error;
    return false;
  }
}

/**
 * Reage ao anuncio de boost, concedendo o cargo do degrau 2 quando cabe.
 *
 * Devolve `true` quando o cargo foi de fato adicionado.
 */
export async function handleBoostMessage(message: Message): Promise<boolean> {
  if (!isBoostMessage(message) || message.guild === null) return false;

  const boosts = boostCountFromMessage(message);

  /*
   * TODA mensagem de boost e registrada, mesmo a que nao concede nada.
   *
   * A contagem sai do `content` da mensagem de sistema — a unica fonte que o
   * Discord expoe, ja que a API nao informa quantos boosts um membro tem. Se
   * esse formato mudar, ou se vier vazio, a leitura cai em 1 e NADA acontece:
   * sem esta linha, a diferenca entre "ninguem deu 2 boosts" e "o bot nao sabe
   * mais contar" seria invisivel. O `content` cru vai junto de proposito, para
   * o diagnostico caber numa linha de log.
   */
  logger.info('Mensagem de boost recebida.', {
    guildId: message.guild.id,
    userId: message.author.id,
    boosts,
    conteudoCru: typeof message.content === 'string' ? message.content.slice(0, 40) : null,
    tipo: message.type,
  });

  const config = await getGuildConfig(message.guild.id);
  const roleId = config.boosterTier2RoleId;
  if (roleId === null) return false;

  if (boosts < TIER_2_THRESHOLD) return false;

  /*
   * `message.member` pode vir vazio numa mensagem de sistema recebida por
   * gateway com o cache frio; o fetch e a garantia de ter o membro com os
   * cargos para conferir e alterar.
   *
   * Quem impulsionou e saiu em seguida faz o fetch falhar. Isso NAO e uma falha
   * operacional — e um desfecho normal — entao vira `null` em vez de subir e
   * virar alerta no canal de erros.
   */
  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));

  if (member === null) {
    logger.warn('Quem impulsionou nao esta mais no servidor; cargo nao concedido.', {
      guildId: message.guild.id,
      userId: message.author.id,
    });
    return false;
  }

  const granted = await grantRole(
    member,
    roleId,
    `Impulsionou o servidor ${boosts} vezes`,
  );

  if (granted) {
    logger.info('Cargo de degrau 2 concedido.', {
      guildId: message.guild.id,
      userId: member.id,
      entityType: 'role',
      entityId: roleId,
      boosts,
    });
  }

  return granted;
}

/**
 * Retira o cargo de quem PAROU de impulsionar.
 *
 * So o abandono completo e detectavel — `premium_since` deixa de existir. Quem
 * cai de 2 para 1 boost continua com `premium_since` preenchido e mantem o
 * cargo indevidamente; nao ha sinal nenhum dessa queda na API, e inventar um
 * (por exemplo, retirar de todo mundo periodicamente) puniria tambem quem
 * continua com dois.
 */
export async function handleBoostLost(
  before: GuildMember,
  after: GuildMember,
): Promise<boolean> {
  if (before.premiumSince === null || after.premiumSince !== null) return false;

  const config = await getGuildConfig(after.guild.id);
  const roleId = config.boosterTier2RoleId;
  if (roleId === null || !after.roles.cache.has(roleId)) return false;

  try {
    await after.roles.remove(roleId, 'Parou de impulsionar o servidor');
    logger.info('Cargo de degrau 2 removido.', {
      guildId: after.guild.id,
      userId: after.id,
      entityType: 'role',
      entityId: roleId,
    });
    return true;
  } catch (error) {
    if (!isUnknownResourceError(error) && !isMissingAccessError(error)) throw error;
    return false;
  }
}
