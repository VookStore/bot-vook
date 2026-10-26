import { PixKeyType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { ValidationError } from '../src/core/errors';
import {
  buildPixPayload,
  crc16ccitt,
  emvField,
  formatPixAmount,
  normalizePixText,
  validatePixPayload,
} from '../src/modules/payments/services/PixPayloadService';
import {
  buildQrCodeAttachment,
  generateQrCodePngBuffer,
} from '../src/modules/payments/services/QrCodeService';
import {
  describePixKeyType,
  validatePixKey,
} from '../src/modules/payments/validators/PixKeyValidator';

/**
 * Parser TLV independente da implementacao: le ID(2) + LENGTH(2) + VALUE e
 * serve para provar que o payload gerado realmente respeita o padrao EMV.
 */
function parseTlv(payload: string): Map<string, string> {
  const fields = new Map<string, string>();
  let index = 0;

  while (index + 4 <= payload.length) {
    const id = payload.slice(index, index + 2);
    const rawLength = payload.slice(index + 2, index + 4);
    const length = Number(rawLength);
    if (!/^\d{2}$/.test(rawLength)) break;
    fields.set(id, payload.slice(index + 4, index + 4 + length));
    index += 4 + length;
  }

  return fields;
}

/**
 * CRC-16/CCITT-FALSE implementado por tabela (algoritmo diferente do usado em
 * producao, que e bit a bit). Serve como conferencia cruzada independente.
 */
const CRC16_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  for (let byte = 0; byte < 256; byte += 1) {
    let value = byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x8000) !== 0 ? ((value << 1) ^ 0x1021) & 0xffff : (value << 1) & 0xffff;
    }
    table[byte] = value;
  }
  return table;
})();

function crc16TableDriven(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xff]) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const BASE_INPUT = {
  pixKey: 'pagamentos@vookstore.com.br',
  receiverName: 'VOOK STORE LTDA',
  city: 'SAO PAULO',
  amountCents: 25_000,
  txid: 'VOOKPED0001',
};

describe('emvField', () => {
  it('monta ID + LENGTH com dois digitos + VALUE', () => {
    expect(emvField('00', '01')).toBe('000201');
    expect(emvField('53', '986')).toBe('5303986');
    expect(emvField('58', 'BR')).toBe('5802BR');
  });

  it('faz zero-padding do tamanho em valores curtos', () => {
    expect(emvField('26', 'x'.repeat(9))).toBe(`2609${'x'.repeat(9)}`);
    expect(emvField('26', 'x'.repeat(10))).toBe(`2610${'x'.repeat(10)}`);
  });

  it('aceita exatamente 99 caracteres (maximo representavel)', () => {
    const value = 'y'.repeat(99);
    const field = emvField('62', value);
    expect(field.slice(0, 4)).toBe('6299');
    expect(field).toHaveLength(103);
  });

  it('recusa valores com 100 caracteres ou mais em vez de truncar', () => {
    expect(() => emvField('62', 'z'.repeat(100))).toThrow(ValidationError);
    expect(() => emvField('62', 'z'.repeat(250))).toThrow(ValidationError);
  });

  it('recusa ID fora do formato de dois digitos', () => {
    expect(() => emvField('6', '01')).toThrow(ValidationError);
    expect(() => emvField('AB', '01')).toThrow(ValidationError);
  });
});

describe('crc16ccitt', () => {
  it('reproduz o vetor de teste oficial do CRC-16/CCITT-FALSE', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
  });

  it('retorna sempre 4 digitos hexadecimais maiusculos', () => {
    for (const sample of ['', 'A', 'vook', '00020126']) {
      const crc = crc16ccitt(sample);
      expect(crc).toMatch(/^[0-9A-F]{4}$/);
    }
    // Valor inicial 0xFFFF sem XOR final: entrada vazia mantem o CRC inicial.
    expect(crc16ccitt('')).toBe('FFFF');
  });

  it('muda quando um unico caractere muda', () => {
    expect(crc16ccitt('vook-store')).not.toBe(crc16ccitt('vook-stere'));
  });

  it('confere com uma implementacao independente baseada em tabela', () => {
    const samples = [
      '123456789',
      'BR.GOV.BCB.PIX',
      '00020126',
      buildPixPayload(BASE_INPUT).slice(0, -4),
      buildPixPayload({ ...BASE_INPUT, amountCents: 1, txid: undefined }).slice(0, -4),
    ];

    for (const sample of samples) {
      expect(crc16ccitt(sample)).toBe(crc16TableDriven(sample));
    }
  });
});

