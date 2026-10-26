/**
 * Backup do banco, sob demanda.
 *
 *   npm run backup            gera um dump agora, sempre
 *   npm run backup -- --due   gera so se o ultimo ja passou do prazo
 *
 * A LOGICA NAO MORA AQUI. Este arquivo e uma casca em volta do
 * `BackupService`, que e o mesmo modulo usado pelo job diario do bot. Duas
 * implementacoes de backup — uma no bot, outra num script — seriam duas
 * chances de divergir, e a divergencia so apareceria no dia da restauracao.
 *
 * Serve para dois casos: rodar um dump antes de uma migracao arriscada, e
 * agendar o backup pelo Agendador de Tarefas do Windows em vez de deixar por
 * conta do bot (util se o bot nao roda 24h).
 */

import { runDatabaseBackup, runBackupIfDue } from '../src/modules/system/services/BackupService';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'GB'}`;
}

async function main(): Promise<void> {
  const somenteSeVencido = process.argv.includes('--due');

  const resultado = somenteSeVencido ? await runBackupIfDue() : await runDatabaseBackup();

  if (resultado === null) {
    console.log('Backup ainda dentro do prazo; nada a fazer.');
    return;
  }

  console.log(`Backup gravado: ${resultado.file}`);
  console.log(
    `${formatBytes(resultado.bytes)} em ${(resultado.durationMs / 1000).toFixed(1)}s` +
      (resultado.removed > 0 ? ` · ${resultado.removed} dump(s) antigo(s) removido(s)` : ''),
  );
}

main().catch((error: unknown) => {
  // Saida diferente de zero: e o que faz o Agendador de Tarefas marcar a
  // execucao como falha em vez de "concluida com sucesso" sem backup nenhum.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
