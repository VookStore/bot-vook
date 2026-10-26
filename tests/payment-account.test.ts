import { PixKeyType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { BUSINESS_LIMITS } from '../src/constants/limits';
import { ValidationError } from '../src/core/errors';
import {
  maskPixKey,
  parseKeyTypeAndExpiration,
} from '../src/modules/payments/builders/PaymentAccountBuilders';
import {
  DEFAULT_EXPIRATION_MINUTES,
  EXPIRATION_MAX_MINUTES,
  EXPIRATION_MIN_MINUTES,
  normalizeAccountInput,
  type PaymentAccountInput,
} from '../src/modules/payments/services/PaymentAccountService';

/** Entrada valida usada como base; cada teste altera apenas o campo em foco. */
function baseInput(overrides: Partial<PaymentAccountInput> = {}): PaymentAccountInput {
  return {
    name: 'Conta principal',
    receiverName: 'Vook Store Ltda',
    pixKey: 'pagamentos@vookstore.com',
    pixKeyType: PixKeyType.EMAIL,
    city: 'Sao Paulo',
    defaultExpirationMinutes: 30,
    ...overrides,
  };
}

describe('maskPixKey', () => {
  it('mostra apenas a primeira letra e o dominio de um e-mail', () => {
    expect(maskPixKey('pagamentos@vookstore.com', PixKeyType.EMAIL)).toBe('p***@vookstore.com');
  });

  it('esconde o local part quando ele tem um unico caractere', () => {
    expect(maskPixKey('a@vookstore.com', PixKeyType.EMAIL)).toBe('***@vookstore.com');
  });

  it('preserva somente os quatro ultimos digitos de CPF e CNPJ', () => {
    const masked = maskPixKey('12345678909', PixKeyType.CPF);
    expect(masked.endsWith('8909')).toBe(true);
    expect(masked).not.toContain('12345');
  });

  it('nao vaza o miolo de uma chave aleatoria', () => {
    const key = '123e4567-e89b-42d3-a456-426614174000';
    const masked = maskPixKey(key, PixKeyType.RANDOM);
    expect(masked.endsWith('4000')).toBe(true);
    expect(masked).not.toContain('123e4567');
    expect(masked.length).toBeLessThan(key.length);
  });

  it('nunca devolve string vazia', () => {
    expect(maskPixKey('', PixKeyType.PHONE).length).toBeGreaterThan(0);
  });
});

describe('parseKeyTypeAndExpiration', () => {
  it('interpreta o formato canonico "EMAIL | 30"', () => {
    expect(parseKeyTypeAndExpiration('EMAIL | 30')).toEqual({
      pixKeyType: PixKeyType.EMAIL,
      defaultExpirationMinutes: 30,
    });
  });

  it('aceita minusculo, acento e rotulo em portugues', () => {
    expect(parseKeyTypeAndExpiration('telefone / 45').pixKeyType).toBe(PixKeyType.PHONE);
    expect(parseKeyTypeAndExpiration('aleatoria 60').pixKeyType).toBe(PixKeyType.RANDOM);
    expect(parseKeyTypeAndExpiration('e-mail,15').pixKeyType).toBe(PixKeyType.EMAIL);
  });

  it('aceita rotulo composto separado por espaco', () => {
    expect(parseKeyTypeAndExpiration('chave aleatoria')).toEqual({
      pixKeyType: PixKeyType.RANDOM,
      defaultExpirationMinutes: DEFAULT_EXPIRATION_MINUTES,
    });
    expect(parseKeyTypeAndExpiration('chave aleatoria 60')).toEqual({
      pixKeyType: PixKeyType.RANDOM,
      defaultExpirationMinutes: 60,
    });
    expect(parseKeyTypeAndExpiration('chave aleatoria | 45').defaultExpirationMinutes).toBe(45);
  });

  it('recusa entrada que so tem numero (sem tipo)', () => {
    expect(() => parseKeyTypeAndExpiration('30')).toThrow(ValidationError);
    expect(() => parseKeyTypeAndExpiration('')).toThrow(ValidationError);
  });

  it('assume a expiracao padrao quando os minutos nao vem', () => {
    expect(parseKeyTypeAndExpiration('cnpj')).toEqual({
      pixKeyType: PixKeyType.CNPJ,
      defaultExpirationMinutes: DEFAULT_EXPIRATION_MINUTES,
    });
  });

  it('recusa um tipo desconhecido', () => {
    expect(() => parseKeyTypeAndExpiration('pix | 30')).toThrow(ValidationError);
  });
});

describe('normalizeAccountInput', () => {
  it('normaliza recebedor e cidade em MAIUSCULO e sem acento', () => {
    const { values, warnings } = normalizeAccountInput(
      baseInput({ receiverName: 'José da Conceição', city: 'Brasília' }),
    );
    expect(values.receiverName).toBe('JOSE DA CONCEICAO');
    expect(values.city).toBe('BRASILIA');
    expect(warnings).toHaveLength(0);
  });

  it('corta e avisa quando o nome do recebedor estoura o limite do PIX', () => {
    const { values, warnings } = normalizeAccountInput(
      baseInput({ receiverName: 'Comercio de Acessorios Digitais Vook Store' }),
    );
    expect(values.receiverName.length).toBeLessThanOrEqual(BUSINESS_LIMITS.PIX_RECEIVER_NAME_MAX);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('nome do recebedor');
  });

  it('corta e avisa quando a cidade estoura o limite do PIX', () => {
    const { values, warnings } = normalizeAccountInput(
      baseInput({ city: 'Sao Jose do Rio Preto' }),
    );
    expect(values.city.length).toBeLessThanOrEqual(BUSINESS_LIMITS.PIX_CITY_MAX);
    expect(warnings.some((warning) => warning.includes('cidade'))).toBe(true);
  });

  it('e idempotente: normalizar de novo nao corta nem avisa outra vez', () => {
    const first = normalizeAccountInput(
      baseInput({ receiverName: 'Comercio de Acessorios Digitais Vook Store' }),
    );
    const second = normalizeAccountInput(baseInput(first.values));
    expect(second.values.receiverName).toBe(first.values.receiverName);
    expect(second.values.city).toBe(first.values.city);
    expect(second.warnings).toHaveLength(0);
  });

  it('deriva o identificador tecnico a partir do nome de exibicao', () => {
    expect(normalizeAccountInput(baseInput({ name: 'Conta Principal' })).values.identifier).toBe(
      'conta-principal',
    );
  });

  it('normaliza a chave PIX conforme o tipo declarado', () => {
    expect(
      normalizeAccountInput(
        baseInput({ pixKey: '  Pagamentos@VookStore.com ' }),
      ).values.pixKey,
    ).toBe('pagamentos@vookstore.com');

    expect(
      normalizeAccountInput(
        baseInput({ pixKey: '123.456.789-09', pixKeyType: PixKeyType.CPF }),
      ).values.pixKey,
    ).toBe('12345678909');
  });

  it('recusa chave PIX invalida para o tipo escolhido', () => {
    expect(() =>
      normalizeAccountInput(baseInput({ pixKey: 'nao-e-email' })),
    ).toThrow(ValidationError);
  });

  it('recusa expiracao fora do intervalo permitido', () => {
    expect(() =>
      normalizeAccountInput(baseInput({ defaultExpirationMinutes: EXPIRATION_MIN_MINUTES - 1 })),
    ).toThrow(ValidationError);
    expect(() =>
      normalizeAccountInput(baseInput({ defaultExpirationMinutes: EXPIRATION_MAX_MINUTES + 1 })),
    ).toThrow(ValidationError);
  });

  it('recusa nome de exibicao sem letras ou numeros', () => {
    expect(() => normalizeAccountInput(baseInput({ name: '!!!' }))).toThrow(ValidationError);
  });
});
