import { describe, expect, it } from 'vitest';

import { ValidationError } from '../src/core/errors';
import { BUSINESS_LIMITS } from '../src/constants/limits';
import {
  assertValidPrice,
  buildPackSlug,
  formatPackDetails,
  hasSellablePrice,
  parseCategoryEmoji,
  parseCategoryName,
  parseImageAlt,
  parseImageUrl,
  parseLongDescription,
  parsePackDetails,
  parsePackName,
  parsePackPrice,
  parsePackSku,
  parseShortDescription,
} from '../src/modules/catalog/validators/packValidators';
import { foldForSearch } from '../src/utils/sanitize';

/**
 * Entrada da equipe -> banco.
 *
 * Aqui moram as garantias que valem dinheiro e seguranca:
 *  - preco e SEMPRE inteiro em centavos, nunca zero/negativo/NaN/Infinity;
 *  - URL de imagem so passa em https (nada de javascript:, data:, file:);
 *  - texto de produto nao carrega mencao em massa nem caractere de controle.
 */

const NUL = String.fromCharCode(0);

describe('preco do pack', () => {
  it('interpreta os formatos que a equipe realmente digita', () => {
    expect(parsePackPrice('149,90')).toBe(14990);
    expect(parsePackPrice('R$ 149,90')).toBe(14990);
    expect(parsePackPrice('1.499,90')).toBe(149990);
    expect(parsePackPrice('149')).toBe(14900);
  });

  it('recusa zero', () => {
    expect(() => parsePackPrice('0')).toThrow(ValidationError);
    expect(() => parsePackPrice('0,00')).toThrow(ValidationError);
  });

  it('recusa valor negativo, texto e notacao invalida', () => {
    expect(() => parsePackPrice('-10')).toThrow(ValidationError);
    expect(() => parsePackPrice('abc')).toThrow(ValidationError);
    expect(() => parsePackPrice('')).toThrow(ValidationError);
    expect(() => parsePackPrice('1,2,3')).toThrow(ValidationError);
  });

  it('assertValidPrice recusa NaN, Infinity e nao inteiro', () => {
    expect(() => assertValidPrice(Number.NaN)).toThrow(ValidationError);
    expect(() => assertValidPrice(Number.POSITIVE_INFINITY)).toThrow(ValidationError);
    expect(() => assertValidPrice(10.5)).toThrow(ValidationError);
    expect(() => assertValidPrice(0)).toThrow(ValidationError);
    expect(() => assertValidPrice(-1)).toThrow(ValidationError);
  });

  it('respeita o mesmo teto do modulo financeiro', () => {
    expect(() => assertValidPrice(BUSINESS_LIMITS.PAYMENT_MAX_CENTS + 1)).toThrow(
      ValidationError,
    );
    expect(() => assertValidPrice(BUSINESS_LIMITS.PAYMENT_MAX_CENTS)).not.toThrow();
  });

  it('hasSellablePrice concorda com assertValidPrice', () => {
    expect(hasSellablePrice(14990)).toBe(true);
    expect(hasSellablePrice(0)).toBe(false);
    expect(hasSellablePrice(-1)).toBe(false);
    expect(hasSellablePrice(Number.NaN)).toBe(false);
    expect(hasSellablePrice(10.5)).toBe(false);
    expect(hasSellablePrice(BUSINESS_LIMITS.PAYMENT_MAX_CENTS + 1)).toBe(false);
  });
});

describe('URL de imagem', () => {
  it('aceita https', () => {
    expect(parseImageUrl('https://cdn.exemplo.com/pack.png')).toBe(
      'https://cdn.exemplo.com/pack.png',
    );
  });

  it('recusa protocolos inseguros', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'file:///C:/Windows/system32',
      'http://cdn.exemplo.com/pack.png',
      'ftp://exemplo.com/pack.png',
    ]) {
      expect(() => parseImageUrl(url)).toThrow(ValidationError);
    }
  });

  it('recusa URL com credenciais embutidas', () => {
    expect(() => parseImageUrl('https://user:senha@cdn.exemplo.com/pack.png')).toThrow(
      ValidationError,
    );
  });

  it('recusa attachment:// (o pack precisa de um endereco publico)', () => {
    expect(() => parseImageUrl('attachment://pack.png')).toThrow(ValidationError);
  });

  it('recusa vazio', () => {
    expect(() => parseImageUrl('   ')).toThrow(ValidationError);
  });

  it('texto alternativo neutraliza mencao em massa', () => {
    const alt = parseImageAlt('foto @everyone @here');
    expect(alt).not.toBeNull();
    expect(alt).not.toContain('@everyone');
    expect(alt).not.toContain('@here');
  });
});

