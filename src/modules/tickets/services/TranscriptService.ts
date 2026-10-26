import {
  AttachmentBuilder,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';

import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import { createLogger } from '../../../core/logger/Logger';
import { escapeHtml, escapeHtmlWithBreaks, linkifyEscaped, safeHref } from '../../../utils/html';
import { formatDuration } from '../../../utils/money';
import { sanitizeFilename } from '../../../utils/sanitize';
import { formatDateTimeBR } from '../../../utils/time';
import type {
  TranscriptAttachment,
  TranscriptAuthor,
  TranscriptHeader,
  TranscriptMessage,
} from '../types/transcript';

/**
 * Geracao do transcript HTML do atendimento.
 *
 * MODELO DE SEGURANCA (auditado):
 *  - O documento e montado por concatenacao de strings. Por isso, cada dado
 *    dinamico passa por `escapeHtml` / `escapeHtmlWithBreaks` ANTES de entrar
 *    no HTML — nome, apelido, username, assunto, motivo, categoria, nome de
 *    arquivo e conteudo de mensagem.
 *  - URLs so chegam a atributos `href`/`src` atraves de `safeHref`, que aceita
 *    apenas http(s). Quando `safeHref` devolve null, a URL e exibida como texto
 *    escapado — nunca como link.
 *  - Nao existe CSS nem JavaScript vindo de usuario: o unico `<style>` do
 *    documento e a constante estatica `TRANSCRIPT_CSS`, e nao ha `<script>`.
 *  - Consequencia: `<script>`, `<iframe>`, `<object>`, `onerror=` e
 *    `javascript:` enviados por um usuario aparecem como texto literal.
 */

const logger = createLogger('TranscriptService');

/** Teto absoluto de iteracoes de paginacao (defesa contra loop infinito). */
const MAX_FETCH_ITERATIONS = 200;

/** Quantas vezes o transcript pode ser reduzido para caber no limite de upload. */
const MAX_SHRINK_ATTEMPTS = 12;

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/* -------------------------------------------------------------------------- */
/* Helpers de formatacao                                                       */
/* -------------------------------------------------------------------------- */

/** Numero do atendimento com 4 digitos: 125 -> "0125". */
function formatTicketNumber(ticketNumber: number): string {
  const safe = Number.isFinite(ticketNumber) ? Math.max(0, Math.trunc(ticketNumber)) : 0;
  return String(safe).padStart(4, '0');
}

/** Tamanho de arquivo legivel em pt-BR: 2048 -> "2,0 KB". */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const lastUnit = BYTE_UNITS.length - 1;
  let value = Math.trunc(bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < lastUnit) {
    value = value / 1024;
    unitIndex += 1;
  }

  // O arredondamento para 1 casa pode chegar a "1024,0": nesse caso a unidade
  // ainda precisa subir (1048575 B e "1,0 MB", nunca "1024,0 KB").
  if (unitIndex < lastUnit && Number(value.toFixed(1)) >= 1024) {
    value = value / 1024;
    unitIndex += 1;
  }

  const unit = BYTE_UNITS[unitIndex];
  if (unitIndex === 0) return `${Math.round(value)} ${unit}`;
  return `${value.toFixed(1).replace('.', ',')} ${unit}`;
}

/** Primeira letra do nome, usada no avatar placeholder. Nunca quebra surrogates. */
function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? '?' : first.toUpperCase();
}

/**
 * Compara dois snowflakes NUMERICAMENTE, nao por ordem lexicografica.
 * Snowflakes sao decimais sem zero a esquerda, entao o mais curto e o menor —
 * comparar como texto colocaria "1000000000000000000" antes de
 * "999999999999999999", invertendo a ordem no ponto em que o Discord passou de
 * 18 para 19 digitos.
 */
function compareSnowflakes(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Plural simples: "1 mensagem" / "3 mensagens". */
function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
}

/* -------------------------------------------------------------------------- */
/* CSS estatico (tema escuro estilo Discord)                                   */
/* -------------------------------------------------------------------------- */

