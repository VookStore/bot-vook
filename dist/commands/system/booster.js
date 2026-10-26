"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.boosterCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const errors_1 = require("../../core/errors");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const limits_1 = require("../../constants/limits");
const sanitize_1 = require("../../utils/sanitize");
const CouponService_1 = require("../../modules/coupons/services/CouponService");
const CatalogCategoryService_1 = require("../../modules/catalog/services/CatalogCategoryService");
const BoosterConfigBuilder_1 = require("../../modules/booster/builders/BoosterConfigBuilder");
const BoosterArtService_1 = require("../../modules/booster/services/BoosterArtService");
const BoosterPanelService_1 = require("../../modules/booster/services/BoosterPanelService");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
const discord_1 = require("../../utils/discord");
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
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('booster')
    .setDescription('Publica e atualiza o anuncio de beneficios de booster')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
    .setName('previa')
    .setDescription('Mostra o anuncio so para voce, sem publicar nada'))
    .addSubcommand((subcommand) => subcommand
    .setName('enviar')
    .setDescription('Publica o anuncio em um canal')
    .addChannelOption((option) => option
    .setName('canal')
    .setDescription('Canal onde o anuncio sera publicado (padrao: canal atual)')
    .addChannelTypes(discord_js_1.ChannelType.GuildText)
    .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
    .setName('atualizar')
    .setDescription('Reescreve o anuncio ja publicado com os beneficios atuais'))
    .addSubcommand((subcommand) => subcommand
    .setName('desconto')
    .setDescription('Liga o desconto automatico ligando cada cargo de booster a um cupom')
    .addRoleOption((option) => option
    .setName('cargo')
    .setDescription('Cargo de quem tem 1 boost')
    .setRequired(true))
    .addStringOption((option) => option
    .setName('cupom')
    .setDescription('Cupom aplicado a quem tem esse cargo')
    .setAutocomplete(true)
    .setRequired(true))
    .addStringOption((option) => option
    .setName('cupom2')
    .setDescription('Cupom do degrau de 2 boosts (exige /booster nivel2 configurado)')
    .setAutocomplete(true)
    .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
    .setName('nivel2')
    .setDescription('Cargo dado automaticamente a quem impulsionar o servidor 2 vezes')
    .addRoleOption((option) => option
    .setName('cargo')
    .setDescription('Cargo concedido a partir do segundo boost')
    .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
    .setName('nivel2-desligar')
    .setDescription('Para de conceder o cargo de 2 boosts automaticamente'))
    .addSubcommand((subcommand) => subcommand
    .setName('desconto-desligar')
    .setDescription('Desliga o desconto automatico de booster'))
    .addSubcommand((subcommand) => subcommand
    .setName('categorias')
    .setDescription('Escolhe em quais categorias do catalogo o desconto vale'));
async function execute(interaction) {
    // A permissao do comando pode ser afrouxada por um admin na interface do
    // Discord; a checagem que vale e esta.
    (0, PermissionService_1.assertCanManageSystem)(interaction.member);
    const subcommand = interaction.options.getSubcommand();
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    if (subcommand === 'previa') {
        const config = await (0, GuildConfigService_1.getGuildConfig)(interaction.guildId);
        const content = (0, BoosterPanelService_1.renderBoosterPanel)(interaction.guildId, config);
        /*
         * Arte ausente e AVISADA, nao omitida em silencio.
         *
         * A versao anterior publicava sem miniatura e nao dizia nada; quem esperava
         * a imagem so descobria olhando o resultado, sem saber onde o bot procurou.
         * O aviso vai junto da previa, com os caminhos exatos.
         */
        const aviso = content.files === undefined
            ? (0, reply_1.warningContainer)('A arte ainda nao esta no disco, entao o anuncio sai sem miniatura.', {
                footer: `Coloque a imagem em um destes caminhos: ${(0, BoosterArtService_1.boosterArtCandidates)(interaction.guildId)
                    .slice(0, 2)
                    .join('  ou  ')}`,
            })
            : null;
        await (0, reply_1.editReplyV2)(interaction, aviso === null ? content.root : [content.root, aviso], {
            ...(content.files === undefined ? {} : { files: content.files }),
        });
        return;
    }
    if (subcommand === 'enviar') {
        const target = interaction.options.getChannel('canal') ?? interaction.channel;
        if (!(0, discord_1.isSendableTextChannel)(target)) {
            throw new errors_1.ValidationError('Canal invalido para o anuncio de booster.', {
                userMessage: 'Escolha um canal de texto onde o bot possa enviar mensagens.',
            });
        }
        await (0, BoosterPanelService_1.publishBoosterPanel)(interaction.guild, target);
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)(`Anuncio publicado em ${(0, discord_1.channelUrl)(interaction.guildId, target.id)}`, {
            footer: 'Para mudar um beneficio: edite boosterTiers.ts, refaca o build e rode /booster atualizar.',
        }));
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
        const atual = await (0, GuildConfigService_1.getGuildConfig)(interaction.guildId);
        if (tier2Coupon !== null && atual.boosterTier2RoleId === null) {
            throw new errors_1.ValidationError('Cupom de degrau 2 sem cargo definido.', {
                userMessage: 'Defina antes o cargo do degrau de 2 boosts com `/booster nivel2`.',
            });
        }
        await assertCouponsExist(interaction.guildId, [tier1Coupon, tier2Coupon]);
        await (0, GuildConfigService_1.updateGuildConfig)(interaction.guildId, {
            boosterRoleId: tier1Role.id,
            boosterCouponId: tier1Coupon,
            boosterTier2CouponId: tier2Coupon,
        });
        await (0, reply_1.editReplyV2)(interaction, await buildDiscountView(interaction.guildId));
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
        const check = botMember === null
            ? { ok: false, reason: 'O bot nao esta disponivel neste servidor.' }
            : (0, PermissionService_1.canBotAssignRole)(botMember, role.id);
        if (!check.ok) {
            throw new errors_1.ValidationError(`Bot nao pode atribuir o cargo ${role.id}.`, {
                userMessage: check.reason ?? 'O bot nao pode atribuir este cargo.',
            });
        }
        await (0, GuildConfigService_1.updateGuildConfig)(interaction.guildId, { boosterTier2RoleId: role.id });
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)(`${(0, discord_1.roleMention)(role.id)} sera concedido a partir do segundo boost.`, {
            footer: 'Vale a partir do proximo boost. Quem ja tem 2 boosts hoje precisa receber o cargo uma vez a mao.',
        }));
        return;
    }
    if (subcommand === 'nivel2-desligar') {
        await (0, GuildConfigService_1.updateGuildConfig)(interaction.guildId, {
            boosterTier2RoleId: null,
            // O cupom do degrau 2 sai junto: sem cargo, ele nao alcanca ninguem.
            boosterTier2CouponId: null,
        });
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)('Cargo automatico de 2 boosts desligado.', {
            footer: 'Ninguem perde o cargo que ja tem; o bot so para de conceder.',
        }));
        return;
    }
    if (subcommand === 'desconto-desligar') {
        await (0, GuildConfigService_1.updateGuildConfig)(interaction.guildId, {
            boosterRoleId: null,
            boosterCouponId: null,
            boosterTier2RoleId: null,
            boosterTier2CouponId: null,
        });
        await (0, reply_1.editReplyV2)(interaction, (0, reply_1.successContainer)('Desconto automatico desligado.', {
            footer: 'A equipe volta a lancar o cupom a mao no atendimento.',
        }));
        return;
    }
    if (subcommand === 'categorias') {
        const categories = await (0, CatalogCategoryService_1.getCatalogCategories)(interaction.guildId);
        await (0, reply_1.editReplyV2)(interaction, (0, BoosterConfigBuilder_1.buildEligibilityPanel)(categories));
        return;
    }
    // atualizar
    const result = await (0, BoosterPanelService_1.refreshBoosterPanel)(interaction.guild);
    await (0, reply_1.editReplyV2)(interaction, result.updated
        ? (0, reply_1.successContainer)('Anuncio atualizado com os beneficios atuais.')
        : (0, reply_1.warningContainer)(result.reason ?? 'Nao foi possivel atualizar o anuncio.'));
}
/**
 * Recusa cupom que nao existe nesta guild.
 *
 * O valor vem do autocomplete, mas o Discord aceita texto digitado a mao — e um
 * id invalido gravado aqui viraria uma automacao que falha em toda venda, em
 * silencio, ate alguem comparar um pedido com a tabela.
 */
