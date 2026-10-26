"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketChannelName = buildTicketChannelName;
exports.isTicketThread = isTicketThread;
exports.resolveDestinationChannel = resolveDestinationChannel;
exports.applyDestinationPermissions = applyDestinationPermissions;
exports.missingDestinationPermissions = missingDestinationPermissions;
exports.grantDestinationAccess = grantDestinationAccess;
exports.revokeDestinationAccess = revokeDestinationAccess;
exports.createTicketChannel = createTicketChannel;
exports.renameTicketChannel = renameTicketChannel;
exports.grantChannelAccess = grantChannelAccess;
exports.revokeChannelAccess = revokeChannelAccess;
exports.reopenIfArchived = reopenIfArchived;
exports.deleteTicketChannel = deleteTicketChannel;
exports.resolveTicketChannel = resolveTicketChannel;
exports.buildTicketOverwrites = buildTicketOverwrites;
const discord_js_1 = require("discord.js");
const errors_1 = require("../../../core/errors");
const Logger_1 = require("../../../core/logger/Logger");
const discord_1 = require("../../../utils/discord");
const sanitize_1 = require("../../../utils/sanitize");
/**
 * O ticket e um TOPICO PRIVADO dentro do canal de destino da categoria.
 *
 * POR QUE TOPICO E NAO CANAL. Um canal por ticket esbarra no teto de 500 canais
 * por servidor: uma loja movimentada fecha ticket so para poder abrir o
 * proximo. Topico nao consome slot nenhum, entao o limite de atendimentos
 * simultaneos passa a ser o do negocio, nao o do Discord. E o canal de destino
 * (ex.: #duvidas) ganha um papel util: e onde vive o painel de localizar.
 *
 * A DIFERENCA QUE MUDA TUDO: topico NAO aceita permissao propria. Ele herda do
 * canal-pai, e quem enxerga um topico privado sao (1) seus membros e (2) quem
 * tem `ManageThreads` no pai. Por isso o acesso da EQUIPE e resolvido uma vez
 * so, nas permissoes do canal de destino (`applyDestinationPermissions`), e o
 * acesso do CLIENTE e resolvido membro a membro dentro do topico.
 *
 * TICKETS ANTIGOS CONTINUAM VALENDO. Quem ja tinha canal proprio nao e migrado:
 * cada operacao aqui aceita canal de texto ou topico e faz a coisa certa para
 * cada um. Renomear, dar acesso e fechar funcionam nos dois.
 */
const logger = (0, Logger_1.createLogger)('ticket:channel');
/** Duracao de inatividade antes do arquivamento automatico: 7 dias. */
const AUTO_ARCHIVE_MINUTES = 10_080;
/**
 * Permissoes de quem participa de um ticket LEGADO (canal proprio).
 *
 * Nao valem para topico: la o acesso e ser membro do topico, e sao estas
 * mesmas capacidades que o canal-pai concede a quem consegue enxerga-lo.
 */
const MEMBER_ALLOW = [
    discord_js_1.PermissionFlagsBits.ViewChannel,
    discord_js_1.PermissionFlagsBits.SendMessages,
    discord_js_1.PermissionFlagsBits.ReadMessageHistory,
    discord_js_1.PermissionFlagsBits.AttachFiles,
    discord_js_1.PermissionFlagsBits.EmbedLinks,
    discord_js_1.PermissionFlagsBits.AddReactions,
];
const BOT_ALLOW = [
    ...MEMBER_ALLOW,
    discord_js_1.PermissionFlagsBits.ManageChannels,
    discord_js_1.PermissionFlagsBits.ManageMessages,
];
/**
 * O canal de destino e OCULTO por padrao.
 *
 * Quem nao tem atendimento aberto nao ve `#duvidas` na lista de canais: o canal
 * so existe para quem esta sendo atendido. O acesso e concedido pessoa a pessoa
 * na abertura do ticket (`grantDestinationAccess`) e retirado quando o ultimo
 * ticket dela naquela categoria fecha.
 *
 * Criar topico continua negado mesmo para quem enxerga: ticket nasce pelo
 * formulario, com numero e registro no banco — nunca por alguem clicando em
 * "criar topico" no canal.
 */
const EVERYONE_OVERWRITE = {
    ViewChannel: false,
    SendMessages: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
};
/**
 * O que o CLIENTE ganha enquanto tem atendimento aberto.
 *
 * `SendMessagesInThreads` e separada de `SendMessages`: ele escreve DENTRO do
 * topico e nunca no canal em si, que continua sendo so o mural do painel de
 * localizar.
 *
 * VER O PAI E PRE-REQUISITO PARA VER O TOPICO. Nao basta ser membro do topico
 * privado — sem `ViewChannel` no canal-pai o Discord simplesmente nao mostra a
 * conversa. E por isso que esta concessao acompanha toda entrada em ticket,
 * seja do dono ou de um participante adicional.
 */
