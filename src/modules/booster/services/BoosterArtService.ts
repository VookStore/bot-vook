import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AttachmentBuilder } from 'discord.js';

import { createLogger } from '../../../core/logger/Logger';

/**
 * Arte do anuncio de booster.
 *
 * A imagem vai como ANEXO da propria mensagem e o painel a referencia por
 * `attachment://`, em vez de apontar para uma URL do CDN do Discord.
 *
 * POR QUE NAO UMA URL. Link de anexo do Discord expira, e um anuncio fixo num
 * canal e exatamente o lugar onde isso da errado sem ninguem ver: a mensagem
 * fica meses no ar e um dia a imagem simplesmente some. Com o arquivo no
 * repositorio, toda republicacao reenvia a arte e ela nunca depende de um link
 * assinado.
 *
 * A BUSCA E TOLERANTE DE PROPOSITO. Quem arrasta um arquivo para a pasta nao
 * deveria precisar renomea-lo para o id da guild nem converte-lo para PNG. O
 * servico aceita varias extensoes e um nome generico; a versao anterior so
 * aceitava `<guildId>.png` e falhava calada quando o arquivo estava ali do lado
 * com outro nome.
 *
 * A ARTE E DECORACAO. Arquivo ausente ou ilegivel nao impede o anuncio de ser
 * publicado — ele so sai sem miniatura, e quem rodar `/booster previa` e avisado.
 */

const logger = createLogger('booster:art');

const ART_ROOT = join('assets', 'booster');

/** Extensoes aceitas, na ordem de preferencia. */
const EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg', 'gif'] as const;

/** Nome generico, para quem nao quer renomear o arquivo com o id da guild. */
const FALLBACK_NAME = 'booster';

export interface BoosterArt {
  attachment: AttachmentBuilder;
  /** Nome do anexo. E o que o painel referencia por `attachment://`. */
  filename: string;
}

/** Caminhos testados, do mais especifico para o mais generico. */
export function boosterArtCandidates(guildId: string): string[] {
  return [guildId, FALLBACK_NAME].flatMap((base) =>
    EXTENSIONS.map((extension) => join(ART_ROOT, `${base}.${extension}`)),
  );
}

interface CachedArt {
  buffer: Buffer;
  extension: string;
  /** Assinatura do arquivo em disco, para detectar troca sem reiniciar o bot. */
  signature: string;
}

/*
 * Cache com assinatura (caminho + mtime + tamanho) em vez de "cache ate o
 * restart".
 *
 * Trocar a arte e reiniciar o bot para ela aparecer e um passo que ninguem
 * lembra na hora — e o sintoma, uma imagem velha teimando, nao parece um
 * problema de cache. Com a assinatura, substituir o arquivo basta.
 *
 * Ausencia NAO e memorizada: quem acabou de largar o arquivo na pasta ve o
 * resultado no `/booster previa` seguinte.
 */
let cached: CachedArt | null = null;

/** Assinatura do arquivo, ou `null` quando ele nao existe. */
function signatureOf(path: string): string | null {
  try {
    const info = statSync(path);
    if (!info.isFile()) return null;
    return `${path}:${info.mtimeMs}:${info.size}`;
  } catch {
    return null;
  }
}

/**
 * Arte da guild, ou `null` quando nao ha arquivo.
 *
 * Um `AttachmentBuilder` NOVO a cada chamada, sobre o buffer em cache: a
 * discord.js consome o stream do anexo ao enviar, entao reaproveitar a mesma
 * instancia faria a segunda publicacao subir um arquivo vazio.
 */
export function boosterArt(guildId: string): BoosterArt | null {
  for (const path of boosterArtCandidates(guildId)) {
    const signature = signatureOf(path);
    if (signature === null) continue;

    if (cached === null || cached.signature !== signature) {
      try {
        const buffer = readFileSync(path);
        const extension = path.slice(path.lastIndexOf('.') + 1);
        cached = { buffer, extension, signature };
        logger.info('Arte do booster carregada.', {
          guildId,
          path,
          bytes: buffer.byteLength,
        });
      } catch (error) {
        logger.warn('Nao foi possivel ler a arte do booster.', {
          guildId,
          path,
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // A extensao acompanha o nome do anexo: o Discord decide como renderizar
    // pelo nome, e um `.png` mentindo sobre um JPEG nao abre.
    const filename = `${FALLBACK_NAME}.${cached.extension}`;
    return { attachment: new AttachmentBuilder(cached.buffer, { name: filename }), filename };
  }

  return null;
}

/** Somente para testes: esquece o que foi lido do disco. */
export function resetBoosterArtCache(): void {
  cached = null;
}
