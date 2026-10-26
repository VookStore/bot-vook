"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishLocatorPanels = publishLocatorPanels;
exports.locateTickets = locateTickets;
exports.locateDeliveredTickets = locateDeliveredTickets;
exports.publishDeliveredLocator = publishDeliveredLocator;
exports.grantDeliveredLocatorAccess = grantDeliveredLocatorAccess;
exports.revokeDeliveredLocatorAccess = revokeDeliveredLocatorAccess;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../../components/reply");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const GuildConfigService_1 = require("../../configuration/services/GuildConfigService");
const TicketLocatorBuilder_1 = require("../builders/TicketLocatorBuilder");
const TicketCategoryRepository_1 = require("../repositories/TicketCategoryRepository");
const TicketRepository_1 = require("../repositories/TicketRepository");
const TicketChannelService_1 = require("./TicketChannelService");
const TicketConfigService_1 = require("./TicketConfigService");
const TicketQueueService_1 = require("./TicketQueueService");
/**
 * Painel "Localizar meu ticket" e a busca por tras dele.
 *
 * Com o ticket virando topico privado, o canal de destino deixou de ser uma
 * pasta e virou uma TELA: e nele que o cliente reencontra o proprio
 * atendimento. Publicar o painel e tambem o momento em que as permissoes do
 * canal sao acertadas — as duas coisas so fazem sentido juntas, e separa-las
 * deixaria o painel publicado num canal onde a equipe nao enxerga nada.
 */
