"use strict";
/**
 * Tabela de precos da Vook Store.
 *
 * ESTE ARQUIVO E A FONTE DA VERDADE. Mudou preco? Muda aqui, roda `npm run
 * build` e depois `/precos atualizar` no Discord — a mensagem publicada e
 * reescrita no lugar, sem virar uma segunda tabela no canal.
 *
 * VALORES EM CENTAVOS, sempre. E a mesma unidade do resto do sistema (pedido,
 * cobranca, cupom), e ela existe para nao haver arredondamento de ponto
 * flutuante em dinheiro. R$ 110,00 se escreve `11_000`.
 *
 * A FORMATACAO NAO MORA AQUI. Nenhuma linha guarda "R$ 110,00" como texto: o
 * valor e um numero e quem desenha chama `formatCents`. Assim a moeda tem um
 * formato so no bot inteiro, e mudar esse formato nao exige reescrever a
 * tabela.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRICE_TABLE = void 0;
/*
 * Emojis personalizados da guild.
 *
 * Ficam nomeados aqui em vez de soltos no meio do texto: um emoji renomeado ou
 * recriado no Discord muda de id, e quando isso acontece o conserto e uma linha
 * neste bloco, nao uma cacada pelo arquivo.
 */
const EMOJI = {
    CABELOS: '<:cabelos:1543648405899968522>',
    PELUCIAS: '<:pelucias:1543661677869015162>',
    ROUPAS: '<:roupas:1543663594808545360>',
};
/*
 * Os rotulos sao TEXTO DE CLIENTE, entao vao acentuados — ao contrario dos
 * identificadores e comentarios do projeto, que sao ASCII de proposito.
 */
exports.PRICE_TABLE = [
    {
        emoji: EMOJI.CABELOS,
        title: 'Cabelos',
        lines: [
            { label: 'Cabelo com presilha', cents: 11_000 },
            { label: 'Cabelo sem presilha', cents: 9_000 },
            { label: 'Acessórios', cents: 2_000, after: 'cada' },
            { label: 'Cores adicionais', cents: 2_000, after: '(pago uma vez)' },
            { label: 'Cílios', cents: 3_000 },
            { label: '2 cabelos em 1 slot', cents: 5_000, before: '+' },
            { label: 'Extração para o Blender (renders)', cents: 3_000, after: 'cada' },
        ],
    },
    {
        // Sem emoji proprio de PEDs ainda: reaproveita o de cabelos.
        emoji: EMOJI.CABELOS,
        title: 'PEDs de Lobo',
        lines: [
            { label: 'PED de Lobo', cents: 18_000, before: 'a partir de' },
            { label: 'Com runas', cents: 20_000 },
            { label: 'Acessórios', cents: 2_000, after: 'cada' },
        ],
    },
    {
        emoji: EMOJI.PELUCIAS,
        title: 'Props (Pelúcias)',
        lines: [
            { label: 'Criação e conversão', cents: 4_000, after: 'cada' },
            {
                label: 'Criação e conversão com efeitos',
                cents: null,
                instead: 'a combinar com o criador',
            },
        ],
    },
    {
        emoji: EMOJI.ROUPAS,
        title: 'Roupas',
        lines: [],
        note: 'Não produzimos internamente — encaminhamos para um parceiro de confiança.',
    },
];
//# sourceMappingURL=priceTable.js.map