const CLIENT_OVERWRITE = {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessagesInThreads: true,
    AttachFiles: true,
    EmbedLinks: true,
    AddReactions: true,
};
/**
 * O que a EQUIPE precisa no canal de destino.
 *
 * `ManageThreads` e o item que nao pode faltar: e literalmente o que faz um
 * topico privado aparecer para quem nao foi adicionado a ele. Sem essa
 * permissao a equipe nao ve ticket nenhum, e o sintoma e mudo — nenhum erro,
 * simplesmente uma lista vazia.
 */
const TEAM_OVERWRITE = {
    ViewChannel: true,
    ReadMessageHistory: true,
    ManageThreads: true,
    SendMessagesInThreads: true,
    AttachFiles: true,
    EmbedLinks: true,
    AddReactions: true,
};
/** O que o BOT precisa no canal de destino. */
const BOT_OVERWRITE = {
    ...TEAM_OVERWRITE,
    SendMessages: true,
    CreatePrivateThreads: true,
    ManageMessages: true,
};
/**
 * Permissoes do BOT sem as quais o fluxo nao roda, com o nome que o
 * administrador ve na tela do Discord.
 *
 * O rotulo vem junto de proposito: dizer "falta 0x400000000" nao ajuda ninguem
 * a consertar, e este e o erro que mais vai aparecer na primeira configuracao.
 */
const REQUIRED_BOT_PERMISSIONS = [
    [discord_js_1.PermissionFlagsBits.ViewChannel, 'Ver canal'],
    [discord_js_1.PermissionFlagsBits.SendMessages, 'Enviar mensagens'],
    [discord_js_1.PermissionFlagsBits.ReadMessageHistory, 'Ver histórico de mensagens'],
    [discord_js_1.PermissionFlagsBits.CreatePrivateThreads, 'Criar tópicos privados'],
    [discord_js_1.PermissionFlagsBits.SendMessagesInThreads, 'Enviar mensagens em tópicos'],
    [discord_js_1.PermissionFlagsBits.ManageThreads, 'Gerenciar tópicos'],
    [discord_js_1.PermissionFlagsBits.EmbedLinks, 'Inserir links'],
    [discord_js_1.PermissionFlagsBits.AttachFiles, 'Anexar arquivos'],
];
function buildTicketChannelName(ticketNumber) {
    return (0, sanitize_1.sanitizeChannelName)(`ticket-${String(ticketNumber).padStart(4, '0')}`);
}
/** True quando a conversa e um topico (ticket novo), nao um canal legado. */
function isTicketThread(channel) {
    return channel.isThread();
}
// ---------------------------------------------------------------------------
// Canal de destino
// ---------------------------------------------------------------------------
/** Canal de texto onde os topicos desta categoria sao criados. */
async function resolveDestinationChannel(guild, destinationChannelId) {
    if (destinationChannelId === null || destinationChannelId.length === 0)
        return null;
    const channel = await (0, discord_1.fetchChannelSafe)(guild, destinationChannelId);
    if (channel === null) {
        logger.warn('Canal de destino nao encontrado.', {
            guildId: guild.id,
            entityType: 'channel',
            entityId: destinationChannelId,
        });
        return null;
    }
    if (channel.type !== discord_js_1.ChannelType.GuildText) {
        // Caminho comum logo apos a migracao: o valor antigo aponta para uma
        // CATEGORIA do Discord, que nao hospeda topico.
        logger.warn('Destino configurado nao e um canal de texto.', {
            guildId: guild.id,
            entityType: 'channel',
            entityId: destinationChannelId,
            actualType: channel.type,
        });
        return null;
    }
    return channel;
}
/**
 * Grava no canal de destino as permissoes que o fluxo de topicos exige.
 *
 * E uma acao EXPLICITA do administrador (sai do comando que publica o painel),
 * nunca um efeito colateral de abrir ticket: mexer sozinho nas permissoes de um
 * canal que nao e nosso seria uma surpresa desagradavel no meio de um
 * atendimento.
 *
 * Sem `ManageRoles` o bot nao consegue escrever overwrite nenhum. Nesse caso a
 * funcao devolve `applied: false` em vez de lancar — quem chamou avisa o
 * administrador com a lista do que ajustar na mao.
 */
