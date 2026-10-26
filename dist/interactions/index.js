"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAll = registerAll;
const commands_1 = require("../commands");
const registry_1 = require("../core/client/registry");
const announcements_1 = require("./announcements");
const cart_1 = require("./cart");
const catalog_1 = require("./catalog");
const categories_1 = require("./categories");
const delivery_1 = require("./delivery");
const orders_1 = require("./orders");
const config_1 = require("./config");
const coupons_1 = require("./coupons");
const paymentAccounts_1 = require("./paymentAccounts");
const payments_1 = require("./payments");
const reviews_1 = require("./reviews");
const tickets_1 = require("./tickets");
const welcome_1 = require("./welcome");
const booster_1 = require("./booster");
const wolves_1 = require("./wolves");
const influencers_1 = require("./influencers");
/**
 * Registro de todos os comandos e handlers de componente.
 *
 * O `Registry` lanca em caso de `namespace:action` duplicado, entao um conflito
 * de rota falha no startup — nunca silenciosamente em producao.
 */
function registerAll(target = registry_1.registry) {
    target.registerCommands(commands_1.commands);
    target.registerButtons([
        ...tickets_1.ticketButtons,
        ...payments_1.paymentButtons,
        ...coupons_1.couponButtons,
        ...paymentAccounts_1.paymentAccountButtons,
        ...categories_1.categoryButtons,
        ...config_1.configButtons,
        ...reviews_1.reviewButtons,
        ...catalog_1.catalogButtons,
        ...cart_1.cartButtons,
        ...orders_1.orderButtons,
        ...announcements_1.announcementButtons,
        ...welcome_1.welcomeButtons,
        ...wolves_1.wolfButtons,
        ...delivery_1.deliveryButtons,
        ...influencers_1.influencerButtons,
    ]);
    target.registerSelects([
        ...tickets_1.ticketSelects,
        ...payments_1.paymentSelects,
        ...coupons_1.couponSelects,
        ...paymentAccounts_1.paymentAccountSelects,
        ...categories_1.categorySelects,
        ...config_1.configSelects,
        ...catalog_1.catalogSelects,
        ...cart_1.cartSelects,
        ...orders_1.orderSelects,
        ...announcements_1.announcementSelects,
        ...booster_1.boosterSelects,
    ]);
    target.registerModals([
        ...tickets_1.ticketModals,
        ...payments_1.paymentModals,
        ...coupons_1.couponModals,
        ...paymentAccounts_1.paymentAccountModals,
        ...categories_1.categoryModals,
        ...config_1.configModals,
        ...reviews_1.reviewModals,
        ...catalog_1.catalogModals,
        ...orders_1.orderModals,
        ...announcements_1.announcementModals,
        ...wolves_1.wolfModals,
        ...delivery_1.deliveryModals,
    ]);
    return target;
}
//# sourceMappingURL=index.js.map