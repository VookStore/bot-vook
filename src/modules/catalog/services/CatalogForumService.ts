import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Routes, type REST, type APIMessage, type APIGuildForumChannel, type APIThreadChannel } from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import { buttonRow } from '../../../components/v2';
import { CATALOG_ACTION, LICENSE_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { getPrisma } from '../../../core/database/prisma';
import { ValidationError } from '../../../core/errors';
import { truncate } from '../../../utils/sanitize';
import { SCRIPT_IMAGES, isScriptPreview } from '../scriptProducts';
import { releaseEndpoint } from '../../licenses/packages';

type ForumDatabase = Pick<PrismaClient, 'catalogPack' | 'catalogForumPost'>;
const noMentions = { parse: [] as never[] };
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && [10003, 10008].includes(Number(error.code));

/** Sincroniza tópicos do bot, preservando comentários e os controles de acesso do fórum. */
export async function syncCatalogForum(rest: REST, guildId: string, forumId: string, botId: string, db: ForumDatabase = getPrisma()) {
    const forum = await rest.get(Routes.channel(forumId)) as APIGuildForumChannel;
    if (forum.type !== ChannelType.GuildForum || forum.guild_id !== guildId) throw new ValidationError('Selecione um fórum deste servidor.');
    const packs = await db.catalogPack.findMany({ where: { guildId, deletedAt: null, enabled: true, category: { enabled: true, deletedAt: null } }, include: { images: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }, details: { orderBy: { position: 'asc' } } }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    const active = await rest.get(Routes.guildActiveThreads(guildId)) as { threads: APIThreadChannel[] };
    const threads = [];
    for (const pack of packs) {
        const cover = pack.images.find(image => image.isCover) ?? pack.images[0];
        const preview = isScriptPreview(pack);
        const description = preview ? (pack.shortDescription?.trim() || 'Conheça esta coleção e confira o conteúdo em Ver detalhes.') : [pack.description ?? pack.shortDescription ?? '',
            pack.details.filter(detail => !['Disponibilidade', 'Licença'].includes(detail.label)).slice(0, 6).map(detail => `**${detail.label}:** ${detail.value}`).join('\n'),
        ].filter(Boolean).join('\n\n');
        const embed = new EmbedBuilder().setTitle(truncate(pack.name, 200)).setDescription(truncate(description, preview ? 240 : 3800));
        if (preview) embed.setFooter({ text: 'VOOK · Catálogo de apresentação' });
        if (cover) embed.setImage(cover.url);
        const buttons = [new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PACK_INFO, pack.id)).setLabel('Ver detalhes').setStyle(ButtonStyle.Secondary)];
        if (pack.images.length > 1) buttons.push(new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PACK_VIEW, pack.id, '1')).setLabel('Ver outras artes').setStyle(ButtonStyle.Secondary));
        buttons.push(new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.LICENSE, LICENSE_ACTION.LIST, '0')).setLabel('Meus arquivos').setStyle(ButtonStyle.Secondary));
        const title = truncate(pack.name, 100);
        const tagName = /COMP-/.test(pack.sku ?? '') ? 'Coleções' : 'Sistemas';
        const tag = forum.available_tags.find(value => value.name === tagName);
        const tags = tag ? [tag.id] : [];
        const hash = createHash('sha256').update(JSON.stringify({ title, embed: embed.toJSON(), buttons: buttons.map(b => b.toJSON()), tags })).digest('hex');
        let publication = await db.catalogForumPost.findUnique({ where: { guildId_packId: { guildId, packId: pack.id } } });
        let thread: APIThreadChannel | undefined;
        if (publication?.forumId === forumId) {
            try { thread = await rest.get(Routes.channel(publication.threadId)) as APIThreadChannel; }
            catch (error) { if (!missing(error)) throw error; }
        }
        if (!thread) {
            const candidates = active.threads.filter(t => t.parent_id === forumId && t.owner_id === botId && t.name === title);
            if (candidates.length > 1) throw new ValidationError('Há tópicos repetidos deste produto. Revise antes de sincronizar.');
            thread = candidates[0];
            if (thread) {
                publication = await db.catalogForumPost.upsert({ where: { guildId_packId: { guildId, packId: pack.id } },
                    create: { guildId, packId: pack.id, forumId, threadId: thread.id, messageId: thread.id, contentHash: '' },
                    update: { forumId, threadId: thread.id, messageId: thread.id, contentHash: '' } });
            }
        }
        if (thread && (thread.parent_id !== forumId || thread.guild_id !== guildId || thread.owner_id !== botId)) throw new ValidationError('O tópico vinculado não pertence a este catálogo do bot.');
        if (thread && publication?.contentHash === hash && !thread.thread_metadata?.archived) {
            threads.push({ packId: pack.id, threadId: thread.id, changed: false });
            continue;
        }
        // Somente arte local já publicada pelo bot vira anexo. URLs externas ficam a cargo do Discord.
        const filename = cover?.url.startsWith(`${new URL(releaseEndpoint()).origin}/catalog-assets/`) ? cover.url.split('/').pop() : undefined;
        const local = filename && Object.values(SCRIPT_IMAGES).flat().includes(filename) ? await readFile(join(process.cwd(), 'assets', 'catalog', filename)) : undefined;
        if (local && filename) embed.setImage(`attachment://${filename}`);
        const message = { content: '', embeds: [embed.toJSON()], components: [buttonRow(...buttons).toJSON()], allowed_mentions: noMentions,
            attachments: local && filename ? [{ id: '0', filename }] : [] };
        const files = local && filename ? [{ name: filename, data: local, contentType: 'image/png' }] : [];
        let messageId: string;
        if (!thread) {
            const created = await rest.post(Routes.threads(forumId), { body: { name: title, auto_archive_duration: forum.default_auto_archive_duration ?? 1440, applied_tags: tags, message }, files }) as APIThreadChannel & { message?: APIMessage };
            thread = created;
            messageId = created.message?.id ?? created.id;
            active.threads.push(created);
        } else {
            messageId = publication?.messageId ?? thread.id;
            const current = await rest.get(Routes.channelMessage(thread.id, messageId)) as APIMessage;
            if (current.author.id !== botId) throw new ValidationError('A mensagem inicial não pertence ao bot.');
            await rest.patch(Routes.channel(thread.id), { body: { name: title, archived: false, applied_tags: tags } });
            await rest.patch(Routes.channelMessage(thread.id, messageId), { body: message, files });
        }
        await db.catalogForumPost.upsert({ where: { guildId_packId: { guildId, packId: pack.id } },
            create: { guildId, packId: pack.id, forumId, threadId: thread.id, messageId, contentHash: hash },
            update: { forumId, threadId: thread.id, messageId, contentHash: hash } });
        threads.push({ packId: pack.id, threadId: thread.id, changed: true });
    }
    const published = await db.catalogForumPost.findMany({ where: { guildId, forumId } });
    for (const item of published) if (!packs.some(pack => pack.id === item.packId)) {
        try {
            const thread = await rest.get(Routes.channel(item.threadId)) as APIThreadChannel;
            if (thread.parent_id === forumId && thread.owner_id === botId) await rest.patch(Routes.channel(item.threadId), { body: { archived: true } });
        } catch (error) { if (!missing(error)) throw error; }
    }
    return { forumId, threads };
}
