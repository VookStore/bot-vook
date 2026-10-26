"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOrphanCleanupButton = buildOrphanCleanupButton;
exports.buildOrphanPreview = buildOrphanPreview;
exports.buildOrphanCleanupResult = buildOrphanCleanupResult;
const discord_js_1 = require("discord.js");
const v2_1 = require("../../../components/v2");
const branding_1 = require("../../../constants/branding");
const customIds_1 = require("../../../constants/customIds");
/**
 * Telas da limpeza de topicos orfaos.
 *
 * A previa lista NOME e CANAL de cada topico antes de qualquer remocao. Apagar
 * canal nao tem desfazer, e a lista e curta o bastante para caber — nao existe
 * motivo para o operador confirmar no escuro.
 */
const TITLE = 'TOPICOS ORFAOS';
/** Quantos topicos sao listados por nome antes de virar contagem. */
const LISTED = 15;
/**
 * O corte vai no customId.
 *
 * Ao clicar, o handler varre de novo e so apaga o que ja existia no momento da
 * previa. Um ticket aberto entre a previa e o clique fica de fora mesmo que a
 * abertura dele tenha falhado — o operador nunca o viu na lista, e apagar o que
 * nao foi mostrado e exatamente o que uma confirmacao deveria impedir.
 */
function buildOrphanCleanupButton(cutoff) {
    return new discord_js_1.ButtonBuilder()
        .setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.TICKET, customIds_1.TICKET_ACTION.CLEAN_ORPHANS, String(cutoff.getTime())))
        .setLabel('Apagar os listados')
        .setEmoji(branding_1.EMOJIS.DELETE)
        .setStyle(discord_js_1.ButtonStyle.Secondary);
}
/** Previa: o que existe e o botao que apaga. */
function buildOrphanPreview(orphans, cutoff) {
    const root = (0, v2_1.container)(orphans.length === 0 ? branding_1.COLORS.SUCCESS : branding_1.COLORS.WARNING);
    (0, v2_1.addHeader)(root, TITLE);
    if (orphans.length === 0) {
        root.addTextDisplayComponents((0, v2_1.text)('Nenhum topico de ticket sem registro no banco.\n' +
            '-# Sao varridos apenas os topicos ativos dos canais de atendimento.'));
        return root;
    }
    root.addTextDisplayComponents((0, v2_1.text)(`**${orphans.length}** topico(s) com nome de ticket nao tem registro no banco. ` +
        'Eles sobraram de aberturas que falharam depois de o topico ser criado — ' +
        'estao vazios e ninguem consegue fecha-los pelo bot.'));
    root.addSeparatorComponents((0, v2_1.separator)());
    const linhas = orphans
        .slice(0, LISTED)
        .map((orphan) => `• **${orphan.name}** — <#${orphan.parentId}>`);
    const resto = orphans.length - linhas.length;
    if (resto > 0)
        linhas.push(`-# e mais ${resto}`);
    root.addTextDisplayComponents((0, v2_1.text)(linhas.join('\n')));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addActionRowComponents((0, v2_1.buttonRow)(buildOrphanCleanupButton(cutoff)));
    root.addTextDisplayComponents((0, v2_1.footerNote)('Apagar um topico nao tem desfazer. Nenhum ticket registrado e tocado.'));
    return root;
}
/** Resultado da limpeza. */
function buildOrphanCleanupResult(result) {
    const root = (0, v2_1.container)(result.failed > 0 ? branding_1.COLORS.WARNING : branding_1.COLORS.SUCCESS);
    (0, v2_1.addHeader)(root, TITLE);
    const linhas = [`**${result.deleted}** topico(s) removido(s).`];
    if (result.failed > 0) {
        linhas.push(`-# ${result.failed} nao pode(m) ser removido(s) — ou ja sumiu(ram), ou o bot perdeu acesso.`);
    }
    root.addTextDisplayComponents((0, v2_1.text)(linhas.join('\n')));
    return root;
}
//# sourceMappingURL=OrphanCleanupBuilder.js.map