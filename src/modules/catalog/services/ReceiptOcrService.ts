import { join } from 'node:path';

import { createWorker, type Worker } from 'tesseract.js';

import { createLogger } from '../../../core/logger/Logger';

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

const logger = createLogger('order:ocr');

/** Onde mora o modelo vendorizado (relativo a raiz do projeto). */
const OCR_ASSETS = join('assets', 'ocr');

const LANGUAGE = 'por';

/** Teto de tempo do reconhecimento: comprovante nao pode travar o handler. */
const RECOGNIZE_TIMEOUT_MS = 30_000;

/** Tipos que o OCR consegue processar. PDF fica de fora de proposito. */
const READABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

let workerPromise: Promise<Worker> | null = null;

export function canReadWithOcr(contentType: string): boolean {
  return READABLE_TYPES.has(contentType.toLowerCase());
}

async function getWorker(): Promise<Worker> {
  if (workerPromise === null) {
    workerPromise = createWorker(LANGUAGE, 1, {
      langPath: OCR_ASSETS,
      cachePath: OCR_ASSETS,
      // O modelo vendorizado nao esta comprimido.
      gzip: false,
    }).catch((error: unknown) => {
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
export async function readReceiptText(bytes: Buffer): Promise<string | null> {
  const startedAt = Date.now();

  try {
    const worker = await getWorker();

    const recognized = await Promise.race([
      worker.recognize(bytes),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('OCR excedeu o tempo limite.')),
          RECOGNIZE_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);

    const text = recognized.data.text ?? '';
    logger.debug('Comprovante processado pelo OCR.', {
      elapsedMs: Date.now() - startedAt,
      characters: text.length,
    });
    return text;
  } catch (error) {
    logger.warn('Falha no OCR do comprovante; seguira para conferencia manual.', {
      elapsedMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Encerra o worker (shutdown gracioso e testes). */
export async function shutdownOcr(): Promise<void> {
  if (workerPromise === null) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Worker que nunca subiu direito nao precisa ser encerrado.
  }
}
