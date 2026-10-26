import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';

import {
  deferIfNeeded,
  editReplyV2,
  successContainer,
  warningContainer,
} from '../../components/reply';
import { ValidationError } from '../../core/errors';
import {
  assertCanManageSystem,
  canBotAssignRole,
  canManageSystem,
} from '../../core/permissions/PermissionService';
import { DISCORD_LIMITS } from '../../constants/limits';
import { truncate } from '../../utils/sanitize';
import { getCoupons } from '../../modules/coupons/services/CouponService';
import { getCatalogCategories } from '../../modules/catalog/services/CatalogCategoryService';
import {
  buildDiscountStatus,
  buildEligibilityPanel,
} from '../../modules/booster/builders/BoosterConfigBuilder';
import { boosterArtCandidates } from '../../modules/booster/services/BoosterArtService';
import {
  publishBoosterPanel,
  refreshBoosterPanel,
  renderBoosterPanel,
} from '../../modules/booster/services/BoosterPanelService';
import {
  getGuildConfig,
  updateGuildConfig,
} from '../../modules/configuration/services/GuildConfigService';
import { channelUrl, isSendableTextChannel, roleMention } from '../../utils/discord';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * /booster previa | enviar | atualizar
 *
 * Os beneficios ficam em `src/modules/booster/data/boosterTiers.ts` e a arte em
 * `assets/booster/<id-do-servidor>.png`. Mudou algo? Edita, `npm run build`,
 * reinicia e roda `/booster atualizar` — a mensagem publicada e reescrita no
 * lugar.
 *
 * `previa` existe porque o anuncio declara DESCONTO. Um percentual errado num
 * canal publico e um abatimento que a loja vai ter de honrar ou desdizer na
 * frente de quem impulsionou; conferir antes custa um comando.
 */

