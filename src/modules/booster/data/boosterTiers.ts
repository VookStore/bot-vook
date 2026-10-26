/**
 * Beneficios de quem impulsiona o servidor.
 *
 * ESTE ARQUIVO E A FONTE DA VERDADE. Mudou um beneficio? Muda aqui, roda
 * `npm run build` e depois `/booster atualizar` no Discord — o anuncio
 * publicado e reescrito no lugar, sem virar um segundo anuncio no canal.
 *
 * O DESCONTO AQUI E TEXTO, NAO REGRA. Este modulo anuncia; ele nao aplica nada.
 * O abatimento continua sendo lancado pela equipe no atendimento, pelo sistema
 * de cupons. Quem mudar um percentual aqui precisa mudar o cupom tambem — o
 * anuncio nao conhece o cupom, e o cupom nao conhece o anuncio.
 */

/** Um nivel de impulso. */
export interface BoosterTier {
  /** Emoji do nivel. Unicode: sao dois niveis e nao vale gastar emoji da guild. */
  emoji: string;
  title: string;
  perks: readonly string[];
}

export const BOOSTER_TIERS: readonly BoosterTier[] = [
  {
    emoji: '💎',
    title: '1 Boost',
    perks: ['Cargo exclusivo de Booster', '5% de desconto em suas compras'],
  },
  {
    emoji: '👑',
    title: '2 Boosts',
    perks: [
      'Cargo exclusivo de Booster',
      '10% de desconto em suas compras',
      'Prioridade no suporte',
    ],
  },
];

/**
 * Regras do desconto.
 *
 * Ficam separadas dos niveis de proposito: valem para TODOS eles, e repeti-las
 * dentro de cada bloco faria o leitor achar que sao restricoes diferentes.
 *
 * E O BLOCO MAIS IMPORTANTE DEPOIS DOS PERCENTUAIS, e por isso ele responde as
 * tres perguntas que sobram de quem leu "10% de desconto": onde vale, onde nao
 * vale e como resgatar. Antes havia so a exclusao, solta — o cliente descobria
 * o resto no atendimento, que e o lugar caro de descobrir.
 */
export const BOOSTER_RULES: readonly string[] = [
  // Complemento exato da exclusao abaixo: o que sobra da tabela de precos.
  'Vale para **cabelos** e seus adicionais (acessórios, cores, cílios, extração).',
  '**Não** vale para PEDs, roupas e props.',
  /*
   * O bot NAO aplica desconto sozinho — o abatimento e lancado pela equipe pelo
   * sistema de cupons, dentro do atendimento. Omitir isso fazia o cliente
   * esperar um preco ja abatido no cartao de cobranca.
   */
  'Abra um ticket e avise que você é booster: a equipe aplica o desconto na cobrança.',
];

/** Titulo do bloco de regras. */
export const BOOSTER_RULES_TITLE = 'Como usar o desconto';
