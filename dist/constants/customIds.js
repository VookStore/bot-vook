"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INFLUENCER_ACTION = exports.DELIVERY_ACTION = exports.WOLF_ACTION = exports.ANNOUNCE_ACTION = exports.ORDER_ACTION = exports.CART_ACTION = exports.CATALOG_ACTION = exports.ACCOUNT_ACTION = exports.TEAM_ACTION = exports.DESTINATION_ACTION = exports.CATEGORY_ACTION = exports.COUPON_ACTION = exports.BOOSTER_ACTION = exports.CONFIG_ACTION = exports.REVIEW_ACTION = exports.PAYMENT_ACTION = exports.TICKET_ACTION = exports.NAMESPACE = exports.MAX_CUSTOM_ID_LENGTH = exports.CUSTOM_ID_SEPARATOR = void 0;
exports.buildCustomId = buildCustomId;
exports.parseCustomId = parseCustomId;
exports.requireArg = requireArg;
const errors_1 = require("../core/errors");
/**
 * Custom IDs persistentes.
 *
 * Formato: `namespace:action[:arg1[:arg2...]]`
 *
 * REGRAS DE SEGURANCA
 *  - O customId NUNCA e autorizacao. Ele apenas identifica o alvo.
 *    Toda acao revalida entidade + permissao no banco.
 *  - Nada de JSON grande: o limite real do Discord e 100 caracteres.
 *  - Componentes sao roteados por namespace/action, logo continuam funcionando
 *    apos restart (sem collectors eternos).
 */
exports.CUSTOM_ID_SEPARATOR = ':';
exports.MAX_CUSTOM_ID_LENGTH = 100;
exports.NAMESPACE = {
    TICKET: 'ticket',
    PAYMENT: 'payment',
    REVIEW: 'review',
    CONFIG: 'config',
    COUPON: 'coupon',
    CATEGORY: 'category',
    DESTINATION: 'destination',
    TEAM: 'team',
    ACCOUNT: 'account',
    CATALOG: 'catalog',
    CART: 'cart',
    ORDER: 'order',
    ANNOUNCE: 'announce',
    BOOSTER: 'booster',
    WOLF: 'wolf',
    DELIVERY: 'delivery',
    INFLUENCER: 'influencer',
};
/**
 * Monta um customId validado.
 * Lanca ValidationError quando o resultado excede o limite do Discord — assim o
 * problema aparece em desenvolvimento e nunca como 400 em producao.
 */
