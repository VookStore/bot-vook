import { LEGAL_PAGES } from './pages.js';

/**
 * Paginas juridicas publicas (Termos e Regras, Politica de Privacidade).
 *
 * A interface usa somente HTML e CSS: alem de manter o documento instantaneo,
 * isso permite que a CSP continue bloqueando todo JavaScript. Movimento e
 * progressivo, respeita `prefers-reduced-motion` e nunca compete com a leitura.
 */

const STORE_NAME = 'Vook Store';

const PAGE_META = {
  termos: {
    eyebrow: 'Acordo de uso',
    summary:
      'Condições claras para compras, entregas, suporte e uso dos produtos digitais da Vook Store.',
    icon: 'document',
  },
  privacidade: {
    eyebrow: 'Privacidade e dados',
    summary:
      'Como protegemos, utilizamos e armazenamos informações durante sua experiência com a Vook Store.',
    icon: 'shield',
  },
};

const ICONS = {
  document:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7.6L19 8.15v12.1H7z"/><path d="M14.5 3.75v4.5H19M10 12h6M10 15.5h6"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.25 19 6v5.1c0 4.45-2.75 7.75-7 9.65-4.25-1.9-7-5.2-7-9.65V6z"/><path d="m9.25 12 1.8 1.8 3.9-4"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16"/></svg>',
  sections:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11"/><circle cx="4.5" cy="6" r=".75"/><circle cx="4.5" cy="12" r=".75"/><circle cx="4.5" cy="18" r=".75"/></svg>',
};

