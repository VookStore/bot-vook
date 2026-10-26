import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import {
  deferIfNeeded,
  editReplyV2,
  successContainer,
  warningContainer,
} from '../../components/reply';
import { ValidationError } from '../../core/errors';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { channelMention, isSendableTextChannel } from '../../utils/discord';
import { listDemandsWithoutCard } from '../../modules/catalog/repositories/OrderRepository';
import { getGuildConfig, updateGuildConfig } from '../../modules/configuration/services/GuildConfigService';
import { publishDemand } from '../../modules/demands/services/DemandBoardService';
import { publishDeliveredLocator } from '../../modules/tickets/services/TicketLocatorService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * /demandas canais | sincronizar
 *
 * Configuracao do quadro de demandas. Quem OPERA uma demanda e a equipe, pelos
 * botoes do cartao; este comando so decide onde os cartoes saem — e por isso
 * exige administracao.
 *
 * POR QUE COMANDO PROPRIO, e nao mais dois selects em `/ticket-config geral`:
 * o painel de canais de la ja usa as cinco linhas que uma mensagem do Discord
 * aceita (quatro selects e a volta). Acrescentar canal ali exigiria paginar o
 * painel inteiro — muito mais risco do que um comando de administrador.
 */

/** Teto de cartoes publicados por `sincronizar`, para nao bater no rate limit. */
const SYNC_LIMIT = 20;