function buildCustomId(namespace, action, ...args) {
    const parts = [namespace, action, ...args.filter((arg) => arg.length > 0)];
    for (const part of parts) {
        if (part.includes(exports.CUSTOM_ID_SEPARATOR)) {
            throw new errors_1.ValidationError(`Segmento de customId nao pode conter "${exports.CUSTOM_ID_SEPARATOR}": ${part}`);
        }
    }
    const customId = parts.join(exports.CUSTOM_ID_SEPARATOR);
    if (customId.length > exports.MAX_CUSTOM_ID_LENGTH) {
        throw new errors_1.ValidationError(`customId excede ${exports.MAX_CUSTOM_ID_LENGTH} caracteres: ${customId.slice(0, 40)}...`);
    }
    return customId;
}
function parseCustomId(customId) {
    if (typeof customId !== 'string' || customId.length === 0)
        return null;
    const parts = customId.split(exports.CUSTOM_ID_SEPARATOR);
    const [namespace, action, ...args] = parts;
    if (namespace === undefined || action === undefined)
        return null;
    if (namespace.length === 0 || action.length === 0)
        return null;
    return { namespace, action, args, raw: customId };
}
/** Extrai o argumento na posicao indicada, garantindo presenca. */
function requireArg(parsed, index, label) {
    const value = parsed.args[index];
    if (value === undefined || value.length === 0) {
        throw new errors_1.ValidationError(`Interacao invalida: ${label} ausente.`, {
            userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
            context: { customId: parsed.raw },
        });
    }
    return value;
}
// ---------------------------------------------------------------------------
// Acoes conhecidas (tipadas para evitar erro de digitacao entre builder/router)
// ---------------------------------------------------------------------------
exports.TICKET_ACTION = {
    CREATE: 'create',
    CREATE_MODAL: 'create-modal',
    CLAIM: 'claim',
    REFRESH: 'refresh',
    NOTIFY: 'notify',
    ADMIN: 'admin',
    CLOSE: 'close',
    CLOSE_MODAL: 'close-modal',
    RENAME: 'rename',
    RENAME_MODAL: 'rename-modal',
    ADD_MEMBER: 'add-member',
    ADD_MEMBER_SELECT: 'add-select',
    REMOVE_MEMBER: 'remove-member',
    REMOVE_MEMBER_SELECT: 'remove-select',
    TRANSFER: 'transfer',
    TRANSFER_SELECT: 'transfer-select',
    /** Painel do canal de destino: acha (e readmite em) os topicos do cliente. */
    LOCATE: 'locate',
    /**
     * Painel do canal de entregas: acha os tickets ENTREGUES do cliente, de
     * qualquer categoria. Sem argumento — quem clicou e a busca inteira.
     */
    LOCATE_DELIVERED: 'locate-delivery',
    /** Confirma a remocao dos topicos orfaos listados na previa. */
    CLEAN_ORPHANS: 'clean-orphans',
};
exports.PAYMENT_ACTION = {
    APPROVE: 'approve',
    /** Cliente envia o comprovante direto do cartao da cobranca (modal com upload). */
    RECEIPT: 'receipt',
    RECEIPT_MODAL: 'receipt-modal',
    CANCEL: 'cancel',
    CANCEL_MODAL: 'cancel-modal',
    MANAGE: 'manage',
    COUPON: 'coupon',
    COUPON_SELECT: 'coupon-select',
    COUPON_REMOVE: 'coupon-remove',
    AMOUNT: 'amount',
    AMOUNT_MODAL: 'amount-modal',
    ACCOUNT_SELECT: 'account-select',
    CONFIRM: 'confirm',
    DISCARD: 'discard',
};
exports.REVIEW_ACTION = {
    /** Convite no cartao de encerramento: abre o painel das cinco notas. */
    START: 'start',
    RATE: 'rate',
    COMMENT: 'comment',
    COMMENT_MODAL: 'comment-modal',
};
exports.CONFIG_ACTION = {
    MENU: 'menu',
    CHANNELS: 'channels',
    CHANNEL_SELECT: 'channel-select',
    AUTOROLE: 'autorole',
    AUTOROLE_SELECT: 'autorole-select',
    AUTOROLE_TOGGLE: 'autorole-toggle',
    AUTOROLE_BACKFILL: 'autorole-backfill',
    WELCOME_TOGGLE: 'welcome-toggle',
    VISUAL: 'visual',
    VISUAL_MODAL: 'visual-modal',
    VISUAL_SELECT: 'visual-select',
    LIMITS: 'limits',
    LIMITS_MODAL: 'limits-modal',
    REFRESH_PANEL: 'refresh-panel',
    BACK: 'back',
};
exports.BOOSTER_ACTION = {
    /** Multi-select das categorias em que o desconto de booster vale. */
    ELIGIBILITY_SELECT: 'eligibility-select',
};
exports.COUPON_ACTION = {
    CREATE: 'create',
    CREATE_MODAL: 'create-modal',
    EDIT: 'edit',
    EDIT_SELECT: 'edit-select',
    EDIT_MODAL: 'edit-modal',
    TOGGLE: 'toggle',
    TOGGLE_SELECT: 'toggle-select',
    DELETE: 'delete',
    DELETE_SELECT: 'delete-select',
    LIST: 'list',
    BACK: 'back',
};
exports.CATEGORY_ACTION = {
    CREATE: 'create',
    CREATE_MODAL: 'create-modal',
    EDIT: 'edit',
    EDIT_SELECT: 'edit-select',
    EDIT_MODAL: 'edit-modal',
    MOVE_UP: 'up',
    MOVE_DOWN: 'down',
    MOVE_SELECT: 'move-select',
    TOGGLE: 'toggle',
    TOGGLE_SELECT: 'toggle-select',
    DELETE: 'delete',
    DELETE_SELECT: 'delete-select',
    BACK: 'back',
};
exports.DESTINATION_ACTION = {
    SELECT_CATEGORY: 'select-category',
    SELECT_CHANNEL: 'select-channel',
    CLEAR: 'clear',
};
exports.TEAM_ACTION = {
    SELECT_CATEGORY: 'select-category',
    SELECT_ROLES: 'select-roles',
    CLEAR: 'clear',
};
exports.ACCOUNT_ACTION = {
    CREATE: 'create',
    CREATE_MODAL: 'create-modal',
    EDIT: 'edit',
    EDIT_SELECT: 'edit-select',
    EDIT_MODAL: 'edit-modal',
    TOGGLE: 'toggle',
    TOGGLE_SELECT: 'toggle-select',
    DELETE: 'delete',
    DELETE_SELECT: 'delete-select',
    LIST: 'list',
    BACK: 'back',
};
/**
 * Catalogo.
 *
 * As acoes sao curtas de proposito: o customId carrega ids de 25 caracteres
 * (cuid) e o teto real do Discord e 100. Ex.: `catalog:img-next:<packId>:<i>`
 * fica em ~45 caracteres, com folga.
 *
 * Nenhuma delas autoriza coisa alguma: todo handler recarrega o pack/pedido no
 * banco e revalida a permissao do membro.
 */
