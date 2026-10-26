import { PixKeyType } from '@prisma/client';

import { ValidationError } from '../../../core/errors';
import { stripUnsafeChars } from '../../../utils/sanitize';

/**
 * Validacao e normalizacao de chaves PIX.
 *
 * A chave e sempre devolvida no formato canonico exigido pelo BR Code:
 *  - CPF/CNPJ: somente digitos
 *  - EMAIL: minusculo
 *  - PHONE: +55DDDNUMERO
 *  - RANDOM: UUID v4 em minusculo
 */

/** Tamanho maximo aceito para chave do tipo e-mail. */
const EMAIL_MAX_LENGTH = 77;

/** Formato pratico de e-mail (sem aceitar espacos, aspas ou dominios sem TLD). */
const EMAIL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** UUID versao 4 com hifens. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Codigo do Brasil usado no formato E.164. */
const BRAZIL_COUNTRY_CODE = '55';

/** DDDs efetivamente em uso no Brasil. */
const VALID_AREA_CODES: ReadonlySet<string> = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;

const CPF_WEIGHTS_FIRST = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CPF_WEIGHTS_SECOND = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_WEIGHTS_SECOND = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** Rotulos em portugues para exibicao ao usuario. */
const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  RANDOM: 'Chave aleatoria',
};

/** Rotulo em portugues do tipo de chave PIX. */
export function describePixKeyType(type: PixKeyType): string {
  return PIX_KEY_TYPE_LABELS[type] ?? 'Chave PIX';
}

/** Mantem apenas digitos. */
function onlyDigits(value: string): string {
  return stripUnsafeChars(value).replace(/\D+/g, '');
}

/** True para sequencias do tipo "00000000000", sempre invalidas. */
function isRepeatedSequence(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

/** Digito verificador padrao modulo 11 usado por CPF e CNPJ. */
function computeCheckDigit(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) {
    sum += Number(digits.charAt(index)) * weights[index];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function validateCpf(rawKey: string): string {
  const digits = onlyDigits(rawKey);

  if (digits.length !== CPF_LENGTH || isRepeatedSequence(digits)) {
    throw new ValidationError(`CPF com formato invalido (${digits.length} digitos)`, {
      userMessage: 'CPF invalido. Informe os 11 digitos, por exemplo: 123.456.789-09',
    });
  }

  const first = computeCheckDigit(digits, CPF_WEIGHTS_FIRST);
  const second = computeCheckDigit(digits, CPF_WEIGHTS_SECOND);

  if (first !== Number(digits.charAt(9)) || second !== Number(digits.charAt(10))) {
    throw new ValidationError('CPF com digito verificador invalido', {
      userMessage: 'CPF invalido. Confira os numeros digitados.',
    });
  }

  return digits;
}

function validateCnpj(rawKey: string): string {
  const digits = onlyDigits(rawKey);

  if (digits.length !== CNPJ_LENGTH || isRepeatedSequence(digits)) {
    throw new ValidationError(`CNPJ com formato invalido (${digits.length} digitos)`, {
      userMessage: 'CNPJ invalido. Informe os 14 digitos, por exemplo: 11.222.333/0001-81',
    });
  }

  const first = computeCheckDigit(digits, CNPJ_WEIGHTS_FIRST);
  const second = computeCheckDigit(digits, CNPJ_WEIGHTS_SECOND);

  if (first !== Number(digits.charAt(12)) || second !== Number(digits.charAt(13))) {
    throw new ValidationError('CNPJ com digito verificador invalido', {
      userMessage: 'CNPJ invalido. Confira os numeros digitados.',
    });
  }

  return digits;
}

function validateEmail(rawKey: string): string {
  const email = stripUnsafeChars(rawKey).trim().toLowerCase();

  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) {
    throw new ValidationError(`E-mail com tamanho invalido: ${email.length} caracteres`, {
      userMessage: `A chave de e-mail deve ter entre 1 e ${EMAIL_MAX_LENGTH} caracteres.`,
    });
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`E-mail com formato invalido (${email.length} caracteres)`, {
      userMessage: 'E-mail invalido. Use o formato nome@dominio.com',
    });
  }

  return email;
}

function validatePhone(rawKey: string): string {
  let digits = onlyDigits(rawKey);

  // Remove o codigo do pais quando presente (12 = fixo, 13 = celular).
  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith(BRAZIL_COUNTRY_CODE)
  ) {
    digits = digits.slice(BRAZIL_COUNTRY_CODE.length);
  }

  if (digits.length !== 10 && digits.length !== 11) {
    throw new ValidationError(`Telefone com quantidade de digitos invalida: ${digits.length}`, {
      userMessage: 'Telefone invalido. Use DDD + numero, por exemplo: (11) 99999-8888',
    });
  }

  const areaCode = digits.slice(0, 2);
  if (!VALID_AREA_CODES.has(areaCode)) {
    throw new ValidationError(`DDD inexistente: "${areaCode}"`, {
      userMessage: 'Telefone invalido: o DDD informado nao existe.',
    });
  }

  const subscriber = digits.slice(2);
  // Celular tem 9 digitos e comeca com 9; fixo tem 8 e comeca entre 2 e 5.
  const validSubscriber =
    subscriber.length === 9 ? subscriber.startsWith('9') : /^[2-5]/.test(subscriber);

  if (!validSubscriber) {
    throw new ValidationError(`Numero de telefone invalido para o DDD ${areaCode}`, {
      userMessage: 'Telefone invalido. Use DDD + numero, por exemplo: (11) 99999-8888',
    });
  }

  return `+${BRAZIL_COUNTRY_CODE}${digits}`;
}

function validateRandomKey(rawKey: string): string {
  const key = stripUnsafeChars(rawKey).trim().toLowerCase();

  if (!UUID_V4_PATTERN.test(key)) {
    throw new ValidationError(`Chave aleatoria fora do formato UUID v4 (${key.length} caracteres)`, {
      userMessage:
        'Chave aleatoria invalida. Copie a chave do seu banco, no formato ' +
        '123e4567-e89b-42d3-a456-426614174000',
    });
  }

  return key;
}

/**
 * Valida e normaliza a chave PIX conforme o tipo declarado.
 * Lanca ValidationError com mensagem segura quando a chave nao serve.
 */
export function validatePixKey(key: string, type: PixKeyType): string {
  const raw = String(key ?? '');

  if (stripUnsafeChars(raw).trim().length === 0) {
    throw new ValidationError('Chave PIX vazia.', {
      userMessage: `Informe a chave PIX do tipo ${describePixKeyType(type)}.`,
    });
  }

  switch (type) {
    case PixKeyType.CPF:
      return validateCpf(raw);
    case PixKeyType.CNPJ:
      return validateCnpj(raw);
    case PixKeyType.EMAIL:
      return validateEmail(raw);
    case PixKeyType.PHONE:
      return validatePhone(raw);
    case PixKeyType.RANDOM:
      return validateRandomKey(raw);
    default:
      throw new ValidationError(`Tipo de chave PIX desconhecido: ${String(type)}`, {
        userMessage: 'Tipo de chave PIX invalido.',
      });
  }
}