const builder = new SlashCommandBuilder()
  .setName('demandas')
  .setDescription('Quadro de demandas: canais e sincronizacao')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('canais')
      .setDescription('Define onde os cartoes de demanda sao publicados')
      .addChannelOption((option) =>
        option
          .setName('quadro')
          .setDescription('Canal onde toda demanda paga aparece')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName('iniciadas')
          .setDescription('Canal que recebe a demanda quando a producao comeca')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName('concluidas')
          .setDescription('Canal para onde a demanda vai quando e entregue')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName('tickets')
          .setDescription('SO DA EQUIPE: cartao de cada ticket entregue (mostra cliente e pedido)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName('localizador')
          .setDescription('DOS CLIENTES: onde cada um acha o proprio ticket entregue')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('sincronizar')
      .setDescription('Publica no quadro as demandas em producao que ainda nao tem cartao'),
  );

/**
 * Os canais que este comando configura, na ordem do ciclo da demanda.
 *
 * Uma tabela so, e nao quatro blocos repetidos: a validacao, a gravacao e o
 * resumo final andam juntos, e um canal novo entra aqui em uma linha.
 */
const CHANNELS = [
  { option: 'quadro', field: 'demandChannelId', label: 'Quadro' },
  { option: 'iniciadas', field: 'demandStartedChannelId', label: 'Iniciadas' },
  { option: 'concluidas', field: 'demandDoneChannelId', label: 'Demandas concluídas' },
  { option: 'tickets', field: 'ticketDoneChannelId', label: 'Tickets entregues (equipe)' },
  { option: 'localizador', field: 'deliveredLocatorChannelId', label: 'Localizador de entregas (clientes)' },
] as const;

function describeChannel(id: string | null): string {
  return id === null ? 'não definido' : channelMention(id);
}

/** Aplica so o que veio na chamada; canal omitido nao mexe no que ja esta la. */
async function setChannels(interaction: GuildChatInputInteraction): Promise<void> {
  const escolhidos = CHANNELS.map((canal) => ({
    ...canal,
    channel: interaction.options.getChannel(canal.option),
  }));

  if (escolhidos.every((canal) => canal.channel === null)) {
    throw new ValidationError('Comando de canais de demanda sem canal.', {
      userMessage:
        'Informe ao menos um canal: `quadro` (onde a demanda nasce), `iniciadas` (produção ' +
        'em andamento), `concluidas` (demanda entregue), `tickets` (cartões da equipe) ou ' +
        '`localizador` (onde o cliente acha a entrega).',
    });
  }

  for (const { channel, option } of escolhidos) {
    if (channel !== null && !isSendableTextChannel(channel)) {
      throw new ValidationError(`Canal invalido para demandas (${option}).`, {
        userMessage: `Escolha um canal de texto onde o bot possa enviar mensagens (${option}).`,
      });
    }
  }

  const alteracoes: Partial<Record<(typeof CHANNELS)[number]['field'], string>> = {};
  for (const { channel, field } of escolhidos) {
    if (channel !== null) alteracoes[field] = channel.id;
  }

  /*
   * O canal dos CLIENTES nao pode ser o canal dos cartoes da EQUIPE.
   *
   * Os cartoes mostram cliente, pedido e atendente de cada venda; no mesmo
   * canal, cada cliente com acesso veria as vendas dos outros. A conferencia
   * olha o resultado FINAL (o que ja estava gravado mais o que veio agora),
   * porque o choque pode vir de trocar so um dos dois.
   */
  const atual = await getGuildConfig(interaction.guildId);
  const equipe = alteracoes.ticketDoneChannelId ?? atual.ticketDoneChannelId;
  const clientes = alteracoes.deliveredLocatorChannelId ?? atual.deliveredLocatorChannelId;
  if (equipe !== null && equipe === clientes) {
    throw new ValidationError('Canal de clientes igual ao de cartoes da equipe.', {
      userMessage:
        `${channelMention(equipe)} não pode ser ao mesmo tempo o canal dos cartões da equipe ` +
        '(`tickets`) e o canal dos clientes (`localizador`): cada cliente veria as vendas dos ' +
        'outros. Crie um canal só da equipe para os cartões e aponte `tickets` para ele.',
    });
  }

  await updateGuildConfig(interaction.guildId, alteracoes);

  // Definir o localizador ja publica o painel — e devolve o motivo se nao der.
  const painel =
    alteracoes.deliveredLocatorChannelId === undefined
      ? null
      : await publishDeliveredLocator(interaction.guild, await getGuildConfig(interaction.guildId));

  const config = await getGuildConfig(interaction.guildId);
  const linhas = CHANNELS.map(
    (canal) => `**${canal.label}:** ${describeChannel(config[canal.field])}`,
  );

  if (painel !== null) {
    linhas.push(
      painel.published
        ? '✅ Painel de localizar publicado no canal dos clientes.'
        : `⚠️ Painel de localizar NÃO publicado: ${painel.reason ?? 'motivo desconhecido'}` +
            (painel.missingPermissions.length > 0
              ? ` (faltam ao bot: ${painel.missingPermissions.join(', ')})`
              : ''),
    );
  }

  const builder = painel !== null && !painel.published ? warningContainer : successContainer;
  await editReplyV2(
    interaction,
    builder(`Canais do quadro de demandas:\n${linhas.join('\n')}`, {
      footer:
        config.demandChannelId === null
          ? 'Sem o quadro definido, nenhuma demanda é publicada. Rode /demandas canais quadro:#canal.'
          : 'Toda venda paga a partir de agora vira um cartão. Para as que já existem, use /demandas sincronizar.',
    }),
  );
}

/**
 * Publica os cartoes que faltam.
 *
 * Idempotente por construcao: a consulta so traz demanda SEM cartao, e
 * `publishDemand` reescreve em vez de duplicar quando ja existe um. Rodar duas
 * vezes seguidas nao cria cartao repetido.
 */
async function sync(interaction: GuildChatInputInteraction): Promise<void> {
  const config = await getGuildConfig(interaction.guildId);
  if (config.demandChannelId === null) {
    await editReplyV2(
      interaction,
      warningContainer('O canal do quadro ainda não foi definido.', {
        footer: 'Rode /demandas canais quadro:#canal antes de sincronizar.',
      }),
    );
    return;
  }

  const pendentes = await listDemandsWithoutCard(interaction.guildId, SYNC_LIMIT);
  if (pendentes.length === 0) {
    await editReplyV2(
      interaction,
      successContainer('Nenhuma demanda em produção está sem cartão no quadro.'),
    );
    return;
  }

  let publicadas = 0;
  for (const order of pendentes) {
    // Uma falha isolada (canal sem permissao, rate limit) nao pode abortar a
    // sincronizacao inteira: `publishDemand` ja devolve false com WARN.
    if (await publishDemand(interaction.guild, order)) publicadas += 1;
  }

  await editReplyV2(
    interaction,
    publicadas === pendentes.length
      ? successContainer(
          `${publicadas} demanda(s) publicada(s) em ${channelMention(config.demandChannelId)}.`,
          {
            footer:
              pendentes.length === SYNC_LIMIT
                ? `O lote é de ${SYNC_LIMIT} por vez. Rode de novo se ainda faltar alguma.`
                : 'O quadro está em dia.',
          },
        )
      : warningContainer(
          `${publicadas} de ${pendentes.length} demanda(s) publicada(s). ` +
            'As que faltaram estão no log do bot.',
          { footer: 'Confira se o bot pode ver e enviar mensagens no canal do quadro.' },
        ),
  );
}

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  // A permissao do comando pode ser afrouxada por um admin na interface do
  // Discord; a checagem que vale e esta.
  assertCanManageSystem(interaction.member);

  const subcommand = interaction.options.getSubcommand();
  await deferIfNeeded(interaction, { ephemeral: true });

  if (subcommand === 'canais') {
    await setChannels(interaction);
    return;
  }
  await sync(interaction);
}

export const demandasCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