const TRANSCRIPT_CSS = `
:root{
  /* Preto, branco e prata. Sem matiz nenhuma: todo tom e cinza puro, e o
     unico "colorido" e a variacao de luminosidade. */
  --bg:#08090a; --panel:rgba(24,25,28,.72); --panel-2:rgba(28,30,34,.66);
  --line:rgba(255,255,255,.10);
  --text:#d8dade; --muted:#8f939a; --strong:#ffffff;
  --silver:#c9ced6; --link:#e6e9ee; --warn:#d9d2b8;
  --client:rgba(255,255,255,.06); --client-line:rgba(255,255,255,.14);
  --staff:rgba(201,206,214,.13); --staff-line:rgba(201,206,214,.30);
}

/*
  FEIXES DE LUZ — 100% CSS.

  A referencia era um componente React com canvas e requestAnimationFrame.
  Aqui nao ha JavaScript: o documento e servido com CSP sem script-src, e uma
  tag de script seria bloqueada pelo navegador. Cada feixe e um elemento com
  gradiente proprio, e o movimento sai de duas animacoes — deriva e pulso.

  (O texto acima evita de proposito escrever a tag literal: o teste de seguranca
  varre o documento inteiro procurando por ela, sem olhar contexto — e essa
  cegueira e o que o torna confiavel.)

  As variaveis por feixe (--x, --w, --dur, --delay, --o, --tone) vem no
  atributo style de cada <i>, escritas pelo gerador. Sao valores estaticos:
  estilo inline nao e script e passa pela CSP sem excecao.

  O atraso NEGATIVO faz cada feixe comecar no meio do proprio ciclo, entao a
  tela ja abre com o movimento em curso em vez de todos partindo do rodape.
*/
.beams{position:fixed;inset:-25%;z-index:0;pointer-events:none;
  overflow:hidden;filter:blur(30px);contain:layout paint}
.beams i{position:absolute;top:0;left:var(--x);
  width:var(--w);height:150%;border-radius:999px;
  transform:rotate(-35deg);opacity:var(--o);
  background:linear-gradient(180deg,
    transparent 0%,
    rgba(255,255,255,calc(var(--tone) * .35)) 18%,
    rgba(255,255,255,var(--tone)) 45%,
    rgba(255,255,255,var(--tone)) 58%,
    rgba(255,255,255,calc(var(--tone) * .35)) 82%,
    transparent 100%);
  animation:beam-drift var(--dur) linear var(--delay) infinite,
            beam-pulse calc(var(--dur) / 3) ease-in-out var(--delay) infinite alternate}
@keyframes beam-drift{from{transform:rotate(-35deg) translateY(60%)}
                      to{transform:rotate(-35deg) translateY(-160%)}}
@keyframes beam-pulse{from{opacity:calc(var(--o) * .55)}to{opacity:var(--o)}}

/* Um veu escuro entre os feixes e o texto: sem ele o brilho competiria com a
   leitura, que e a unica funcao desta pagina. */
.beams::after{content:"";position:absolute;inset:0;background:rgba(8,9,10,.18)}

@media (prefers-reduced-motion:reduce){
  .beams i{animation:none}
}
*{box-sizing:border-box}
body{margin:0;padding:28px 12px;background:var(--bg);color:var(--text);
  font-family:"gg sans","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:15px;line-height:1.5;-webkit-text-size-adjust:100%}
.wrap{max-width:900px;margin:0 auto;position:relative;z-index:1}
/* Leve translucidez para o feixe passar por tras sem borrar o texto: o blur
   fica no fundo, nunca no conteudo. */
.card,.bubble{backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
a{color:var(--link);text-decoration:none;word-break:break-word}
a:hover{text-decoration:underline}

/* ---- Cabecalho ---- */
.card{background:linear-gradient(180deg,rgba(38,40,45,.78) 0%,var(--panel) 100%);
  border:1px solid var(--line);border-radius:16px;padding:24px;
  box-shadow:0 1px 0 rgba(255,255,255,.03) inset}
.head-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:6px}
.store{font-size:13px;font-weight:600;letter-spacing:.10em;text-transform:uppercase;
  color:var(--muted)}
.ticket{margin-left:auto;font-family:Consolas,"Courier New",monospace;font-size:13px;
  color:var(--silver);background:rgba(255,255,255,.06);border:1px solid var(--line);
  padding:3px 10px;border-radius:999px}
.subject{width:100%;font-size:22px;font-weight:700;color:var(--strong);
  line-height:1.3;word-break:break-word;margin:2px 0 16px}
.info-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:14px 24px;border-top:1px solid var(--line);padding-top:16px}
.info{display:flex;flex-direction:column;gap:3px;min-width:0}
.info-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.info-value{color:var(--strong);word-break:break-word;font-size:14px}
.info-wide{grid-column:1/-1}
.uid{color:var(--muted);font-size:12px;font-family:Consolas,"Courier New",monospace}

/* ---- Conversa ---- */
.msgs{margin-top:22px;display:flex;flex-direction:column;gap:14px}

/*
  ANIMACAO DE ENTRADA SEM JAVASCRIPT.
  O documento e servido com CSP sem script-src, entao a unica ferramenta e
  CSS. O atraso vem de --i, escrito no style de cada mensagem, e e limitado
  no gerador: transcript de 500 mensagens nao pode levar meio minuto para
  terminar de aparecer.
*/
@keyframes msg-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.msg{display:flex;gap:10px;max-width:78%;
  animation:msg-in .32s cubic-bezier(.22,.61,.36,1) both;
  animation-delay:calc(var(--i,0) * 28ms)}
@media (prefers-reduced-motion:reduce){.msg{animation:none}}

/* Cliente a ESQUERDA, atendente a DIREITA, bot ao CENTRO. */
.msg-client{align-self:flex-start}
.msg-staff{align-self:flex-end;flex-direction:row-reverse}
.msg-bot{align-self:center;max-width:88%;flex-direction:column;align-items:center;gap:6px}

.avatar{flex:0 0 auto;width:38px;height:38px;border-radius:50%;overflow:hidden}
.avatar img{width:38px;height:38px;border-radius:50%;display:block;object-fit:cover}
.avatar-fallback{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.14);
  color:var(--strong);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}

.bubble{min-width:0;border:1px solid var(--line);background:var(--panel-2);
  border-radius:14px;padding:9px 13px}
.msg-client .bubble{background:var(--client);border-color:var(--client-line);
  border-bottom-left-radius:4px}
.msg-staff .bubble{background:var(--staff);border-color:var(--staff-line);
  border-bottom-right-radius:4px}
.msg-bot .bubble{background:transparent;border-style:dashed;text-align:center;
  color:var(--muted);font-size:13px}

.mhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:2px}
.msg-staff .mhead{justify-content:flex-end}
.msg-bot .mhead{justify-content:center}
.name{font-weight:600;color:var(--strong);word-break:break-word;font-size:13px}
.badge{background:rgba(255,255,255,.16);color:var(--strong);font-size:9px;font-weight:700;
  padding:1px 5px;border-radius:4px;letter-spacing:.04em;text-transform:uppercase}
.role-tag{font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  padding:1px 6px;border-radius:4px;border:1px solid var(--line);color:var(--muted)}
.msg-client .role-tag{border-color:var(--client-line)}
.msg-staff .role-tag{border-color:var(--staff-line)}
.handle,.time,.edited{color:var(--muted);font-size:11px}
.reply{display:flex;gap:6px;align-items:baseline;color:var(--muted);
  font-size:12px;margin-bottom:4px;word-break:break-word}
.reply-mark{color:var(--silver)}
.content{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.empty-content{color:var(--muted);font-style:italic}
.files{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.file{background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:8px;
  padding:6px 10px;font-size:13px;word-break:break-word}
.file-size,.file-type{color:var(--muted);margin-left:6px;font-size:12px}
.file-warn{color:var(--warn);margin-left:6px;font-size:12px}
.shots{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}
.shot{margin:0;max-width:320px;background:rgba(0,0,0,.25);border:1px solid var(--line);
  border-radius:8px;padding:6px;font-size:12px}
.shot img{display:block;max-width:100%;height:auto;border-radius:5px;
  background:rgba(255,255,255,.04)}
.shot figcaption{margin-top:5px;color:var(--muted);word-break:break-word}
.embeds{margin-top:6px;font-size:12px;color:var(--warn)}

.notice{margin:18px 0;padding:14px;border:1px dashed var(--line);border-radius:10px;
  background:var(--panel);color:var(--muted);text-align:center}
.foot{margin:22px 0 0;color:var(--muted);font-size:12px;text-align:center}

/* A legenda ensina o codigo de cores antes da primeira bolha. */
.legend{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;
  margin:18px 0 4px;font-size:11px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:50%;border:1px solid var(--line);display:inline-block}
.dot-client{background:var(--client);border-color:var(--client-line)}
.dot-staff{background:var(--staff);border-color:var(--staff-line)}
.dot-bot{background:transparent;border-style:dashed}

@media (max-width:560px){
  body{padding:14px 8px;font-size:14px}
  .card{padding:16px;border-radius:12px}
  .subject{font-size:18px}
  .msg{max-width:92%}
  .avatar,.avatar img,.avatar-fallback{width:30px;height:30px}
}
`;

