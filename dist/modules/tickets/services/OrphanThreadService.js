"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findOrphanThreads = findOrphanThreads;
exports.deleteOrphanThreads = deleteOrphanThreads;
const discord_js_1 = require("discord.js");
const Logger_1 = require("../../../core/logger/Logger");
const prisma_1 = require("../../../core/database/prisma");
const discord_1 = require("../../../utils/discord");
const TicketConfigService_1 = require("./TicketConfigService");
/**
 * Topicos de ticket que o banco nao conhece.
 *
 * COMO ELES NASCEM. A abertura de um ticket cria o topico e SO DEPOIS termina o
 * resto (acesso do cliente, painel, ping da equipe). Quando um desses passos
 * falhava, o servico de criacao apagava o rascunho do banco e o topico ficava
 * para tras — vazio, so com o bot dentro, sem painel e sem ninguem conseguir
 * fecha-lo pelo bot. Isso foi corrigido (a criacao agora remove o proprio
 * topico ao falhar), mas os que ja existiam continuam la.
 *
 * SO TOPICOS ATIVOS SAO VARRIDOS. Um ticket encerrado e trancado e arquivado
 * pelo bot, e todo ticket encerrado TEM registro no banco — orfao arquivado nao
 * existe. Varrer os arquivados custaria uma chamada a mais por canal para
 * procurar uma categoria que nao ocorre.
 *
 * O CRITERIO E CONSERVADOR. So entra o que casa com o padrao de nome que o
 * proprio bot gera (`ticket-0000`) E nao aparece em nenhuma linha da tabela de
 * tickets, de qualquer status. Um topico criado a mao pela equipe, com outro
 * nome, nunca e tocado.
 */
const logger = (0, Logger_1.createLogger)('ticket:orphans');
/** Exatamente o formato de `buildTicketChannelName`. */
const TICKET_THREAD_NAME = /^ticket-\d{4,}$/;
/** Canais de destino distintos, de todas as categorias vivas da guild. */
async function destinationChannelIds(guildId) {
    const categories = await (0, TicketConfigService_1.getCategories)(guildId);
    const ids = new Set();
    for (const category of categories) {
        if (category.deletedAt !== null)
            continue;
        if (category.destinationChannelId !== null)
            ids.add(category.destinationChannelId);
    }
    return [...ids];
}
/** Todo channelId ja registrado como ticket nesta guild, em qualquer status. */
async function knownTicketChannelIds(guildId) {
    const rows = await (0, prisma_1.getPrisma)().ticket.findMany({
        where: { guildId, channelId: { not: null } },
        select: { channelId: true },
    });
    return new Set(rows.flatMap((row) => (row.channelId === null ? [] : [row.channelId])));
}
/** True quando o topico parece um ticket gerado pelo bot. */
function looksLikeTicketThread(thread) {
    return TICKET_THREAD_NAME.test(thread.name);
}
/**
 * Lista os topicos orfaos da guild.
 *
 * Melhor-esforco por canal: um destino inacessivel e pulado com warning em vez
 * de derrubar a varredura inteira — o diagnostico precisa responder mesmo com
 * um canal quebrado no meio.
 */
async function findOrphanThreads(guild) {
    const [destinations, known] = await Promise.all([
        destinationChannelIds(guild.id),
        knownTicketChannelIds(guild.id),
    ]);
    const orphans = [];
    for (const channelId of destinations) {
        const channel = await (0, discord_1.fetchChannelSafe)(guild, channelId);
        if (channel === null || channel.type !== discord_js_1.ChannelType.GuildText)
            continue;
        try {
            const active = await channel.threads.fetchActive();
            for (const thread of active.threads.values()) {
                if (!looksLikeTicketThread(thread) || known.has(thread.id))
                    continue;
                orphans.push({
                    id: thread.id,
                    name: thread.name,
                    parentId: channelId,
                    createdAt: thread.createdAt,
                });
            }
        }
        catch (error) {
            logger.warn('Nao foi possivel listar os topicos do canal de destino.', {
                guildId: guild.id,
                channelId,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return orphans.sort((a, b) => a.name.localeCompare(b.name));
}
/**
 * Apaga os topicos orfaos informados.
 *
 * RECEBE A LISTA, nao a recalcula. Quem chama ja mostrou essa lista ao operador
 * e obteve a confirmacao; recalcular aqui apagaria um topico que ele nunca viu
 * — inclusive um ticket legitimo aberto entre a previa e o clique.
 */
async function deleteOrphanThreads(guild, orphans) {
    let deleted = 0;
    let failed = 0;
    for (const orphan of orphans) {
        const channel = await (0, discord_1.fetchChannelSafe)(guild, orphan.id);
        /*
         * Reconfirma que ainda e um topico com nome de ticket antes de apagar. O id
         * veio de uma mensagem que pode estar aberta ha minutos, e apagar canal por
         * id antigo e o tipo de engano que nao tem desfazer.
         */
        if (channel === null || !channel.isThread() || !looksLikeTicketThread(channel)) {
            failed += 1;
            continue;
        }
        try {
            await channel.delete(`Topico orfao de ticket removido por ${guild.id}`);
            deleted += 1;
        }
        catch (error) {
            failed += 1;
            logger.warn('Falha ao apagar topico orfao.', {
                guildId: guild.id,
                channelId: orphan.id,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    logger.info('Limpeza de topicos orfaos concluida.', {
        guildId: guild.id,
        deleted,
        failed,
    });
    return { deleted, failed };
}
//# sourceMappingURL=OrphanThreadService.js.map