import { ButtonBuilder, ButtonStyle, type ContainerBuilder } from 'discord.js';
import type { CatalogPack } from '@prisma/client';
import { CATALOG_ACTION, LICENSE_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { addHeader, buttonRow, container, footerNote, mediaGallery, sectionWithButton, text } from '../../../components/v2';
import { truncate } from '../../../utils/sanitize';
import { SCRIPT_CATALOG, isScriptPreview } from '../scriptProducts';
import type { PackView } from '../types/catalog';

const presentation = {
    companheiros_sanrio: { title: 'Sanrio', summary: 'Sete companheiros animados, com a caixa e o painel rosa.', order: 0 },
    companheiros_monster_high: { title: 'Monster High', summary: 'Dez companheiras animadas, com a caixa e o painel de controle.', order: 1 },
    pelucias_base: { title: 'Sistema de pelúcias', summary: 'O sistema completo para organizar caixas, coleções e trocas. Sem coleção de brinde.', order: 2 },
    pelucias_dragoes: { title: 'Sistema + Dragões', summary: 'O sistema de pelúcias com seis dragões de brinde.', order: 3 },
} as const;

function display(pack: CatalogPack) {
    const offer = SCRIPT_CATALOG.find(value => value.sku === pack.sku || value.slug === pack.slug);
    if (!offer) return { title: pack.name, summary: pack.shortDescription ?? '', order: 4 };
    return { ...presentation[offer.product], title: pack.name === offer.name ? presentation[offer.product].title : truncate(pack.name, 80),
        summary: pack.shortDescription && pack.shortDescription !== offer.summary ? truncate(pack.shortDescription, 180) : presentation[offer.product].summary };
}
function button(action: string, label: string, ...args: string[]): ButtonBuilder {
    return new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.CATALOG, action, ...args))
        .setLabel(label).setStyle(ButtonStyle.Secondary);
}

/** A vitrine pequena abre cada produto diretamente; catálogos mistos mantêm sua navegação. */
export function isScriptShowcase(packs: readonly CatalogPack[] | undefined): packs is readonly CatalogPack[] {
    return packs !== undefined && packs.length > 0 && packs.length <= SCRIPT_CATALOG.length
        && packs.every(pack => pack.enabled && pack.deletedAt === null && isScriptPreview(pack));
}

export function buildScriptShowcase(packs: readonly CatalogPack[], bannerUrl?: string | null, notice?: string): ContainerBuilder {
    const root = container();
    addHeader(root, 'VOOK · Coleções e pelúcias');
    if (bannerUrl) root.addMediaGalleryComponents(mediaGallery([bannerUrl], 'Coleções VOOK'));
    root.addTextDisplayComponents(text(notice ? `${notice}\n\nEscolha o que você quer conhecer.` : 'Escolha o que você quer conhecer.'));
    for (const pack of [...packs].sort((a, b) => display(a).order - display(b).order)) {
        const info = display(pack);
        root.addSectionComponents(sectionWithButton(
            [`### ${info.title}\n${info.summary}`],
            button(CATALOG_ACTION.PACK_VIEW, 'Conhecer', pack.id, '0'),
        ));
    }
    root.addActionRowComponents(buttonRow(new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.LICENSE, LICENSE_ACTION.LIST, '0'))
        .setLabel('Meus arquivos').setStyle(ButtonStyle.Secondary)));
    root.addTextDisplayComponents(footerNote('Já tem uma licença? Use Meus arquivos. Compras ainda não disponíveis.'));
    return root;
}

export function buildScriptProductCard(view: PackView, requestedIndex: number, notice?: string): ContainerBuilder {
    const { pack, images } = view;
    const info = display(pack), total = images.length;
    const index = total ? ((Number.isFinite(requestedIndex) ? Math.trunc(requestedIndex) : 0) % total + total) % total : 0;
    const root = container();
    addHeader(root, info.title);
    const image = images[index];
    if (image) root.addMediaGalleryComponents(mediaGallery([image.url], image.altText ?? info.title));
    root.addTextDisplayComponents(text(`${notice ? `${notice}\n\n` : ''}${truncate(pack.shortDescription ?? info.summary, 400)}`));
    if (total > 1) root.addTextDisplayComponents(footerNote(`Arte ${index + 1} de ${total}`));
    const actions = [button(CATALOG_ACTION.HOME, 'Voltar')];
    if (total > 1) actions.push(button(CATALOG_ACTION.IMAGE_NEXT, 'Ver outras artes', pack.id, String(index)));
    actions.push(button(CATALOG_ACTION.PACK_INFO, 'O que está incluído', pack.id));
    root.addActionRowComponents(buttonRow(...actions));
    root.addTextDisplayComponents(footerNote('Compras ainda não disponíveis.'));
    return root;
}

export function buildScriptProductDetails(view: PackView): ContainerBuilder {
    const root = container();
    addHeader(root, `${display(view.pack).title} · O que está incluído`);
    root.addTextDisplayComponents(text(truncate(view.pack.description ?? view.pack.shortDescription ?? '', 1600)));
    const details = view.details.filter(detail => !['Disponibilidade', 'Licença'].includes(detail.label)).slice(0, 6);
    if (details.length) root.addTextDisplayComponents(text(details.map(detail => `**${detail.label}:** ${truncate(detail.value, 240)}`).join('\n')));
    root.addActionRowComponents(buttonRow(
        button(CATALOG_ACTION.PACK_VIEW, 'Voltar ao produto', view.pack.id, '0'),
        button(CATALOG_ACTION.HOME, 'Todas as opções'),
    ));
    root.addTextDisplayComponents(footerNote('Compras ainda não disponíveis.'));
    return root;
}
