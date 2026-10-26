"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRules = renderRules;
exports.renderTier = renderTier;
exports.buildBoosterPanel = buildBoosterPanel;
const branding_1 = require("../../../constants/branding");
const v2_1 = require("../../../components/v2");
const boosterTiers_1 = require("../data/boosterTiers");
/**
 * Anuncio dos beneficios de booster (Components V2).
 *
 * Mesma linguagem dos outros paineis fixos da loja: titulo como chamada, blocos
 * separados por divisoria e assinatura da equipe no rodape.
 *
 * A EXCLUSAO NAO E RODAPE. "Nao valido para PEDs, roupas e props" vai destacada
 * como citacao, acima da assinatura: e a unica linha do anuncio que retira
 * alguma coisa, e escondida em letra miuda ela vira discussao no atendimento
 * com quem leu so os percentuais.
 *
 * ORCAMENTO DE COMPONENTES. Um container aceita 10 filhos. Aqui: cabecalho(1) +
 * divisoria(1) + N niveis + divisoria(1) + exclusao(1) + rodape(1). Com os dois
 * niveis atuais sao 7 — o teste fixa isso, entao um nivel novo quebra o teste em
 * vez de virar um 400 num canal publico.
 */
/** Emoji personalizado da guild. Nomeado aqui para o conserto ser uma linha. */
const BOOSTER_EMOJI = '<:booster:1544060264800985149>';
const TITLE = `${BOOSTER_EMOJI} IMPULSIONE O SERVIDOR`;
const INTRO = 'Impulsionar a **Vook Store** libera cargo exclusivo e desconto nas suas ' +
    'compras. Os benefícios acumulam conforme o número de boosts.';
/**
 * Bloco de regras do desconto.
 *
 * CITACAO, e nao letra miuda. E o unico bloco que RETIRA alguma coisa e o unico
 * que diz como resgatar; a barra lateral da citacao o separa dos beneficios sem
 * o encolher, que era o problema da versao anterior — uma linha solta parecia
 * rodape e ninguem lia.
 */
function renderRules() {
    const linhas = boosterTiers_1.BOOSTER_RULES.map((rule) => `> ・${rule}`);
    return [`> ### ⚠️ ${boosterTiers_1.BOOSTER_RULES_TITLE}`, ...linhas].join('\n');
}
/** Um nivel: titulo com emoji e os beneficios embaixo. */
function renderTier(tier) {
    const heading = `### ${tier.emoji} ${tier.title}`;
    // `・` no lugar de `•`: e o marcador que a loja ja usa nos avisos do servidor.
    const perks = tier.perks.map((perk) => `・${perk}`);
    return [heading, ...perks].join('\n');
}
/**
 * Monta o anuncio.
 *
 * `artFilename` e o nome do anexo enviado junto da mensagem; a miniatura o
 * referencia por `attachment://`. `null` quando nao ha arte no disco — o
 * anuncio sai sem miniatura, que e decoracao.
 */
function buildBoosterPanel(config, artFilename = null) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    if (artFilename === null) {
        (0, v2_1.addHeader)(root, TITLE);
        root.addTextDisplayComponents((0, v2_1.text)(INTRO));
    }
    else {
        /*
         * Titulo e introducao no MESMO bloco para a arte alinhar com os dois. O
         * texto alternativo e o nome da loja: a imagem e a marca, e descrever cada
         * detalhe dela em voz alta so atrapalharia quem usa leitor de tela.
         */
        root.addSectionComponents((0, v2_1.sectionWithThumbnail)([`## ${TITLE}`, INTRO], `attachment://${artFilename}`, config.storeName));
        root.addSeparatorComponents((0, v2_1.separator)());
    }
    for (const tier of boosterTiers_1.BOOSTER_TIERS) {
        root.addTextDisplayComponents((0, v2_1.text)(renderTier(tier)));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(renderRules()));
    root.addTextDisplayComponents((0, v2_1.footerNote)(`Equipe ${config.storeName}`));
    return root;
}
//# sourceMappingURL=BoosterBuilder.js.map