"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configModals = exports.configSelects = exports.configButtons = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const customIds_1 = require("../../constants/customIds");
const errors_1 = require("../../core/errors");
const Logger_1 = require("../../core/logger/Logger");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const ConfigBuilders_1 = require("../../modules/configuration/builders/ConfigBuilders");
const GuildConfigService_1 = require("../../modules/configuration/services/GuildConfigService");
const TicketPanelService_1 = require("../../modules/tickets/services/TicketPanelService");
const discord_1 = require("../../utils/discord");
const sanitize_1 = require("../../utils/sanitize");
/**
 * Handlers do painel de configuracao geral (/ticket-config geral).
 *
 * REGRAS APLICADAS EM TODOS OS HANDLERS:
 *  - o customId nao autoriza nada: `assertCanManageSystem` roda de novo a cada acao;
 *  - escrita sempre via `updateGuildConfig` (que atualiza o cache) e so depois a
 *    interface e redesenhada com o registro devolvido pelo banco;
 *  - qualquer aviso ao usuario e um follow-up efemero, nunca uma mensagem publica.
 */
// ---------------------------------------------------------------------------
// Contexto e autorizacao
// ---------------------------------------------------------------------------
const logger = (0, Logger_1.createLogger)('config-geral');
/** Garante guild + permissao de administracao do sistema. */
function requireAdminContext(interaction) {
    const guild = interaction.guild;
    const member = interaction.member;
    if (guild === null || !(member instanceof discord_js_1.GuildMember)) {
        throw new errors_1.PermissionError('Interacao de configuracao fora de uma guild em cache.', {
            userMessage: 'Esta configuracao so pode ser usada dentro do servidor.',
        });
    }
    (0, PermissionService_1.assertCanManageSystem)(member);
    return { guild, member };
}
/** Aviso efemero (nunca vaza para o canal onde o painel foi aberto). */
async function notify(interaction, kind, message) {
    const root = kind === 'success'
        ? (0, reply_1.successContainer)(message)
        : kind === 'warning'
            ? (0, reply_1.warningContainer)(message)
            : (0, reply_1.infoContainer)(message);
    await (0, reply_1.followUpV2)(interaction, root, { ephemeral: true });
}
// ---------------------------------------------------------------------------
// Leitura e validacao dos campos de modal
// ---------------------------------------------------------------------------
/**
 * Le um campo do modal. Campos opcionais deixados em branco podem nao vir no
 * payload do Discord; nesse caso o valor lido e a string vazia.
 */
function readModalField(interaction, customId) {
    try {
        return interaction.fields.getTextInputValue(customId);
    }
    catch {
        return '';
    }
}
function requiredConfigText(raw, label, max) {
    const value = (0, sanitize_1.sanitizeConfigText)(raw, max);
    if (value.length === 0) {
        throw new errors_1.ValidationError(`Campo obrigatorio vazio: ${label}`, {
            userMessage: `${label}: preencha este campo.`,
        });
    }
    return value;
}
function optionalConfigText(raw, max) {
    const value = (0, sanitize_1.sanitizeConfigText)(raw, max);
    return value.length === 0 ? null : value;
}
/** URL de imagem: vazio limpa o valor, invalida gera mensagem clara por campo. */
function parseImageUrl(raw, label) {
    const value = raw.trim();
    let url;
    try {
        url = (0, sanitize_1.sanitizeImageUrl)(value);
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError) {
            throw new errors_1.ValidationError(`URL invalida em ${label}: ${error.message}`, {
                userMessage: `${label}: ${error.userMessage} Deixe o campo vazio para remover a imagem.`,
            });
        }
        throw error;
    }
    /*
     * `sanitizeImageUrl` aceita `attachment://` porque o proprio bot usa esse
     * esquema para referenciar anexos que ele mesmo envia (QR code, transcript).
     * Vindo deste modal nao existe anexo nenhum: o valor seria salvo e a partir
     * dai TODA renderizacao que usa a imagem falharia com 400 Invalid Form Body
     * — inclusive a criacao de ticket, que envia o painel interno.
     *
     * A recusa roda sobre o valor JA NORMALIZADO, nunca sobre o texto digitado:
     * `sanitizeImageUrl` remove zero-width antes de decidir, entao
     * `attach<U+200B>ment://x` nao casa com nenhum teste feito no texto cru e
     * volta daqui como `attachment://x`.
     */
    if (url !== null && url.toLowerCase().startsWith('attachment://')) {
        throw new errors_1.ValidationError(`Esquema attachment:// recusado em ${label}.`, {
            userMessage: `${label}: informe um endereco https:// completo ou deixe o campo vazio.`,
        });
    }
    return url;
}
/**
 * Le as tres imagens de um unico campo, separadas por barra vertical:
 *
 *   thumbnail | banner do painel | banner do ticket
 *
 * Vao juntas porque um modal do Discord aceita no maximo 5 campos, e os outros
 * quatro ja estao ocupados por nome, titulo, descricao e avisos. Posicao
 * omitida limpa o valor correspondente.
 */
