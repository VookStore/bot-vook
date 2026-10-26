import { TRANSCRIPT_RETENTION } from '../../../constants/limits';
import { getEnv } from '../../../config/env';
import { getPrisma } from '../../../core/database/prisma';
import { createLogger } from '../../../core/logger/Logger';
import {
  deleteHostedAsset,
  deleteHostedTranscript,
  slugFromTranscriptUrl,
} from './TranscriptHostingService';

/**
 * Retencao dos transcripts hospedados.
 *
 * POR QUE EXISTE. Cada ticket fechado deixa no R2 um HTML com a conversa
 * inteira — nome do cliente, o que ele disse, prints que enviou e, quando houve
 * pagamento, comprovante com dado bancario. Isso ficava la para sempre, e a
 * unica barreira de leitura e o endereco secreto. Um acervo que so cresce e de
 * onde nada nunca sai e risco puro: nao acrescenta nada a operacao depois de
 * alguns meses e piora todo incidente que venha a acontecer.
 *
 * DESLIGADO POR PADRAO. Sem `TRANSCRIPT_RETENTION_DAYS` no ambiente, nada e
 * apagado. Apagar registro de cliente por conta propria, so porque a
 * funcionalidade existe, seria decidir no lugar do operador uma coisa que ele
 * pode ter obrigacao legal de manter.
 *
 * O TICKET SOBREVIVE. So o conteudo hospedado e removido; a linha no banco
 * continua com numero, cliente, categoria, motivo do encerramento e valores. O
 * historico comercial nao e afetado — o que sai e a transcricao da conversa.
 *
 * ANEXOS SAO APAGADOS JUNTO. Sao a parte mais sensivel e vivem em chaves
 * aleatorias no R2; sem os ids guardados em `transcriptAssetIds`, apagar o HTML
 * deixaria os arquivos orfaos e ilocalizaveis para sempre. Tickets fechados
 * antes dessa coluna existir nao tem ids — o HTML deles sai, os anexos ficam.
 */

const logger = createLogger('ticket:retention');

export interface RetentionResult {
  /** Tickets cujo transcript foi removido por completo. */
  purged: number;
  /** Objetos de anexo removidos. */
  assets: number;
  /** Tickets que falharam e serao tentados de novo na proxima rodada. */
  failed: number;
}

/** Dias de retencao configurados; `null` quando desligado. */
export function retentionDays(): number | null {
  const days = getEnv().TRANSCRIPT_RETENTION_DAYS;
  return days > 0 ? days : null;
}

/**
 * Apaga os transcripts vencidos.
 *
 * O registro do ticket so e limpo DEPOIS de a hospedagem confirmar a remocao.
 * Na ordem inversa, uma falha de rede deixaria o banco dizendo "nao ha
 * transcript" com o arquivo ainda publicado — o pior dos dois mundos, porque
 * ninguem voltaria para apaga-lo.
 */
export async function purgeExpiredTranscripts(now: Date = new Date()): Promise<RetentionResult> {
  const days = retentionDays();
  if (days === null) return { purged: 0, assets: 0, failed: 0 };

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const db = getPrisma();

  const expired = await db.ticket.findMany({
    where: { transcriptUrl: { not: null }, closedAt: { lte: cutoff } },
    select: { id: true, guildId: true, transcriptUrl: true, transcriptAssetIds: true },
    orderBy: { closedAt: 'asc' },
    take: TRANSCRIPT_RETENTION.BATCH,
  });

  let purged = 0;
  let assets = 0;
  let failed = 0;

  for (const ticket of expired) {
    if (ticket.transcriptUrl === null) continue;

    const slug = slugFromTranscriptUrl(ticket.transcriptUrl);
    if (slug === null) {
      /*
       * URL de outra hospedagem (o operador trocou o dominio, por exemplo).
       * Nao da para apagar o que nao sabemos endereçar, e insistir faria este
       * ticket ocupar o lote de todas as rodadas seguintes — entao a referencia
       * e limpa e o registro do ticket segue intacto.
       */
      await db.ticket.update({
        where: { id: ticket.id },
        data: { transcriptUrl: null, transcriptAssetIds: [] },
      });
      logger.warn('Transcript com endereco desconhecido; referencia limpa sem remover.', {
        guildId: ticket.guildId,
        entityType: 'ticket',
        entityId: ticket.id,
      });
      continue;
    }

    // Anexos primeiro: se algo falhar no meio, o HTML permanece e a proxima
    // rodada reencontra o ticket pelo mesmo filtro.
    let assetsOk = true;
    for (const assetId of ticket.transcriptAssetIds) {
      if (await deleteHostedAsset(assetId)) assets += 1;
      else assetsOk = false;
    }

    if (!assetsOk || !(await deleteHostedTranscript(slug))) {
      failed += 1;
      continue;
    }

    await db.ticket.update({
      where: { id: ticket.id },
      data: { transcriptUrl: null, transcriptAssetIds: [] },
    });
    purged += 1;
  }

  if (purged > 0 || failed > 0) {
    logger.info('Retencao de transcripts executada.', { purged, assets, failed, days });
  }

  return { purged, assets, failed };
}
