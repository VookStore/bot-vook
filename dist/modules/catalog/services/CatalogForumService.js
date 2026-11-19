"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCatalogForum = syncCatalogForum;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const discord_js_1 = require("discord.js");
const v2_1 = require("../../../components/v2");
const customIds_1 = require("../../../constants/customIds");
const prisma_1 = require("../../../core/database/prisma");
const errors_1 = require("../../../core/errors");
const sanitize_1 = require("../../../utils/sanitize");
const scriptProducts_1 = require("../scriptProducts");
const packages_1 = require("../../licenses/packages");
const noMentions = { parse: [] };
const missing = (error) => typeof error === 'object' && error !== null && 'code' in error && [10003, 10008].includes(Number(error.code));
/** Sincroniza tópicos do bot, preservando comentários e os controles de acesso do fórum. */
async function syncCatalogForum(rest, guildId, forumId, botId, db = (0, prisma_1.getPrisma)()) {
    const forum = await rest.get(discord_js_1.Routes.channel(forumId));
    if (forum.type !== discord_js_1.ChannelType.GuildForum || forum.guild_id !== guildId)
        throw new errors_1.ValidationError('Selecione um fórum deste servidor.');
    const packs = await db.catalogPack.findMany({ where: { guildId, deletedAt: null, enabled: true, category: { enabled: true, deletedAt: null } }, include: { images: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }, details: { orderBy: { position: 'asc' } } }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    const active = await rest.get(discord_js_1.Routes.guildActiveThreads(guildId));
    const threads = [];
    for (const pack of packs) {
        const cover = pack.images.find(image => image.isCover) ?? pack.images[0];
        const preview = (0, scriptProducts_1.isScriptPreview)(pack);
        const description = preview ? (pack.shortDescription?.trim() || 'Conheça esta coleção e confira o conteúdo em Ver detalhes.') : [pack.description ?? pack.shortDescription ?? '',
            pack.details.filter(detail => !['Disponibilidade', 'Licença'].includes(detail.label)).slice(0, 6).map(detail => `**${detail.label}:** ${detail.value}`).join('\n'),
        ].filter(Boolean).join('\n\n');
        const embed = new discord_js_1.EmbedBuilder().setTitle((0, sanitize_1.truncate)(pack.name, 200)).setDescription((0, sanitize_1.truncate)(description, preview ? 240 : 3800));
        if (preview)
            embed.setFooter({ text: 'VOOK · Catálogo de apresentação' });
        if (cover)
            embed.setImage(cover.url);
        const buttons = [new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_INFO, pack.id)).setLabel('Ver detalhes').setStyle(discord_js_1.ButtonStyle.Secondary)];
        if (pack.images.length > 1)
            buttons.push(new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CATALOG, customIds_1.CATALOG_ACTION.PACK_VIEW, pack.id, '1')).setLabel('Ver outras artes').setStyle(discord_js_1.ButtonStyle.Secondary));
        buttons.push(new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.LIST, '0')).setLabel('Meus arquivos').setStyle(discord_js_1.ButtonStyle.Secondary));
        const title = (0, sanitize_1.truncate)(pack.name, 100);
        const tagName = /COMP-/.test(pack.sku ?? '') ? 'Coleções' : 'Sistemas';
        const tag = forum.available_tags.find(value => value.name === tagName);
        const tags = tag ? [tag.id] : [];
        const hash = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({ title, embed: embed.toJSON(), buttons: buttons.map(b => b.toJSON()), tags })).digest('hex');
        let publication = await db.catalogForumPost.findUnique({ where: { guildId_packId: { guildId, packId: pack.id } } });
        let thread;
        if (publication?.forumId === forumId) {
            try {
                thread = await rest.get(discord_js_1.Routes.channel(publication.threadId));
            }
            catch (error) {
                if (!missing(error))
                    throw error;
            }
        }
        if (!thread) {
            const candidates = active.threads.filter(t => t.parent_id === forumId && t.owner_id === botId && t.name === title);
            if (candidates.length > 1)
                throw new errors_1.ValidationError('Há tópicos repetidos deste produto. Revise antes de sincronizar.');
            thread = candidates[0];
            if (thread) {
                publication = await db.catalogForumPost.upsert({ where: { guildId_packId: { guildId, packId: pack.id } },
                    create: { guildId, packId: pack.id, forumId, threadId: thread.id, messageId: thread.id, contentHash: '' },
                    update: { forumId, threadId: thread.id, messageId: thread.id, contentHash: '' } });
            }
        }
        if (thread && (thread.parent_id !== forumId || thread.guild_id !== guildId || thread.owner_id !== botId))
            throw new errors_1.ValidationError('O tópico vinculado não pertence a este catálogo do bot.');
        if (thread && publication?.contentHash === hash && !thread.thread_metadata?.archived) {
            threads.push({ packId: pack.id, threadId: thread.id, changed: false });
            continue;
        }
        // Somente arte local já publicada pelo bot vira anexo. URLs externas ficam a cargo do Discord.
        const filename = cover?.url.startsWith(`${new URL((0, packages_1.releaseEndpoint)()).origin}/catalog-assets/`) ? cover.url.split('/').pop() : undefined;
        const local = filename && Object.values(scriptProducts_1.SCRIPT_IMAGES).flat().includes(filename) ? await (0, promises_1.readFile)((0, node_path_1.join)(process.cwd(), 'assets', 'catalog', filename)) : undefined;
        if (local && filename)
            embed.setImage(`attachment://${filename}`);
        const message = { content: '', embeds: [embed.toJSON()], components: [(0, v2_1.buttonRow)(...buttons).toJSON()], allowed_mentions: noMentions,
            attachments: local && filename ? [{ id: '0', filename }] : [] };
        const files = local && filename ? [{ name: filename, data: local, contentType: 'image/png' }] : [];
        let messageId;
        if (!thread) {
            const created = await rest.post(discord_js_1.Routes.threads(forumId), { body: { name: title, auto_archive_duration: forum.default_auto_archive_duration ?? 1440, applied_tags: tags, message }, files });
            thread = created;
            messageId = created.message?.id ?? created.id;
            active.threads.push(created);
        }
        else {
            messageId = publication?.messageId ?? thread.id;
            const current = await rest.get(discord_js_1.Routes.channelMessage(thread.id, messageId));
            if (current.author.id !== botId)
                throw new errors_1.ValidationError('A mensagem inicial não pertence ao bot.');
            await rest.patch(discord_js_1.Routes.channel(thread.id), { body: { name: title, archived: false, applied_tags: tags } });
            await rest.patch(discord_js_1.Routes.channelMessage(thread.id, messageId), { body: message, files });
        }
        await db.catalogForumPost.upsert({ where: { guildId_packId: { guildId, packId: pack.id } },
            create: { guildId, packId: pack.id, forumId, threadId: thread.id, messageId, contentHash: hash },
            update: { forumId, threadId: thread.id, messageId, contentHash: hash } });
        threads.push({ packId: pack.id, threadId: thread.id, changed: true });
    }
    const published = await db.catalogForumPost.findMany({ where: { guildId, forumId } });
    for (const item of published)
        if (!packs.some(pack => pack.id === item.packId)) {
            try {
                const thread = await rest.get(discord_js_1.Routes.channel(item.threadId));
                if (thread.parent_id === forumId && thread.owner_id === botId)
                    await rest.patch(discord_js_1.Routes.channel(item.threadId), { body: { archived: true } });
            }
            catch (error) {
                if (!missing(error))
                    throw error;
            }
        }
    return { forumId, threads };
}
//# sourceMappingURL=CatalogForumService.js.map