async function assertCouponsExist(guildId, couponIds) {
    const coupons = await (0, CouponService_1.getCoupons)(guildId);
    const known = new Set(coupons.map((coupon) => coupon.id));
    for (const couponId of couponIds) {
        if (couponId !== null && !known.has(couponId)) {
            throw new errors_1.ValidationError(`Cupom inexistente: ${couponId}`, {
                userMessage: 'Cupom nao encontrado. Escolha um da lista do autocomplete, ou crie em `/cupom`.',
            });
        }
    }
}
/** Estado atual do desconto, com os codigos dos cupons resolvidos. */
async function buildDiscountView(guildId) {
    const [config, coupons] = await Promise.all([(0, GuildConfigService_1.getGuildConfig)(guildId), (0, CouponService_1.getCoupons)(guildId)]);
    const codeOf = (id) => id === null ? null : (coupons.find((coupon) => coupon.id === id)?.code ?? null);
    return (0, BoosterConfigBuilder_1.buildDiscountStatus)(config, {
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
async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'cupom' && focused.name !== 'cupom2') {
        await interaction.respond([]);
        return;
    }
    if (!(0, PermissionService_1.canManageSystem)(interaction.member)) {
        await interaction.respond([]);
        return;
    }
    const query = focused.value.toLowerCase().trim();
    const coupons = await (0, CouponService_1.getCoupons)(interaction.guildId);
    await interaction.respond(coupons
        .filter((coupon) => coupon.deletedAt === null)
        .filter((coupon) => query.length === 0 || coupon.code.toLowerCase().includes(query))
        .slice(0, limits_1.DISCORD_LIMITS.AUTOCOMPLETE_CHOICES)
        .map((coupon) => ({
        // O rotulo diz se o cupom esta desligado: apontar a automacao para um
        // cupom desabilitado e um erro facil e invisivel.
        name: (0, sanitize_1.truncate)(`${coupon.code}${coupon.enabled ? '' : ' (desativado)'}`, 100),
        value: coupon.id,
    })));
}
exports.boosterCommand = {
    builder,
    guildOnly: true,
    execute,
    autocomplete,
};
//# sourceMappingURL=booster.js.map