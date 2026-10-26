/**
 * Conversao segura de `unknown` para texto.
 *
 * `String(valor)` em um objeto produz "[object Object]" — inutil em log e
 * PIOR ainda no transcript, onde viraria conteudo visivel para o cliente.
 * Aqui cada tipo tem um tratamento explicito.
 */
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;

  try {
    const json = JSON.stringify(value);
    return json ?? '';
  } catch {
    // Referencia circular ou getter que lanca.
    return '[Unserializable]';
  }
}
