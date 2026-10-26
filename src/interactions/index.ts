import { commands } from '../commands';
import { registry, type Registry } from '../core/client/registry';
import { announcementButtons, announcementModals, announcementSelects } from './announcements';
import { cartButtons, cartSelects } from './cart';
import { catalogButtons, catalogModals, catalogSelects } from './catalog';
import { categoryButtons, categoryModals, categorySelects } from './categories';
import { deliveryButtons, deliveryModals } from './delivery';
import { orderButtons, orderModals, orderSelects } from './orders';
import { configButtons, configModals, configSelects } from './config';
import { couponButtons, couponModals, couponSelects } from './coupons';
import {
  paymentAccountButtons,
  paymentAccountModals,
  paymentAccountSelects,
} from './paymentAccounts';
import { paymentButtons, paymentModals, paymentSelects } from './payments';
import { reviewButtons, reviewModals } from './reviews';
import { ticketButtons, ticketModals, ticketSelects } from './tickets';
import { welcomeButtons } from './welcome';
import { boosterSelects } from './booster';
import { wolfButtons, wolfModals } from './wolves';
import { influencerButtons } from './influencers';

/**
 * Registro de todos os comandos e handlers de componente.
 *
 * O `Registry` lanca em caso de `namespace:action` duplicado, entao um conflito
 * de rota falha no startup — nunca silenciosamente em producao.
 */
export function registerAll(target: Registry = registry): Registry {
  target.registerCommands(commands);

  target.registerButtons([
    ...ticketButtons,
    ...paymentButtons,
    ...couponButtons,
    ...paymentAccountButtons,
    ...categoryButtons,
    ...configButtons,
    ...reviewButtons,
    ...catalogButtons,
    ...cartButtons,
    ...orderButtons,
    ...announcementButtons,
    ...welcomeButtons,
    ...wolfButtons,
    ...deliveryButtons,
    ...influencerButtons,
  ]);

  target.registerSelects([
    ...ticketSelects,
    ...paymentSelects,
    ...couponSelects,
    ...paymentAccountSelects,
    ...categorySelects,
    ...configSelects,
    ...catalogSelects,
    ...cartSelects,
    ...orderSelects,
    ...announcementSelects,
    ...boosterSelects,
  ]);

  target.registerModals([
    ...ticketModals,
    ...paymentModals,
    ...couponModals,
    ...paymentAccountModals,
    ...categoryModals,
    ...configModals,
    ...reviewModals,
    ...catalogModals,
    ...orderModals,
    ...announcementModals,
    ...wolfModals,
    ...deliveryModals,
  ]);

  return target;
}
