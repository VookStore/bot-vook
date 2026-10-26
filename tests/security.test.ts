import { describe, expect, it } from 'vitest';

import { ValidationError } from '../src/core/errors';
import { escapeHtml, escapeHtmlWithBreaks, linkifyEscaped, safeHref } from '../src/utils/html';
import {
  ZERO_WIDTH_SPACE,
  collapseRepeats,
  isSafeImageUrl,
  sanitizeChannelName,
  sanitizeConfigText,
  sanitizeCouponCode,
  sanitizeFilename,
  sanitizeIdentifier,
  sanitizeImageUrl,
  sanitizeMentions,
  sanitizeReason,
  sanitizeReviewComment,
  sanitizeTicketSubject,
  stripUnsafeChars,
} from '../src/utils/sanitize';

/**
 * Testes de seguranca.
 *
 * Cobrem os vetores que um usuario mal-intencionado tentaria: ping em massa,
 * injecao de HTML no transcript, nome de canal invalido, URL com protocolo
 * perigoso, path traversal em nome de arquivo e caracteres de controle.
 */

const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);
const BOM = String.fromCharCode(0xfeff);

describe('mencoes em massa', () => {
  it('neutraliza @everyone e @here', () => {
    const saida = sanitizeMentions('ola @everyone e @here!');
    expect(saida).not.toContain('@everyone');
    expect(saida).not.toContain('@here');
    expect(saida).toContain(ZERO_WIDTH_SPACE);
  });

  it('neutraliza variacoes de caixa', () => {
    expect(sanitizeMentions('@EveryOne')).not.toContain('@EveryOne');
    expect(sanitizeMentions('@HERE')).not.toContain('@HERE');
  });

  it('remove mencoes a cargos e usuarios de textos configuraveis', () => {
    expect(sanitizeMentions('<@&123456789012345678>')).toBe('[cargo]');
    expect(sanitizeMentions('<@123456789012345678>')).toBe('[usuario]');
    expect(sanitizeMentions('<@!123456789012345678>')).toBe('[usuario]');
  });

  it('protege todos os campos que aceitam texto do usuario', () => {
    const ataque = 'promocao @everyone @here <@&999999999999999999>';
    for (const saida of [
      sanitizeConfigText(ataque),
      sanitizeReason(ataque),
      sanitizeReviewComment(ataque) ?? '',
      sanitizeTicketSubject(ataque),
    ]) {
      expect(saida).not.toContain('@everyone');
      expect(saida).not.toContain('@here');
    }
  });
});