/* -------------------------------------------------------------------------- */
/* Renderizacao                                                                */
/* -------------------------------------------------------------------------- */

/** Linha rotulo/valor do cabecalho. `valueHtml` ja deve estar escapado. */
/**
 * Camada de feixes do fundo.
 *
 * Valores FIXOS, e nao aleatorios: o transcript e um documento de auditoria e
 * precisa sair identico toda vez que for gerado. Duas execucoes sobre as
 * mesmas mensagens tem de produzir o mesmo arquivo — sem isso, comparar dois
 * transcripts deixaria de significar alguma coisa.
 *
 * `aria-hidden` porque nao ha nada para um leitor de tela anunciar aqui.
 *
 * INTENSIDADE E VELOCIDADE SAO DELIBERADAS. A primeira versao usava tons de
 * 9% a 21% e ciclos de 34 a 45 segundos, sob um veu de 35% e blur de 42px:
 * o feixe mais forte chegava a 8% de branco sobre um fundo quase preto,
 * atravessando a tela devagar demais. Estava animado e parecia parado.
 * Quatro fatores multiplicavam o mesmo erro, e cada um sozinho parecia
 * discreto.
 */
const BACKGROUND_BEAMS: ReadonlyArray<{
  x: number;
  w: number;
  dur: number;
  delay: number;
  opacity: number;
  tone: number;
}> = [
  { x: -8, w: 150, dur: 17, delay: -3, opacity: 0.85, tone: 0.34 },
  { x: 6, w: 90, dur: 13, delay: -7, opacity: 0.7, tone: 0.24 },
  { x: 18, w: 200, dur: 21, delay: -11, opacity: 0.95, tone: 0.4 },
  { x: 31, w: 70, dur: 15, delay: -4, opacity: 0.6, tone: 0.2 },
  { x: 44, w: 170, dur: 19, delay: -9, opacity: 0.85, tone: 0.34 },
  { x: 57, w: 110, dur: 16, delay: -6, opacity: 0.72, tone: 0.27 },
  { x: 68, w: 220, dur: 23, delay: -14, opacity: 1, tone: 0.42 },
  { x: 80, w: 85, dur: 14, delay: -2, opacity: 0.62, tone: 0.22 },
  { x: 92, w: 160, dur: 18, delay: -8, opacity: 0.82, tone: 0.32 },
  { x: 104, w: 120, dur: 20, delay: -16, opacity: 0.75, tone: 0.28 },
];