async function applyDestinationPermissions(guild, channel, teamRoleIds) {
    const me = guild.members.me;
    if (me === null || !channel.permissionsFor(me).has(discord_js_1.PermissionFlagsBits.ManageRoles)) {
        return { applied: false, missingRoles: [] };
    }
    const missingRoles = [];
    const reason = 'Permissoes do canal de tickets (topicos privados)';
    /*
     * `edit` e nao `set`: `set` apagaria overwrites que o administrador criou
     * por outros motivos (um cargo silenciado, um bot de log). So os ids que este
     * fluxo precisa sao tocados.
     */
    await channel.permissionOverwrites.edit(guild.roles.everyone, EVERYONE_OVERWRITE, { reason });
    await channel.permissionOverwrites.edit(guild.client.user.id, BOT_OVERWRITE, { reason });
    for (const roleId of new Set(teamRoleIds)) {
        if (!guild.roles.cache.has(roleId)) {
            missingRoles.push(roleId);
            continue;
        }
        await channel.permissionOverwrites.edit(roleId, TEAM_OVERWRITE, { reason });
    }
    if (missingRoles.length > 0) {
        logger.warn('Cargos de equipe configurados nao existem mais.', {
            guildId: guild.id,
            channelId: channel.id,
            roles: missingRoles,
        });
    }
    return { applied: true, missingRoles };
}
/** Permissoes que faltam ao BOT no canal de destino, ja com nome legivel. */
function missingDestinationPermissions(guild, channel) {
    const me = guild.members.me;
    const labels = REQUIRED_BOT_PERMISSIONS.map(([, label]) => label);
    if (me === null)
        return labels;
    const permissions = channel.permissionsFor(me);
    return REQUIRED_BOT_PERMISSIONS.filter(([flag]) => !permissions.has(flag)).map(([, label]) => label);
}
/**
 * Da ao cliente acesso ao canal de destino.
 *
 * Sem `ManageRoles` o bot nao consegue gravar o overwrite. Devolve `false` em
 * vez de lancar: a alternativa seria derrubar a abertura do ticket por causa de
 * uma permissao do canal, e um ticket criado que o cliente nao ve ainda pode ser
 * consertado; um ticket que nao existe, nao.
 */
async function grantDestinationAccess(channel, userId, reason) {
    const me = channel.guild.members.me;
    if (me === null || !channel.permissionsFor(me).has(discord_js_1.PermissionFlagsBits.ManageRoles)) {
        logger.warn('Sem ManageRoles no canal de destino: acesso do cliente nao concedido.', {
            guildId: channel.guild.id,
            channelId: channel.id,
            userId,
        });
        return false;
    }
    /*
     * `type: Member` porque so temos o ID. Sem ele o discord.js procura o id no
     * cache para decidir se e membro ou cargo, e lanca "User nor a Role" quando o
     * cliente nao esta la — o caso comum na republicacao dos localizadores, que
     * da acesso de uma vez a todo mundo com ticket aberto. Um unico cliente fora
     * do cache derrubava o lote da categoria inteira.
     */
    await channel.permissionOverwrites.edit(userId, CLIENT_OVERWRITE, {
        reason,
        type: discord_js_1.OverwriteType.Member,
    });
    return true;
}
/**
 * Tira o acesso ao canal de destino.
 *
 * Chamado quando o ULTIMO ticket da pessoa naquela categoria termina — quem
 * ainda tem outro atendimento aberto continua enxergando o canal. Some sem
 * lancar quando o overwrite ja nao existe.
 */
async function revokeDestinationAccess(channel, userId, reason) {
    try {
        await channel.permissionOverwrites.delete(userId, reason);
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return;
        throw error;
    }
}
/**
 * Cria o topico privado do ticket e adiciona o cliente.
 *
 * O destino e OBRIGATORIO: sem canal configurado nao ha onde criar topico.
 * Antes um destino ausente apenas jogava o canal na raiz do servidor; agora
 * isso vira erro com instrucao, porque a alternativa silenciosa nao existe.
 */
