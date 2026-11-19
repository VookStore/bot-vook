import { beforeEach, expect, it, vi } from 'vitest';
import { ChannelType, Routes, type REST } from 'discord.js';
import { syncCatalogForum } from '../src/modules/catalog/services/CatalogForumService';
const forum = { id: 'forum1', type: ChannelType.GuildForum, guild_id: 'guild1', available_tags: [], default_auto_archive_duration: 1440 };
const thread = { id: 'thread1', type: ChannelType.PublicThread, parent_id: 'forum1', guild_id: 'guild1', owner_id: 'bot1', name: 'Sanrio', thread_metadata: { archived: false } };
const pack = { id: 'pack1', name: 'Sanrio', sku: 'VOOK-COMP-SANRIO', slug: 'companheiros-sanrio', shortDescription: 'Sete companheiros animados, com box ou VIP configurável.', description: 'Descrição completa com personagens e instruções de instalação.', images: [], details: [{ label: 'Instalação', value: 'LEIA-ME e integrações incluídos' }] };
const rest = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
const db = { catalogPack: { findMany: vi.fn() }, catalogForumPost: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() } };
const run = () => syncCatalogForum(rest as unknown as REST, 'guild1', 'forum1', 'bot1', db as unknown as NonNullable<Parameters<typeof syncCatalogForum>[4]>);
beforeEach(() => {
    vi.resetAllMocks();
    db.catalogPack.findMany.mockResolvedValue([pack]);
    db.catalogForumPost.findUnique.mockResolvedValue(null);
    db.catalogForumPost.findMany.mockResolvedValue([]);
    db.catalogForumPost.upsert.mockImplementation(({ create }: { create: object }) => Promise.resolve({ id: 'publication1', ...create }));
    rest.get.mockImplementation((route: string) => {
        if (route === Routes.channel('forum1')) return Promise.resolve(forum);
        if (route === Routes.guildActiveThreads('guild1')) return Promise.resolve({ threads: [] });
        if (route === Routes.channel('thread1')) return Promise.resolve(thread);
        return Promise.resolve({ author: { id: 'bot1' } });
    });
    rest.post.mockResolvedValue({ ...thread, message: { id: 'message1' } });
    rest.patch.mockResolvedValue({});
});
it('publica sem compra e repete a sincronização sem criar outro tópico', async () => {
    await run();
    const stored = db.catalogForumPost.upsert.mock.calls[0][0].create as object;
    db.catalogForumPost.findUnique.mockResolvedValue({ ...stored });
    await run();
    expect(rest.post).toHaveBeenCalledTimes(1);
    expect(rest.patch).not.toHaveBeenCalled();
    const post = JSON.stringify(rest.post.mock.calls[0][1]);
    expect(post).toContain('Catálogo de apresentação');
    expect(post).toContain(pack.shortDescription);
    expect(post).toContain('Ver detalhes');
    expect(post).not.toContain(pack.description);
    expect(post).not.toContain('LEIA-ME e integrações incluídos');
    expect(post).not.toMatch(/Comprar Agora|Adicionar ao Carrinho/);
    expect(post).toContain('"parse":[]');
});
it('não publica no fórum de outro servidor', async () => {
    rest.get.mockResolvedValue({ ...forum, guild_id: 'other' });
    await expect(run()).rejects.toThrow(/deste servidor/);
    expect(db.catalogPack.findMany).not.toHaveBeenCalled();
    expect(rest.post).not.toHaveBeenCalled();
});
it('não edita um tópico vinculado ao canal errado', async () => {
    db.catalogForumPost.findUnique.mockResolvedValue({ forumId: 'forum1', threadId: 'thread1', messageId: 'message1', contentHash: 'old' });
    rest.get.mockImplementation((route: string) => Promise.resolve(route === Routes.channel('forum1') ? forum : route === Routes.guildActiveThreads('guild1') ? { threads: [] } : { ...thread, parent_id: 'other' }));
    await expect(run()).rejects.toThrow(/não pertence/);
    expect(rest.patch).not.toHaveBeenCalled();
});
it('confere a autoria da mensagem antes de editar', async () => {
    db.catalogForumPost.findUnique.mockResolvedValue({ forumId: 'forum1', threadId: 'thread1', messageId: 'message1', contentHash: 'old' });
    rest.get.mockImplementation((route: string) => Promise.resolve(route === Routes.channel('forum1') ? forum : route === Routes.guildActiveThreads('guild1') ? { threads: [] } : route === Routes.channel('thread1') ? thread : { author: { id: 'other' } }));
    await expect(run()).rejects.toThrow(/mensagem inicial/);
    expect(rest.patch).not.toHaveBeenCalled();
});
it('arquiva a publicação de um produto oculto sem apagar comentários', async () => {
    db.catalogPack.findMany.mockResolvedValue([]);
    db.catalogForumPost.findMany.mockResolvedValue([{ packId: 'pack1', threadId: 'thread1' }]);
    await run();
    expect(rest.patch).toHaveBeenCalledWith(Routes.channel('thread1'), { body: { archived: true } });
    expect(rest.post).not.toHaveBeenCalled();
});
