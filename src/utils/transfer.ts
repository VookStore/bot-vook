const MIB = 1024 * 1024;

/**
 * Transferencia de arquivo grande: as contas que valem para qualquer arquivo.
 *
 * Nasceram no portfolio de lobos e passaram a ser usadas tambem pela entrega de
 * produto no ticket. Nao ha nada de imagem nem de zip aqui — so tamanho e
 * tempo —, e manter duas copias faria a segunda envelhecer sozinha.
 */

/** "100 MB" — derivado do limite, para o texto nunca divergir da regra. */
export function describeMaxSize(maxBytes: number): string {
  return `${Math.floor(maxBytes / MIB)} MB`;
}

/**
 * Prazo para baixar OU reenviar um arquivo, proporcional ao tamanho.
 *
 * O cliente do Discord desiste de qualquer chamada em 15 s — mais que o
 * suficiente para mensagem, e pouco para 100 MB: exigiria mais de 50 Mbps de
 * upload. 20 s de base mais 2 s por MB cobre ~0,5 MB/s, que e conexao ruim de
 * verdade; o teto de 5 min impede que uma transferencia travada segure a fila
 * (e a memoria) indefinidamente.
 */
export function transferTimeoutMs(bytes: number): number {
  return Math.min(5 * 60_000, 20_000 + Math.ceil(bytes / MIB) * 2_000);
}
