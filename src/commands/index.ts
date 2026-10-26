import { carrinhoCommand } from './catalog/carrinho';
import { catalogoCommand } from './catalog/catalogo';
import { comprovanteCommand } from './catalog/comprovante';
import { catalogoPainelCommand } from './catalog/catalogoPainel';
import { meusPedidosCommand } from './catalog/meusPedidos';
import { pedidosCommand } from './catalog/pedidos';
import { ticketCategoriasCommand } from './config/ticketCategorias';
import { ticketConfigCommand } from './config/ticketConfig';
import { ticketDestinosCommand } from './config/ticketDestinos';
import { ticketEquipeCommand } from './config/ticketEquipe';
import { cupomCommand } from './coupons/cupom';
import { configPagamentoCommand } from './payments/configPagamento';
import { pagamentoCommand } from './payments/pagamento';
import { anunciarCommand } from './system/anunciar';
import { cargoAutomaticoCommand } from './system/cargoAutomatico';
import { demandasCommand } from './system/demandas';
import { lobosCommand } from './system/lobos';
import { boosterCommand } from './system/booster';
import { precosCommand } from './system/precos';
import { ticketPainelCommand } from './system/ticketPainel';
import { ticketSistemaCommand } from './system/ticketSistema';
import { entregarCommand } from './tickets/entregar';
import type { SlashCommandDefinition } from '../types';

/**
 * Todos os slash commands do Vook Store Bot.
 * Esta lista alimenta o registro em memoria e o deploy na API do Discord.
 */
export const commands: readonly SlashCommandDefinition[] = [
  // Configuracao
  ticketConfigCommand,
  ticketCategoriasCommand,
  ticketDestinosCommand,
  ticketEquipeCommand,
  // Painel e sistema
  ticketPainelCommand,
  ticketSistemaCommand,
  anunciarCommand,
  cargoAutomaticoCommand,
  precosCommand,
  boosterCommand,
  lobosCommand,
  demandasCommand,
  // Comercial
  entregarCommand,
  pagamentoCommand,
  configPagamentoCommand,
  cupomCommand,
  // Catalogo, carrinho e pedidos
  catalogoCommand,
  catalogoPainelCommand,
  carrinhoCommand,
  meusPedidosCommand,
  pedidosCommand,
  comprovanteCommand,
];
