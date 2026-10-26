/**
 * Tipos do transcript de atendimento.
 *
 * Estes tipos sao deliberadamente independentes de discord.js: a renderizacao
 * do HTML e uma funcao pura sobre dados simples, o que permite testar a camada
 * de seguranca (escape) sem instanciar um Client do Discord.
 */

/** Autor de uma mensagem, ja resolvido para dados simples. */
export interface TranscriptAuthor {
  id: string;
  username: string;
  /** Apelido no servidor quando existir; caso contrario o username. */
  displayName: string;
  /** URL do avatar. Pode ser nula — nesse caso o HTML usa um placeholder textual. */
  avatarUrl: string | null;
  isBot: boolean;
}

/** Anexo de uma mensagem. */
export interface TranscriptAttachment {
  name: string;
  /** Endereco original no CDN do Discord. EXPIRA em poucas horas. */
  url: string;
  /** Tamanho em bytes informado pelo Discord. */
  size: number;
  contentType: string | null;
  /**
   * Copia re-hospedada no mesmo dominio do transcript.
   *
   * A URL do Discord em `url` morre junto com a assinatura que ela carrega — um
   * transcript de ontem ja abre com o comprovante quebrado. Quando o
   * espelhamento funciona, e este endereco que vai para o HTML, e so imagem
   * espelhada e desenhada de fato na conversa.
   *
   * `null`/ausente quando nao ha hospedagem configurada, quando o arquivo passou
   * do teto de tamanho ou quando a copia falhou. O transcript continua valido:
   * cai no link original e avisa que ele expira.
   */
  hostedUrl?: string | null;
}

/** Mensagem normalizada pronta para renderizacao. */
export interface TranscriptMessage {
  id: string;
  author: TranscriptAuthor;
  createdAt: Date;
  content: string;
  attachments: TranscriptAttachment[];
  /** Quantidade de embeds — o conteudo dos embeds nao e renderizado. */
  embedCount: number;
  /** Id da mensagem respondida, quando esta e uma resposta. */
  replyToId: string | null;
  /** Nome do autor respondido, quando resolvivel pelo cache do canal. */
  replyToAuthorName: string | null;
  editedAt: Date | null;
}

/** Cabecalho do transcript: metadados do atendimento encerrado. */
export interface TranscriptHeader {
  storeName: string;
  ticketNumber: number;
  categoryName: string;
  subject: string;
  ownerId: string;
  ownerName: string;
  staffId: string | null;
  staffName: string | null;
  closedById: string | null;
  closedByName: string | null;
  participants: Array<{ id: string; name: string }>;
  openedAt: Date;
  closedAt: Date;
  closeReason: string | null;
  /** Duracao total do atendimento em milissegundos. */
  durationMs: number;
}