function parseImageTrio(raw) {
    const value = raw.trim();
    if (value.length === 0) {
        return { thumbnailUrl: null, bannerUrl: null, ticketBannerUrl: null };
    }
    /*
     * Mais de tres partes e erro, nao "pega as tres primeiras": uma URL com `|`
     * no caminho (o WHATWG URL nao percent-codifica esse caractere) ou uma quarta
     * imagem colada por engano sairiam daqui truncadas em silencio, gravando um
     * endereco pela metade no lugar do que o administrador digitou.
     */
    const partes = value.split('|');
    if (partes.length > 3) {
        throw new errors_1.ValidationError(`Campo de imagens com ${partes.length} partes.`, {
            userMessage: 'Informe no maximo tres enderecos separados por | (barra vertical): ' +
                'thumbnail | banner do painel | banner do ticket. ' +
                'Se alguma URL contem |, troque por %7C.',
        });
    }
    const [thumbnailRaw = '', bannerRaw = '', ticketBannerRaw = ''] = partes;
    return {
        thumbnailUrl: parseImageUrl(thumbnailRaw, 'Thumbnail'),
        bannerUrl: parseImageUrl(bannerRaw, 'Banner do painel'),
        ticketBannerUrl: parseImageUrl(ticketBannerRaw, 'Banner do ticket'),
    };
}
function parseIntegerField(raw, label, range) {
    const value = raw.trim();
    if (!/^\d{1,6}$/.test(value)) {
        throw new errors_1.ValidationError(`Valor nao inteiro em "${label}": ${value.slice(0, 20)}`, {
            userMessage: `${label}: informe um numero inteiro entre ${range.min} e ${range.max}.`,
        });
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < range.min || parsed > range.max) {
        throw new errors_1.ValidationError(`Valor fora do intervalo em "${label}": ${parsed}`, {
            userMessage: `${label}: use um valor entre ${range.min} e ${range.max}.`,
        });
    }
    return parsed;
}
// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------
function parseChannelKey(raw) {
    if (raw === 'panel' || raw === 'log' || raw === 'welcome' || raw === 'review')
        return raw;
    throw new errors_1.ValidationError(`Chave de canal desconhecida: ${raw}`, {
        userMessage: 'Este componente esta invalido. Reabra o painel de configuracao.',
    });
}
/**
 * Monta a escrita do canal escolhido.
 * Trocar o canal do painel invalida a mensagem memorizada, senao o "atualizar"
 * tentaria editar uma mensagem que ficou em outro canal.
 */
