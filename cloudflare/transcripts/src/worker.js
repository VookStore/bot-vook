import { LEGAL_SLUGS, renderLegalPage } from './legal.js';
import {
  INFLUENCER_SLUG,
  renderInfluencerPage,
  renderInfluencerResult,
} from './influencers.js';

/**
 * Hospedagem dos transcripts e das paginas juridicas publicas.
 *
 *   PUT  /t/<slug>  (Authorization: Bearer <UPLOAD_TOKEN>)  -> grava o HTML
 *   GET  /t/<slug>                                          -> entrega o HTML
 *   PUT  /a/<id>    (Authorization: Bearer <UPLOAD_TOKEN>)  -> grava um anexo
 *   GET  /a/<id>                                            -> entrega o anexo
 *   GET  /termos | /privacidade                             -> documento publico
 *   GET  /influenciadores                                  -> programa de creators
 *   GET  /                                                  -> vai para /termos
 *
 * DOIS PAPEIS OPOSTOS NO MESMO WORKER. O transcript e privado e so existe em um
 * endereco secreto; as paginas juridicas sao publicas e precisam ser
 * encontradas. Dividem hospedagem — um deploy, um dominio — e nada mais: o
 * `robots.txt` libera os documentos e continua barrando `/t/`, e cada resposta
 * monta os proprios cabecalhos.
 *
 * O QUE ESTE WORKER PROTEGE. Um transcript carrega dado de cliente: nome, print
 * de conversa, as vezes comprovante com dado bancario. O endereco secreto e a
 * unica barreira de leitura, entao tudo aqui existe para essa barreira nao
 * vazar por outro caminho:
 *
 *  - `X-Robots-Tag: noindex` e um robots.txt fechado, para o link nao acabar
 *    no Google. Sem isso, "URL secreta" dura ate alguem colar o link em algum
 *    lugar que um crawler leia.
 *  - `Referrer-Policy: no-referrer`, para o proprio endereco nao ir embutido no
 *    cabecalho quando o cliente clica num link de dentro do transcript.
 *  - CSP sem `script-src`: o transcript gerado pelo bot nao tem JavaScript
 *    nenhum, entao o navegador pode recusar qualquer script. E a segunda linha
 *    de defesa depois do escape que o `TranscriptService` ja faz.
 *  - `nosniff`, para o navegador nao reinterpretar o tipo do arquivo.
 */

/** Slug aceito: so o formato que o bot gera. Barra path traversal e chave torta. */
const SLUG = /^[a-z0-9][a-z0-9-]{7,63}$/;

/**
 * Endereco de anexo: 32 hex, com extensao OPCIONAL.
 *
 * A extensao e decorativa — o objeto e gravado e lido so pelos 32 hex, entao
 * `/a/<id>` e `/a/<id>.png` servem o mesmo arquivo e os enderecos antigos
 * continuam valendo. Ela existe porque o portfolio de lobos publica o render
 * como URL quando ele passa do limite de anexo do Discord, e um endereco
 * terminado em `.png` e o que faz o Discord tratar o link como imagem sem
 * depender so do content-type.
 *
 * O que NAO muda: a extensao nao escolhe o tipo servido. Quem decide continua
 * sendo o `x-asset-type` gravado no upload, filtrado por `INLINE_TYPES`.
 */
const ASSET_PATH = /^([a-f0-9]{32})(?:\.[a-z0-9]{2,5})?$/;

/**
 * Tipos servidos INLINE. Todo o resto vira download.
 *
 * Anexo e arquivo que um estranho mandou no ticket. Devolver o content-type que
 * ele declarou seria deixar qualquer pessoa publicar HTML executavel neste
 * dominio — o mesmo dominio dos transcripts. A lista abaixo e a unica excecao:
 * formatos de imagem que o navegador nao trata como documento, e que existem
 * para o comprovante aparecer dentro da conversa em vez de virar um link.
 */
const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