describe('formatPixAmount', () => {
  it('formata centavos com ponto decimal e duas casas', () => {
    expect(formatPixAmount(25_000)).toBe('250.00');
    expect(formatPixAmount(1)).toBe('0.01');
    expect(formatPixAmount(100_000)).toBe('1000.00');
  });

  it('nao usa separador de milhar', () => {
    expect(formatPixAmount(1_234_567)).toBe('12345.67');
  });

  it('recusa valores nao inteiros ou negativos', () => {
    expect(() => formatPixAmount(10.5)).toThrow(ValidationError);
    expect(() => formatPixAmount(-1)).toThrow(ValidationError);
  });
});

describe('normalizePixText', () => {
  it('remove acentos preservando as letras base', () => {
    expect(normalizePixText('José Antônio Gonçalves', 40)).toBe('Jose Antonio Goncalves');
    expect(normalizePixText('SÃO PAULO', 15)).toBe('SAO PAULO');
  });

  it('corta no limite informado e remove sobra de espaco', () => {
    expect(normalizePixText('SAO JOSE DOS CAMPOS', 15)).toBe('SAO JOSE DOS CA');
    expect(normalizePixText('VOOK STORE LTDA ME', 10)).toBe('VOOK STORE');
  });

  it('remove caracteres proibidos e colapsa espacos', () => {
    expect(normalizePixText('Pedido #1234 | urgente', 40)).toBe('Pedido 1234 urgente');
    expect(normalizePixText('VOOK\n\tSTORE', 40)).toBe('VOOK STORE');
  });

  it('retorna string vazia quando nada sobra', () => {
    expect(normalizePixText('@@@ ### $$$', 25)).toBe('');
    expect(normalizePixText('VOOK', 0)).toBe('');
  });
});

