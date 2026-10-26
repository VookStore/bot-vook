"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canReadWithOcr = canReadWithOcr;
exports.readReceiptText = readReceiptText;
exports.shutdownOcr = shutdownOcr;
const node_path_1 = require("node:path");
const tesseract_js_1 = require("tesseract.js");
const Logger_1 = require("../../../core/logger/Logger");
/**
 * OCR do comprovante.
 *
 * MODELO VENDORIZADO: o `tesseract.js` baixa o modelo de idioma de um CDN na
 * primeira execucao. Num fluxo que envolve dinheiro isso e frágil — a primeira
 * conferencia do dia dependeria de rede externa. O `por.traineddata` fica em
 * `assets/ocr/` e o worker e configurado para ler dali.
 *
 * WORKER REAPROVEITADO: subir um worker custa ~350 ms e memoria. Um so, criado
 * sob demanda e mantido vivo, atende o volume de uma loja com folga.
 *
 * ESTE SERVICO NAO DECIDE NADA. Ele devolve texto. Quem compara com a cobranca
 * e o `receiptParser`, e quem aprova a cobranca continua sendo uma pessoa.
 */
const logger = (0, Logger_1.createLogger)('order:ocr');
/** Onde mora o modelo vendorizado (relativo a raiz do projeto). */
const OCR_ASSETS = (0, node_path_1.join)('assets', 'ocr');
const LANGUAGE = 'por';
/** Teto de tempo do reconhecimento: comprovante nao pode travar o handler. */
const RECOGNIZE_TIMEOUT_MS = 30_000;
/** Tipos que o OCR consegue processar. PDF fica de fora de proposito. */
const READABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
let workerPromise = null;
function canReadWithOcr(contentType) {
    return READABLE_TYPES.has(contentType.toLowerCase());
}
async function getWorker() {
    if (workerPromise === null) {
        workerPromise = (0, tesseract_js_1.createWorker)(LANGUAGE, 1, {
            langPath: OCR_ASSETS,
            cachePath: OCR_ASSETS,
            // O modelo vendorizado nao esta comprimido.
            gzip: false,
        }).catch((error) => {
            // Nao guarda a promessa quebrada: a proxima tentativa recomeca do zero.
            workerPromise = null;
            throw error;
        });
    }
    return workerPromise;
}
/**
 * Le o texto do comprovante. Devolve `null` quando o OCR falha — o chamador
 * trata como "ilegivel" e manda para conferencia manual, jamais como recusa.
 */
async function readReceiptText(bytes) {
    const startedAt = Date.now();
    try {
        const worker = await getWorker();
        const recognized = await Promise.race([
            worker.recognize(bytes),
            new Promise((_resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('OCR excedeu o tempo limite.')), RECOGNIZE_TIMEOUT_MS);
                timer.unref?.();
            }),
        ]);
        const text = recognized.data.text ?? '';
        logger.debug('Comprovante processado pelo OCR.', {
            elapsedMs: Date.now() - startedAt,
            characters: text.length,
        });
        return text;
    }
    catch (error) {
        logger.warn('Falha no OCR do comprovante; seguira para conferencia manual.', {
            elapsedMs: Date.now() - startedAt,
            detail: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
/** Encerra o worker (shutdown gracioso e testes). */
async function shutdownOcr() {
    if (workerPromise === null)
        return;
    const pending = workerPromise;
    workerPromise = null;
    try {
        const worker = await pending;
        await worker.terminate();
    }
    catch {
        // Worker que nunca subiu direito nao precisa ser encerrado.
    }
}
//# sourceMappingURL=ReceiptOcrService.js.map