const CSS = `
:root{
  color-scheme:dark;
  --bg:#050505;--bg-soft:#0b0b0b;--surface:rgba(15,15,15,.78);
  --surface-strong:rgba(20,20,20,.94);--line:rgba(255,255,255,.09);
  --line-strong:rgba(255,255,255,.24);--text:#e8e8e8;--muted:#a5a5a5;
  --quiet:#767676;--strong:#fff;--brand:#fff;--brand-bright:#fff;
  --brand-soft:rgba(255,255,255,.07);--max:1180px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:100px}
body{margin:0;min-width:320px;background:var(--bg);color:var(--text);
  font-family:Inter,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:16px;
  line-height:1.72;-webkit-text-size-adjust:100%;overflow-x:hidden}
a{color:inherit;text-decoration:none}
a:focus-visible{outline:2px solid var(--brand-bright);outline-offset:4px;border-radius:6px}
::selection{background:rgba(255,255,255,.24);color:#fff}

.skip{position:fixed;z-index:30;top:10px;left:10px;transform:translateY(-160%);
  padding:10px 14px;border-radius:10px;background:#fff;color:#090909;font-weight:700}
.skip:focus{transform:none}

.ambient{position:fixed;inset:0;z-index:-2;overflow:hidden;pointer-events:none;
  background:linear-gradient(180deg,#090909 0%,#050505 42%,#070707 100%)}
.ambient::before{content:"";position:absolute;inset:-20%;opacity:.28;
  background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
  background-size:64px 64px;transform:perspective(700px) rotateX(62deg) translateY(-16%);
  mask-image:linear-gradient(to bottom,black,transparent 68%)}
.glow{position:absolute;border-radius:50%;filter:blur(4px);opacity:.8}
.glow-a{width:680px;height:680px;left:-280px;top:-300px;
  background:radial-gradient(circle,rgba(255,255,255,.11),transparent 68%);
  animation:float-a 14s ease-in-out infinite alternate}
.glow-b{width:560px;height:560px;right:-250px;top:22%;
  background:radial-gradient(circle,rgba(255,255,255,.055),transparent 70%);
  animation:float-b 18s ease-in-out infinite alternate}
.noise{position:absolute;inset:0;opacity:.025;mix-blend-mode:screen;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
@keyframes float-a{to{transform:translate(80px,55px) scale(1.08)}}
@keyframes float-b{to{transform:translate(-70px,90px) scale(.92)}}

.top{position:sticky;top:0;z-index:20;border-bottom:1px solid var(--line);
  background:rgba(7,7,10,.72);backdrop-filter:blur(20px) saturate(135%);
  -webkit-backdrop-filter:blur(20px) saturate(135%)}
.top-in{max-width:var(--max);height:68px;margin:auto;padding:0 24px;display:flex;
  align-items:center;gap:24px}
.brand{display:inline-flex;align-items:center;color:var(--strong);font-weight:760;
  letter-spacing:.08em;text-transform:uppercase;font-size:12px}
.nav{margin-left:auto;display:flex;gap:4px;align-items:center}
.nav a{position:relative;padding:9px 13px;border-radius:10px;color:var(--muted);
  font-size:13px;font-weight:560;transition:color .2s,background .2s}
.nav a:hover{color:var(--strong);background:rgba(255,255,255,.045)}
.nav a[aria-current="page"]{color:var(--strong);background:var(--brand-soft)}
.nav a[aria-current="page"]::after{content:"";position:absolute;height:2px;left:13px;right:13px;
  bottom:4px;border-radius:2px;background:var(--brand-bright);box-shadow:0 0 14px rgba(255,255,255,.35)}

.shell{position:relative;max-width:var(--max);margin:0 auto;padding:64px 24px 88px}
.hero{position:relative;overflow:hidden;min-height:300px;border:1px solid var(--line);
  border-radius:28px;padding:52px 54px;background:linear-gradient(135deg,rgba(24,24,24,.9),rgba(10,10,10,.82));
  box-shadow:0 32px 80px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.055)}
.hero::before{content:"";position:absolute;width:520px;height:520px;right:-160px;top:-260px;
  border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.11),transparent 66%)}
.hero::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(115deg,transparent 52%,rgba(255,255,255,.035) 52.1%,transparent 65%)}
.hero-icon{position:absolute;right:58px;bottom:44px;width:112px;height:112px;color:rgba(255,255,255,.18)}
.hero-icon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.1;
  stroke-linecap:round;stroke-linejoin:round}
.eyebrow{position:relative;display:flex;align-items:center;gap:9px;margin:0 0 18px;color:#d6d6d6;
  font-size:11px;font-weight:750;letter-spacing:.16em;text-transform:uppercase}
.eyebrow::before{content:"";width:18px;height:1px;background:var(--brand-bright);box-shadow:0 0 12px rgba(255,255,255,.3)}
.hero h1{position:relative;max-width:760px;margin:0;color:var(--strong);font-size:clamp(36px,5.4vw,66px);
  line-height:.98;letter-spacing:-.052em;font-weight:720;text-wrap:balance}
.summary{position:relative;max-width:670px;margin:24px 0 32px;color:#c5c5c5;font-size:17px;line-height:1.65}
.meta{position:relative;display:flex;flex-wrap:wrap;gap:9px}
.meta span{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid var(--line);
  border-radius:999px;background:rgba(255,255,255,.035);color:var(--muted);font-size:12px}
.meta svg{width:15px;height:15px;fill:none;stroke:#d0d0d0;stroke-width:1.7;
  stroke-linecap:round;stroke-linejoin:round}

.layout{display:grid;grid-template-columns:250px minmax(0,1fr);gap:54px;align-items:start;margin-top:54px}
.toc{position:sticky;top:100px;max-height:calc(100vh - 124px);overflow:auto;padding:2px 12px 18px 2px;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.toc-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 12px;padding:0 9px;
  color:var(--quiet);font-size:10px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
.toc-count{display:grid;place-items:center;min-width:23px;height:20px;border:1px solid var(--line);border-radius:7px;
  color:#a7a7a7;font-size:10px;letter-spacing:0}
.toc ol{display:flex;flex-direction:column;gap:2px;list-style:none;margin:0;padding:0}
.toc a{display:grid;grid-template-columns:27px 1fr;gap:4px;align-items:start;padding:8px 9px;border-radius:10px;
  color:#909090;font-size:11px;line-height:1.45;transition:background .2s,color .2s,transform .2s}
.toc a:hover{color:#eee;background:rgba(255,255,255,.04);transform:translateX(2px)}
.toc-num{font-variant-numeric:tabular-nums;color:#6f6f6f;font-size:10px;padding-top:1px}
.toc-label{text-transform:capitalize}

.doc{min-width:0}
.intro{padding:2px 4px 24px;color:#c9c9c9;font-size:17px;line-height:1.8}
.intro p{margin:0 0 15px}.intro strong{color:var(--strong)}
.legal-section{position:relative;margin:0 0 16px;padding:30px 32px;border:1px solid var(--line);
  border-radius:18px;background:linear-gradient(145deg,var(--surface-strong),var(--surface));
  box-shadow:0 16px 48px rgba(0,0,0,.14),inset 0 1px rgba(255,255,255,.035);
  transition:border-color .25s,transform .25s,box-shadow .25s}
.legal-section::before{content:"";position:absolute;left:-1px;top:29px;width:2px;height:28px;border-radius:2px;
  background:linear-gradient(#fff,#747474);opacity:.62;box-shadow:0 0 16px rgba(255,255,255,.26)}
.legal-section:hover{border-color:rgba(255,255,255,.18);transform:translateY(-2px);
  box-shadow:0 20px 54px rgba(0,0,0,.2),inset 0 1px rgba(255,255,255,.045)}
.legal-section:has(h2:target){border-color:var(--line-strong);box-shadow:0 0 0 1px rgba(255,255,255,.05),0 22px 64px rgba(0,0,0,.26)}
.doc h2{margin:0 0 19px;color:var(--strong);font-size:16px;line-height:1.35;letter-spacing:.025em;
  text-transform:uppercase;scroll-margin-top:100px;text-wrap:balance}
.doc p{margin:0 0 14px}.doc p:last-child{margin-bottom:0}
.doc ul,.doc ol{margin:3px 0 16px;padding-left:0;list-style:none;display:grid;gap:9px}
.doc li{position:relative;padding-left:24px;color:#cbcbcb}
.doc ul li::before{content:"";position:absolute;left:3px;top:.72em;width:6px;height:6px;border-radius:2px;
  background:var(--brand-bright);box-shadow:0 0 10px rgba(255,255,255,.3);transform:rotate(45deg)}
.doc ol{counter-reset:item}.doc ol li{counter-increment:item;padding-left:34px}
.doc ol li::before{content:counter(item);position:absolute;left:0;top:.16em;display:grid;place-items:center;
  width:22px;height:22px;border:1px solid rgba(255,255,255,.17);border-radius:7px;background:var(--brand-soft);
  color:#e7e7e7;font-size:10px;font-weight:700}
.doc strong{color:#fff;font-weight:650}
.doc code{font:500 .9em Consolas,"Courier New",monospace;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.13);padding:2px 6px;border-radius:6px;color:#ededed}
.doc>hr{border:0;height:1px;margin:32px 4px;background:linear-gradient(90deg,transparent,var(--line),transparent)}
.doc>hr+p{margin:0 4px;padding:22px 24px;border:1px solid var(--line-strong);border-radius:16px;
  background:var(--brand-soft);color:#d8d8d8}

.foot{position:relative;border-top:1px solid var(--line);background:rgba(7,7,10,.58)}
.foot-in{max-width:var(--max);margin:auto;padding:28px 24px;display:flex;align-items:center;gap:16px;
  color:var(--quiet);font-size:12px}
.foot-brand{color:#bcbcbc;font-weight:650}.foot-dot{width:3px;height:3px;border-radius:50%;background:#575757}
.foot a{margin-left:auto;color:#bdbdbd;transition:color .2s}.foot a:hover{color:#fff}

@supports (animation-timeline:view()){
  .legal-section{animation:section-in linear both;animation-timeline:view();animation-range:entry 0% entry 30%}
  @keyframes section-in{from{opacity:.2;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
}
@media (max-width:850px){
  .shell{padding-top:34px}.hero{padding:38px 32px;min-height:0}.hero-icon{right:20px;bottom:18px;width:80px;height:80px}
  .layout{grid-template-columns:1fr;gap:25px;margin-top:30px}.toc{position:relative;top:auto;max-height:none;padding:16px;
    border:1px solid var(--line);border-radius:16px;background:rgba(17,17,17,.66)}
  .toc ol{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:600px){
  .top-in{height:auto;min-height:64px;padding:10px 16px;gap:10px}.brand{font-size:11px}
  .nav{gap:1px}.nav a{font-size:11px;padding:8px}.nav a[aria-current="page"]::after{left:8px;right:8px}
  .shell{padding:24px 14px 60px}.hero{border-radius:20px;padding:32px 24px}.hero h1{font-size:36px}
  .summary{font-size:15px;margin:20px 0 26px}.hero-icon{display:none}.meta{gap:7px}.meta span{font-size:10px;padding:7px 9px}
  .toc ol{grid-template-columns:1fr}.legal-section{padding:25px 22px;border-radius:15px}.legal-section::before{top:24px}
  .intro{padding-inline:2px;font-size:16px}.foot-in{padding:24px 16px;flex-wrap:wrap}.foot a{width:100%;margin-left:0}
}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}.glow{animation:none}.legal-section,.toc a{transition:none}
  .legal-section{animation:none!important}
}
`;

