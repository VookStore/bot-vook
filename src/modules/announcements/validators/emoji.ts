import { ValidationError } from '../../../core/errors';

/**
 * Emoji de botao.
 *
 * O Discord aceita duas coisas MUITO diferentes no campo `emoji` de um botao:
 * um emoji unicode (`"🔥"`, so `name`) ou um emoji CUSTOMIZADO do servidor, que
 * precisa de `id` — o nome sozinho nao resolve nada, e mandar `name: "hairmtc"`
 * faz o botao sair sem emoji nenhum, sem erro nem aviso.
 *
 * Quem escreve o anuncio copia o emoji do proprio Discord e cola a forma
 * textual, `<:hairmtc:1403457616792785017>` (ou `<a:...>` quando animado). Este
 * parser existe para transformar exatamente essa colagem no objeto que o
 * builder espera.
 */

/** `<:nome:id>` ou `<a:nome:id>` — a forma que o Discord poe no seu clipboard. */
const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;

/**
 * Um emoji unicode pode ter varios code points (bandeiras, ZWJ, tom de pele),
 * entao contar caracteres nao serve. O que da para afirmar com seguranca e o
 * OPOSTO: texto comum (letra, digito, pontuacao ASCII) nao e emoji.
 */
const LOOKS_LIKE_TEXT = /[A-Za-z0-9]/;

export interface ButtonEmoji {
  /** Nome do emoji; para unicode, e o proprio caractere. */
  name: string;
  /** Presente apenas em emoji customizado. */
  id?: string;
  animated?: boolean;
}

/**
 * Interpreta o emoji digitado no formulario.
 *
 * Devolve `null` para campo vazio — emoji e opcional em todo botao. Lanca
 * apenas quando o texto foi PREENCHIDO e nao e emoji: silenciar aqui produziria
 * um botao sem emoji e ninguem entenderia por que.
 */
export function parseButtonEmoji(input: string | null | undefined): ButtonEmoji | null {
  const raw = String(input ?? '').trim();
  if (raw.length === 0) return null;

  const custom = CUSTOM_EMOJI.exec(raw);
  if (custom !== null) {
    const [, animated, name, id] = custom;
    return {
      name,
      id,
      ...(animated === 'a' ? { animated: true } : {}),
    };
  }

  // Uma colagem quase certa: `:hairmtc:` (como aparece ao digitar no chat) nao
  // carrega o id, entao nao ha como o bot resolver o emoji. Dizer isso e melhor
  // que aceitar e desenhar um botao pelado.
  if (/^:[A-Za-z0-9_]+:$/.test(raw)) {
    throw new ValidationError(`Emoji customizado sem id: ${raw}`, {
      userMessage:
        'Emoji customizado precisa vir com o id. No Discord, escreva `\\` antes do emoji ' +
        'e envie: ele vira `<:nome:123456789012345678>` — cole esse texto aqui.',
    });
  }

  if (LOOKS_LIKE_TEXT.test(raw) || raw.length > 16) {
    throw new ValidationError(`Emoji invalido: ${raw.slice(0, 40)}`, {
      userMessage:
        'Use um emoji comum (🔥) ou um emoji customizado no formato ' +
        '`<:nome:123456789012345678>`.',
    });
  }

  return { name: raw };
}

/** Texto de volta ao formato colavel, para reabrir o formulario com o valor. */
export function formatButtonEmoji(emoji: ButtonEmoji | null | undefined): string {
  if (emoji === null || emoji === undefined) return '';
  if (emoji.id === undefined) return emoji.name;
  return `<${emoji.animated === true ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}
