"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meusPedidosCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const orders_1 = require("../../interactions/orders");
/**
 * `/meus-pedidos` — historico do proprio cliente.
 *
 * O comando nunca aceita "cliente" como parametro: cada pessoa ve apenas os
 * proprios pedidos. A equipe consulta pedidos por `/pedidos gerenciar`.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('meus-pedidos')
    .setDescription('Mostra os seus pedidos na Vook Store')
    .setDMPermission(false);
async function execute(interaction) {
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    await (0, orders_1.renderCustomerOrdersForCommand)(interaction, interaction.guildId, interaction.user.id, 1);
}
exports.meusPedidosCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=meusPedidos.js.map