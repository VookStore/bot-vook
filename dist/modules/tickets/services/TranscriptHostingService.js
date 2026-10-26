"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTranscriptSlug = buildTranscriptSlug;
exports.isTranscriptHostingEnabled = isTranscriptHostingEnabled;
exports.publishTranscript = publishTranscript;
exports.mirrorTranscriptAttachments = mirrorTranscriptAttachments;
exports.slugFromTranscriptUrl = slugFromTranscriptUrl;
exports.assetIdFromUrl = assetIdFromUrl;
exports.deleteHostedTranscript = deleteHostedTranscript;
exports.deleteHostedAsset = deleteHostedAsset;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../../../config/env");
const Logger_1 = require("../../../core/logger/Logger");
const AssetHostingService_1 = require("../../hosting/AssetHostingService");
/**
 * Publicacao do transcript num endereco proprio.
 *
 * O transcript ja era gerado como HTML auto-contido e ia como ANEXO no canal de
 * logs. O anexo tem dois problemas que uma URL resolve: ele e cortado pela
 * metade repetidamente para caber nos 20 MiB do Discord, e o cliente nao recebe
 * copia nenhuma — so a equipe.
 *
 * OPCIONAL POR CONSTRUCAO. Sem `TRANSCRIPT_BASE_URL` no ambiente, `publish`
 * devolve `null` e o fechamento segue exatamente como antes. Isso mantem o bot
 * rodando em quem nao configurou hospedagem nenhuma.
 *
 * NUNCA DERRUBA O FECHAMENTO. Falha de rede, Worker fora do ar ou token errado
 * viram `null` com warning: o ticket precisa fechar de qualquer jeito, e o
 * anexo no log continua sendo a copia de seguranca.
 */
const logger = (0, Logger_1.createLogger)('ticket:transcript-host');
/** Teto de espera do upload. O fechamento ja segura um lock; nao pode pendurar. */
const UPLOAD_TIMEOUT_MS = 15_000;
/**
 * Endereco secreto.
 *
 * 20 bytes de aleatoriedade criptografica (~160 bits) em base36. A URL e a
 * UNICA barreira de leitura do transcript — que carrega nome de cliente, print
 * de conversa e as vezes comprovante — entao ela precisa ser inadivinhavel de
 * verdade, nao um id sequencial nem o numero do ticket.
 *
 * O numero do ticket entra como prefixo legivel so para a equipe reconhecer o
 * arquivo numa lista; ele nao reduz a entropia do resto.
 */
function buildTranscriptSlug(ticketNumber) {
    const random = (0, node_crypto_1.randomBytes)(20).toString('hex');
    return `t${String(Math.max(0, Math.trunc(ticketNumber))).padStart(4, '0')}-${random}`;
}
/** True quando ha hospedagem configurada. */
function isTranscriptHostingEnabled() {
    return (0, env_1.getEnv)().TRANSCRIPT_BASE_URL !== null;
}
/**
 * Envia o HTML e devolve a URL publica; `null` quando desligado ou ao falhar.
 */