function channelUpdate(key, channelId, config) {
    switch (key) {
        case 'panel':
            return channelId === config.ticketPanelChannelId
                ? { ticketPanelChannelId: channelId }
                : { ticketPanelChannelId: channelId, ticketPanelMessageId: null };
        case 'log':
            return { ticketLogChannelId: channelId };
        case 'welcome':
            /*
             * Boas-vindas sem canal nao teem onde publicar: o toggle ja recusa
             * ativar sem canal, entao limpar o canal precisa desligar tambem. Sem
             * isto o painel exibiria "Ativado" para um recurso que, a cada entrada
             * de membro, so produz um aviso no log.
             */
            return channelId === null
                ? { welcomeChannelId: null, welcomeEnabled: false }
                : { welcomeChannelId: channelId };
        case 'review':
            return { reviewChannelId: channelId };
    }
}
/**
 * O painel publico so e gerenciavel pelo par
 * (ticketPanelChannelId, ticketPanelMessageId): `publishPanel` apaga o painel
 * anterior por esse par e `refreshPublicPanel` edita a mensagem por ele.
 * Trocar ou limpar o canal descarta o par, logo a mensagem ja publicada tem de
 * ser removida ANTES da gravacao — senao ela fica viva no canal antigo, ainda
 * clicavel, e o proximo `/ticket-painel enviar` cria um segundo painel em vez
 * de substituir o primeiro.
 */
async function discardPublishedPanel(guild, config) {
    if (config.ticketPanelMessageId === null)
        return null;
    try {
        await (0, TicketPanelService_1.removePanel)(guild);
        return null;
    }
    catch (error) {
        logger.warn('Nao foi possivel remover o painel publico do canal anterior.', {
            guildId: guild.id,
            channelId: config.ticketPanelChannelId,
            detail: error instanceof Error ? error.message : String(error),
        });
        return 'O painel publicado no canal anterior nao pode ser apagado automaticamente. Remova aquela mensagem manualmente para nao ficar com dois paineis.';
    }
}
/** O bot precisa enxergar o canal e conseguir enviar mensagens nele. */
async function inspectChannel(guild, channelId) {
    const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
    if (channel === null) {
        return {
            ok: false,
            reason: 'O canal selecionado nao existe mais ou o bot nao consegue enxerga-lo.',
        };
    }
    if (!(0, discord_1.isSendableTextChannel)(channel)) {
        return { ok: false, reason: 'Selecione um canal de texto padrao do servidor.' };
    }
    const botMember = guild.members.me;
    if (botMember === null) {
        return { ok: false, reason: 'Nao foi possivel verificar as permissoes do bot no servidor.' };
    }
    const permissions = channel.permissionsFor(botMember);
    if (permissions === null) {
        return {
            ok: false,
            reason: `Nao foi possivel verificar as permissoes do bot em <#${channelId}>.`,
        };
    }
    const missing = [];
    if (!permissions.has(discord_js_1.PermissionFlagsBits.ViewChannel))
        missing.push('Ver canal');
    if (!permissions.has(discord_js_1.PermissionFlagsBits.SendMessages))
        missing.push('Enviar mensagens');
    if (missing.length > 0) {
        return {
            ok: false,
            reason: `O bot nao tem as permissoes necessarias em <#${channelId}>: ${missing.join(', ')}.`,
        };
    }
    return { ok: true };
}
// ---------------------------------------------------------------------------
// Navegacao entre paineis
// ---------------------------------------------------------------------------
async function showMainMenu(interaction, guild) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildConfigMenu)(config, guild));
}
/**
 * Confirma o modal antes do trabalho pesado.
 * Modal aberto a partir de um painel edita o proprio painel; modal solto
 * responde de forma efemera.
 */