function renderNav(activeSlug) {
  const documents = LEGAL_PAGES.map((page) => {
    const current = page.slug === activeSlug ? ' aria-current="page"' : '';
    return `<a href="/${page.slug}"${current}>${page.nav}</a>`;
  }).join('');
  return `${documents}<a href="/influenciadores">Creators</a>`;
}

function renderToc(page) {
  if (page.toc.length === 0) return '';
  const items = page.toc
    .map((entry, index) => {
      const label = entry.title.replace(/^\d+\.\s*/, '').toLocaleLowerCase('pt-BR');
      return (
        `<li><a href="#${entry.id}">` +
        `<span class="toc-num">${String(index + 1).padStart(2, '0')}</span>` +
        `<span class="toc-label">${label}</span></a></li>`
      );
    })
    .join('');
  return (
    `<nav class="toc" aria-label="Sumário do documento">` +
    `<div class="toc-head"><span>Nesta página</span><span class="toc-count">${page.toc.length}</span></div>` +
    `<ol>${items}</ol></nav>`
  );
}

function splitIntro(html) {
  const firstSection = html.indexOf('<section class="legal-section">');
  if (firstSection < 0) return { intro: html, sections: '' };
  return { intro: html.slice(0, firstSection), sections: html.slice(firstSection) };
}

