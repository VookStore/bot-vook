import { BUSINESS_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { stripUnsafeChars } from '../../../utils/sanitize';

/**
 * URL de um botao de link.
 *
 * Existe separada de `sanitizeImageUrl` — que aplica exatamente as mesmas
 * regras de protocolo e tamanho — por causa de UM detalhe: aquela aceita
 * `attachment://arquivo.png`, valido para thumbnail de embed e invalido num
 * botao. Um botao com `attachment://` derruba a mensagem inteira com 400, e o
 * erro apareceria no clique em "Publicar", nao no momento de cadastrar o botao.
 */
export function sanitizeLinkUrl(input: string | null | undefined): string {
  const raw = stripUnsafeChars(String(input ?? '')).trim();
  if (raw.length === 0) {
    throw new ValidationError('Botao de link sem URL.', {
      userMessage: 'Informe o endereco para onde o botao deve levar.',
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`URL de botao invalida: ${raw.slice(0, 60)}`, {
      userMessage: 'URL invalida. Utilize um endereco https:// completo.',
    });
  }

  if (parsed.protocol !== 'https:') {
    throw new ValidationError(`Protocolo nao permitido no botao: ${parsed.protocol}`, {
      userMessage: 'Somente URLs https:// sao aceitas no botao.',
    });
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new ValidationError('URL de botao com credenciais embutidas.', {
      userMessage: 'URL invalida. Remova usuario/senha do endereco.',
    });
  }
  if (parsed.href.length > BUSINESS_LIMITS.IMAGE_URL_MAX) {
    throw new ValidationError('URL de botao muito longa.', {
      userMessage: 'A URL informada e muito longa.',
    });
  }
  return parsed.href;
}

/**
 * Cor do embed, em hexadecimal.
 *
 * Aceita `#8b5cf6` e `8b5cf6`. Campo vazio devolve `null` — sem cor, o Discord
 * desenha o embed sem a barra lateral, que e um resultado legitimo e nao um
 * erro a ser corrigido com um padrao imposto.
 */
export function parseEmbedColor(input: string | null | undefined): number | null {
  const raw = String(input ?? '').trim().replace(/^#/, '');
  if (raw.length === 0) return null;

  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    throw new ValidationError(`Cor invalida: ${raw.slice(0, 20)}`, {
      userMessage: 'Cor invalida. Use hexadecimal de 6 digitos, por exemplo `#8b5cf6`.',
    });
  }
  return Number.parseInt(raw, 16);
}

/** Hexadecimal de volta ao formulario, para reabrir o modal com o valor atual. */
export function formatEmbedColor(color: number | null): string {
  if (color === null) return '';
  return `#${color.toString(16).padStart(6, '0')}`;
}