describe('caracteres de controle e invisiveis', () => {
  it('remove NUL, ESC e BOM', () => {
    const entrada = `a${NUL}b${ESC}c${BOM}d`;
    expect(stripUnsafeChars(entrada)).toBe('abcd');
  });

  it('preserva quebras de linha e tabulacao', () => {
    expect(stripUnsafeChars('linha1\nlinha2\tfim')).toBe('linha1\nlinha2\tfim');
  });

  it('normaliza CRLF', () => {
    expect(stripUnsafeChars('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('remove zero-width usados para burlar filtro de mencao', () => {
    const disfarcado = `@every${ZERO_WIDTH_SPACE}one`;
    expect(stripUnsafeChars(disfarcado)).toBe('@everyone');
    // Apos a limpeza, o filtro de mencao consegue enxergar e neutralizar.
    expect(sanitizeMentions(stripUnsafeChars(disfarcado))).not.toContain('@everyone');
  });

  it('limita spam de repeticao', () => {
    expect(collapseRepeats('a'.repeat(500)).length).toBeLessThanOrEqual(5);
  });
});

describe('assunto do ticket', () => {
  it('recusa assunto curto demais', () => {
    expect(() => sanitizeTicketSubject('oi')).toThrow(ValidationError);
    expect(() => sanitizeTicketSubject('   ')).toThrow(ValidationError);
  });

  it('recusa assunto sem nenhuma letra ou numero', () => {
    expect(() => sanitizeTicketSubject('!!!!!!!!!!')).toThrow(ValidationError);
    expect(() => sanitizeTicketSubject('..........')).toThrow(ValidationError);
  });

  it('aceita assunto legitimo e corta o excesso', () => {
    expect(sanitizeTicketSubject('  Problema   com   meu  produto  ')).toBe(
      'Problema com meu produto',
    );
    expect(sanitizeTicketSubject('a'.repeat(400)).length).toBeLessThanOrEqual(200);
  });

  it('transforma quebras de linha em espaco', () => {
    expect(sanitizeTicketSubject('linha um\nlinha dois')).toBe('linha um linha dois');
  });
});

describe('nome de canal', () => {
  it('converte para o formato aceito pelo Discord', () => {
    expect(sanitizeChannelName('Ticket #0125')).toBe('ticket-0125');
    expect(sanitizeChannelName('Compras Rápidas')).toBe('compras-rapidas');
    expect(sanitizeChannelName('  MUITOS   ESPACOS  ')).toBe('muitos-espacos');
  });

  it('nunca devolve string vazia', () => {
    expect(sanitizeChannelName('!!!!')).toBe('ticket');
    expect(sanitizeChannelName('')).toBe('ticket');
    expect(sanitizeChannelName('   ', 'fallback')).toBe('fallback');
  });

  it('respeita o limite de 100 caracteres', () => {
    expect(sanitizeChannelName('a'.repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it('nao deixa hifens nas pontas nem duplicados', () => {
    const nome = sanitizeChannelName('---abc---def---');
    expect(nome).toBe('abc-def');
  });
});

describe('nome de arquivo', () => {
  it('impede path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('..');
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('..\\..\\windows\\system32')).not.toContain('\\');
  });

  it('remove caracteres proibidos em sistema de arquivos', () => {
    const nome = sanitizeFilename('rel:at*rio?.html');
    expect(nome).not.toMatch(/[:*?]/);
  });

  it('nunca devolve string vazia', () => {
    expect(sanitizeFilename('...')).toBe('arquivo');
    expect(sanitizeFilename('')).toBe('arquivo');
  });
});

describe('URLs de imagem', () => {
  it('aceita https', () => {
    expect(sanitizeImageUrl('https://cdn.vook.store/banner.png')).toBe(
      'https://cdn.vook.store/banner.png',
    );
    expect(isSafeImageUrl('https://cdn.vook.store/banner.png')).toBe(true);
  });

  it('recusa protocolos perigosos', () => {
    for (const perigosa of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///C:/Windows/System32/config',
      'vbscript:msgbox(1)',
    ]) {
      expect(() => sanitizeImageUrl(perigosa)).toThrow(ValidationError);
      expect(isSafeImageUrl(perigosa)).toBe(false);
    }
  });

  it('recusa http sem TLS', () => {
    expect(() => sanitizeImageUrl('http://inseguro.com/x.png')).toThrow(ValidationError);
  });

  it('recusa URL com credenciais embutidas', () => {
    expect(() => sanitizeImageUrl('https://user:senha@cdn.com/x.png')).toThrow(ValidationError);
  });

  it('trata vazio como ausencia de imagem', () => {
    expect(sanitizeImageUrl('')).toBeNull();
    expect(sanitizeImageUrl(null)).toBeNull();
    expect(isSafeImageUrl(null)).toBe(false);
  });
});

describe('injecao de HTML no transcript', () => {
  it('escapa todos os caracteres perigosos', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml('a"b\'c`d=e&f')).toBe('a&quot;b&#39;c&#96;d&#61;e&amp;f');
  });

  it('nao deixa nenhuma tag executavel passar', () => {
    for (const ataque of [
      '<script>fetch("https://evil")</script>',
      '<iframe src="https://evil"></iframe>',
      '<object data="evil"></object>',
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
    ]) {
      const saida = escapeHtmlWithBreaks(ataque);
      expect(saida).not.toContain('<script');
      expect(saida).not.toContain('<iframe');
      expect(saida).not.toContain('<object');
      expect(saida).not.toContain('<img');
      expect(saida).not.toContain('<svg');
    }
  });

  it('converte quebras de linha somente apos escapar', () => {
    expect(escapeHtmlWithBreaks('<b>\nx')).toBe('&lt;b&gt;<br>x');
  });

  it('so aceita http/https em href', () => {
    expect(safeHref('https://vook.store')).toBe('https://vook.store/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('nao-e-url')).toBeNull();
  });

  it('nao gera href para protocolo perigoso ao criar links', () => {
    const saida = linkifyEscaped(escapeHtml('javascript:alert(1) e https://vook.store/ok'));
    expect(saida).not.toContain('href="javascript:');
    expect(saida).toContain('href="https://vook.store/ok"');
    expect(saida).toContain('rel="noopener noreferrer nofollow"');
  });

  it('preserva query string ao criar links (sem escape duplo)', () => {
    // Regressao: passar o texto ja escapado direto para safeHref escapava duas
    // vezes ("&amp;" virava "&amp;amp;") e quebrava TODO link de CDN do Discord.
    const url = 'https://cdn.discordapp.com/a.png?ex=1&is=2';
    const saida = linkifyEscaped(escapeHtml(url));

    expect(saida).not.toContain('&amp;amp;');

    const href = /href="([^"]+)"/.exec(saida)?.[1];
    expect(href).toBeDefined();

    // O href e entidade-escapado (inclusive `=` como &#61;, defensivo em
    // atributo). O que importa e o navegador decodificar de volta a URL exata.
    const decodificado = (href ?? '')
      .replace(/&#61;/g, '=')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    expect(decodificado).toBe(url);
  });
});

describe('codigo de cupom', () => {
  it('normaliza para maiusculo sem acento', () => {
    expect(sanitizeCouponCode('vook20')).toBe('VOOK20');
    expect(sanitizeCouponCode(' promoção ')).toBe('PROMOCAO');
  });

  it('recusa codigos fora dos limites', () => {
    expect(() => sanitizeCouponCode('ab')).toThrow(ValidationError);
    expect(() => sanitizeCouponCode('a'.repeat(40))).toThrow(ValidationError);
    expect(() => sanitizeCouponCode('@@@')).toThrow(ValidationError);
  });
});

describe('identificador tecnico', () => {
  it('gera slug seguro', () => {
    expect(sanitizeIdentifier('Compras Rápidas')).toBe('compras-rapidas');
    expect(sanitizeIdentifier('  ')).toBe('item');
    expect(sanitizeIdentifier('a'.repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe('comentario da avaliacao', () => {
  it('descarta comentario vazio ou sem conteudo util', () => {
    expect(sanitizeReviewComment('')).toBeNull();
    expect(sanitizeReviewComment('   ')).toBeNull();
    expect(sanitizeReviewComment('!!!!')).toBeNull();
    expect(sanitizeReviewComment(null)).toBeNull();
  });

  it('mantem comentario legitimo e limita o tamanho', () => {
    expect(sanitizeReviewComment('Atendimento excelente!')).toBe('Atendimento excelente!');
    const longo = sanitizeReviewComment('a'.repeat(2000));
    expect(longo).not.toBeNull();
    expect((longo ?? '').length).toBeLessThanOrEqual(500);
  });
});
