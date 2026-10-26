"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.carrinhoCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const cart_1 = require("../../interactions/cart");
/**
 * `/carrinho` — atalho para o proprio carrinho.
 *
 * Sempre efemero: o carrinho e informacao do cliente e nunca vira conteudo do
 * canal. E aqui NAO existe campo de cupom — desconto e decisao da equipe.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('carrinho')
    .setDescription('Mostra o seu carrinho da Vook Store')
    .setDMPermission(false);
async function execute(interaction) {
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    await (0, cart_1.renderCartForCommand)(interaction, interaction.guildId, interaction.user.id);
}
exports.carrinhoCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=carrinho.js.map