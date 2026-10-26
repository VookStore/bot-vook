"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSection = renderSection;
exports.buildPricingPanel = buildPricingPanel;
const branding_1 = require("../../../constants/branding");
const v2_1 = require("../../../components/v2");
const money_1 = require("../../../utils/money");
const sanitize_1 = require("../../../utils/sanitize");
const priceTable_1 = require("../data/priceTable");
/**
 * Tabela de precos publica (Components V2).
 *
 * Mesma linguagem visual do painel de atendimento: banner primeiro, titulo como
 * chamada abaixo dele, blocos separados por divisoria e assinatura da equipe no
 * rodape.
 *
 * NAO TEM BOTAO. A tabela e material de consulta, nao um fluxo — quem decidir
 * comprar abre um ticket pelo painel de atendimento, que ja existe e ja e o
 * unico caminho de venda. Um botao aqui criaria uma segunda porta de entrada
 * para manter em pe.
 *
 * ORCAMENTO DE COMPONENTES. Um container aceita 10 filhos. Aqui: banner(1) +
 * divisoria(1) + cabecalho(1) + N blocos + divisoria(1) + rodape(1). Com os
 * quatro blocos atuais sao 9 — o teste fixa isso, entao um quinto bloco quebra
 * o teste em vez de virar um 400 no canal publico.
 */
/*
 * TEXTO DE CLIENTE VAI ACENTUADO.
 *
 * O resto do projeto escreve sem acento — identificadores, comentarios e log
 * sao ASCII de proposito. Isto aqui e outra coisa: e a vitrine de precos num
 * canal publico, e "Acessorios" e "Cilios" num cartaz de loja parecem descuido.
 * A regra vale so para o que o cliente le.
 */
const TITLE = 'TABELA DE PREÇOS';
const INTRO = 'Valores de referência dos nossos serviços. Para encomendar, abra um ' +
    'atendimento pelo painel de tickets.';
const CLOSING = 'Valores sujeitos a alteração. Trabalhos fora da tabela são orçados no atendimento.';
/**
 * Valor de uma linha, ja com prefixo, sufixo e moeda.
 *
 * O prefixo cola no valor quando e um simbolo (`+R$ 50,00`) e ganha espaco
 * quando e palavra (`a partir de R$ 180,00`). A alternativa seria guardar o
 * espaco dentro do dado — invisivel no arquivo e facil de perder num format.
 */
function renderValue(line) {
    if (line.cents === null) {
        return line.instead ?? 'sob consulta';
    }
    const before = line.before === undefined ? '' : /[a-zà-ú]$/i.test(line.before) ? `${line.before} ` : line.before;
    const amount = `${before}${(0, money_1.formatCents)(line.cents)}`;
    return line.after === undefined ? amount : `${amount} ${line.after}`;
}
/** Um bloco: titulo com emoji e as linhas embaixo. */
function renderSection(section) {
    const heading = `### ${section.emoji} ${section.title}`;
    const lines = section.lines.map((line) => `• **${line.label}** — ${renderValue(line)}`);
    if (section.note !== undefined) {
        /*
         * A observacao e um APARTE quando ha precos acima dela (fica pequena, para
         * nao competir com os valores) e o CONTEUDO do bloco quando nao ha — caso
         * de "Roupas", que nao tem tabela e existe justamente para explicar por que.
         */
        lines.push(lines.length > 0 ? `-# ${section.note}` : section.note);
    }
    return [heading, ...lines].join('\n');
}
/**
 * Monta a tabela de precos.
 *
 * Reaproveita banner, miniatura e nome da loja da configuracao geral para nao
 * abrir um segundo conjunto de campos visuais so para esta mensagem.
 */
function buildPricingPanel(config) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    if ((0, sanitize_1.isSafeImageUrl)(config.panelBannerUrl)) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([config.panelBannerUrl], config.storeName));
        root.addSeparatorComponents((0, v2_1.separator)());
    }
    root.addTextDisplayComponents((0, v2_1.text)(`### ${TITLE}\n${INTRO}`));
    for (const section of priceTable_1.PRICE_TABLE) {
        root.addTextDisplayComponents((0, v2_1.text)(renderSection(section)));
    }
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.footerNote)(`${CLOSING} · Equipe ${config.storeName}`));
    return root;
}
//# sourceMappingURL=PricingBuilder.js.map