async function publishTranscript(html, ticketNumber) {
    const { TRANSCRIPT_BASE_URL: base, TRANSCRIPT_UPLOAD_TOKEN: token } = (0, env_1.getEnv)();
    if (base === null || token === null)
        return null;
    const slug = buildTranscriptSlug(ticketNumber);
    const target = `${base}/t/${slug}`;
    try {
        const response = await fetch(target, {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'text/html; charset=utf-8',
            },
            body: html,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        if (!response.ok) {
            logger.warn('Hospedagem do transcript recusou o envio.', {
                entityType: 'ticket',
                entityId: String(ticketNumber),
                status: response.status,
            });
            return null;
        }
        logger.info('Transcript publicado.', {
            entityType: 'ticket',
            entityId: String(ticketNumber),
        });
        return target;
    }
    catch (error) {
        // Timeout, DNS, TLS, Worker fora do ar: nenhum deles pode impedir o
        // encerramento do atendimento.
        logger.warn('Falha ao publicar o transcript.', {
            entityType: 'ticket',
            entityId: String(ticketNumber),
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
/*
 * ---------------------------------------------------------------------------
 * Espelhamento dos anexos
 * ---------------------------------------------------------------------------
 *
 * A URL de anexo do Discord e assinada e expira em poucas horas. O transcript,
 * porem, e o documento que a equipe reabre semanas depois para conferir um
 * comprovante — e ele abria com a imagem quebrada e o link morto. Antes de
 * publicar o HTML, baixamos cada anexo e gravamos uma copia ao lado do
 * transcript, no mesmo Worker.
 *
 * TUDO AQUI E MELHOR-ESFORCO. Nenhuma falha de rede pode impedir um ticket de
 * fechar: o que nao for espelhado simplesmente mantem o link original, e o
 * transcript avisa que aquele link expira.
 */
/** Acima disto o arquivo nao e espelhado: segura o fechamento por tempo demais. */
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
/** Teto do ticket inteiro, para uma conversa cheia de midia nao virar meia hora de upload. */
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
/** Teto de arquivos por ticket. */
const MAX_ASSETS = 60;
/**
 * Orcamento total do espelhamento.
 *
 * O fechamento segura um lock e o usuario esta olhando para um "processando".
 * Estourado o tempo, o que sobrou fica com o link do Discord mesmo.
 */
const MIRROR_BUDGET_MS = 25_000;
/** Downloads simultaneos. Quatro satura a banda sem transformar isso num crawler. */
const MIRROR_CONCURRENCY = 4;
/** Teto por arquivo (download + upload contam separado). */
const ASSET_TIMEOUT_MS = 12_000;
/**
 * Baixa um anexo e grava a copia. Devolve a URL hospedada, ou `null`.
 *
 * O PROTOCOLO do Worker (rota, cabecalhos, token) mora em `AssetHostingService`
 * — aqui fica so o que e do transcript: baixar do CDN do Discord antes que o
 * link expire. O anexo do ticket sobe SEM extensao no endereco: quem o abre e
 * uma pessoa clicando no transcript, e a extensao so importa para o Discord
 * renderizar link como imagem (caso do portfolio de lobos).
 */
async function mirrorOne(attachment) {
    try {
        const source = await fetch(attachment.url, {
            signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
        });
        if (!source.ok)
            return null;
        return await (0, AssetHostingService_1.hostAsset)({
            bytes: await source.arrayBuffer(),
            name: attachment.name,
            contentType: attachment.contentType ?? '',
            timeoutMs: ASSET_TIMEOUT_MS,
        });
    }
    catch {
        // Timeout, CDN fora, token errado: o anexo fica com o link original.
        return null;
    }
}
/**
 * Devolve as mensagens com `hostedUrl` preenchido nos anexos que deram certo.
 *
 * Nao muta a entrada: o chamador continua com a lista original caso precise.
 * Sem hospedagem configurada, devolve uma copia rasa e nao toca na rede.
 */
async function mirrorTranscriptAttachments(messages) {
    const { TRANSCRIPT_BASE_URL: base, TRANSCRIPT_UPLOAD_TOKEN: token } = (0, env_1.getEnv)();
    if (base === null || token === null)
        return [...messages];
    /*
     * Fila achatada, na ordem da conversa. Os tetos sao aplicados AQUI, antes de
     * qualquer download: o tamanho ja vem do Discord, entao um arquivo grande
     * demais e descartado sem custo de rede.
     */
    const queue = [];
    let remaining = MAX_TOTAL_BYTES;
    for (const message of messages) {
        for (const attachment of message.attachments) {
            if (queue.length >= MAX_ASSETS)
                break;
            if (attachment.size > MAX_ASSET_BYTES || attachment.size > remaining)
                continue;
            remaining -= attachment.size;
            queue.push(attachment);
        }
        if (queue.length >= MAX_ASSETS)
            break;
    }
    if (queue.length === 0)
        return [...messages];
    const hosted = new Map();
    const deadline = Date.now() + MIRROR_BUDGET_MS;
    let cursor = 0;
    const drain = async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= queue.length || Date.now() >= deadline)
                return;
            const attachment = queue[index];
            if (attachment === undefined)
                return;
            const url = await mirrorOne(attachment);
            if (url !== null)
                hosted.set(attachment, url);
        }
    };
    await Promise.all(Array.from({ length: MIRROR_CONCURRENCY }, drain));
    if (hosted.size < queue.length) {
        logger.warn('Nem todos os anexos foram espelhados.', {
            total: queue.length,
            espelhados: hosted.size,
        });
    }
    return messages.map((message) => ({
        ...message,
        attachments: message.attachments.map((attachment) => {
            const url = hosted.get(attachment);
            return url === undefined ? attachment : { ...attachment, hostedUrl: url };
        }),
    }));
}
/*
 * ---------------------------------------------------------------------------
 * Remocao
 * ---------------------------------------------------------------------------
 *
 * O transcript e os anexos vivem indefinidamente no R2 e carregam nome de
 * cliente, print de conversa e as vezes comprovante bancario. Acumular isso
 * para sempre e uma exposicao que so cresce; o job de retencao usa as funcoes
 * abaixo para encerrar o ciclo.
 */
/** Slug de uma URL publicada, ou `null` quando ela nao e desta hospedagem. */
function slugFromTranscriptUrl(url) {
    const { TRANSCRIPT_BASE_URL: base } = (0, env_1.getEnv)();
    if (base === null || !url.startsWith(`${base}/t/`))
        return null;
    const slug = url.slice(`${base}/t/`.length);
    return /^[a-z0-9][a-z0-9-]{7,63}$/.test(slug) ? slug : null;
}
/** Id de anexo a partir da URL hospedada, ou `null`. */
function assetIdFromUrl(url) {
    const { TRANSCRIPT_BASE_URL: base } = (0, env_1.getEnv)();
    if (base === null || !url.startsWith(`${base}/a/`))
        return null;
    const id = url.slice(`${base}/a/`.length);
    return /^[a-f0-9]{32}$/.test(id) ? id : null;
}
/**
 * Apaga um objeto da hospedagem.
 *
 * Devolve `true` tambem quando o Worker responde 404: o objetivo e "isto nao
 * existe mais", e um arquivo ja ausente satisfaz o objetivo. Tratar 404 como
 * falha faria o job tentar para sempre o mesmo ticket.
 */
async function deleteHosted(path) {
    const { TRANSCRIPT_BASE_URL: base, TRANSCRIPT_UPLOAD_TOKEN: token } = (0, env_1.getEnv)();
    if (base === null || token === null)
        return false;
    try {
        const response = await fetch(`${base}${path}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        return response.ok || response.status === 404;
    }
    catch (error) {
        logger.warn('Falha ao remover objeto da hospedagem.', {
            path,
            detail: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
/** Apaga o HTML do transcript. */
async function deleteHostedTranscript(slug) {
    return deleteHosted(`/t/${slug}`);
}
/** Apaga um anexo re-hospedado. */
async function deleteHostedAsset(assetId) {
    return deleteHosted(`/a/${assetId}`);
}
//# sourceMappingURL=TranscriptHostingService.js.map