/**
 * Dados do portfolio de lobos.
 *
 * ESTE ARQUIVO E A FONTE DA VERDADE dos tipos de lobo e dos emojis que o post
 * usa. Mudou um nome ou apareceu um terceiro tipo? E aqui — o formulario, o
 * painel e o post leem desta lista.
 */

/*
 * Emojis personalizados da guild.
 *
 * Nomeados aqui, e nao soltos no texto, pelo mesmo motivo da tabela de precos:
 * emoji recriado no Discord muda de id, e o conserto tem de ser uma linha neste
 * bloco, nao uma cacada pelos builders.
 *
 * SO ENTRAM EM TEXTO, nunca no `emoji` de botao ou de opcao de select. Em texto,
 * um emoji que o bot nao alcanca aparece como `:lobo:` e a mensagem sai; num
 * componente, o Discord recusa a mensagem INTEIRA com 400 — e o painel ou o
 * formulario deixaria de abrir por causa de um enfeite.
 */
export const WOLF_EMOJI = {
  LOBO: '<:lobo:1545571121045307463>',
  PERSONALIZACAO: '<:personalizacao:1545576354995765298>',
  ADICIONAL: '<:adicional:1545576868986757190>',
  TICKET: '<:folder:1413672818423627857>',
} as const;

/**
 * Tipos de lobo que a loja produz.
 *
 * `value` e o que trafega no formulario (curto, sem acento, estavel); `label` e
 * texto de cliente, e vai como aparece no post.
 */
export const WOLF_KINDS = [
  { value: 'lycan', label: 'Lycan' },
  { value: 'lobisomem', label: 'Lobisomem' },
] as const;

export type WolfKind = (typeof WOLF_KINDS)[number]['value'];

export function isWolfKind(value: string): value is WolfKind {
  return WOLF_KINDS.some((kind) => kind.value === value);
}

export function wolfKindLabel(kind: WolfKind): string {
  return WOLF_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}