const logger = (0, Logger_1.createLogger)('ticket:locator');
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
async function publishLocatorPanels(guild) {
    const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
    const categories = await (0, TicketConfigService_1.getEnabledCategories)(guild.id);
    const entries = [];
    for (const category of categories) {
        entries.push(await publishOne(guild, config, category));
    }
    // O canal de entregas entra no mesmo relatorio: e por aqui que o
    // administrador publica localizador, e ele precisa ver se este saiu.
    if (config.deliveredLocatorChannelId !== null) {
        entries.push(await publishDeliveredLocator(guild, config));
    }
    if (entries.some((entry) => entry.published))
        (0, TicketConfigService_1.invalidateCategories)(guild.id);
    return entries;
}
async function publishOne(guild, config, category) {
    const base = {
        categoryName: category.name,
        channelId: category.destinationChannelId,
        published: false,
        missingPermissions: [],
        missingRoles: [],
    };
    const channel = await (0, TicketChannelService_1.resolveDestinationChannel)(guild, category.destinationChannelId);
    if (channel === null) {
        return {
            ...base,
            reason: category.destinationChannelId === null
                ? 'sem canal de atendimento configurado'
                : 'o destino configurado nao e um canal de texto acessivel',
        };
    }
    // As permissoes vem PRIMEIRO: publicar num canal onde a equipe nao enxerga
    // topico seria publicar um painel que nao leva a lugar nenhum.
    const teamRoleIds = await (0, TicketConfigService_1.getTeamRoleIds)(category.id);
    const permissions = await (0, TicketChannelService_1.applyDestinationPermissions)(guild, channel, teamRoleIds);
    const missingPermissions = (0, TicketChannelService_1.missingDestinationPermissions)(guild, channel);
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
    for (const userId of await (0, TicketRepository_1.listUserIdsWithOpenTickets)(guild.id, category.id)) {
        await (0, TicketChannelService_1.grantDestinationAccess)(channel, userId, 'Atendimento aberto nesta categoria');
    }
    const panel = (0, TicketLocatorBuilder_1.buildTicketLocatorPanel)(config, category);
    if (category.locatorMessageId !== null) {
        try {
            const existing = await channel.messages.fetch(category.locatorMessageId);
            await existing.edit({
                components: [panel],
                flags: discord_js_1.MessageFlags.IsComponentsV2,
                allowedMentions: discord_1.NO_MENTIONS,
            });
            return {
                ...base,
                channelId: channel.id,
                published: true,
                missingRoles: permissions.missingRoles,
            };
        }
        catch (error) {
            // Mensagem apagada a mao: cai para o envio de uma nova, em vez de deixar
            // a categoria sem painel para sempre.
            if (!(0, discord_1.isUnknownResourceError)(error))
                throw error;
        }
    }
    const message = await (0, reply_1.sendV2)(channel, panel);
    await (0, TicketCategoryRepository_1.setCategoryLocatorMessage)(category.id, message.id);
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
async function locateTickets(guild, ownerId, categoryId) {
    const tickets = await (0, TicketRepository_1.listOpenTicketsByOwnerAndCategory)(guild.id, ownerId, categoryId);
    const located = [];
    for (const ticket of tickets)
        located.push(await locateOne(guild, ownerId, ticket));
    return located;
}
/**
 * Tickets ENTREGUES do cliente, de qualquer categoria — a busca do canal de
 * entregas. Mesma readmissao do localizador de categoria.
 */
async function locateDeliveredTickets(guild, ownerId) {
    const tickets = await (0, TicketRepository_1.listDeliveredOpenTickets)(guild.id, ownerId);
    const located = [];
    for (const ticket of tickets)
        located.push(await locateOne(guild, ownerId, ticket));
    return located;
}
/** Um ticket: confere se a conversa existe e readmite o cliente se ele saiu. */
async function locateOne(guild, ownerId, ticket) {
    const channel = await (0, TicketChannelService_1.resolveTicketChannel)(guild, ticket.channelId);
    if (channel === null) {
        return { ticket, queuePosition: 0, reachable: false, rejoined: false };
    }
    let rejoined = false;
    if ((0, TicketChannelService_1.isTicketThread)(channel)) {
        try {
            const already = await channel.members.fetch(ownerId).catch(() => null);
            if (already === null) {
                /*
                 * Topico de ticket ENTREGUE esta arquivado de proposito, e topico
                 * arquivado nao aceita membro novo. Quem volta e porque vai interagir
                 * — reabrir aqui e o que o clique pede.
                 */
                await (0, TicketChannelService_1.reopenIfArchived)(channel, `Retorno ao ticket #${ticket.ticketNumber}`);
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
                if (parent !== null && parent.type === discord_js_1.ChannelType.GuildText) {
                    await (0, TicketChannelService_1.grantDestinationAccess)(parent, ownerId, `Retorno ao ticket #${ticket.ticketNumber}`).catch(() => false);
                }
                // Sem `reason`: o Discord nao registra motivo em entrada de topico.
                await channel.members.add(ownerId);
                rejoined = true;
            }
        }
        catch (error) {
            if (!(0, TicketLocatorBuilder_1.isRecoverableRejoinError)(error) && !(0, discord_1.isUnknownResourceError)(error))
                throw error;
            logger.warn('Nao foi possivel readicionar o cliente ao topico.', {
                guildId: guild.id,
                userId: ownerId,
                entityType: 'ticket',
                entityId: ticket.id,
            });
        }
    }
    const queue = await (0, TicketQueueService_1.getQueueInfo)(ticket);
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
function sharesStaffChannel(config) {
    return (config.deliveredLocatorChannelId !== null &&
        config.deliveredLocatorChannelId === config.ticketDoneChannelId);
}
/**
 * O que o cliente pode no canal de entregas: ver o painel e clicar. Nada mais.
 *
 * O "nao escrever" e explicito de proposito. Sem ele o cliente herdaria o
 * "enviar mensagens" do @everyone do servidor, e o canal de entregas viraria
 * um chat onde um cliente le o outro.
 */
const DELIVERED_CLIENT_OVERWRITE = {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false,
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
};
/** Permissoes do BOT no canal de entregas, com o nome que o administrador ve. */
const DELIVERED_BOT_PERMISSIONS = [
    [discord_js_1.PermissionFlagsBits.ViewChannel, 'Ver canal'],
    [discord_js_1.PermissionFlagsBits.SendMessages, 'Enviar mensagens'],
    [discord_js_1.PermissionFlagsBits.ReadMessageHistory, 'Ver histórico de mensagens'],
    // Sem isto o bot nao consegue dar (nem tirar) o acesso de cada cliente.
    [discord_js_1.PermissionFlagsBits.ManageRoles, 'Gerenciar cargos'],
];
async function resolveDeliveredChannel(guild, config) {
    const channel = await (0, discord_1.fetchChannelSafe)(guild, config.deliveredLocatorChannelId);
    return channel !== null && channel.type === discord_js_1.ChannelType.GuildText ? channel : null;
}
/**
 * Publica (ou reescreve) o painel do canal de entregas.
 *
 * Volta como mais uma linha do relatorio de `/ticket-painel localizadores`: e
 * por la que os localizadores sao publicados, e um painel que saisse por outro
 * caminho deixaria o administrador sem saber se ele existe.
 */
async function publishDeliveredLocator(guild, config) {
    const base = {
        categoryName: 'Entregas',
        channelId: config.deliveredLocatorChannelId,
        published: false,
        missingPermissions: [],
        missingRoles: [],
    };
    if (sharesStaffChannel(config)) {
        return {
            ...base,
            reason: 'é o mesmo canal dos cartões da equipe — cada cliente veria as vendas dos outros. ' +
                'Aponte os dois para canais diferentes em `/demandas canais`',
        };
    }
    const channel = await resolveDeliveredChannel(guild, config);
    if (channel === null) {
        return { ...base, reason: 'o canal configurado não é um canal de texto acessível' };
    }
    const me = guild.members.me;
    const permissions = me === null ? null : channel.permissionsFor(me);
    const missingPermissions = DELIVERED_BOT_PERMISSIONS.filter(([flag]) => permissions === null || !permissions.has(flag)).map(([, label]) => label);
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
    for (const userId of await (0, TicketRepository_1.listOwnersWithDeliveredOpenTickets)(guild.id)) {
        await grantDeliveredLocatorAccess(guild, userId);
    }
    const panel = (0, TicketLocatorBuilder_1.buildDeliveredLocatorPanel)(config);
    if (config.deliveredLocatorMessageId !== null) {
        try {
            const existing = await channel.messages.fetch(config.deliveredLocatorMessageId);
            await existing.edit({
                components: [panel],
                flags: discord_js_1.MessageFlags.IsComponentsV2,
                allowedMentions: discord_1.NO_MENTIONS,
            });
            return { ...base, channelId: channel.id, published: true };
        }
        catch (error) {
            // Mensagem apagada a mao: cai para o envio de uma nova.
            if (!(0, discord_1.isUnknownResourceError)(error))
                throw error;
        }
    }
    const message = await (0, reply_1.sendV2)(channel, panel);
    await (0, GuildConfigService_1.updateGuildConfig)(guild.id, { deliveredLocatorMessageId: message.id });
    logger.info('Painel de entregas publicado.', { guildId: guild.id, channelId: channel.id });
    return { ...base, channelId: channel.id, published: true };
}
/**
 * Da ao cliente acesso ao canal de entregas. Chamado na entrega.
 *
 * NUNCA LANCA: o produto ja foi entregue quando isto roda, e o cliente ainda
 * tem a DM e o link do proprio ticket.
 */
async function grantDeliveredLocatorAccess(guild, userId) {
    try {
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        if (config.deliveredLocatorChannelId === null)
            return false;
        if (sharesStaffChannel(config)) {
            logger.warn('Canal de entregas e o mesmo dos cartoes da equipe: acesso NAO concedido.', {
                guildId: guild.id,
                channelId: config.deliveredLocatorChannelId,
                userId,
            });
            return false;
        }
        const channel = await resolveDeliveredChannel(guild, config);
        if (channel === null)
            return false;
        /*
         * `type: Member` e obrigatorio aqui. Sem ele o discord.js procura o id no
         * cache de usuarios para descobrir se e membro ou cargo — e o dono do
         * ticket nem sempre esta em cache. A busca falhava com "User nor a Role",
         * o `catch` abaixo virava WARN, e o cliente ficava sem acesso ao canal sem
         * ninguem saber.
         */
        await channel.permissionOverwrites.edit(userId, DELIVERED_CLIENT_OVERWRITE, {
            reason: 'Entrega aguardando a confirmacao do cliente',
            type: discord_js_1.OverwriteType.Member,
        });
        return true;
    }
    catch (error) {
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
async function revokeDeliveredLocatorAccess(guild, userId, closedTicketId) {
    try {
        const config = await (0, GuildConfigService_1.getGuildConfig)(guild.id);
        const channel = await resolveDeliveredChannel(guild, config);
        if (channel === null)
            return;
        const pendentes = await (0, TicketRepository_1.listDeliveredOpenTickets)(guild.id, userId, closedTicketId);
        if (pendentes.length > 0)
            return;
        await channel.permissionOverwrites.delete(userId, 'Nenhuma entrega aguardando confirmacao');
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return;
        logger.warn('Nao foi possivel tirar o acesso ao canal de entregas.', {
            guildId: guild.id,
            userId,
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}
//# sourceMappingURL=TicketLocatorService.js.map