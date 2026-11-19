import { ButtonBuilder, ButtonStyle, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import type { CatalogPack, PackImage } from '@prisma/client';
import { CATALOG_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { addHeader, buttonRow, container, footerNote, sectionWithButton, text } from '../../../components/v2';
import { truncate } from '../../../utils/sanitize';

function action(kind: string, label: string, ...args: string[]) {
    return new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.CATALOG, kind, ...args)).setLabel(label).setStyle(ButtonStyle.Secondary);
}
export function buildCatalogWorkspace(packs: readonly CatalogPack[], notice?: string) {
    const root = container();
    addHeader(root, 'Gerenciar catálogo');
    root.addTextDisplayComponents(text(`${notice ? `${notice}\n\n` : ''}Escolha o produto que você quer ajustar.`));
    for (const pack of packs) root.addSectionComponents(sectionWithButton([
        `**${truncate(pack.name, 80)}**\n${pack.enabled ? 'Publicado' : 'Arquivado / oculto'}`,
    ], action(CATALOG_ACTION.PRODUCT_PANEL, 'Editar produto', pack.id)));
    root.addActionRowComponents(buttonRow(action(CATALOG_ACTION.PACK_NEW, 'Novo produto'), action(CATALOG_ACTION.CATEGORIES, 'Categorias'), action(CATALOG_ACTION.ADMIN_ADVANCED, 'Outras opções')));
    root.addTextDisplayComponents(footerNote('Os ajustes são feitos no produto escolhido, sem selecionar tudo outra vez.'));
    return root;
}
export function buildProductWorkspace(pack: CatalogPack, images: readonly PackImage[], notice?: string) {
    const root = container();
    addHeader(root, truncate(pack.name, 100));
    root.addTextDisplayComponents(text(`${notice ? `${notice}\n\n` : ''}${pack.enabled ? 'Publicado' : 'Arquivado / oculto'} · ${images.length} artes\n\n${truncate(pack.shortDescription ?? '', 300)}`));
    root.addActionRowComponents(buttonRow(action(CATALOG_ACTION.PRODUCT_ACTION, 'Editar textos', 'text', pack.id), action(CATALOG_ACTION.PRODUCT_ACTION, 'Trocar capa', 'cover', pack.id), action(CATALOG_ACTION.IMAGES_PANEL, 'Artes e ordem', pack.id)));
    root.addActionRowComponents(buttonRow(action(CATALOG_ACTION.PRODUCT_ACTION, 'Conteúdo incluído', 'details', pack.id), action(CATALOG_ACTION.PRODUCT_ACTION, pack.enabled ? 'Arquivar / ocultar' : 'Republicar', 'toggle', pack.id), action(CATALOG_ACTION.PACK_VIEW, 'Ver como cliente', pack.id, '0')));
    root.addActionRowComponents(buttonRow(action(CATALOG_ACTION.ADMIN, 'Voltar aos produtos')));
    return root;
}
function field(id: string, label: string, value: string, max: number, paragraph = false) {
    const input = new TextInputBuilder().setCustomId(id).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(id === 'nome' || id === 'url').setMaxLength(max);
    if (value) input.setValue(truncate(value, max));
    return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}
export function buildProductTextModal(pack: CatalogPack) {
    return new ModalBuilder().setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PRODUCT_TEXT_MODAL, pack.id)).setTitle('Editar textos')
        .addLabelComponents(field('nome', 'Nome do produto', pack.name, 80), field('resumo', 'Resumo', pack.shortDescription ?? '', 240), field('descricao', 'Descrição completa', pack.description ?? '', 2000, true));
}
export function buildProductCoverModal(pack: CatalogPack, cover?: PackImage | null) {
    return new ModalBuilder().setCustomId(buildCustomId(NAMESPACE.CATALOG, CATALOG_ACTION.PRODUCT_COVER_MODAL, pack.id, cover?.id ?? 'new')).setTitle('Trocar capa')
        .addLabelComponents(field('url', 'Link HTTPS da capa', cover?.url ?? '', 2048), field('alt', 'Descrição da imagem', cover?.altText ?? '', 240));
}
