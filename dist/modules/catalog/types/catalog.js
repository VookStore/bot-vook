"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_CATEGORIES_VALUE = exports.CATEGORY_PICK_KIND = exports.IMAGE_PICK_KIND = exports.PACK_PICK_KIND = void 0;
exports.isPackPickKind = isPackPickKind;
exports.isImagePickKind = isImagePickKind;
exports.isCategoryPickKind = isCategoryPickKind;
/** Alvo de uma acao administrativa sobre packs. */
exports.PACK_PICK_KIND = {
    EDIT: 'edit',
    PRICE: 'price',
    TOGGLE: 'toggle',
    FEATURE: 'feature',
    DELETE: 'delete',
    IMAGES: 'images',
    DETAILS: 'details',
    CATEGORY: 'category',
};
function isPackPickKind(value) {
    return Object.values(exports.PACK_PICK_KIND).includes(value);
}
/** Alvo de uma acao administrativa sobre imagens. */
exports.IMAGE_PICK_KIND = {
    REMOVE: 'remove',
    UP: 'up',
    DOWN: 'down',
    COVER: 'cover',
};
function isImagePickKind(value) {
    return Object.values(exports.IMAGE_PICK_KIND).includes(value);
}
/** Alvo de uma acao administrativa sobre categorias do catalogo. */
exports.CATEGORY_PICK_KIND = {
    EDIT: 'edit',
    TOGGLE: 'toggle',
    DELETE: 'delete',
    UP: 'up',
    DOWN: 'down',
};
function isCategoryPickKind(value) {
    return Object.values(exports.CATEGORY_PICK_KIND).includes(value);
}
/** Valor usado no seletor de categorias para "todos os produtos". */
exports.ALL_CATEGORIES_VALUE = 'all';
//# sourceMappingURL=catalog.js.map