function renderPage(page) {
  const other = LEGAL_PAGES.find((candidate) => candidate.slug !== page.slug);
  const meta = PAGE_META[page.slug] ?? {
    eyebrow: 'Documento oficial',
    summary: `${page.title} da ${STORE_NAME}.`,
    icon: 'document',
  };
  const body = splitIntro(page.html);
  const updated = page.updatedAt ?? 'Consulte a versão vigente';

  return (
    `<!DOCTYPE html><html lang="pt-BR"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="theme-color" content="#050505">` +
    `<meta name="description" content="${meta.summary}">` +
    `<meta property="og:title" content="${page.title} — ${STORE_NAME}">` +
    `<meta property="og:description" content="${meta.summary}">` +
    `<meta property="og:type" content="website">` +
    `<title>${page.title} — ${STORE_NAME}</title><style>${CSS}</style></head><body>` +
    `<a class="skip" href="#conteudo">Ir para o conteúdo</a>` +
    `<div class="ambient" aria-hidden="true"><i class="glow glow-a"></i><i class="glow glow-b"></i><i class="noise"></i></div>` +
    `<header class="top"><div class="top-in">` +
    `<a class="brand" href="/" aria-label="Vook Store — início">${STORE_NAME}</a>` +
    `<nav class="nav" aria-label="Documentos oficiais">${renderNav(page.slug)}</nav>` +
    `</div></header>` +
    `<main class="shell" id="conteudo">` +
    `<section class="hero" aria-labelledby="titulo-documento">` +
    `<div class="hero-icon">${ICONS[meta.icon]}</div>` +
    `<p class="eyebrow">${meta.eyebrow}</p><h1 id="titulo-documento">${page.title}</h1>` +
    `<p class="summary">${meta.summary}</p>` +
    `<div class="meta" aria-label="Informações do documento">` +
    `<span>${ICONS.calendar}Atualizado em ${updated}</span>` +
    `<span>${ICONS.clock}${page.readMinutes} min de leitura</span>` +
    `<span>${ICONS.sections}${page.toc.length} seções</span>` +
    `</div></section>` +
    `<div class="layout">${renderToc(page)}<article class="doc">` +
    `<div class="intro">${body.intro}</div>${body.sections}</article></div>` +
    `</main>` +
    `<footer class="foot"><div class="foot-in"><span class="foot-brand">${STORE_NAME}</span>` +
    `<span class="foot-dot" aria-hidden="true"></span><span>Documento oficial</span>` +
    `<a href="/${other.slug}">Ver ${other.nav.toLocaleLowerCase('pt-BR')} →</a></div></footer>` +
    `</body></html>`
  );
}

/** Documentos ja renderizados, montados uma vez por instancia do Worker. */
const RENDERED = new Map(LEGAL_PAGES.map((page) => [page.slug, renderPage(page)]));

/** Devolve o HTML da pagina, ou `null` quando a rota nao e um documento. */
export function renderLegalPage(slug) {
  return RENDERED.get(slug) ?? null;
}

/** Slugs publicados, usados pelo `robots.txt` e pela raiz. */
export const LEGAL_SLUGS = LEGAL_PAGES.map((page) => page.slug);
