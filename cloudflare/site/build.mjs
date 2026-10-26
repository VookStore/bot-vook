/**
 * Gera as paginas juridicas estaticas a partir do Markdown.
 *
 *   node cloudflare/site/build.mjs
 *
 * A FONTE DA VERDADE E O MARKDOWN em `content/`. O Worker nao interpreta
 * Markdown em tempo de execucao: converter aqui evita embarcar um parser no
 * runtime e, principalmente, tira a conversao do caminho de uma requisicao —
 * a pagina servida e sempre a mesma string, ja pronta.
 *
 * Para atualizar um documento: edite o `.md`, rode este script e publique com
 * `wrangler deploy` dentro de `cloudflare/transcripts/`.
 *
 * SEGURANCA: o conteudo e escapado ANTES de qualquer conversao. So depois disso
 * um subconjunto conhecido de Markdown (titulo, negrito, lista, paragrafo,
 * regua) vira HTML. Nao existe caminho para HTML bruto vindo do documento.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'transcripts', 'src', 'pages.js');

/** Ordem importa: `&` primeiro, senao as entidades seguintes seriam reescritas. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Texto de um paragrafo: negrito e `codigo`, sobre conteudo JA escapado. */
function inline(escaped) {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Ancora estavel para o indice: "1. CONDICOES GERAIS" -> "1-condicoes-gerais". */
function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Converte o subconjunto de Markdown usado nos documentos.
 * Devolve tambem os titulos de nivel 2, que viram o indice lateral.
 */
function toHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  const toc = [];
  let list = null;
  let paragraph = [];
  let sectionOpen = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list === null) return;
    out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = escapeHtml(raw.trimEnd());
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushAll();
      continue;
    }
    if (trimmed === '---') {
      flushAll();
      if (sectionOpen) {
        out.push('</section>');
        sectionOpen = false;
      }
      out.push('<hr>');
      continue;
    }

    const h1 = /^# (.+)$/.exec(trimmed);
    if (h1 !== null) {
      flushAll();
      // O H1 vira o titulo do cabecalho, nao do corpo: nao entra aqui.
      continue;
    }

    if (/^\*\*[UÚ]ltima atualiza[cç][aã]o:.+\*\*$/i.test(trimmed)) {
      flushAll();
      // A data tambem vira metadado do cabecalho e nao deve aparecer duplicada.
      continue;
    }

    const h2 = /^## (.+)$/.exec(trimmed);
    if (h2 !== null) {
      flushAll();
      if (sectionOpen) out.push('</section>');
      const title = h2[1];
      const id = slugify(title);
      toc.push({ id, title });
      out.push(`<section class="legal-section"><h2 id="${id}">${inline(title)}</h2>`);
      sectionOpen = true;
      continue;
    }

    const bullet = /^[-*] (.+)$/.exec(trimmed);
    if (bullet !== null) {
      flushParagraph();
      if (list === null || list.tag !== 'ul') {
        flushList();
        list = { tag: 'ul', items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\d+\. (.+)$/.exec(trimmed);
    if (numbered !== null) {
      flushParagraph();
      if (list === null || list.tag !== 'ol') {
        flushList();
        list = { tag: 'ol', items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushAll();
  if (sectionOpen) out.push('</section>');
  return { html: out.join(''), toc };
}

/** Estimativa curta exibida no cabecalho, sem depender de JavaScript no cliente. */
function readingStats(markdown) {
  const plain = markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*`_-]/g, ' ')
    .trim();
  const words = plain.length === 0 ? 0 : plain.split(/\s+/).length;
  return { words, readMinutes: Math.max(1, Math.ceil(words / 180)) };
}

/**
 * Primeira linha `# ...` do documento, sem o sufixo da loja.
 *
 * Os documentos abrem com "TERMOS E REGRAS — VOOK STORE". O nome da loja ja
 * aparece no cabecalho do site e no `<title>`, entao mante-lo aqui produzia
 * "TERMOS E REGRAS — VOOK STORE — Vook Store" na aba do navegador.
 */
function extractTitle(markdown, fallback) {
  const match = /^#\s+(.+)$/m.exec(markdown);
  if (match === null) return fallback;
  return match[1].split('—')[0].trim() || match[1].trim();
}

/** Linha "**Última atualização: ...**" logo abaixo do titulo. */
function extractUpdatedAt(markdown) {
  const match = /\*\*[UÚ]ltima atualiza[cç][aã]o:\s*([^*]+)\*\*/i.exec(markdown);
  return match === null ? null : match[1].trim();
}

const DOCS = [
  { slug: 'termos', file: 'termos.md', nav: 'Termos e Regras' },
  { slug: 'privacidade', file: 'privacidade.md', nav: 'Política de Privacidade' },
];

const pages = DOCS.map((doc) => {
  const markdown = readFileSync(join(here, 'content', doc.file), 'utf8');
  const { html, toc } = toHtml(markdown);
  return {
    ...doc,
    title: extractTitle(markdown, doc.nav),
    updatedAt: extractUpdatedAt(markdown),
    ...readingStats(markdown),
    html,
    toc,
  };
});

const generated =
  `/*\n` +
  ` * GERADO AUTOMATICAMENTE — nao edite a mao.\n` +
  ` *\n` +
  ` * Fonte: cloudflare/site/content/*.md\n` +
  ` * Gerador: cloudflare/site/build.mjs\n` +
  ` *\n` +
  ` * Editar aqui e perder o trabalho na proxima geracao. Altere o Markdown.\n` +
  ` */\n\n` +
  `export const LEGAL_PAGES = ${JSON.stringify(pages, null, 2)};\n`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, generated, 'utf8');

for (const page of pages) {
  console.log(
    `/${page.slug.padEnd(12)} ${String(page.html.length).padStart(6)} bytes` +
      ` | ${String(page.toc.length).padStart(2)} secoes | atualizado em ${page.updatedAt ?? '?'}`,
  );
}
console.log(`\nescrito em ${OUT}`);