/**
 * Nome de arquivo seguro para o cabecalho `content-disposition`.
 *
 * O nome vem do Discord, ou seja, de quem enviou o arquivo. Aspas e quebras de
 * linha ali dentro quebrariam o cabecalho (e permitiriam injetar outros); o
 * filtro deixa passar so o que e inequivocamente nome de arquivo.
 */
function safeFilename(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^[._ ]+/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'anexo';
}

const SECURITY_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  /*
   * `style-src 'unsafe-inline'` e necessario: o transcript embute o CSS no
   * proprio documento para ser um arquivo unico, que abre sem rede. `img-src`
   * liberado em https por causa dos avatares do Discord. Nenhuma diretiva de
   * script — o documento nao tem nenhum.
   */
  'content-security-policy':
    "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:; base-uri 'none'; form-action 'none'",
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Comparacao em tempo constante.
 *
 * `===` em string vaza o tamanho do prefixo correto pelo tempo de resposta. O
 * risco e pequeno num token longo, mas o custo de fazer certo tambem e.
 */
function tokenMatches(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < received.length; i += 1) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const INFLUENCER_PLATFORMS = new Set(['TikTok', 'Instagram', 'YouTube', 'Twitch']);
const INFLUENCER_FORM_LIMIT = 20_000;
const INFLUENCER_RETRY_MS = 24 * 60 * 60 * 1000;

function compactText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function publicHtml(body, options = {}) {
  return new Response(body, {
    status: options.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'cache-control': options.cache ?? 'no-store',
    },
  });
}

function influencerResult(ok, title, message, status) {
  return publicHtml(renderInfluencerResult(ok, title, message), { status });
}

function normalizeProfileLinks(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 8) return { valid: false, value: '' };

  const normalized = [];
  for (const line of lines) {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(line) ? line : `https://${line}`;
    try {
      const parsed = new URL(candidate);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.hostname.length === 0) {
        return { valid: false, value: '' };
      }
      normalized.push(parsed.href);
    } catch {
      return { valid: false, value: '' };
    }
  }

  return { valid: true, value: normalized.join('\n') };
}