describe('buildPixPayload', () => {
  it('gera um BR Code estruturalmente valido', () => {
    const payload = buildPixPayload(BASE_INPUT);

    expect(payload.startsWith('000201')).toBe(true);
    expect(payload).toContain('010212');
    expect(payload).toContain('BR.GOV.BCB.PIX');
    expect(payload).toContain('5303986');
    expect(payload).toContain('5406250.00');
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
    expect(validatePixPayload(payload)).toBe(true);
  });

  it('produz exatamente o BR Code esperado para um caso conhecido', () => {
    const payload = buildPixPayload({
      pixKey: '+5561912345678',
      receiverName: 'Fulano de Tal',
      city: 'BRASILIA',
      amountCents: 1000,
    });

    // Montagem manual, campo a campo, conforme o manual do BR Code.
    const expectedBody =
      '000201' +
      '010212' +
      '2636' +
      '0014BR.GOV.BCB.PIX' +
      '0114+5561912345678' +
      '52040000' +
      '5303986' +
      '540510.00' +
      '5802BR' +
      '5913Fulano de Tal' +
      '6008BRASILIA' +
      '62070503***' +
      '6304';

    expect(payload).toBe(`${expectedBody}${crc16TableDriven(expectedBody)}`);
    expect(validatePixPayload(payload)).toBe(true);
  });

  it('preenche cada campo EMV com o conteudo esperado', () => {
    const payload = buildPixPayload(BASE_INPUT);
    const fields = parseTlv(payload);

    expect(fields.get('00')).toBe('01');
    expect(fields.get('01')).toBe('12');
    expect(fields.get('52')).toBe('0000');
    expect(fields.get('53')).toBe('986');
    expect(fields.get('54')).toBe('250.00');
    expect(fields.get('58')).toBe('BR');
    expect(fields.get('59')).toBe('VOOK STORE LTDA');
    expect(fields.get('60')).toBe('SAO PAULO');
    expect(fields.get('63')).toHaveLength(4);

    const merchant = parseTlv(fields.get('26') ?? '');
    expect(merchant.get('00')).toBe('BR.GOV.BCB.PIX');
    expect(merchant.get('01')).toBe(BASE_INPUT.pixKey);

    const additional = parseTlv(fields.get('62') ?? '');
    expect(additional.get('05')).toBe('VOOKPED0001');
  });

  it('usa "***" quando nao ha txid', () => {
    const payload = buildPixPayload({ ...BASE_INPUT, txid: undefined });
    const additional = parseTlv(parseTlv(payload).get('62') ?? '');

    expect(additional.get('05')).toBe('***');
    expect(validatePixPayload(payload)).toBe(true);
  });

  it('inclui a descricao no campo 26 sem estourar o limite de 99 caracteres', () => {
    const payload = buildPixPayload({ ...BASE_INPUT, description: 'Pedido 42 Vook Store' });
    const merchantValue = parseTlv(payload).get('26') ?? '';

    expect(merchantValue.length).toBeLessThanOrEqual(99);
    expect(parseTlv(merchantValue).get('02')).toBe('Pedido 42 Vook Store');
    expect(validatePixPayload(payload)).toBe(true);
  });

  it('corta a descricao quando a chave PIX quase preenche o campo 26', () => {
    const longKey = `${'a'.repeat(60)}@vookstore.com.br`;
    const payload = buildPixPayload({
      ...BASE_INPUT,
      pixKey: longKey,
      description: 'Descricao bem longa que nao cabe no campo 26 do BR Code',
    });
    const merchantValue = parseTlv(payload).get('26') ?? '';

    expect(longKey).toHaveLength(77);
    expect(merchantValue.length).toBeLessThanOrEqual(99);
    expect(parseTlv(merchantValue).get('02')).toBeUndefined();
    expect(validatePixPayload(payload)).toBe(true);
  });

  it('normaliza nome e cidade dentro dos limites do padrao', () => {
    const payload = buildPixPayload({
      ...BASE_INPUT,
      receiverName: 'Comércio Vook Store Pagamentos Digitais',
      city: 'SÃO JOSÉ DOS CAMPOS',
    });
    const fields = parseTlv(payload);

    expect(fields.get('59')).toBe('Comercio Vook Store Pagam');
    expect(fields.get('60')).toBe('SAO JOSE DOS CA');
    expect(validatePixPayload(payload)).toBe(true);
  });

  it('recusa valor zero, negativo ou nao inteiro', () => {
    expect(() => buildPixPayload({ ...BASE_INPUT, amountCents: 0 })).toThrow(ValidationError);
    expect(() => buildPixPayload({ ...BASE_INPUT, amountCents: -500 })).toThrow(ValidationError);
    expect(() => buildPixPayload({ ...BASE_INPUT, amountCents: 10.5 })).toThrow(ValidationError);
  });

  it('recusa valor acima do teto de negocio', () => {
    expect(() => buildPixPayload({ ...BASE_INPUT, amountCents: 100_000_001 })).toThrow(
      ValidationError,
    );
  });

  it('recusa chave vazia, nome/cidade sem conteudo util e txid invalido', () => {
    expect(() => buildPixPayload({ ...BASE_INPUT, pixKey: '   ' })).toThrow(ValidationError);
    expect(() => buildPixPayload({ ...BASE_INPUT, receiverName: '###' })).toThrow(ValidationError);
    expect(() => buildPixPayload({ ...BASE_INPUT, city: '@@@' })).toThrow(ValidationError);
    expect(() => buildPixPayload({ ...BASE_INPUT, txid: 'PED-2024/01' })).toThrow(ValidationError);
    expect(() => buildPixPayload({ ...BASE_INPUT, txid: 'A'.repeat(26) })).toThrow(ValidationError);
  });
});

describe('validatePixPayload', () => {
  it('detecta payload adulterado', () => {
    const payload = buildPixPayload(BASE_INPUT);
    const tampered = payload.replace('5406250.00', '5406900.00');

    expect(tampered).not.toBe(payload);
    expect(validatePixPayload(tampered)).toBe(false);
  });

  it('recusa payload sem CRC valido', () => {
    expect(validatePixPayload('')).toBe(false);
    expect(validatePixPayload('0002')).toBe(false);
    expect(validatePixPayload('00020163041234')).toBe(false);
    expect(validatePixPayload(`${buildPixPayload(BASE_INPUT).slice(0, -4)}ZZZZ`)).toBe(false);
  });

  it('aceita CRC escrito em minusculas', () => {
    const payload = buildPixPayload(BASE_INPUT);
    const lowerCrc = `${payload.slice(0, -4)}${payload.slice(-4).toLowerCase()}`;

    expect(validatePixPayload(lowerCrc)).toBe(true);
  });
});