async function createTicketChannel(params) {
    const destination = await resolveDestinationChannel(params.guild, params.destinationChannelId);
    if (destination === null) {
        throw new errors_1.ConfigurationError('Categoria sem canal de destino valido.', {
            userMessage: 'Esta categoria ainda nao tem um canal de atendimento configurado. Avise um administrador.',
            context: { guildId: params.guild.id, categoryName: params.categoryName },
        });
    }
    const missing = missingDestinationPermissions(params.guild, destination);
    if (missing.length > 0) {
        throw new errors_1.ConfigurationError('Bot sem permissao no canal de destino.', {
            userMessage: 'O bot nao tem as permissoes necessarias no canal de atendimento. Avise um administrador.',
            context: { guildId: params.guild.id, channelId: destination.id },
        });
    }
    let thread = null;
    try {
        thread = await destination.threads.create({
            name: buildTicketChannelName(params.ticketNumber),
            type: discord_js_1.ChannelType.PrivateThread,
            /*
             * `invitable: false`: so quem tem `ManageThreads` (a equipe) adiciona
             * gente. Sem isso, o proprio cliente poderia trazer terceiros para dentro
             * de um atendimento que costuma tratar de dado pessoal e pagamento.
             */
            invitable: false,
            autoArchiveDuration: AUTO_ARCHIVE_MINUTES,
            reason: `Ticket #${params.ticketNumber} aberto por ${params.ownerId}`,
        });
        /*
         * DUAS concessoes, e as duas sao necessarias:
         *  1. `ViewChannel` no canal-pai — sem isso o Discord nao mostra o topico
         *     nem para quem e membro dele;
         *  2. membro do topico — o que torna o topico privado visivel para ele.
         *
         * A ORDEM NAO E DETALHE, e ela ja custou um bug. O Discord so entrega
         * eventos de topico a clientes que enxergam o canal-pai. Adicionando a
         * pessoa ao topico ANTES de ela ter `ViewChannel` no pai, o `THREAD_CREATE`
         * nao chega ao cliente dela: ela vira membro de verdade, mas o topico so
         * aparece na lista depois de reiniciar o Discord. Concedendo o pai
         * primeiro, o topico aparece sozinho no momento em que e criado.
         *
         * A equipe nao entra em nenhuma das duas: ela enxerga tudo por
         * `ManageThreads`, concedido ao cargo uma vez so.
         */
        await grantDestinationAccess(destination, params.ownerId, `Ticket #${params.ticketNumber} aberto`);
        await thread.members.add(params.ownerId);
        return thread;
    }
    catch (error) {
        /*
         * LIMPEZA DO TOPICO ORFAO.
         *
         * `threads.create` e a primeira operacao do bloco, entao qualquer falha
         * depois dela deixava para tras um topico vazio — so com o bot, sem painel
         * e sem registro no banco, porque o service de criacao apaga o rascunho ao
         * receber este erro. Eram esses os `ticket-000X` fantasmas que apareciam na
         * lista de canais e que ninguem conseguia fechar pelo bot.
         *
         * A remocao e best-effort: se ela tambem falhar, o erro que importa e o
         * original, nao o da limpeza.
         */
        if (thread !== null) {
            await thread
                .delete(`Abertura do ticket #${params.ticketNumber} falhou`)
                .catch(() => undefined);
        }
        // O DiscordResourceError carrega a causa, mas o handler de interacao so
        // imprime a mensagem de topo — sem esta linha o motivo real se perdia.
        logger.warn('Falha ao preparar o topico do ticket; topico removido.', {
            guildId: params.guild.id,
            channelId: destination.id,
            entityType: 'ticket',
            entityId: String(params.ticketNumber),
            detail: error instanceof Error ? error.message : String(error),
        });
        throw new errors_1.DiscordResourceError('Falha ao criar o topico do ticket.', {
            userMessage: 'Nao foi possivel criar o seu atendimento. Tente novamente em instantes.',
            context: { guildId: params.guild.id, ticketNumber: params.ticketNumber },
            cause: error,
        });
    }
}
// ---------------------------------------------------------------------------
// Operacoes sobre a conversa
// ---------------------------------------------------------------------------
async function renameTicketChannel(channel, newName, reason) {
    const safeName = (0, sanitize_1.sanitizeChannelName)(newName, channel.name);
    await channel.setName(safeName, reason);
    return safeName;
}
/**
 * Da acesso a um participante adicional.
 *
 * Topico: vira membro. Canal legado: ganha overwrite. Sao mecanismos
 * diferentes para o mesmo resultado, e por isso a decisao fica aqui e nao
 * espalhada pelos services que chamam.
 */
