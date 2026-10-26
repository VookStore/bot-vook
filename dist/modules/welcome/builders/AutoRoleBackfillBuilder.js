"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBackfillPreview = buildBackfillPreview;
exports.buildBackfillProgress = buildBackfillProgress;
exports.buildBackfillResult = buildBackfillResult;
const discord_js_1 = require("discord.js");
const v2_1 = require("../../../components/v2");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
const discord_1 = require("../../../utils/discord");
/**
 * Telas da aplicacao retroativa do cargo de boas-vindas.
 *
 * A previa NAO e enfeite. O comando escreve em centenas de membros de uma vez e
 * nao existe desfazer: o operador precisa ver o nome do cargo e a contagem
 * exata antes de confirmar, porque "aplicar o cargo errado em 300 pessoas" e um
 * estrago que so se limpa a mao.
 */
const TITLE = 'CARGO DE BOAS-VINDAS — APLICAR RETROATIVAMENTE';
/**
 * Painel de previa: o que aconteceria, e o botao que faz acontecer.
 *
 * `readOnly` desenha tudo menos o botao. E o que separa `/cargo-automatico
 * previa` de `aplicar`: qualquer administrador pode conferir a contagem sem
 * ter um botao destrutivo a um clique de distancia.
 */
function buildBackfillPreview(preview, options = {}) {
    const root = (0, v2_1.container)(preview.blocker === null ? branding_1.COLORS.INFO : branding_1.COLORS.WARNING);
    (0, v2_1.addHeader)(root, TITLE);
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Cargo', (0, discord_1.roleMention)(preview.roleId)],
        ['Membros humanos', String(preview.humans)],
        ['Sem nenhum cargo', String(preview.targets)],
    ])));
    root.addSeparatorComponents((0, v2_1.separator)());
    if (preview.blocker !== null) {
        root.addTextDisplayComponents((0, v2_1.text)(`⚠️ **Nao da para aplicar agora.**\n${preview.blocker}`));
        return root;
    }
    if (preview.targets === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Todos os membros do servidor ja possuem pelo menos um cargo. Nada a fazer.'));
        return root;
    }
    const alvos = preview.targets === 1 ? '**1 membro**' : `**${preview.targets} membros**`;
    root.addTextDisplayComponents((0, v2_1.text)(`${alvos} sem cargo nenhum vao receber ${(0, discord_1.roleMention)(preview.roleId)}.\n` +
        'Quem ja tem qualquer outro cargo NAO sera tocado.'));
    if (preview.batch < preview.targets) {
        root.addTextDisplayComponents((0, v2_1.text)(`-# Esta rodada atende ${preview.batch}. Rode o comando de novo para continuar de onde parou.`));
    }
    if (!preview.enabled) {
        root.addTextDisplayComponents(
        // O toggle governa quem ENTRA. Quem rodou este comando pediu o retroativo
        // de propósito, entao ele acontece — mas dizendo o que esta desligado.
        (0, v2_1.text)('-# O cargo automatico esta **desativado** para novos membros. ' +
            'Isto aqui aplica mesmo assim, so nos que ja estao no servidor.'));
    }
    if (options.readOnly === true) {
        root.addTextDisplayComponents((0, v2_1.footerNote)('Use `/cargo-automatico aplicar` para executar.'));
        return root;
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.CONFIG, customIds_1.CONFIG_ACTION.AUTOROLE_BACKFILL))
        .setLabel('Aplicar agora')
        .setEmoji(branding_1.EMOJIS.WELCOME)
        .setStyle(discord_js_1.ButtonStyle.Secondary)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Nao existe desfazer automatico desta acao.'));
    return root;
}
/** Mensagem enquanto a varredura acontece. */
function buildBackfillProgress(applied, total) {
    const root = (0, v2_1.container)(branding_1.COLORS.INFO);
    (0, v2_1.addHeader)(root, TITLE);
    root.addTextDisplayComponents((0, v2_1.text)(`Aplicando... **${applied}** de **${total}** membros.`), (0, v2_1.footerNote)('Nao rode o comando de novo enquanto isto termina.'));
    return root;
}
/** Resultado final. */
function buildBackfillResult(result, roleId) {
    const root = (0, v2_1.container)(result.failed > 0 ? branding_1.COLORS.WARNING : branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, TITLE);
    root.addTextDisplayComponents((0, v2_1.text)((0, v2_1.fields)([
        ['Cargo aplicado', (0, discord_1.roleMention)(roleId)],
        ['Membros atendidos', String(result.applied)],
        ...(result.failed > 0 ? [['Falhas', String(result.failed)]] : []),
        ...(result.remaining > 0
            ? [['Ainda sem cargo', String(result.remaining)]]
            : []),
    ])));
    if (result.remaining > 0) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addTextDisplayComponents((0, v2_1.text)(`-# Sobraram ${result.remaining} por causa do teto desta rodada. ` +
            'Rode `/cargo-automatico aplicar` de novo para continuar.'));
    }
    if (result.firstError !== null) {
        root.addSeparatorComponents((0, v2_1.separator)());
        root.addTextDisplayComponents((0, v2_1.text)(`-# Primeira falha: ${result.firstError}`));
    }
    return root;
}
//# sourceMappingURL=AutoRoleBackfillBuilder.js.map