exports.CATALOG_ACTION = {
    // --- Cliente ---
    HOME: 'home',
    CATEGORY_SELECT: 'cat-sel',
    CATEGORY_PAGE: 'cat-page',
    PACK_SELECT: 'pack-sel',
    PACK_VIEW: 'pack',
    IMAGE_PREV: 'img-prev',
    IMAGE_NEXT: 'img-next',
    PACK_INFO: 'info',
    CART_ADD: 'add',
    BUY: 'buy',
    BUY_CONFIRM: 'buy-ok',
    SEARCH: 'search',
    SEARCH_MODAL: 'search-modal',
    // --- Administracao ---
    ADMIN: 'admin',
    PACK_NEW: 'p-new',
    PACK_NEW_CATEGORY: 'p-new-cat',
    PACK_NEW_MODAL: 'p-new-modal',
    /** Abre o seletor de packs para uma acao administrativa (`kind` no arg 0). */
    PACK_PICK: 'p-pick',
    PACK_PICK_SELECT: 'p-pick-sel',
    PACK_EDIT_MODAL: 'p-edit-modal',
    PACK_PRICE_MODAL: 'p-price-modal',
    PACK_DETAILS_MODAL: 'p-det-modal',
    PACK_CATEGORY_SELECT: 'p-cat-sel',
    IMAGES_PANEL: 'img-panel',
    IMAGE_ADD: 'img-add',
    IMAGE_ADD_MODAL: 'img-add-modal',
    /** Abre o seletor de imagens para uma acao (`kind` no arg 0). */
    IMAGE_PICK: 'img-pick',
    IMAGE_PICK_SELECT: 'img-sel',
    CATEGORIES: 'cats',
    CATEGORY_NEW: 'c-new',
    CATEGORY_NEW_MODAL: 'c-new-modal',
    CATEGORY_PICK: 'c-pick',
    CATEGORY_PICK_SELECT: 'c-sel',
    CATEGORY_EDIT_MODAL: 'c-edit-modal',
    ORDER_CHANNEL: 'ord-ch',
    ORDER_CHANNEL_SELECT: 'ord-ch-sel',
};
exports.CART_ACTION = {
    VIEW: 'view',
    REMOVE: 'remove',
    REMOVE_SELECT: 'rm-sel',
    CLEAR: 'clear',
    CLEAR_CONFIRM: 'clear-ok',
    CHECKOUT: 'checkout',
    CHECKOUT_CONFIRM: 'checkout-ok',
};
exports.ORDER_ACTION = {
    // --- Cliente ---
    LIST: 'list',
    LIST_SELECT: 'list-sel',
    VIEW: 'view',
    // --- Equipe ---
    STAFF: 'staff',
    COUPON: 'coupon',
    COUPON_SELECT: 'coupon-sel',
    PAYMENT: 'payment',
    PAYMENT_ACCOUNT: 'pay-acc',
    CANCEL: 'cancel',
    CANCEL_MODAL: 'cancel-modal',
    PROGRESS: 'progress',
    DELIVER: 'deliver',
    COMPLETE: 'complete',
    ADMIN_LIST: 'admin-list',
    ADMIN_FILTER: 'admin-filter',
    ADMIN_SELECT: 'admin-sel',
    /** Sem argumento abre o seletor; com `customerId` lista os pedidos dele. */
    ADMIN_CUSTOMER: 'admin-cust',
    ADMIN_CUSTOMER_SELECT: 'admin-cust-sel',
    SEARCH: 'search',
    SEARCH_MODAL: 'search-modal',
    // --- Demandas (fila de producao) ---
    /** Fila de producao. Arg: recorte (`all` | `mine` | `free`). */
    QUEUE: 'queue',
    /** Pega a proxima demanda livre, na ordem da fila. Arg: recorte atual. */
    QUEUE_NEXT: 'queue-next',
    CLAIM: 'claim',
    RELEASE: 'release',
    /** Select de usuario: entrega a demanda a alguem da equipe. */
    ASSIGN: 'assign',
};
/**
 * Composicao de anuncio.
 *
 * O rascunho vive em memoria e o `draftId` viaja como argumento do customId —
 * ele identifica, nunca autoriza: cada handler reconfere guild, autoria e
 * permissao antes de tocar no rascunho.
 */
