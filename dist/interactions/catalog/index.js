"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAdminPanelForCommand = exports.renderSearchResults = exports.renderHomeForCommand = exports.catalogModals = exports.catalogSelects = exports.catalogButtons = void 0;
const admin_1 = require("./admin");
const customer_1 = require("./customer");
/**
 * Handlers do catalogo.
 *
 * As duas metades ficam em arquivos separados de proposito: a loja do cliente e
 * a administracao tem publicos, permissoes e riscos diferentes, e misturar as
 * duas em um arquivo so torna facil deixar passar um `assert` esquecido.
 */
exports.catalogButtons = [
    ...customer_1.catalogCustomerButtons,
    ...admin_1.catalogAdminButtons,
];
exports.catalogSelects = [
    ...customer_1.catalogCustomerSelects,
    ...admin_1.catalogAdminSelects,
];
exports.catalogModals = [
    ...customer_1.catalogCustomerModals,
    ...admin_1.catalogAdminModals,
];
var customer_2 = require("./customer");
Object.defineProperty(exports, "renderHomeForCommand", { enumerable: true, get: function () { return customer_2.renderHomeForCommand; } });
Object.defineProperty(exports, "renderSearchResults", { enumerable: true, get: function () { return customer_2.renderSearchResults; } });
var admin_2 = require("./admin");
Object.defineProperty(exports, "renderAdminPanelForCommand", { enumerable: true, get: function () { return admin_2.renderAdminPanelForCommand; } });
//# sourceMappingURL=index.js.map