function renderBeams(): string {
  const layers = BACKGROUND_BEAMS.map(
    (beam) =>
      `<i style="--x:${beam.x}%;--w:${beam.w}px;--dur:${beam.dur}s;` +
      `--delay:${beam.delay}s;--o:${beam.opacity};--tone:${beam.tone}"></i>`,
  ).join('');
  return `<div class="beams" aria-hidden="true">${layers}</div>`;
}

function renderInfo(label: string, valueHtml: string, wide = false): string {
  const cls = wide ? 'info info-wide' : 'info';
  return (
    `<div class="${cls}">` +
    `<span class="info-label">${escapeHtml(label)}</span>` +
    `<span class="info-value">${valueHtml}</span>` +
    `</div>`
  );
}

/** "Fulano (123456789)" com escape em ambos os campos. */
function renderUserValue(name: string | null, id: string | null, fallback: string): string {
  if (name === null && id === null) return escapeHtml(fallback);
  const safeName = escapeHtml(name ?? fallback);
  if (id === null || id.length === 0) return safeName;
  return `${safeName} <span class="uid">(${escapeHtml(id)})</span>`;
}

function renderParticipants(participants: TranscriptHeader['participants']): string {
  if (participants.length === 0) return escapeHtml('Nenhum participante adicional.');
  return participants
    .map((participant) => renderUserValue(participant.name, participant.id, 'Desconhecido'))
    .join('<span class="uid">, </span>');
}

function renderHeaderCard(header: TranscriptHeader): string {
  const ticketLabel = `Atendimento #${formatTicketNumber(header.ticketNumber)}`;

  const rows = [
    renderInfo('Categoria', escapeHtml(header.categoryName)),
    renderInfo('Duracao', escapeHtml(formatDuration(header.durationMs))),
    renderInfo('Cliente', renderUserValue(header.ownerName, header.ownerId, 'Desconhecido')),
    renderInfo(
      'Responsavel',
      renderUserValue(header.staffName, header.staffId, 'Nao atribuido'),
    ),
    renderInfo(
      'Encerrado por',
      renderUserValue(header.closedByName, header.closedById, 'Sistema'),
    ),
    renderInfo('Aberto em', escapeHtml(formatDateTimeBR(header.openedAt))),
    renderInfo('Fechado em', escapeHtml(formatDateTimeBR(header.closedAt))),
    renderInfo('Participantes', renderParticipants(header.participants), true),
    renderInfo(
      'Motivo do encerramento',
      header.closeReason === null || header.closeReason.length === 0
        ? escapeHtml('Nao informado')
        : escapeHtmlWithBreaks(header.closeReason),
      true,
    ),
  ].join('');

  /*
   * O ASSUNTO E O TITULO.
   *
   * Antes o cabecalho abria com o nome da loja e o numero do ticket em corpo 20,
   * e o assunto vinha depois em cinza, do tamanho do texto comum — a unica linha
   * que diz do que se trata era a menos visivel das tres. Agora a loja e o
   * numero viram etiquetas e o assunto ocupa o lugar de manchete.
   */
  return (
    `<header class="card">` +
    `<div class="head-top">` +
    `<span class="store">${escapeHtml(header.storeName)}</span>` +
    `<span class="ticket">${escapeHtml(ticketLabel)}</span>` +
    `</div>` +
    `<h1 class="subject">${escapeHtml(header.subject)}</h1>` +
    `<div class="info-grid">${rows}</div>` +
    `</header>`
  );
}