describe('validatePixKey - CPF e CNPJ', () => {
  it('aceita CPF valido e devolve somente digitos', () => {
    expect(validatePixKey('123.456.789-09', PixKeyType.CPF)).toBe('12345678909');
    expect(validatePixKey('12345678909', PixKeyType.CPF)).toBe('12345678909');
  });

  it('recusa CPF com digito verificador errado', () => {
    expect(() => validatePixKey('123.456.789-00', PixKeyType.CPF)).toThrow(ValidationError);
    expect(() => validatePixKey('111.111.111-11', PixKeyType.CPF)).toThrow(ValidationError);
    expect(() => validatePixKey('1234567890', PixKeyType.CPF)).toThrow(ValidationError);
  });

  it('aceita CNPJ valido e devolve somente digitos', () => {
    expect(validatePixKey('11.222.333/0001-81', PixKeyType.CNPJ)).toBe('11222333000181');
    expect(validatePixKey('11222333000181', PixKeyType.CNPJ)).toBe('11222333000181');
  });

  it('recusa CNPJ com digito verificador errado', () => {
    expect(() => validatePixKey('11.222.333/0001-82', PixKeyType.CNPJ)).toThrow(ValidationError);
    expect(() => validatePixKey('00.000.000/0000-00', PixKeyType.CNPJ)).toThrow(ValidationError);
  });
});

describe('validatePixKey - EMAIL, PHONE e RANDOM', () => {
  it('normaliza e-mail para minusculo', () => {
    expect(validatePixKey('  Pagamentos@VookStore.com.BR ', PixKeyType.EMAIL)).toBe(
      'pagamentos@vookstore.com.br',
    );
  });

  it('recusa e-mail invalido', () => {
    expect(() => validatePixKey('sem-arroba.com.br', PixKeyType.EMAIL)).toThrow(ValidationError);
    expect(() => validatePixKey('vook@dominio', PixKeyType.EMAIL)).toThrow(ValidationError);
    expect(() => validatePixKey('vook @store.com', PixKeyType.EMAIL)).toThrow(ValidationError);
    expect(() => validatePixKey(`${'a'.repeat(70)}@vookstore.com.br`, PixKeyType.EMAIL)).toThrow(
      ValidationError,
    );
  });

  it('normaliza telefone com mascara para o formato +55DDDNUMERO', () => {
    expect(validatePixKey('(11) 99999-8888', PixKeyType.PHONE)).toBe('+5511999998888');
    expect(validatePixKey('+55 (21) 98888-7777', PixKeyType.PHONE)).toBe('+5521988887777');
    expect(validatePixKey('11 3030-4040', PixKeyType.PHONE)).toBe('+551130304040');
  });

  it('recusa telefone com DDD inexistente ou tamanho errado', () => {
    expect(() => validatePixKey('(00) 99999-8888', PixKeyType.PHONE)).toThrow(ValidationError);
    expect(() => validatePixKey('99999-8888', PixKeyType.PHONE)).toThrow(ValidationError);
    expect(() => validatePixKey('(11) 19999-8888', PixKeyType.PHONE)).toThrow(ValidationError);
  });

  it('aceita UUID v4 e normaliza para minusculo', () => {
    expect(validatePixKey('123E4567-E89B-42D3-A456-426614174000', PixKeyType.RANDOM)).toBe(
      '123e4567-e89b-42d3-a456-426614174000',
    );
  });

  it('recusa UUID invalido', () => {
    expect(() => validatePixKey('123e4567-e89b-12d3-a456-426614174000', PixKeyType.RANDOM)).toThrow(
      ValidationError,
    );
    expect(() => validatePixKey('123e4567e89b42d3a456426614174000', PixKeyType.RANDOM)).toThrow(
      ValidationError,
    );
    expect(() => validatePixKey('chave-aleatoria-invalida', PixKeyType.RANDOM)).toThrow(
      ValidationError,
    );
  });

  it('recusa chave vazia em qualquer tipo', () => {
    expect(() => validatePixKey('   ', PixKeyType.EMAIL)).toThrow(ValidationError);
    expect(() => validatePixKey('', PixKeyType.CPF)).toThrow(ValidationError);
  });

  it('descreve o tipo de chave em portugues', () => {
    expect(describePixKeyType(PixKeyType.CPF)).toBe('CPF');
    expect(describePixKeyType(PixKeyType.EMAIL)).toBe('E-mail');
    expect(describePixKeyType(PixKeyType.PHONE)).toBe('Telefone');
    expect(describePixKeyType(PixKeyType.RANDOM)).toBe('Chave aleatoria');
  });
});

