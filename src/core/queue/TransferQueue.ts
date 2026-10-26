/**
 * Fila das transferencias grandes, uma por servidor.
 *
 * FILA, E NAO LOCK. O lock da casa (`LockService`) recusa quem chega com o
 * recurso ocupado — o certo para clique duplo. Aqui seria o errado: os dois
 * chamadores nascem de um FORMULARIO, e o modal do Discord nao guarda nada.
 * "Aguarde e envie de novo" custaria digitar tudo e anexar o arquivo outra vez.
 * Na fila, o segundo espera o primeiro terminar e sai sozinho — a interacao ja
 * esta deferida e aguenta 15 minutos.
 *
 * POR QUE UMA FILA SO PARA O BOT INTEIRO. O que ela protege e MEMORIA, e
 * memoria e do processo, nao do recurso: o arquivo e baixado inteiro e o
 * discord.js faz mais uma copia para reenviar (medido em +208 MB de RSS para
 * 100 MiB, num processo que o PM2 reinicia em 512 MB). Um post de lobo cabe;
 * um post de lobo mais uma entrega de produto ao mesmo tempo, nao. Enquanto
 * cada modulo tinha a sua fila, os dois podiam rodar juntos e derrubar o bot.
 *
 * O QUE ELA NAO COBRE: a chave e o servidor, entao duas guilds transferindo ao
 * mesmo tempo continuam somando memoria. E deliberado — serializar guilds
 * diferentes faria uma loja esperar pela outra —, e o teto de 100 MB por
 * arquivo existe justamente para essa soma ainda caber.
 *
 * Nenhuma tarefa espera para sempre: download e reenvio tem prazo proprio
 * (`transferTimeoutMs`, e 5 min no cliente de anexo grande).
 */

const queues = new Map<string, Promise<unknown>>();

export function enqueueTransfer<T>(guildId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(guildId) ?? Promise.resolve();
  // Roda depois do anterior, tenha ele dado certo ou nao: uma transferencia que
  // falhou nao pode travar as seguintes.
  const run = previous.then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(guildId, settled);
  // Fila vazia sai do mapa, para ele nao crescer com servidores inativos.
  void settled.then(() => {
    if (queues.get(guildId) === settled) queues.delete(guildId);
  });
  return run;
}