exports.ANNOUNCE_ACTION = {
    /** Reabre o formulario principal (conteudo do embed ou texto simples). */
    EDIT: 'edit',
    EDIT_MODAL: 'edit-modal',
    BUTTON_ADD: 'btn-add',
    BUTTON_ADD_MODAL: 'btn-add-modal',
    BUTTON_REMOVE: 'btn-remove',
    BUTTON_REMOVE_SELECT: 'btn-remove-sel',
    PUBLISH: 'publish',
    DISCARD: 'discard',
};
/**
 * Portfolio de lobos.
 *
 * O painel fica num canal da equipe; o botao abre o formulario e o envio
 * publica direto no canal do portfolio. Nenhum id viaja no customId: nao ha
 * rascunho nem entidade a identificar — o formulario carrega tudo, e o handler
 * reconfere a permissao e o canal de destino a cada envio.
 */
exports.WOLF_ACTION = {
    CREATE: 'create',
    CREATE_MODAL: 'create-modal',
};
/**
 * Entrega do produto dentro do ticket.
 *
 * So existe o modal: quem o abre e o comando `/entregar`, nao um botao de
 * painel. O ticket vem do CANAL onde o formulario foi enviado, nunca do
 * customId — assim nao ha id de ticket circulando em componente, e o handler
 * reconfere permissao, ticket e destino a cada envio.
 */
exports.DELIVERY_ACTION = {
    SEND_MODAL: 'send-modal',
    /**
     * "Confirmar recebimento", no cartao da entrega. Arg: id do ticket.
     *
     * O id identifica, nao autoriza: o handler confere no banco que quem clicou
     * e o DONO do ticket. O botao vive numa mensagem que a equipe tambem ve.
     */
    CONFIRM: 'confirm',
};
/** Analise das inscricoes recebidas pelo site publico. Arg: Discord user ID. */
exports.INFLUENCER_ACTION = {
    APPROVE: 'approve',
    REJECT: 'reject',
};
//# sourceMappingURL=customIds.js.map