"use strict";
/**
 * Identidade visual oficial da Vook Store.
 * Qualquer texto exibido ao usuario deve vir daqui (ou da configuracao da guild).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_LABEL = exports.EMOJIS = exports.COLORS = exports.TITLES = exports.BOT_NAME = exports.DEFAULT_STORE_NAME = void 0;
exports.renderStars = renderStars;
exports.DEFAULT_STORE_NAME = 'Vook Store';
exports.BOT_NAME = 'Vook Store Bot';
/** Titulos padronizados dos paineis (Components V2). */
exports.TITLES = {
    TICKET_PANEL: 'VOOK STORE — CENTRAL DE ATENDIMENTO',
    TICKET_INTERNAL: 'VOOK STORE — ATENDIMENTO',
    TICKET_ADMIN: 'VOOK STORE — PAINEL ADMINISTRATIVO',
    TICKET_CLOSED: 'VOOK STORE — ATENDIMENTO FINALIZADO',
    TICKET_LOG: 'VOOK STORE — TICKET FINALIZADO',
    TICKET_UPDATE: 'VOOK STORE — NOVA ATUALIZACAO',
    PAYMENT: 'VOOK STORE — PAGAMENTO PIX',
    PAYMENT_MANAGE: 'VOOK STORE — GERENCIAR COBRANCA',
    COUPONS: 'VOOK STORE — CUPONS',
    WELCOME: 'VOOK STORE — BOAS-VINDAS',
    REVIEW_REQUEST: 'VOOK STORE — AVALIE SEU ATENDIMENTO',
    REVIEW_PUBLISHED: 'VOOK STORE — NOVA AVALIACAO',
    CONFIG: 'VOOK STORE — CONFIGURACOES',
    STATUS: 'VOOK STORE — STATUS DO SISTEMA',
    DIAGNOSTICS: 'VOOK STORE — DIAGNOSTICO',
    CATEGORIES: 'VOOK STORE — CATEGORIAS',
    DESTINATIONS: 'VOOK STORE — DESTINOS',
    TEAM: 'VOOK STORE — EQUIPES',
    PAYMENT_ACCOUNTS: 'VOOK STORE — CONTAS PIX',
    CATALOG: 'VOOK STORE — CATÁLOGO',
    CATALOG_PACK: 'VOOK STORE — PACK',
    CATALOG_ADMIN: 'VOOK STORE — GERENCIAR CATÁLOGO',
    CATALOG_CATEGORIES: 'VOOK STORE — CATEGORIAS DO CATÁLOGO',
    CATALOG_IMAGES: 'VOOK STORE — IMAGENS DO PACK',
    CART: 'VOOK STORE — SEU CARRINHO',
    CART_ABANDONED: 'VOOK STORE — VOCE ESQUECEU ALGO',
    CHECKOUT: 'VOOK STORE — CONFIRMAR COMPRA',
    ORDER: 'VOOK STORE — PEDIDO',
    ORDER_NEW: 'VOOK STORE — NOVO PEDIDO',
    ORDERS: 'VOOK STORE — MEUS PEDIDOS',
    ORDERS_ADMIN: 'VOOK STORE — GERENCIAR PEDIDOS',
    ORDER_CHARGE: 'VOOK STORE — PAGAMENTO DO PEDIDO',
    ORDER_RECEIPT: 'VOOK STORE — COMPROVANTE',
    ORDER_PAID: 'VOOK STORE — PAGAMENTO CONFIRMADO',
    ORDER_DELIVERED: 'VOOK STORE — PEDIDO ENTREGUE',
    /**
     * A entrega do ARQUIVO dentro do ticket, que e outra coisa do que o aviso de
     * `ORDER_DELIVERED`: aquele diz que o pedido mudou de estado, este entrega o
     * produto na mao do cliente.
     */
    DELIVERY: 'VOOK STORE — ENTREGA DO PRODUTO',
    /** Cartao do quadro: um pedido pago esperando (ou recebendo) producao. */
    DEMAND: 'VOOK STORE — DEMANDA',
    /** A mesma demanda depois que alguem comecou. Vale para o canal e para a DM. */
    DEMAND_STARTED: 'VOOK STORE — DEMANDA INICIADA',
    /** A demanda depois da entrega, no canal de concluidas. */
    DEMAND_DONE: 'VOOK STORE — DEMANDA CONCLUÍDA',
    /** Cartao do ticket entregue, no canal de concluidos. */
    TICKET_DONE: 'VOOK STORE — ATENDIMENTO ENTREGUE',
    WOLF_PANEL: 'VOOK STORE — ANÚNCIO DE LOBOS',
    WOLF_PORTFOLIO: 'VOOK STORE — PORTFÓLIO',
};
/** Cores de destaque dos containers V2. */
exports.COLORS = {
    BRAND: 0x8b5cf6,
    SUCCESS: 0x22c55e,
    WARNING: 0xf59e0b,
    DANGER: 0xef4444,
    INFO: 0x3b82f6,
    NEUTRAL: 0x64748b,
    GOLD: 0xfacc15,
};
exports.EMOJIS = {
    TICKET: '🎟️',
    TICKET_FOLDER: '📂',
    LOCK: '🔒',
    QUEUE: '🕐',
    CLAIM: '🙋',
    REFRESH: '🔄',
    NOTIFY: '🔔',
    ADMIN: '⚙️',
    CLOSE: '❌',
    APPROVE: '✅',
    PAYMENT: '💳',
    COUPON: '🎫',
    REVIEW: '⭐',
    WELCOME: '👋',
    ADD: '➕',
    REMOVE: '➖',
    EDIT: '✏️',
    DELETE: '🗑️',
    UP: '🔼',
    DOWN: '🔽',
    ENABLE: '🟢',
    DISABLE: '🔴',
    LIST: '📋',
    CHANNELS: '📁',
    ROLE: '👤',
    VISUAL: '🎨',
    LIMITS: '⚖️',
    ONLINE: '🟢',
    OFFLINE: '🔴',
    PENDING: '🟡',
    TRANSFER: '🔀',
    LINK: '🔗',
    STORE: '🛍️',
    CART: '🛒',
    PACKAGE: '📦',
    BUY_NOW: '⚡',
    INFO: 'ℹ️',
    SEARCH: '🔎',
    IMAGE: '🖼️',
    PRICE: '💰',
    FEATURED: '🔥',
    PREVIOUS: '◀️',
    NEXT: '▶️',
    BACK: '↩️',
    CLEAR: '🧹',
    DELIVER: '🚚',
    PREPARING: '🛠️',
    RECEIPT: '🧾',
    WOLF: '🐺',
};
/** Marcadores de status usados em textos de painel. */
exports.STATUS_LABEL = {
    WAITING: '🟡 Aguardando atendimento',
    IN_PROGRESS: '🟢 Em atendimento',
    CLOSING: '🟠 Finalizando',
    CLOSED: '⚫ Finalizado',
    ORPHANED: '🔴 Canal removido',
    CREATING: '⚪ Criando',
};
/** Renderiza a nota como estrelas (1..5). */
function renderStars(rating) {
    const safe = Math.max(0, Math.min(5, Math.trunc(rating)));
    return '⭐'.repeat(safe) + '☆'.repeat(5 - safe);
}
//# sourceMappingURL=branding.js.map