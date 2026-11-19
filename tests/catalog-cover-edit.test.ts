import { beforeEach, expect, it, vi } from 'vitest';
import { replaceImage } from '../src/modules/catalog/services/CatalogImageService';
import { requirePack, invalidatePackImages } from '../src/modules/catalog/services/CatalogService';
import { findPackImageById, updatePackImageContent } from '../src/modules/catalog/repositories/PackImageRepository';
vi.mock('../src/modules/catalog/services/CatalogService', () => ({ requirePack: vi.fn(), invalidatePackImages: vi.fn() }));
vi.mock('../src/modules/catalog/repositories/PackImageRepository', () => ({ findPackImageById: vi.fn(), updatePackImageContent: vi.fn() }));
vi.mock('../src/modules/catalog/repositories/CatalogAuditRepository', () => ({ recordCatalogAudit: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });
it('recusa trocar a imagem quando o produto não pertence ao servidor', async () => {
  vi.mocked(requirePack).mockRejectedValue(new Error('Produto de outra guild'));
  await expect(replaceImage('guild', 'actor', 'pack', 'image', 'https://example.com/new.png', null)).rejects.toThrow();
  expect(findPackImageById).not.toHaveBeenCalled();
  expect(updatePackImageContent).not.toHaveBeenCalled();
});
it('recusa a imagem de outro produto', async () => {
  vi.mocked(findPackImageById).mockResolvedValue({ id: 'image', packId: 'other-pack' } as NonNullable<Awaited<ReturnType<typeof findPackImageById>>>);
  await expect(replaceImage('guild', 'actor', 'pack', 'image', 'https://example.com/new.png', null)).rejects.toThrow();
  expect(updatePackImageContent).not.toHaveBeenCalled();
  expect(invalidatePackImages).not.toHaveBeenCalled();
});
it('substitui o arquivo conservando a identidade, posição e marca de capa', async () => {
  const image = { id: 'image', packId: 'pack', url: 'https://example.com/old.png', altText: null, position: 3, isCover: true, createdAt: new Date(), updatedAt: new Date() };
  vi.mocked(findPackImageById).mockResolvedValue(image);
  vi.mocked(updatePackImageContent).mockResolvedValue({ ...image, url: 'https://example.com/new.png' });
  const result = await replaceImage('guild', 'actor', 'pack', 'image', 'https://example.com/new.png', null);
  expect(updatePackImageContent).toHaveBeenCalledWith('image', { url: 'https://example.com/new.png', altText: null });
  expect(result).toMatchObject({ id: 'image', position: 3, isCover: true });
  expect(invalidatePackImages).toHaveBeenCalledWith('pack');
});