async function handleInfluencerApplication(request, env, url) {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== url.origin) {
    return influencerResult(false, 'Origem não autorizada', 'Reabra o formulário pelo site oficial da Vook Store.', 403);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > INFLUENCER_FORM_LIMIT) {
    return influencerResult(false, 'Inscrição muito extensa', 'Revise as respostas e tente novamente com textos mais curtos.', 413);
  }

  if (
    typeof env.DISCORD_BOT_TOKEN !== 'string' ||
    env.DISCORD_BOT_TOKEN.length === 0 ||
    !DISCORD_SNOWFLAKE.test(String(env.INFLUENCER_APPROVAL_CHANNEL_ID ?? ''))
  ) {
    return influencerResult(false, 'Inscrições temporariamente indisponíveis', 'A integração com o Discord ainda não foi configurada. Tente novamente mais tarde.', 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return influencerResult(false, 'Formulário inválido', 'Não foi possível ler sua inscrição. Atualize a página e tente novamente.', 400);
  }

  // Campo invisível: bots genéricos costumam preenchê-lo; pessoas não o veem.
  if (compactText(form.get('website'), 200).length > 0) {
    return influencerResult(true, 'Inscrição recebida', 'Recebemos suas informações para análise.', 200);
  }

  const discordId = compactText(form.get('discordId'), 20);
  const discordUsername = compactText(form.get('discordUsername'), 40);
  const creatorName = compactText(form.get('creatorName'), 60);
  const age = Number(compactText(form.get('age'), 3));
  const rawProfileLinks = compactText(form.get('profileLinks'), 900);
  const audience = compactText(form.get('audience'), 80) || 'Não informado';
  const rpExperience = compactText(form.get('rpExperience'), 100);
  const motivation = compactText(form.get('motivation'), 1200);
  const consent = form.get('consent') === 'yes';
  const platforms = [...new Set(form.getAll('platforms').map((value) => compactText(value, 20)))]
    .filter((value) => INFLUENCER_PLATFORMS.has(value));

  const normalizedProfiles = normalizeProfileLinks(rawProfileLinks);
  const invalidFields = [];
  if (!DISCORD_SNOWFLAKE.test(discordId)) invalidFields.push('ID do Discord');
  if (discordUsername.length < 2) invalidFields.push('usuário do Discord');
  if (creatorName.length < 2) invalidFields.push('nome de creator');
  if (!Number.isInteger(age) || age < 18 || age > 99) invalidFields.push('idade');
  if (platforms.length === 0) invalidFields.push('plataformas');
  if (!normalizedProfiles.valid) invalidFields.push('links dos perfis');
  if (rpExperience.length < 2) invalidFields.push('experiência com RP');
  if (motivation.length < 2) invalidFields.push('motivação');
  if (!consent) invalidFields.push('confirmação final');

  if (invalidFields.length > 0) {
    return influencerResult(
      false,
      'Revise sua inscrição',
      `Verifique os seguintes campos: ${invalidFields.join(', ')}.`,
      400,
    );
  }

  const profileLinks = normalizedProfiles.value;

  const markerKey = `influencers/by-discord/${discordId}.json`;
  const previous = await env.TRANSCRIPTS.get(markerKey);
  if (previous !== null) {
    try {
      const prior = JSON.parse(await previous.text());
      if (Date.now() - Number(prior.submittedAt ?? 0) < INFLUENCER_RETRY_MS) {
        return influencerResult(false, 'Inscrição já enviada', 'Já recebemos uma inscrição deste ID nas últimas 24 horas. Aguarde a análise da equipe.', 409);
      }
    } catch {
      // Marcador antigo ou corrompido: uma nova inscrição válida pode substituí-lo.
    }
  }

  const applicationId = crypto.randomUUID().replace(/-/g, '');
  const submittedAt = Date.now();
  const applicationKey = `influencers/applications/${applicationId}.json`;
  const application = {
    id: applicationId,
    discordId,
    discordUsername,
    creatorName,
    age,
    platforms,
    profileLinks,
    audience,
    rpExperience,
    motivation,
    status: 'pending',
    submittedAt,
  };

  await Promise.all([
    env.TRANSCRIPTS.put(applicationKey, JSON.stringify(application), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    }),
    env.TRANSCRIPTS.put(markerKey, JSON.stringify({ applicationId, submittedAt }), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    }),
  ]);

  const discordResponse = await fetch(
    `https://discord.com/api/v10/channels/${env.INFLUENCER_APPROVAL_CHANNEL_ID}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: 'NOVA INSCRIÇÃO — CREATOR VOOK',
            description: `Uma nova inscrição foi enviada pelo site.\n\n**Motivação**\n${motivation}`,
            color: 0xffffff,
            fields: [
              { name: 'Creator', value: creatorName, inline: true },
              { name: 'Discord', value: `${discordUsername}\n\`${discordId}\``, inline: true },
              { name: 'Idade', value: String(age), inline: true },
              { name: 'Plataformas', value: platforms.join(', '), inline: true },
              { name: 'Audiência', value: audience, inline: true },
              { name: 'Experiência em RP', value: rpExperience, inline: true },
              { name: 'Perfis', value: profileLinks },
            ],
            footer: { text: `Inscrição ${applicationId}` },
            timestamp: new Date(submittedAt).toISOString(),
          },
        ],
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 3, label: 'Aprovar', custom_id: `influencer:approve:${discordId}` },
              { type: 2, style: 4, label: 'Reprovar', custom_id: `influencer:reject:${discordId}` },
            ],
          },
        ],
      }),
    },
  );

  if (!discordResponse.ok) {
    await Promise.all([
      env.TRANSCRIPTS.delete(applicationKey),
      env.TRANSCRIPTS.delete(markerKey),
    ]);
    return influencerResult(false, 'Não foi possível enviar', 'A comunicação com o Discord falhou. Nenhuma inscrição foi registrada; tente novamente em alguns minutos.', 502);
  }

  const discordMessage = await discordResponse.json();
  application.messageId = discordMessage.id;
  await env.TRANSCRIPTS.put(applicationKey, JSON.stringify(application), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  return influencerResult(true, 'Inscrição enviada', 'Sua inscrição chegou à equipe Vook Store. Você receberá o resultado por mensagem direta do nosso bot no Discord.', 201);
}

