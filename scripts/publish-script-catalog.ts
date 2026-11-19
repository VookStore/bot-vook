import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { parse } from 'dotenv';
import { REST, Routes, MessageFlags, type APIGuild } from 'discord.js';
import { SCRIPT_CATALOG, SCRIPT_IMAGES } from '../src/modules/catalog/scriptProducts';
import { archiveHash, inspectPackage, releaseEndpoint } from '../src/modules/licenses/packages';
import { buildCatalogPanel } from '../src/modules/catalog/builders/CatalogBuilders';
import { licenseCommand, plansCommand } from '../src/modules/licenses/commands';

/** Publicação manual e idempotente. Não cria pedidos, pagamentos, concessões nem DMs. */
async function main(): Promise<void> {
    const [packageArg, envArg, ...flags] = process.argv.slice(2);
    if (!packageArg || !envArg || flags.some(flag => flag !== '--apply')) throw new Error('Uso: npx tsx scripts/publish-script-catalog.ts PASTA_DOS_ZIPS ARQUIVO_ENV [--apply]');
    const directory = resolve(packageArg), version = '1.10.0';
    const manifest: unknown = JSON.parse(await readFile(join(directory, 'CHECKSUMS.json'), 'utf8'));
    if (!manifest || typeof manifest !== 'object') throw new Error('Manifesto de pacotes inválido.');
    const verified = [];
    for (const offer of SCRIPT_CATALOG) {
        const entry: unknown = Reflect.get(manifest, offer.product);
        if (!entry || typeof entry !== 'object') throw new Error(`Pacote ausente: ${offer.product}`);
        const filename = `${offer.package}-${version}.zip`;
        const archive = await readFile(join(directory, filename));
        const sha256 = archiveHash(archive);
        if (Reflect.get(entry, 'file') !== filename || Reflect.get(entry, 'sha256') !== sha256) throw new Error(`SHA-256 divergente: ${offer.product}`);
        const files = inspectPackage(archive, offer.product, 'vook_plush', version);
        for (const image of SCRIPT_IMAGES[offer.product]) await readFile(join('assets', 'catalog', image));
        verified.push({ offer, archive, sha256, fileCount: Object.keys(files).length });
    }
    console.log(JSON.stringify({ mode: flags.includes('--apply') ? 'apply' : 'dry-run', products: verified.map(v => ({ product: v.offer.product, file: `${v.offer.package}-${version}.zip`, bytes: v.archive.length, sha256: v.sha256 })), payments: 'disabled-for-preview-products' }, null, 2));
    if (!flags.includes('--apply')) return;
    const environment = parse(await readFile(resolve(envArg)));
    if (!environment.DATABASE_URL || !environment.DISCORD_TOKEN || !/^\d{17,20}$/.test(environment.DISCORD_GUILD_ID || '')) throw new Error('Ambiente incompleto. Configure os segredos no arquivo privado, nunca na linha de comando.');
    const origin = new URL(releaseEndpoint()).origin;
    const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(15000) });
    const health: unknown = await response.json();
    if (!response.ok || !health || typeof health !== 'object' || Reflect.get(health, 'catalogVersion') !== '2026-11-18') throw new Error('Publique primeiro o código do catálogo na hospedagem. Nenhum dado alterado.');
    const rest = new REST({ version: '10' }).setToken(environment.DISCORD_TOKEN);
    const guildId = environment.DISCORD_GUILD_ID;
    const guild = await rest.get(Routes.guild(guildId)) as APIGuild;
    const actorId = guild.owner_id;
    const db = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } }, log: [] });
    try {
        const beforeLicenses = await db.scriptLicense.findMany({ select: { id: true, keyHash: true, keyCipher: true }, orderBy: { id: 'asc' } });
        const config = await db.guildConfig.findUniqueOrThrow({ where: { guildId } });
        const beforePacks = await db.catalogPack.findMany({ where: { guildId, sku: { in: SCRIPT_CATALOG.map(v => v.sku) } }, include: { images: true, details: true } });
        const backupDirectory = join('backups', `catalogo-${Date.now()}`);
        await mkdir(backupDirectory, { recursive: true });
        await writeFile(join(backupDirectory, 'catalog-before.json'), JSON.stringify({ config: { guildId, catalogBannerUrl: config.catalogBannerUrl, catalogDescription: config.catalogDescription }, packs: beforePacks }, null, 2), { flag: 'wx' });
        for (const { offer, archive, sha256, fileCount } of verified) {
            await db.$transaction(async tx => {
                const identity = { guildId, product: offer.product, resource: 'vook_plush', version };
                const previous = await tx.scriptRelease.findUnique({ where: { guildId_product_resource_version: identity } });
                if (previous && (previous.sha256 !== sha256 || archiveHash(previous.archive) !== sha256 || previous.status === 'WITHDRAWN')) throw new Error(`Versão existente incompatível: ${offer.product}. Não foi substituída.`);
                const release = previous ?? await tx.scriptRelease.create({ data: { ...identity, sha256, archive: new Uint8Array(archive), fileCount, createdById: actorId }, select: { id: true, status: true } });
                if (release.status !== 'PUBLISHED') await tx.scriptRelease.update({ where: { id: release.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actorId } });
            }, { timeout: 120000, maxWait: 10000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            console.log(`Pacote publicado: ${offer.name}`);
        }
        await db.$transaction(async tx => {
            for (const [position, offer] of SCRIPT_CATALOG.entries()) {
                const identifier = offer.category === 'Sistemas de Pelúcias' ? 'sistemas-de-pelucias' : 'colecoes-de-companheiros';
                const category = await tx.catalogCategory.upsert({ where: { guildId_identifier: { guildId, identifier } }, create: { guildId, identifier, name: offer.category, position: 10 + Math.floor(position / 2), createdById: actorId, boosterEligible: false }, update: { name: offer.category, enabled: true, deletedAt: null, boosterEligible: false } });
                const data = { categoryId: category.id, name: offer.name, slug: offer.slug, sku: offer.sku,
                    shortDescription: offer.summary, description: offer.description, price: 0, position, enabled: true, featured: true, deletedAt: null };
                const pack = await tx.catalogPack.upsert({ where: { guildId_slug: { guildId, slug: offer.slug } }, create: { ...data, guildId, createdById: actorId }, update: data });
                await tx.catalogPackDetail.deleteMany({ where: { packId: pack.id } });
                await tx.catalogPackDetail.createMany({ data: [...offer.details, ['Disponibilidade', 'Apresentação; compra e pagamento ainda não habilitados'], ['Licença', 'Testes/Desenvolvimento + Produção; arquivos por produto adquirido']].map(([label, value], index) => ({ packId: pack.id, label, value, position: index })) });
                await tx.packImage.deleteMany({ where: { packId: pack.id } });
                if (SCRIPT_IMAGES[offer.product].length) await tx.packImage.createMany({ data: SCRIPT_IMAGES[offer.product].map((filename, index) => ({ packId: pack.id, url: `${origin}/catalog-assets/${filename}`, altText: `${offer.name} · ${index + 1}`, position: index, isCover: index === 0 })) });
            }
            await tx.guildConfig.update({ where: { guildId }, data: { catalogBannerUrl: `${origin}/catalog-assets/flyer-sanrio-v2.png`, catalogDescription: 'Conheça os produtos da VOOK e as novas opções de sistemas e companheiros. Os novos sistemas e coleções estão em apresentação: compras e pagamentos ainda não estão disponíveis para essas ofertas.' } });
        }, { timeout: 120000, maxWait: 10000 });
        const afterLicenses = await db.scriptLicense.findMany({ where: { id: { in: beforeLicenses.map(v => v.id) } }, select: { id: true, keyHash: true, keyCipher: true }, orderBy: { id: 'asc' } });
        const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
        if (fingerprint(beforeLicenses) !== fingerprint(afterLicenses)) throw new Error('Licenças existentes mudaram durante a publicação. Verifique a operação concorrente.');
        const current = await db.guildConfig.findUniqueOrThrow({ where: { guildId } });
        const [packs, categories] = await Promise.all([
            db.catalogPack.count({ where: { guildId, enabled: true, deletedAt: null, category: { enabled: true, deletedAt: null } } }),
            db.catalogCategory.count({ where: { guildId, enabled: true, deletedAt: null } }),
        ]);
        if (current.catalogChannelId && current.catalogMessageId) await rest.patch(Routes.channelMessage(current.catalogChannelId, current.catalogMessageId), {
            body: { components: [buildCatalogPanel(current, { packs, categories }).toJSON()], flags: MessageFlags.IsComponentsV2, allowed_mentions: { parse: [] } },
        });
        if (!environment.DISCORD_CLIENT_ID) throw new Error('DISCORD_CLIENT_ID ausente para atualizar os comandos.');
        await rest.post(Routes.applicationCommands(environment.DISCORD_CLIENT_ID), { body: plansCommand.builder.toJSON() });
        await rest.post(Routes.applicationGuildCommands(environment.DISCORD_CLIENT_ID, guildId), { body: licenseCommand.builder.toJSON() });
        console.log(JSON.stringify({ published: 4, existingLicensesPreserved: beforeLicenses.length, catalogUpdated: Boolean(current.catalogChannelId && current.catalogMessageId), paymentOperations: 0, customerMessages: 0 }));
    } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'validation-or-connectivity';
    console.error(`Publicação interrompida (${code}). Os pacotes já conferidos foram preservados. Os segredos do ambiente não são exibidos.`);
    process.exitCode = 1;
});
