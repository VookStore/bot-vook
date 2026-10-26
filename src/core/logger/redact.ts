import { toDisplayString } from '../../utils/stringify';

/**
 * Sanitizacao de segredos.
 *
 * Nenhum token, URL de banco, senha ou header de autorizacao pode aparecer em
 * log, mensagem do Discord ou registro persistido.
 */

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|senha|authorization|auth|apikey|api_key|database_url|databaseurl|connection_string|private_key|privatekey|cookie|session)/i;

const REDACTED = '[REDACTED]';

/** Padroes textuais que precisam ser mascarados em qualquer string. */
const VALUE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // URLs de conexao com credenciais: postgres://user:pass@host/db
  { pattern: /\b([a-z][a-z0-9+.-]*):\/\/([^\s:/@]+):([^\s@]+)@/gi, replacement: '$1://$2:***@' },
  // Bot tokens do Discord (3 segmentos base64url separados por ponto).
  {
    pattern: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g,
    replacement: REDACTED,
  },
  /*
   * Header Authorization inline ("Authorization: Bot <token>").
   *
   * O valor precisa PARECER uma credencial: 24+ caracteres e ao menos um
   * digito/ponto/underscore/hifen. Sem essa exigencia o padrao casava frases
   * comuns — "Bot operacional." virava "Bot [REDACTED]", justamente na linha
   * que anuncia que o boot deu certo. Redacao boa demais destroi o log.
   */
  {
    pattern: /\b(Bot|Bearer|Basic)\s+(?=[A-Za-z0-9._-]{24,})([A-Za-z0-9._-]*[\d._-][A-Za-z0-9._-]*)/g,
    replacement: '$1 [REDACTED]',
  },
];

/** Mascara segredos conhecidos dentro de uma string livre. */
export function redactString(input: string): string {
  let output = input;
  for (const { pattern, replacement } of VALUE_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/**
 * Sanitiza recursivamente qualquer valor antes de logar/persistir.
 * Chaves sensiveis viram `[REDACTED]`; strings passam pelo mascaramento.
 */
export function redactValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (typeof value === 'object') {
    const objectValue = value;
    if (seen.has(objectValue)) return '[Circular]';
    seen.add(objectValue);

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => redactValue(item, depth + 1, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1, seen);
    }
    return output;
  }

  return toDisplayString(value);
}

/** Sanitiza um objeto de contexto mantendo o tipo de retorno util. */
export function redactContext(context: Record<string, unknown>): Record<string, unknown> {
  return redactValue(context) as Record<string, unknown>;
}