/**
 * Anexos dos tickets, re-hospedados.
 *
 * POR QUE EXISTE. A URL de anexo do Discord expira em poucas horas. Um
 * transcript de ontem ja abria com imagem quebrada e link morto — justamente o
 * comprovante que a equipe precisa reler meses depois. Guardar uma copia aqui e
 * a unica forma de o documento continuar completo.
 *
 * O anexo herda a privacidade do transcript: endereco de 128 bits, fora do
 * indice, sem referrer. Mas ele e conteudo enviado por terceiros, entao ganha
 * duas travas que o transcript nao precisa: o content-type e reescrito pelo
 * servidor (nunca o declarado no upload) e tudo que nao for imagem sai como
 * download, com `sandbox` na CSP.
 */
async function handleAsset(request, env, url) {
  const match = ASSET_PATH.exec(url.pathname.slice('/a/'.length));
  if (match === null) return new Response('endereco invalido', { status: 400 });

  const id = match[1];
  const key = `a/${id}`;

  if (request.method === 'PUT') {
    const auth = request.headers.get('authorization') ?? '';
    if (!tokenMatches(auth, `Bearer ${env.UPLOAD_TOKEN}`)) {
      return json(401, { error: 'nao autorizado' });
    }

    /*
     * Nome e tipo vao para `customMetadata`, nao para `httpMetadata`: o GET
     * monta os cabecalhos do zero a partir deles, filtrando. Se fossem
     * httpMetadata, um objeto gravado por outro caminho (o console do R2, por
     * exemplo) poderia ser servido com o content-type que quisesse.
     */
    await env.TRANSCRIPTS.put(key, request.body, {
      customMetadata: {
        name: safeFilename(request.headers.get('x-asset-name')),
        type: String(request.headers.get('x-asset-type') ?? '').slice(0, 80),
      },
    });

    return json(200, { url: `${url.origin}/a/${id}` });
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const object = await env.TRANSCRIPTS.get(key);
    if (object === null) return new Response('anexo nao encontrado', { status: 404 });

    const meta = object.customMetadata ?? {};
    const name = safeFilename(meta.name);
    const inline = INLINE_TYPES.has(meta.type);

    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        // Tipo decidido AQUI. O que veio no upload so escolhe entre a lista
        // branca e o generico; nunca chega cru ao navegador.
        'content-type': inline ? meta.type : 'application/octet-stream',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex, nofollow, noarchive',
        // `sandbox` sem valores: mesmo que algo escape do content-type, o
        // conteudo roda numa origem opaca, sem script e sem acesso a nada.
        'content-security-policy': "default-src 'none'; sandbox",
        // Anexo nunca muda depois de gravado.
        'cache-control': 'public, max-age=31536000, immutable',
        etag: object.httpEtag,
      },
    });
  }

  if (request.method === 'DELETE') {
    const auth = request.headers.get('authorization') ?? '';
    if (!tokenMatches(auth, `Bearer ${env.UPLOAD_TOKEN}`)) {
      return json(401, { error: 'nao autorizado' });
    }
    await env.TRANSCRIPTS.delete(key);
    return json(200, { deleted: id });
  }

  return new Response('metodo nao permitido', { status: 405 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * O transcript continua fora do indice; os documentos juridicos entram.
     * "URL secreta" so vale enquanto nenhum robo a publica, e um `Disallow`
     * generico aqui manteria os Termos invisiveis para quem procura por eles.
     */
    if (url.pathname === '/robots.txt') {
      const body =
        'User-agent: *\n' +
        'Disallow: /t/\n' +
        'Disallow: /a/\n' +
        LEGAL_SLUGS.map((slug) => `Allow: /${slug}\n`).join('') +
        `Allow: /${INFLUENCER_SLUG}\n` +
        '\n';
      return new Response(body, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (url.pathname === '/api/influenciadores') {
      if (request.method !== 'POST') {
        return new Response('metodo nao permitido', {
          status: 405,
          headers: { allow: 'POST' },
        });
      }
      return handleInfluencerApplication(request, env, url);
    }

    // --- Paginas juridicas publicas ---
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (url.pathname === '/') {
        return Response.redirect(`${url.origin}/${LEGAL_SLUGS[0]}`, 302);
      }

      const publicPage =
        renderLegalPage(url.pathname.slice(1)) ??
        renderInfluencerPage(url.pathname.slice(1));
      if (publicPage !== null) {
        const isInfluencerPage = url.pathname === `/${INFLUENCER_SLUG}`;
        return new Response(request.method === 'HEAD' ? null : publicPage, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'strict-origin-when-cross-origin',
            /*
             * Sem `script-src`: o documento nao tem JavaScript, entao o
             * navegador pode recusar qualquer um. Mesma politica do transcript.
             */
            'content-security-policy':
              "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; " +
              `font-src https:; base-uri 'none'; form-action ${isInfluencerPage ? "'self'" : "'none'"}; ` +
              "frame-ancestors 'none'",
            /*
             * Cache curto e revalidavel: documento juridico muda raramente, mas
             * quando muda a versao velha nao pode ficar presa no navegador de
             * quem ja visitou — e o texto vigente tem valor legal.
             */
            'cache-control': 'public, max-age=300, must-revalidate',
          },
        });
      }
    }

    // --- Anexos re-hospedados ---
    if (url.pathname.startsWith('/a/')) {
      return handleAsset(request, env, url);
    }

    if (!url.pathname.startsWith('/t/')) {
      return new Response('nao encontrado', { status: 404 });
    }

    const slug = url.pathname.slice('/t/'.length);
    if (!SLUG.test(slug)) return new Response('endereco invalido', { status: 400 });

    if (request.method === 'PUT') {
      const auth = request.headers.get('authorization') ?? '';
      if (!tokenMatches(auth, `Bearer ${env.UPLOAD_TOKEN}`)) {
        return json(401, { error: 'nao autorizado' });
      }

      /*
       * `httpMetadata` e gravado no objeto, mas a resposta do GET define os
       * cabecalhos de novo: assim um objeto enviado por outro caminho (console
       * do R2, por exemplo) nao consegue ser servido com content-type proprio.
       */
      await env.TRANSCRIPTS.put(slug, request.body, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      });

      return json(200, { url: `${url.origin}/t/${slug}` });
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = await env.TRANSCRIPTS.get(slug);
      if (object === null) {
        return new Response('Este transcript nao existe ou expirou.', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' },
        });
      }

      return new Response(request.method === 'HEAD' ? null : object.body, {
        headers: {
          ...SECURITY_HEADERS,
          // Transcript nunca muda depois de gravado: cache agressivo e de graca.
          'cache-control': 'public, max-age=31536000, immutable',
          etag: object.httpEtag,
        },
      });
    }

    if (request.method === 'DELETE') {
      const auth = request.headers.get('authorization') ?? '';
      if (!tokenMatches(auth, `Bearer ${env.UPLOAD_TOKEN}`)) {
        return json(401, { error: 'nao autorizado' });
      }
      await env.TRANSCRIPTS.delete(slug);
      return json(200, { deleted: slug });
    }

    return new Response('metodo nao permitido', { status: 405 });
  },
};