describe('nome, SKU e descricoes', () => {
  it('nome remove mencoes e caracteres de controle', () => {
    const nome = parsePackName(`Vook @everyone ${NUL}Pack`);
    expect(nome).not.toContain('@everyone');
    expect(nome).not.toContain(NUL);
  });

  it('nome muito curto ou sem palavras e recusado', () => {
    expect(() => parsePackName('ab')).toThrow(ValidationError);
    expect(() => parsePackName('!!!!!')).toThrow(ValidationError);
  });

  it('nome longo demais e truncado, nao rejeitado', () => {
    const nome = parsePackName('N'.repeat(500));
    expect(nome.length).toBeLessThanOrEqual(BUSINESS_LIMITS.PACK_NAME_MAX);
  });

  it('SKU vira maiusculo e alfanumerico; vazio vira null', () => {
    expect(parsePackSku(' veh-001 ')).toBe('VEH-001');
    expect(parsePackSku('veh 001!')).toBe('VEH001');
    expect(parsePackSku('')).toBeNull();
    expect(parsePackSku('   ')).toBeNull();
  });

  it('SKU longo demais e recusado (o UNIQUE por guild depende dele)', () => {
    expect(() => parsePackSku('X'.repeat(BUSINESS_LIMITS.PACK_SKU_MAX + 1))).toThrow(
      ValidationError,
    );
  });

  it('descricoes vazias viram null em vez de string em branco', () => {
    expect(parseShortDescription('   ')).toBeNull();
    expect(parseLongDescription('\n\n')).toBeNull();
  });

  it('descricao completa e truncada no limite do modelo', () => {
    const descricao = parseLongDescription('D'.repeat(5000));
    expect(descricao).not.toBeNull();
    expect((descricao ?? '').length).toBeLessThanOrEqual(BUSINESS_LIMITS.PACK_DESCRIPTION_MAX);
  });

  it('slug e estavel e seguro para o UNIQUE da guild', () => {
    expect(buildPackSlug('Vook Vehicles Collection')).toBe('vook-vehicles-collection');
    expect(buildPackSlug('Veículos  Prémium!!')).toBe('veiculos-premium');
    expect(buildPackSlug('   ')).toBe('pack');
  });
});

describe('ficha tecnica', () => {
  it('interpreta uma linha por item', () => {
    const detalhes = parsePackDetails(
      'Compatibilidade: FiveM\nQuantidade = 15 veiculos\nFormato: Ready-to-use',
    );

    expect(detalhes).toEqual([
      { label: 'Compatibilidade', value: 'FiveM' },
      { label: 'Quantidade', value: '15 veiculos' },
      { label: 'Formato', value: 'Ready-to-use' },
    ]);
  });

  it('ignora linhas sem separador em vez de gravar lixo', () => {
    expect(parsePackDetails('linha solta\nCampo: valor')).toEqual([
      { label: 'Campo', value: 'valor' },
    ]);
  });

  it('respeita o teto de itens', () => {
    const entrada = Array.from({ length: 40 }, (_unused, i) => `Campo ${i}: valor`).join('\n');
    expect(parsePackDetails(entrada)).toHaveLength(BUSINESS_LIMITS.MAX_DETAILS_PER_PACK);
  });

  it('neutraliza mencao em massa dentro do detalhe', () => {
    const [detalhe] = parsePackDetails('Aviso: @everyone corre');
    expect(detalhe?.value).not.toContain('@everyone');
  });

  it('formata de volta para o formulario sem perder dado', () => {
    const detalhes = [
      { label: 'Compatibilidade', value: 'FiveM' },
      { label: 'Quantidade', value: '15 veiculos' },
    ];
    expect(parsePackDetails(formatPackDetails(detalhes))).toEqual(detalhes);
  });
});

describe('categoria do catalogo', () => {
  it('nome curto demais e recusado', () => {
    expect(() => parseCategoryName('a')).toThrow(ValidationError);
  });

  it('emoji unicode e emoji customizado sao aceitos', () => {
    expect(parseCategoryEmoji('🚗')).toBe('🚗');
    expect(parseCategoryEmoji('<:vook:123456789012345678>')).toBe(
      '<:vook:123456789012345678>',
    );
  });

  it('texto comum nao vira emoji (evita rotulo quebrado no menu)', () => {
    expect(parseCategoryEmoji('carros')).toBeNull();
    expect(parseCategoryEmoji('')).toBeNull();
    expect(parseCategoryEmoji('uma frase inteira aqui')).toBeNull();
  });
});

describe('busca do catalogo', () => {
  it('ignora acento e caixa', () => {
    expect(foldForSearch('Veículos Prémium')).toBe('veiculos premium');
    expect(foldForSearch('  PACK   Completo ')).toBe('pack completo');
  });

  it('remove caracteres de controle', () => {
    expect(foldForSearch(`pack${NUL}`)).toBe('pack');
  });

  it('nulo e indefinido viram string vazia', () => {
    expect(foldForSearch(null)).toBe('');
    expect(foldForSearch(undefined)).toBe('');
  });
});