function renderAvatar(author: TranscriptAuthor): string {
  const href = safeHref(author.avatarUrl);
  const alt = escapeHtml(`Avatar de ${author.displayName}`);
  if (href === null) {
    // Sem URL confiavel: placeholder textual, jamais um <img> com src arbitrario.
    return `<div class="avatar"><div class="avatar-fallback">${escapeHtml(initialOf(author.displayName))}</div></div>`;
  }
  return (
    `<div class="avatar">` +
    `<img src="${href}" alt="${alt}" width="40" height="40" loading="lazy" referrerpolicy="no-referrer">` +
    `</div>`
  );
}

/**
 * Formatos desenhados dentro da conversa.
 *
 * A lista e a MESMA do Worker (`INLINE_TYPES` em `cloudflare/transcripts`), e
 * precisa continuar sendo: la ela decide o que sai com `content-disposition:
 * inline`, aqui ela decide o que vira `<img>`. Divergir gera imagem quebrada de
 * um lado ou download forcado do outro.
 */
const INLINE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

/** Tipo sem parametros: `image/png; charset=x` -> `image/png`. */
function baseContentType(attachment: TranscriptAttachment): string {
  return (attachment.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * So imagem JA ESPELHADA e desenhada.
 *
 * Apontar um `<img>` para o CDN do Discord daria uma miniatura bonita hoje e um
 * icone de imagem quebrada amanha, quando a assinatura da URL expira — pior que
 * o link de texto, que pelo menos deixa claro que existe um arquivo ali.
 */
function isInlineImage(attachment: TranscriptAttachment): boolean {
  return (
    typeof attachment.hostedUrl === 'string' &&
    attachment.hostedUrl.length > 0 &&
    INLINE_IMAGE_TYPES.has(baseContentType(attachment))
  );
}

/** Endereco preferido: a copia hospedada; sem ela, o link original. */
function attachmentHref(attachment: TranscriptAttachment): string | null {
  return safeHref(
    typeof attachment.hostedUrl === 'string' && attachment.hostedUrl.length > 0
      ? attachment.hostedUrl
      : attachment.url,
  );
}

function attachmentSize(attachment: TranscriptAttachment): string {
  return `<span class="file-size">${escapeHtml(formatBytes(attachment.size))}</span>`;
}

function renderAttachment(attachment: TranscriptAttachment): string {
  const name = escapeHtml(attachment.name);
  const size = attachmentSize(attachment);
  const type =
    attachment.contentType === null || attachment.contentType.length === 0
      ? ''
      : `<span class="file-type">${escapeHtml(attachment.contentType)}</span>`;
  const href = attachmentHref(attachment);

  /*
   * Aviso de validade. Sem copia hospedada, o unico endereco e o do CDN do
   * Discord, que expira em horas — quem reabrir o transcript depois disso
   * merece saber por que o link nao funciona, em vez de achar que quebramos.
   */
  const expiring =
    attachment.hostedUrl === undefined || attachment.hostedUrl === null
      ? '<span class="file-warn">link temporario</span>'
      : '';

  // URL nao confiavel (javascript:, data:, file:, invalida): vira texto puro.
  const label =
    href === null
      ? `${name} <span class="file-size">${escapeHtml(`[link bloqueado: ${attachment.url}]`)}</span>`
      : `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${name}</a>`;

  return `<li class="file">${label}${size}${type}${href === null ? '' : expiring}</li>`;
}

/** Imagem hospedada: miniatura clicavel com o nome embaixo. */
function renderInlineImage(attachment: TranscriptAttachment): string {
  const href = attachmentHref(attachment);
  if (href === null) return renderAttachment(attachment);

  const name = escapeHtml(attachment.name);
  return (
    `<figure class="shot">` +
    `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">` +
    `<img src="${href}" alt="${name}" loading="lazy" referrerpolicy="no-referrer">` +
    `</a>` +
    `<figcaption>${name}${attachmentSize(attachment)}</figcaption>` +
    `</figure>`
  );
}

function renderAttachments(attachments: readonly TranscriptAttachment[]): string {
  if (attachments.length === 0) return '';

  const images = attachments.filter(isInlineImage);
  const files = attachments.filter((attachment) => !isInlineImage(attachment));

  const list =
    files.length === 0 ? '' : `<ul class="files">${files.map(renderAttachment).join('')}</ul>`;
  const gallery =
    images.length === 0 ? '' : `<div class="shots">${images.map(renderInlineImage).join('')}</div>`;

  return list + gallery;
}

function renderReply(message: TranscriptMessage): string {
  if (message.replyToId === null) return '';
  const author =
    message.replyToAuthorName === null
      ? escapeHtml('autor desconhecido')
      : escapeHtml(message.replyToAuthorName);
  return (
    `<div class="reply">` +
    `<span class="reply-mark">&#8618;</span>` +
    `<span>${escapeHtml('Em resposta a')} ${author} ` +
    `<span class="uid">(${escapeHtml(message.replyToId)})</span></span>` +
    `</div>`
  );
}

function renderContent(content: string): string {
  if (content.length === 0) {
    return `<div class="content empty-content">${escapeHtml('(mensagem sem texto)')}</div>`;
  }
  // Escape primeiro, linkify depois: o linkify opera sobre texto ja escapado e
  // so cria <a> quando safeHref aprova a URL.
  return `<div class="content">${linkifyEscaped(escapeHtmlWithBreaks(content))}</div>`;
}

/**
 * De que LADO a mensagem aparece.
 *
 * Cliente a esquerda, atendente a direita, bot ao centro — o mesmo codigo
 * visual de um app de conversa, que dispensa ler o nome para saber quem falou.
 *
 * A classificacao usa o `ownerId` do cabecalho porque ele e o unico dado
 * confiavel: cargo nao serve (quem responde pode ser um admin sem cargo de
 * equipe) e nome muda. Dono do ticket e dono do ticket.
 */
function messageSide(
  author: TranscriptAuthor,
  ownerId: string,
): { side: 'client' | 'staff' | 'bot'; label: string } {
  if (author.isBot) return { side: 'bot', label: 'sistema' };
  if (author.id === ownerId) return { side: 'client', label: 'cliente' };
  return { side: 'staff', label: 'atendimento' };
}

/**
 * Teto do atraso em cascata da animacao.
 *
 * Sem ele, a 500a mensagem so apareceria catorze segundos depois de abrir o
 * arquivo — o efeito viraria espera. Passado o teto, todas entram juntas.
 */
const MAX_ANIMATION_STEPS = 24;

function renderMessage(
  message: TranscriptMessage,
  ownerId: string,
  index: number,
): string {
  const author = message.author;
  const { side, label } = messageSide(author, ownerId);

  const botBadge = author.isBot ? `<span class="badge">${escapeHtml('BOT')}</span>` : '';
  const roleTag = author.isBot
    ? ''
    : `<span class="role-tag">${escapeHtml(label)}</span>`;
  const edited =
    message.editedAt === null
      ? ''
      : `<span class="edited" title="${escapeHtml(formatDateTimeBR(message.editedAt))}">${escapeHtml('(editado)')}</span>`;
  const embeds =
    message.embedCount > 0
      ? `<div class="embeds">${escapeHtml(`${message.embedCount} embed(s) nao renderizado(s)`)}</div>`
      : '';

  // O bot fala em nome do sistema: avatar repetido a cada aviso vira ruido.
  const avatar = side === 'bot' ? '' : renderAvatar(author);

  const step = Math.min(index, MAX_ANIMATION_STEPS);

  return (
    `<article class="msg msg-${side}" id="msg-${escapeHtml(message.id)}" style="--i:${step}">` +
    avatar +
    `<div class="bubble">` +
    renderReply(message) +
    `<div class="mhead">` +
    `<span class="name">${escapeHtml(author.displayName)}</span>` +
    botBadge +
    roleTag +
    `<span class="handle">@${escapeHtml(author.username)}</span>` +
    `<span class="time">${escapeHtml(formatDateTimeBR(message.createdAt))}</span>` +
    edited +
    `</div>` +
    renderContent(message.content) +
    renderAttachments(message.attachments) +
    embeds +
    `</div>` +
    `</article>`
  );
}

/**
 * Renderiza o documento HTML completo e auto-contido do transcript.
 *
 * Funcao pura em relacao as entradas (a unica variacao e a data de geracao no
 * rodape). Cada dado dinamico e escapado antes de entrar no documento.
 *
 * @param omittedMessages Quantidade de mensagens antigas omitidas quando o
 *   arquivo precisou ser reduzido para caber no limite de upload do Discord.
 */
export function renderTranscriptHtml(
  header: TranscriptHeader,
  messages: readonly TranscriptMessage[],
  omittedMessages = 0,
): string {
  const title = `Atendimento #${formatTicketNumber(header.ticketNumber)} — ${header.storeName}`;

  const omittedNotice =
    omittedMessages > 0
      ? `<div class="notice">${escapeHtml(
          `${pluralize(omittedMessages, 'mensagem mais antiga foi omitida', 'mensagens mais antigas foram omitidas')} para respeitar o limite de tamanho do arquivo.`,
        )}</div>`
      : '';

  const legend =
    `<div class="legend">` +
    `<span><i class="dot dot-client"></i>${escapeHtml('cliente')}</span>` +
    `<span><i class="dot dot-staff"></i>${escapeHtml('atendimento')}</span>` +
    `<span><i class="dot dot-bot"></i>${escapeHtml('sistema')}</span>` +
    `</div>`;

  const body =
    messages.length === 0
      ? `<div class="notice">${escapeHtml('Nenhuma mensagem foi registrada neste atendimento.')}</div>`
      : legend +
        `<section class="msgs">` +
        messages
          .map((message, index) => renderMessage(message, header.ownerId, index))
          .join('') +
        `</section>`;

  const footer =
    `<p class="foot">` +
    escapeHtml(
      `${pluralize(messages.length, 'mensagem registrada', 'mensagens registradas')} · Transcript gerado em ${formatDateTimeBR(new Date())}`,
    ) +
    `</p>`;

  return (
    `<!DOCTYPE html>\n` +
    `<html lang="pt-BR">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta name="robots" content="noindex, nofollow">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>${TRANSCRIPT_CSS}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    renderBeams() +
    `<main class="wrap">` +
    renderHeaderCard(header) +
    omittedNotice +
    body +
    footer +
    `</main>\n` +
    `</body>\n` +
    `</html>\n`
  );
}

/* -------------------------------------------------------------------------- */
/* Coleta de mensagens no Discord                                              */
/* -------------------------------------------------------------------------- */

function resolveAvatarUrl(message: Message): string | null {
  try {
    return message.author.displayAvatarURL({ extension: 'png', size: 128 });
  } catch {
    logger.debug('Nao foi possivel resolver o avatar do autor.', {
      userId: message.author.id,
      entityType: 'message',
      entityId: message.id,
    });
    return null;
  }
}

/** Converte uma mensagem do discord.js na forma normalizada do transcript. */
function toTranscriptMessage(
  message: Message,
  channel: TextChannel | ThreadChannel,
): TranscriptMessage {
  const author: TranscriptAuthor = {
    id: message.author.id,
    username: message.author.username,
    displayName: message.member?.displayName ?? message.author.username,
    avatarUrl: resolveAvatarUrl(message),
    isBot: message.author.bot,
  };

  const attachments: TranscriptAttachment[] = message.attachments.map((attachment) => ({
    name: attachment.name,
    url: attachment.url,
    size: attachment.size,
    contentType: attachment.contentType,
  }));

  const replyToId = message.reference?.messageId ?? null;
  let replyToAuthorName: string | null = null;
  if (replyToId !== null) {
    // Somente cache: buscar cada referencia geraria uma chamada extra por
    // mensagem e estouraria o rate limit em canais longos.
    const referenced = channel.messages.cache.get(replyToId);
    if (referenced !== undefined) {
      replyToAuthorName = referenced.member?.displayName ?? referenced.author.username;
    }
  }

  return {
    id: message.id,
    author,
    createdAt: message.createdAt,
    content: message.content,
    attachments,
    embedCount: message.embeds.length,
    replyToId,
    replyToAuthorName,
    editedAt: message.editedAt,
  };
}

/**
 * Busca o historico do canal em lotes de 100, do mais recente para o mais
 * antigo, e devolve as mensagens em ordem cronologica (mais antiga primeiro).
 *
 * A paginacao para quando: o lote vem vazio, o lote vem menor que o solicitado
 * (fim do historico), o limite de mensagens e atingido, ou o teto de iteracoes
 * e alcancado — nunca ha loop infinito.
 *
 * `maxMessages` e sempre limitado ao teto de negocio. NaN vira 0 (nao consulta a
 * API); Infinity significa "tudo o que o teto de negocio permitir" — devolver
 * vazio nesse caso perderia o transcript inteiro em silencio.
 */
export async function fetchChannelMessages(
  // Topico ou canal legado: a leitura de historico e identica nos dois, e o
  // transcript de um ticket antigo precisa continuar saindo.
  channel: TextChannel | ThreadChannel,
  maxMessages: number = BUSINESS_LIMITS.TRANSCRIPT_MAX_MESSAGES,
): Promise<TranscriptMessage[]> {
  const requestedMax = Number.isNaN(maxMessages) ? 0 : Math.trunc(maxMessages);
  const limit = Math.max(0, Math.min(requestedMax, BUSINESS_LIMITS.TRANSCRIPT_MAX_MESSAGES));
  if (limit === 0) return [];

  const batchSize = DISCORD_LIMITS.MESSAGES_FETCH_LIMIT;
  const maxIterations = Math.min(Math.ceil(limit / batchSize) + 1, MAX_FETCH_ITERATIONS);

  const collected: TranscriptMessage[] = [];
  let before: string | undefined;
  let reachedEnd = false;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const remaining = limit - collected.length;
    if (remaining <= 0) break;

    const requested = Math.min(batchSize, remaining);
    const batch = await channel.messages.fetch({ limit: requested, before });
    if (batch.size === 0) {
      reachedEnd = true;
      break;
    }

    // O Discord devolve do mais recente para o mais antigo.
    const ordered = [...batch.values()];
    for (const message of ordered) {
      if (collected.length >= limit) break;
      collected.push(toTranscriptMessage(message, channel));
    }

    const oldest = ordered[ordered.length - 1];
    if (oldest === undefined) {
      reachedEnd = true;
      break;
    }
    before = oldest.id;

    if (batch.size < requested) {
      reachedEnd = true;
      break;
    }
  }

  collected.sort((a, b) => {
    const delta = a.createdAt.getTime() - b.createdAt.getTime();
    if (delta !== 0) return delta;
    return compareSnowflakes(a.id, b.id);
  });

  logger.debug('Historico coletado para transcript.', {
    channelId: channel.id,
    guildId: channel.guildId,
    total: collected.length,
    limit,
    reachedEnd,
  });

  return collected;
}

/* -------------------------------------------------------------------------- */
/* Arquivo final                                                               */
/* -------------------------------------------------------------------------- */

/** Nome de arquivo seguro do transcript: "transcript-atendimento-0125.html". */
export function buildTranscriptFilename(ticketNumber: number): string {
  return sanitizeFilename(
    `transcript-atendimento-${formatTicketNumber(ticketNumber)}.html`,
    'transcript.html',
  );
}

/**
 * Monta o anexo pronto para envio no Discord.
 *
 * Se o HTML ultrapassar o limite de upload, as mensagens mais antigas sao
 * descartadas (preservando o fim da conversa) e um aviso e incluido no
 * documento — melhor um transcript parcial do que um envio recusado.
 *
 * O teto e o padrao de 20 MiB, sem olhar o nivel de impulsos. O anexo e
 * enviado pelo BOT ao canal de logs, e a unica fonte que o fechamento tem —
 * o `attachmentSizeLimit` do modal — inclui o Nitro de quem fechou: um
 * atendente com Nitro num servidor sem impulso traria de volta o 40005 que
 * este teto evita. A versao hospedada, quando existe, nao passa por este corte.
 */
export function buildTranscriptAttachment(
  header: TranscriptHeader,
  messages: readonly TranscriptMessage[],
): AttachmentBuilder {
  const maxBytes = DISCORD_LIMITS.ATTACHMENT_BYTES_DEFAULT;

  let visible: readonly TranscriptMessage[] = messages;
  let omitted = 0;
  let buffer = Buffer.from(renderTranscriptHtml(header, visible, omitted), 'utf8');

  for (let attempt = 0; attempt < MAX_SHRINK_ATTEMPTS; attempt += 1) {
    if (buffer.byteLength <= maxBytes || visible.length <= 1) break;
    const keep = Math.max(1, Math.floor(visible.length / 2));
    omitted += visible.length - keep;
    visible = visible.slice(visible.length - keep);
    buffer = Buffer.from(renderTranscriptHtml(header, visible, omitted), 'utf8');
  }

  if (omitted > 0) {
    logger.warn('Transcript reduzido para caber no limite de upload do Discord.', {
      entityType: 'ticket',
      entityId: String(header.ticketNumber),
      omitted,
      bytes: buffer.byteLength,
    });
  }

  return new AttachmentBuilder(buffer, {
    name: buildTranscriptFilename(header.ticketNumber),
    description: `Transcript do atendimento #${formatTicketNumber(header.ticketNumber)}`,
  });
}
