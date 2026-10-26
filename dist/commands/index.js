"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commands = void 0;
const carrinho_1 = require("./catalog/carrinho");
const catalogo_1 = require("./catalog/catalogo");
const comprovante_1 = require("./catalog/comprovante");
const catalogoPainel_1 = require("./catalog/catalogoPainel");
const meusPedidos_1 = require("./catalog/meusPedidos");
const pedidos_1 = require("./catalog/pedidos");
const ticketCategorias_1 = require("./config/ticketCategorias");
const ticketConfig_1 = require("./config/ticketConfig");
const ticketDestinos_1 = require("./config/ticketDestinos");
const ticketEquipe_1 = require("./config/ticketEquipe");
const cupom_1 = require("./coupons/cupom");
const configPagamento_1 = require("./payments/configPagamento");
const pagamento_1 = require("./payments/pagamento");
const anunciar_1 = require("./system/anunciar");
const cargoAutomatico_1 = require("./system/cargoAutomatico");
const demandas_1 = require("./system/demandas");
const lobos_1 = require("./system/lobos");
const booster_1 = require("./system/booster");
const precos_1 = require("./system/precos");
const ticketPainel_1 = require("./system/ticketPainel");
const ticketSistema_1 = require("./system/ticketSistema");
const entregar_1 = require("./tickets/entregar");
/**
 * Todos os slash commands do Vook Store Bot.
 * Esta lista alimenta o registro em memoria e o deploy na API do Discord.
 */
exports.commands = [
    // Configuracao
    ticketConfig_1.ticketConfigCommand,
    ticketCategorias_1.ticketCategoriasCommand,
    ticketDestinos_1.ticketDestinosCommand,
    ticketEquipe_1.ticketEquipeCommand,
    // Painel e sistema
    ticketPainel_1.ticketPainelCommand,
    ticketSistema_1.ticketSistemaCommand,
    anunciar_1.anunciarCommand,
    cargoAutomatico_1.cargoAutomaticoCommand,
    precos_1.precosCommand,
    booster_1.boosterCommand,
    lobos_1.lobosCommand,
    demandas_1.demandasCommand,
    // Comercial
    entregar_1.entregarCommand,
    pagamento_1.pagamentoCommand,
    configPagamento_1.configPagamentoCommand,
    cupom_1.cupomCommand,
    // Catalogo, carrinho e pedidos
    catalogo_1.catalogoCommand,
    catalogoPainel_1.catalogoPainelCommand,
    carrinho_1.carrinhoCommand,
    meusPedidos_1.meusPedidosCommand,
    pedidos_1.pedidosCommand,
    comprovante_1.comprovanteCommand,
];
//# sourceMappingURL=index.js.map