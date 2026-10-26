"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cargoAutomaticoCommand = void 0;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const AutoRoleBackfillBuilder_1 = require("../../modules/welcome/builders/AutoRoleBackfillBuilder");
const AutoRoleBackfillService_1 = require("../../modules/welcome/services/AutoRoleBackfillService");
/**
 * /cargo-automatico previa | aplicar
 *
 * Aplica o cargo de boas-vindas (o mesmo de `/ticket-config geral`) a quem esta
 * no servidor SEM NENHUM cargo. Serve para fechar o buraco de quem entrou antes
 * de o cargo existir, ou enquanto ele estava desligado.
 *
 * AS DUAS SUBCOMANDOS MOSTRAM A MESMA PREVIA. A diferenca e so o botao: em
 * `previa` ele nao aparece. Isso deixa qualquer administrador conferir a
 * contagem sem correr o risco de um clique errado abrir a operacao.
 */
const builder = new discord_js_1.SlashCommandBuilder()
    .setName('cargo-automatico')
    .setDescription('Aplica o cargo de boas-vindas em quem esta sem nenhum cargo')
    .setDMPermission(false)
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) => subcommand
    .setName('previa')
    .setDescription('Mostra quantos membros receberiam o cargo, sem aplicar nada'))
    .addSubcommand((subcommand) => subcommand
    .setName('aplicar')
    .setDescription('Mostra a previa e libera o botao para aplicar o cargo'));
async function execute(interaction) {
    /*
     * `setDefaultMemberPermissions` some do lado do servidor quando um admin
     * reconfigura as permissoes do comando na interface do Discord. A checagem
     * aqui e a que realmente vale — escrever em centenas de membros nao pode
     * depender de uma configuracao que outra pessoa consegue afrouxar.
     */
    (0, PermissionService_1.assertCanManageSystem)(interaction.member);
    // A varredura busca a lista completa de membros pelo gateway: passa fácil
    // dos 3 segundos de prazo da interacao num servidor grande.
    await (0, reply_1.deferIfNeeded)(interaction, { ephemeral: true });
    const preview = await (0, AutoRoleBackfillService_1.previewAutoRoleBackfill)(interaction.guild);
    const somenteLeitura = interaction.options.getSubcommand() === 'previa';
    await (0, reply_1.editReplyV2)(interaction, (0, AutoRoleBackfillBuilder_1.buildBackfillPreview)(preview, { readOnly: somenteLeitura }));
}
exports.cargoAutomaticoCommand = {
    builder,
    guildOnly: true,
    execute,
};
//# sourceMappingURL=cargoAutomatico.js.map