describe('QrCodeService', () => {
  it('gera um PNG real em memoria para o payload', async () => {
    const payload = buildPixPayload(BASE_INPUT);
    const buffer = await generateQrCodePngBuffer(payload);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // Assinatura magica do formato PNG.
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('recusa payload vazio', async () => {
    await expect(generateQrCodePngBuffer('')).rejects.toThrow(ValidationError);
  });

  it('devolve anexo com nome sanitizado terminando em .png', async () => {
    const payload = buildPixPayload(BASE_INPUT);

    const traversal = await buildQrCodeAttachment(payload, '../../pix qr');
    expect(traversal.name).toBe('pix-qr.png');

    const alreadyPng = await buildQrCodeAttachment(payload, 'cobranca-42.png');
    expect(alreadyPng.name).toBe('cobranca-42.png');
  });
});

describe('conformidade EMV: charset, bytes e privacidade', () => {
  /**
   * Corpo do exemplo publicado no manual do BR Code do Banco Central, cujo CRC
   * divulgado e "1D3D". Oraculo externo: nao depende de nenhum codigo daqui.
   */
  const BCB_MANUAL_BODY =
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000' +
    '5204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';

  it('reproduz o CRC publicado no exemplo oficial do BR Code', () => {
    expect(crc16ccitt(BCB_MANUAL_BODY)).toBe('1D3D');
    expect(validatePixPayload(`${BCB_MANUAL_BODY}1D3D`)).toBe(true);
  });

  it('recusa caractere fora do ASCII imprimivel em vez de declarar tamanho errado', () => {
    // O LENGTH do TLV conta caracteres, mas o leitor do QR conta bytes:
    // "aç" tem 2 caracteres e 3 bytes, "\u{1F600}" tem 2 e 4.
    expect(() => emvField('59', 'aç')).toThrow(ValidationError);
    expect(() => emvField('01', '\u{1F600}')).toThrow(ValidationError);
  });

  it('recusa chave PIX com acento ou emoji', () => {
    expect(() => buildPixPayload({ ...BASE_INPUT, pixKey: 'joão@vook.com' })).toThrow(
      ValidationError,
    );
    expect(() => buildPixPayload({ ...BASE_INPUT, pixKey: 'a\u{1F600}@vook.com' })).toThrow(
      ValidationError,
    );
  });

  it('gera payload com tamanho em caracteres igual ao tamanho em bytes', () => {
    const payloads = [
      buildPixPayload(BASE_INPUT),
      buildPixPayload({
        ...BASE_INPUT,
        receiverName: 'Comércio Açaí',
        city: 'SÃO PAULO',
        description: 'Pedido nº 42',
      }),
      buildPixPayload({ ...BASE_INPUT, txid: undefined, amountCents: 1 }),
    ];

    for (const payload of payloads) {
      expect(payload.length).toBe(Buffer.byteLength(payload, 'utf8'));
      expect(validatePixPayload(payload)).toBe(true);
    }
  });

  it('recusa nome ou cidade sem nenhuma letra ou digito', () => {
    expect(() => buildPixPayload({ ...BASE_INPUT, receiverName: '...' })).toThrow(ValidationError);
    expect(() => buildPixPayload({ ...BASE_INPUT, city: '- - -' })).toThrow(ValidationError);
  });

  it('nao expoe CPF, CNPJ nem chave PIX na mensagem tecnica (que vai para o log)', () => {
    const cases: Array<[string, PixKeyType]> = [
      ['123.456.789-00', PixKeyType.CPF],
      ['1234567890', PixKeyType.CPF],
      ['11.222.333/0001-82', PixKeyType.CNPJ],
      ['nao-e-email@@vook', PixKeyType.EMAIL],
    ];

    for (const [key, type] of cases) {
      let thrown: unknown;
      try {
        validatePixKey(key, type);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ValidationError);
      const { message } = thrown as ValidationError;
      const digits = key.replace(/\D/g, '');

      expect(message).not.toContain(key);
      if (digits.length > 0) expect(message).not.toContain(digits);
    }

    let pixKeyError: unknown;
    try {
      buildPixPayload({ ...BASE_INPUT, pixKey: '12345678909 x' });
    } catch (error) {
      pixKeyError = error;
    }
    expect(pixKeyError).toBeInstanceOf(ValidationError);
    expect((pixKeyError as ValidationError).message).not.toContain('12345678909');
  });
});