async function acknowledgeModal(interaction) {
    if (interaction.deferred || interaction.replied)
        return;
    if (interaction.isFromMessage()) {
        await interaction.deferUpdate();
        return;
    }
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
}
// ---------------------------------------------------------------------------
// Botoes
// ---------------------------------------------------------------------------
const backButtonHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.BACK,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        await showMainMenu(interaction, guild);
    },
};
const channelsButtonHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.CHANNELS,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildChannelsPanel)(config, guild));
    },
};
const autoRoleButtonHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.AUTOROLE,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(config, guild));
    },
};
const visualButtonHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.VISUAL,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildVisualPanel)(config));
    },
};
const limitsButtonHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.LIMITS,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildLimitsPanel)(config));
    },
};
/** Abre o modal de textos: `showModal` precisa ser a primeira resposta. */
const visualModalButtonHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.VISUAL_MODAL,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await interaction.showModal((0, ConfigBuilders_1.buildVisualModal)(config));
    },
};
const limitsModalButtonHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.LIMITS_MODAL,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await interaction.showModal((0, ConfigBuilders_1.buildLimitsModal)(config));
    },
};
const autoRoleToggleHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.AUTOROLE_TOGGLE,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        if (!config.autoRoleEnabled) {
            if (config.autoRoleId === null || config.autoRoleId.length === 0) {
                await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(config, guild));
                await notify(interaction, 'warning', 'Selecione primeiro o cargo automatico; sem cargo o auto-role nao pode ser ativado.');
                return;
            }
            const botMember = guild.members.me;
            if (botMember === null) {
                throw new errors_1.ConfigurationError('Membro do bot indisponivel no cache da guild.', {
                    userMessage: 'Nao foi possivel verificar as permissoes do bot. Tente novamente.',
                });
            }
            const assignable = (0, PermissionService_1.canBotAssignRole)(botMember, config.autoRoleId);
            if (!assignable.ok) {
                await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(config, guild));
                await notify(interaction, 'warning', `Auto-role nao ativado. ${assignable.reason ?? 'O bot nao consegue entregar este cargo.'}`);
                return;
            }
        }
        const updated = await (0, GuildConfigService_1.updateGuildConfig)(guild.id, { autoRoleEnabled: !config.autoRoleEnabled });
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(updated, guild));
        await notify(interaction, 'success', updated.autoRoleEnabled ? 'Auto-role ativado.' : 'Auto-role desativado.');
    },
};
const welcomeToggleHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.WELCOME_TOGGLE,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        const welcomeChannelMissing = config.welcomeChannelId === null || config.welcomeChannelId.length === 0;
        // Boas-vindas sem canal nao teria onde publicar: exige o canal antes de ativar.
        if (!config.welcomeEnabled && welcomeChannelMissing) {
            await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(config, guild));
            await notify(interaction, 'warning', `Defina antes o ${ConfigBuilders_1.CHANNEL_LABEL.welcome.toLowerCase()} em "Canais".`);
            return;
        }
        const updated = await (0, GuildConfigService_1.updateGuildConfig)(guild.id, { welcomeEnabled: !config.welcomeEnabled });
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(updated, guild));
        await notify(interaction, 'success', updated.welcomeEnabled
            ? 'Mensagem de boas-vindas ativada.'
            : 'Mensagem de boas-vindas desativada.');
    },
};
/** Republica/edita o painel publico da central de atendimento. */
const refreshPanelHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.REFRESH_PANEL,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const result = await (0, TicketPanelService_1.refreshPublicPanel)(guild);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildConfigMenu)(config, guild));
        if (!result.updated) {
            await notify(interaction, 'warning', `${result.reason ?? 'Nao foi possivel atualizar o painel publico.'}\nPublique o painel pelo comando \`/ticket-painel\` antes de atualiza-lo.`);
            return;
        }
        await notify(interaction, 'success', result.reason ?? 'Painel publico atualizado com a configuracao atual.');
    },
};
exports.configButtons = [
    backButtonHandler,
    channelsButtonHandler,
    autoRoleButtonHandler,
    visualButtonHandler,
    limitsButtonHandler,
    visualModalButtonHandler,
    limitsModalButtonHandler,
    autoRoleToggleHandler,
    welcomeToggleHandler,
    refreshPanelHandler,
];
// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------
const channelSelectHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.CHANNEL_SELECT,
    async handle(interaction, parsed) {
        const { guild } = requireAdminContext(interaction);
        if (!interaction.isChannelSelectMenu()) {
            throw new errors_1.ValidationError('Select de canal recebido com tipo inesperado.', {
                userMessage: 'Este componente esta invalido. Reabra o painel de configuracao.',
            });
        }
        const key = parseChannelKey((0, customIds_1.requireArg)(parsed, 0, 'canal'));
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        const selectedId = interaction.values[0] ?? null;
        // Canal novo (quando houver) precisa ser utilizavel antes de qualquer escrita.
        if (selectedId !== null) {
            const usability = await inspectChannel(guild, selectedId);
            if (!usability.ok) {
                // Canal inutilizavel: nada e salvo e o painel volta ao estado do banco.
                await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildChannelsPanel)(config, guild));
                await notify(interaction, 'warning', `${ConfigBuilders_1.CHANNEL_LABEL[key]} nao foi alterado.\n${usability.reason}`);
                return;
            }
        }
        // Trocar/limpar o canal do painel: apaga a mensagem antiga antes de gravar.
        const panelWarning = key === 'panel' && selectedId !== config.ticketPanelChannelId
            ? await discardPublishedPanel(guild, config)
            : null;
        const updated = await (0, GuildConfigService_1.updateGuildConfig)(guild.id, channelUpdate(key, selectedId, config));
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildChannelsPanel)(updated, guild));
        if (selectedId === null) {
            const welcomeTurnedOff = key === 'welcome' && config.welcomeEnabled
                ? ' A mensagem de boas-vindas foi desativada junto.'
                : '';
            await notify(interaction, 'success', `${ConfigBuilders_1.CHANNEL_LABEL[key]} removido da configuracao.${welcomeTurnedOff}`);
        }
        else {
            await notify(interaction, 'success', `${ConfigBuilders_1.CHANNEL_LABEL[key]}: <#${selectedId}>.`);
        }
        if (panelWarning !== null)
            await notify(interaction, 'warning', panelWarning);
    },
};
const autoRoleSelectHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.AUTOROLE_SELECT,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        if (!interaction.isRoleSelectMenu()) {
            throw new errors_1.ValidationError('Select de cargo recebido com tipo inesperado.', {
                userMessage: 'Este componente esta invalido. Reabra o painel de configuracao.',
            });
        }
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const roleId = interaction.values[0] ?? null;
        // Sem cargo nao existe auto-role: limpar tambem desliga o recurso.
        if (roleId === null) {
            const updated = await (0, GuildConfigService_1.updateGuildConfig)(guild.id, {
                autoRoleId: null,
                autoRoleEnabled: false,
            });
            await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(updated, guild));
            await notify(interaction, 'success', 'Cargo automatico removido e auto-role desativado.');
            return;
        }
        const botMember = guild.members.me;
        if (botMember === null) {
            throw new errors_1.ConfigurationError('Membro do bot indisponivel no cache da guild.', {
                userMessage: 'Nao foi possivel verificar as permissoes do bot. Tente novamente.',
            });
        }
        const assignable = (0, PermissionService_1.canBotAssignRole)(botMember, roleId);
        if (!assignable.ok) {
            const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
            await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(config, guild));
            await notify(interaction, 'warning', `Cargo nao salvo. ${assignable.reason ?? 'O bot nao consegue entregar este cargo.'}`);
            return;
        }
        const updated = await (0, GuildConfigService_1.updateGuildConfig)(guild.id, { autoRoleId: roleId });
        await (0, reply_1.updateV2)(interaction, (0, ConfigBuilders_1.buildAutoRolePanel)(updated, guild));
        await notify(interaction, updated.autoRoleEnabled ? 'success' : 'info', updated.autoRoleEnabled
            ? `Cargo automatico definido: <@&${roleId}>.`
            : `Cargo automatico definido: <@&${roleId}>. Ative o auto-role para comecar a entrega-lo.`);
    },
};
exports.configSelects = [channelSelectHandler, autoRoleSelectHandler];
// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
const visualModalHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.VISUAL_MODAL,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await acknowledgeModal(interaction);
        const storeName = requiredConfigText(readModalField(interaction, ConfigBuilders_1.VISUAL_FIELD.STORE_NAME), 'Nome visual da loja', ConfigBuilders_1.CONFIG_TEXT_LIMITS.STORE_NAME);
        const panelTitle = requiredConfigText(readModalField(interaction, ConfigBuilders_1.VISUAL_FIELD.PANEL_TITLE), 'Titulo do painel', ConfigBuilders_1.CONFIG_TEXT_LIMITS.PANEL_TITLE);
        const panelDescription = requiredConfigText(readModalField(interaction, ConfigBuilders_1.VISUAL_FIELD.PANEL_DESCRIPTION), 'Descricao do painel', ConfigBuilders_1.CONFIG_TEXT_LIMITS.PANEL_DESCRIPTION);
        const panelNotice = optionalConfigText(readModalField(interaction, ConfigBuilders_1.VISUAL_FIELD.PANEL_NOTICE), ConfigBuilders_1.CONFIG_TEXT_LIMITS.PANEL_NOTICE);
        const { thumbnailUrl, bannerUrl, ticketBannerUrl } = parseImageTrio(readModalField(interaction, ConfigBuilders_1.VISUAL_FIELD.IMAGES));
        const updated = await (0, GuildConfigService_1.updateGuildConfig)(guild.id, {
            storeName,
            panelTitle,
            panelDescription,
            panelNotice,
            panelThumbnailUrl: thumbnailUrl,
            panelBannerUrl: bannerUrl,
            ticketBannerUrl,
        });
        await (0, reply_1.editReplyV2)(interaction, (0, ConfigBuilders_1.buildVisualPanel)(updated));
        await notify(interaction, 'success', 'Textos do painel salvos. Use "Atualizar Painel" para aplicar na central de atendimento.');
    },
};
const limitsModalHandler = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.LIMITS_MODAL,
    async handle(interaction) {
        const { guild } = requireAdminContext(interaction);
        await acknowledgeModal(interaction);
        const maxOpenTicketsPerUser = parseIntegerField(readModalField(interaction, ConfigBuilders_1.LIMITS_FIELD.MAX_PER_USER), 'Max tickets por usuario', ConfigBuilders_1.CONFIG_LIMIT_RANGES.MAX_TICKETS_PER_USER);
        const maxOpenTicketsGuild = parseIntegerField(readModalField(interaction, ConfigBuilders_1.LIMITS_FIELD.MAX_GUILD), 'Max tickets no servidor', ConfigBuilders_1.CONFIG_LIMIT_RANGES.MAX_TICKETS_GUILD);
        const ticketCreateCooldownSeconds = parseIntegerField(readModalField(interaction, ConfigBuilders_1.LIMITS_FIELD.CREATE_COOLDOWN), 'Cooldown de criacao', ConfigBuilders_1.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS);
        const clientNotifyCooldownSeconds = parseIntegerField(readModalField(interaction, ConfigBuilders_1.LIMITS_FIELD.NOTIFY_COOLDOWN), 'Cooldown de notificacao', ConfigBuilders_1.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS);
        const renameCooldownSeconds = parseIntegerField(readModalField(interaction, ConfigBuilders_1.LIMITS_FIELD.RENAME_COOLDOWN), 'Cooldown de rename', ConfigBuilders_1.CONFIG_LIMIT_RANGES.COOLDOWN_SECONDS);
        if (maxOpenTicketsPerUser > maxOpenTicketsGuild) {
            throw new errors_1.ValidationError(`Limite por usuario (${maxOpenTicketsPerUser}) maior que o limite do servidor (${maxOpenTicketsGuild}).`, {
                userMessage: 'O limite por usuario nao pode ser maior que o limite total de tickets do servidor.',
            });
        }
        const updated = await (0, GuildConfigService_1.updateGuildConfig)(guild.id, {
            maxOpenTicketsPerUser,
            maxOpenTicketsGuild,
            ticketCreateCooldownSeconds,
            clientNotifyCooldownSeconds,
            renameCooldownSeconds,
        });
        await (0, reply_1.editReplyV2)(interaction, (0, ConfigBuilders_1.buildLimitsPanel)(updated));
        await notify(interaction, 'success', 'Limites e cooldowns atualizados.');
    },
};
exports.configModals = [visualModalHandler, limitsModalHandler];
//# sourceMappingURL=index.js.map