const builder = new SlashCommandBuilder()
  .setName('booster')
  .setDescription('Publica e atualiza o anuncio de beneficios de booster')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('previa')
      .setDescription('Mostra o anuncio so para voce, sem publicar nada'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('enviar')
      .setDescription('Publica o anuncio em um canal')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal onde o anuncio sera publicado (padrao: canal atual)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('atualizar')
      .setDescription('Reescreve o anuncio ja publicado com os beneficios atuais'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('desconto')
      .setDescription('Liga o desconto automatico ligando cada cargo de booster a um cupom')
      .addRoleOption((option) =>
        option
          .setName('cargo')
          .setDescription('Cargo de quem tem 1 boost')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('cupom')
          .setDescription('Cupom aplicado a quem tem esse cargo')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('cupom2')
          .setDescription('Cupom do degrau de 2 boosts (exige /booster nivel2 configurado)')
          .setAutocomplete(true)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('nivel2')
      .setDescription('Cargo dado automaticamente a quem impulsionar o servidor 2 vezes')
      .addRoleOption((option) =>
        option
          .setName('cargo')
          .setDescription('Cargo concedido a partir do segundo boost')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('nivel2-desligar')
      .setDescription('Para de conceder o cargo de 2 boosts automaticamente'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('desconto-desligar')
      .setDescription('Desliga o desconto automatico de booster'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('categorias')
      .setDescription('Escolhe em quais categorias do catalogo o desconto vale'),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  // A permissao do comando pode ser afrouxada por um admin na interface do
  // Discord; a checagem que vale e esta.
  assertCanManageSystem(interaction.member);

  const subcommand = interaction.options.getSubcommand();
  await deferIfNeeded(interaction, { ephemeral: true });

  if (subcommand === 'previa') {
    const config = await getGuildConfig(interaction.guildId);
    const content = renderBoosterPanel(interaction.guildId, config);

    /*
     * Arte ausente e AVISADA, nao omitida em silencio.
     *
     * A versao anterior publicava sem miniatura e nao dizia nada; quem esperava
     * a imagem so descobria olhando o resultado, sem saber onde o bot procurou.
     * O aviso vai junto da previa, com os caminhos exatos.
     */
    const aviso =
      content.files === undefined
        ? warningContainer(
            'A arte ainda nao esta no disco, entao o anuncio sai sem miniatura.',
            {
              footer: `Coloque a imagem em um destes caminhos: ${boosterArtCandidates(
                interaction.guildId,
              )
                .slice(0, 2)
                .join('  ou  ')}`,
            },
          )
        : null;

    await editReplyV2(interaction, aviso === null ? content.root : [content.root, aviso], {
      ...(content.files === undefined ? {} : { files: content.files }),
    });
    return;
  }

  if (subcommand === 'enviar') {
    const target = interaction.options.getChannel('canal') ?? interaction.channel;
    if (!isSendableTextChannel(target)) {
      throw new ValidationError('Canal invalido para o anuncio de booster.', {
        userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
      });
    }

    await publishBoosterPanel(interaction.guild, target);

    await editReplyV2(
      interaction,
      successContainer(`Anuncio publicado em ${channelUrl(interaction.guildId, target.id)}`, {
        footer:
          'Para mudar um beneficio: edite boosterTiers.ts, refaca o build e rode /booster atualizar.',
      }),
    );
    return;
  }

  if (subcommand === 'desconto') {
    const tier1Role = interaction.options.getRole('cargo', true);
    const tier1Coupon = interaction.options.getString('cupom', true);
    const tier2Coupon = interaction.options.getString('cupom2');

    /*
     * O cupom do degrau 2 depende do CARGO do degrau 2, que e configurado a
     * parte (`/booster nivel2`) porque ele tambem serve para a concessao
     * automatica. Cupom sem cargo nao alcanca ninguem — e um degrau que parece
     * ligado e nunca desconta.
     */
    const atual = await getGuildConfig(interaction.guildId);
    if (tier2Coupon !== null && atual.boosterTier2RoleId === null) {
      throw new ValidationError('Cupom de degrau 2 sem cargo definido.', {
        userMessage:
          'Defina antes o cargo do degrau de 2 boosts com `/booster nivel2`.',
      });
    }

    await assertCouponsExist(interaction.guildId, [tier1Coupon, tier2Coupon]);

    await updateGuildConfig(interaction.guildId, {
      boosterRoleId: tier1Role.id,
      boosterCouponId: tier1Coupon,
      boosterTier2CouponId: tier2Coupon,
    });

    await editReplyV2(interaction, await buildDiscountView(interaction.guildId));
    return;
  }

  if (subcommand === 'nivel2') {
    const role = interaction.options.getRole('cargo', true);

    /*
     * Falha CEDO se o bot nao consegue dar o cargo. A concessao acontece meses
     * depois, num evento de boost que ninguem esta olhando — descobrir ali que
     * a hierarquia nao permite significa descobrir por reclamacao do cliente.
     */
    const botMember = interaction.guild.members.me;
    const check =
      botMember === null
        ? { ok: false, reason: 'O bot nao esta disponivel neste servidor.' }
        : canBotAssignRole(botMember, role.id);

    if (!check.ok) {
      throw new ValidationError(`Bot nao pode atribuir o cargo ${role.id}.`, {
        userMessage: check.reason ?? 'O bot nao pode atribuir este cargo.',
      });
    }

    await updateGuildConfig(interaction.guildId, { boosterTier2RoleId: role.id });

    await editReplyV2(
      interaction,
      successContainer(`${roleMention(role.id)} sera concedido a partir do segundo boost.`, {
        footer:
          'Vale a partir do proximo boost. Quem ja tem 2 boosts hoje precisa receber o cargo uma vez a mao.',
      }),
    );
    return;
  }

  if (subcommand === 'nivel2-desligar') {
    await updateGuildConfig(interaction.guildId, {
      boosterTier2RoleId: null,
      // O cupom do degrau 2 sai junto: sem cargo, ele nao alcanca ninguem.
      boosterTier2CouponId: null,
    });

    await editReplyV2(
      interaction,
      successContainer('Cargo automatico de 2 boosts desligado.', {
        footer: 'Ninguem perde o cargo que ja tem; o bot so para de conceder.',
      }),
    );
    return;
  }

  if (subcommand === 'desconto-desligar') {
    await updateGuildConfig(interaction.guildId, {
      boosterRoleId: null,
      boosterCouponId: null,
      boosterTier2RoleId: null,
      boosterTier2CouponId: null,
    });

    await editReplyV2(
      interaction,
      successContainer('Desconto automatico desligado.', {
        footer: 'A equipe volta a lancar o cupom a mao no atendimento.',
      }),
    );
    return;
  }

  if (subcommand === 'categorias') {
    const categories = await getCatalogCategories(interaction.guildId);
    await editReplyV2(interaction, buildEligibilityPanel(categories));
    return;
  }

  // atualizar
  const result = await refreshBoosterPanel(interaction.guild);

  await editReplyV2(
    interaction,
    result.updated
      ? successContainer('Anuncio atualizado com os beneficios atuais.')
      : warningContainer(result.reason ?? 'Nao foi possivel atualizar o anuncio.'),
  );
}

/**
 * Recusa cupom que nao existe nesta guild.
 *
 * O valor vem do autocomplete, mas o Discord aceita texto digitado a mao — e um
 * id invalido gravado aqui viraria uma automacao que falha em toda venda, em
 * silencio, ate alguem comparar um pedido com a tabela.
 */
async function assertCouponsExist(
  guildId: string,
  couponIds: ReadonlyArray<string | null>,
): Promise<void> {
  const coupons = await getCoupons(guildId);
  const known = new Set(coupons.map((coupon) => coupon.id));

  for (const couponId of couponIds) {
    if (couponId !== null && !known.has(couponId)) {
      throw new ValidationError(`Cupom inexistente: ${couponId}`, {
        userMessage:
          'Cupom nao encontrado. Escolha um da lista do autocomplete, ou crie em `/cupom`.',
      });
    }
  }
}

/** Estado atual do desconto, com os codigos dos cupons resolvidos. */
async function buildDiscountView(guildId: string) {
  const [config, coupons] = await Promise.all([getGuildConfig(guildId), getCoupons(guildId)]);
  const codeOf = (id: string | null): string | null =>
    id === null ? null : (coupons.find((coupon) => coupon.id === id)?.code ?? null);

  return buildDiscountStatus(config, {
    tier1: codeOf(config.boosterCouponId),
    tier2: codeOf(config.boosterTier2CouponId),
  });
}

/**
 * Autocomplete dos cupons.
 *
 * Revalida a permissao: o autocomplete e uma interacao separada e
 * `setDefaultMemberPermissions` e apenas visual. Sem isto, qualquer membro que
 * enxergasse o comando leria a lista de cupons da loja.
 */
async function autocomplete(interaction: AutocompleteInteraction<'cached'>): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'cupom' && focused.name !== 'cupom2') {
    await interaction.respond([]);
    return;
  }
  if (!canManageSystem(interaction.member)) {
    await interaction.respond([]);
    return;
  }

  const query = focused.value.toLowerCase().trim();
  const coupons = await getCoupons(interaction.guildId);

  await interaction.respond(
    coupons
      .filter((coupon) => coupon.deletedAt === null)
      .filter((coupon) => query.length === 0 || coupon.code.toLowerCase().includes(query))
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_CHOICES)
      .map((coupon) => ({
        // O rotulo diz se o cupom esta desligado: apontar a automacao para um
        // cupom desabilitado e um erro facil e invisivel.
        name: truncate(`${coupon.code}${coupon.enabled ? '' : ' (desativado)'}`, 100),
        value: coupon.id,
      })),
  );
}

export const boosterCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
  autocomplete,
};