async function grantChannelAccess(channel, member, reason) {
    if (isTicketThread(channel)) {
        /*
         * SEM `reason`. O Discord nao registra motivo em entrada de topico — a
         * propria discord.js marca o parametro como deprecado — e passa-lo so
         * enchia o log de DeprecationWarning. O motivo continua indo para o audit
         * log do bot, que e onde ele de fato e consultado.
         */
        await channel.members.add(member.id);
        return;
    }
    await channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
        AddReactions: true,
    }, { reason });
}
/** Remove o acesso de um participante. */
async function revokeChannelAccess(channel, userId, reason) {
    try {
        if (isTicketThread(channel)) {
            await channel.members.remove(userId, reason);
            return;
        }
        await channel.permissionOverwrites.delete(userId, reason);
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return;
        throw error;
    }
}
/**
 * Reabre um topico arquivado; nao faz nada com canal legado ou topico ativo.
 *
 * Topico arquivado nao aceita edicao nem, conforme o caso, mensagem do bot. Ele
 * fica arquivado por dois motivos, e os dois deixam o ticket ABERTO no banco: o
 * Discord arquiva sozinho depois de 7 dias parado, e a entrega do produto
 * arquiva de proposito para tirar o ticket da lista de ativos.
 *
 * Quem vai ESCREVER na conversa chama isto antes. Quem so le (transcript,
 * diagnostico) nao precisa — e reabrir sem necessidade traria o ticket de volta
 * a lista de ativos.
 *
 * Topico TRANCADO tambem e reaberto: quem chama decide se pode escrever nele
 * (o fechamento pode; a entrega recusa antes de chegar aqui).
 */
async function reopenIfArchived(channel, reason) {
    if (!isTicketThread(channel) || channel.archived !== true)
        return;
    await channel.setArchived(false, reason);
}
/**
 * Encerra a conversa do ticket.
 *
 * TOPICO E ARQUIVADO E TRANCADO, nao apagado. Ele sai da lista do canal mas
 * continua consultavel pela equipe, e trancado ninguem reabre a conversa por
 * engano. Guardar nao custa nada — topico arquivado nao ocupa slot de canal —,
 * e o transcript HTML continua sendo gerado do mesmo jeito, para quem precisa
 * do historico fora do Discord.
 *
 * A ordem importa: TRANCA e depois arquiva. Arquivar primeiro faria a segunda
 * chamada reabrir o topico para poder edita-lo.
 *
 * Canal legado continua sendo APAGADO: e o comportamento com que ele foi
 * criado, e um canal vazio a mais na lista e justamente o que se quis evitar.
 */
async function deleteTicketChannel(channel, reason) {
    try {
        if (isTicketThread(channel)) {
            /*
             * Topico JA ARQUIVADO precisa ser reaberto antes de ser trancado.
             *
             * O Discord so aceita editar um topico arquivado se a propria edicao o
             * desarquivar — trancar direto e recusado. A recusa caia no `catch` de
             * quem chama e virava so um WARN: o ticket fechava no banco, mas o topico
             * ficava DESTRANCADO, e qualquer mensagem do cliente reabria um
             * atendimento encerrado.
             *
             * Antes isso so acontecia com ticket parado 7 dias (o proprio Discord
             * arquiva). Desde que a entrega do produto arquiva o topico, passou a ser
             * o caminho comum de todo ticket entregue.
             */
            await reopenIfArchived(channel, reason);
            await channel.setLocked(true, reason);
            await channel.setArchived(true, reason);
            return { outcome: 'archived' };
        }
        await channel.delete(reason);
        return { outcome: 'deleted' };
    }
    catch (error) {
        if ((0, discord_1.isUnknownResourceError)(error))
            return { outcome: 'gone' };
        throw error;
    }
}
/**
 * Busca a conversa do ticket; null quando removida.
 *
 * Aceita topico E canal de texto de proposito: tickets abertos antes da mudanca
 * continuam vivendo em canais proprios, e recusa-los aqui os tornaria
 * invisiveis para fechar, renomear e transferir.
 */
async function resolveTicketChannel(guild, channelId) {
    const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
    if (channel === null)
        return null;
    if (channel.isThread()) {
        /*
         * Topico arquivado e reaberto ao ser tocado. Nao reabrimos aqui: quem
         * resolve pode estar so lendo (transcript, diagnostico). Quem precisa
         * escrever trata o `archived` no proprio ponto de uso.
         */
        return channel;
    }
    if (channel.type !== discord_js_1.ChannelType.GuildText)
        return null;
    return channel;
}
/** Overwrites de um ticket LEGADO. Mantido para o recovery de canais antigos. */
function buildTicketOverwrites(params) {
    const botId = params.guild.client.user.id;
    const overwrites = [
        { id: params.guild.roles.everyone.id, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
        { id: botId, allow: [...BOT_ALLOW] },
        { id: params.ownerId, allow: [...MEMBER_ALLOW] },
    ];
    for (const roleId of new Set(params.teamRoleIds)) {
        if (!params.guild.roles.cache.has(roleId))
            continue;
        overwrites.push({ id: roleId, allow: [...MEMBER_ALLOW] });
    }
    for (const userId of new Set(params.participantIds ?? [])) {
        overwrites.push({ id: userId, allow: [...MEMBER_ALLOW] });
    }
    return overwrites;
}
//# sourceMappingURL=TicketChannelService.js.map