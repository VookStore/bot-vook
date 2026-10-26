/**
 * Hierarquia de erros da aplicacao.
 *
 * Regra fundamental: `message` e tecnico (vai para o log) e `userMessage` e o
 * unico texto que pode ser exibido ao usuario final. Nenhum erro de
 * infraestrutura (Prisma, SQL, stack trace, token) pode vazar para o Discord.
 */

export interface AppErrorOptions {
  /** Codigo estavel usado em logs/metricas. */
  code?: string;
  /** Texto seguro exibido ao usuario final. */
  userMessage?: string;
  /** Contexto estruturado para logs (sera sanitizado antes de persistir). */
  context?: Record<string, unknown>;
  /** Erro original encadeado. */
  cause?: unknown;
  /**
   * True quando o erro e uma RECUSA de regra, e nao um defeito.
   *
   * Cada classe abaixo declara o proprio valor; quem lanca raramente precisa
   * mexer nisto. Ver o bloco em `AppError.expected` para a regra.
   */
  expected?: boolean;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly context: Record<string, unknown>;
  public override readonly cause?: unknown;

  /**
   * O erro e uma RECUSA de regra, ou um defeito?
   *
   * A LINHA E ESTA: o pedido foi recusado por uma regra de negocio (estado,
   * permissao, limite, validacao) — `expected` — contra o bot nao ter
   * CONSEGUIDO atender o pedido porque algo esta quebrado (configuracao
   * faltando, recurso do Discord sumido) — nao esperado.
   *
   * POR QUE MORA NA CLASSE, e nao numa lista dentro do tratador de erro. O
   * ramo "nao esperado" faz tres coisas: `logger.error` com stack, uma linha em
   * `system_error_logs` e um ALERTA no canal de erros. Enquanto a lista vivia
   * no tratador, ela cobria quatro classes e esquecia as outras doze — entao
   * clicar em "Aprovar" numa cobranca JA aprovada (o botao continua clicavel
   * ate o cartao ser reescrito, e o segundo clique e esperado) disparava
   * alerta de falha para o dono da loja. Alerta que ninguem pode consertar
   * ensina a ignorar o canal de alertas, e ai o alerta que importa passa
   * despercebido.
   *
   * O modulo de avaliacoes ja tinha contornado isso na mao, tratando
   * "ja avaliou" dentro do proprio handler. Com a natureza declarada aqui, a
   * proxima classe de erro e obrigada a escolher em vez de herdar silencio.
   *
   * Padrao FALSO de proposito: classe nova sem decisao aparece no alerta. E
   * preferivel ruido visivel a defeito silencioso.
   */
  public readonly expected: boolean;

  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'APP_ERROR';
    this.expected = options.expected ?? false;
    this.userMessage =
      options.userMessage ?? 'Ocorreu um erro inesperado. Tente novamente em instantes.';
    this.context = options.context ?? {};
    this.cause = options.cause;
    Error.captureStackTrace?.(this, new.target);
  }

  /** Representacao segura para logs estruturados. */
  public toLogPayload(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...this.context,
    };
  }
}

/** Entrada invalida fornecida por um usuario. */
export class ValidationError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'VALIDATION_ERROR',
      expected: true,
      userMessage: options.userMessage ?? message,
      ...options,
    });
  }
}

/** Usuario nao possui autorizacao para a acao solicitada. */
export class PermissionError extends AppError {
  public constructor(message = 'Acao nao autorizada.', options: AppErrorOptions = {}) {
    super(message, {
      code: 'PERMISSION_DENIED',
      expected: true,
      userMessage: options.userMessage ?? 'Voce nao tem permissao para executar esta acao.',
      ...options,
    });
  }
}

/**
 * Sistema esta mal configurado (canal/cargo/categoria ausente etc).
 *
 * NAO e recusa de regra: alguem precisa ir la e arrumar. Fica sem
 * `expected: true` de proposito, para continuar virando alerta — e justamente
 * o tipo de coisa que passa meses quebrada porque ninguem foi avisado.
 */
export class ConfigurationError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'CONFIGURATION_ERROR',
      userMessage:
        options.userMessage ??
        'O sistema nao esta configurado corretamente. Avise um administrador.',
      ...options,
    });
  }
}

/**
 * Recurso do Discord ausente ou inacessivel (canal apagado, cargo removido).
 *
 * Tambem sem `expected: true`: a acao do usuario era valida e o bot nao
 * conseguiu cumpri-la.
 */
export class DiscordResourceError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'DISCORD_RESOURCE_ERROR',
      userMessage:
        options.userMessage ?? 'Nao foi possivel acessar um recurso necessario no Discord.',
      ...options,
    });
  }
}

/** Operacao bloqueada por cooldown / rate limit interno. */
export class RateLimitError extends AppError {
  public readonly retryAfterSeconds: number;

  public constructor(retryAfterSeconds: number, options: AppErrorOptions = {}) {
    super(`Rate limit atingido. Retry em ${retryAfterSeconds}s`, {
      code: 'RATE_LIMITED',
      expected: true,
      userMessage:
        options.userMessage ??
        `Aguarde ${retryAfterSeconds} segundo(s) antes de tentar novamente.`,
      ...options,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Outra operacao concorrente ja detem o lock. */
export class LockBusyError extends AppError {
  public constructor(resource: string, options: AppErrorOptions = {}) {
    super(`Recurso ocupado: ${resource}`, {
      code: 'LOCK_BUSY',
      expected: true,
      userMessage:
        options.userMessage ?? 'Esta operacao ja esta em andamento. Aguarde alguns segundos.',
      ...options,
    });
  }
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export class TicketNotFoundError extends AppError {
  public constructor(identifier: string, options: AppErrorOptions = {}) {
    super(`Ticket nao encontrado: ${identifier}`, {
      code: 'TICKET_NOT_FOUND',
      expected: true,
      userMessage: options.userMessage ?? 'Este atendimento nao foi encontrado.',
      ...options,
    });
  }
}

export class TicketStateError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'TICKET_STATE_ERROR',
      expected: true,
      userMessage:
        options.userMessage ?? 'Este atendimento nao esta em um estado que permita esta acao.',
      ...options,
    });
  }
}

export class TicketAlreadyClaimedError extends AppError {
  public constructor(claimedById: string, options: AppErrorOptions = {}) {
    super(`Ticket ja assumido por ${claimedById}`, {
      code: 'TICKET_ALREADY_CLAIMED',
      expected: true,
      userMessage:
        options.userMessage ?? `Este atendimento ja foi assumido por <@${claimedById}>.`,
      ...options,
    });
  }
}

export class TicketLimitError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'TICKET_LIMIT_REACHED',
      expected: true,
      userMessage: options.userMessage ?? message,
      ...options,
    });
  }
}

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------

export class PaymentNotFoundError extends AppError {
  public constructor(identifier: string, options: AppErrorOptions = {}) {
    super(`Pagamento nao encontrado: ${identifier}`, {
      code: 'PAYMENT_NOT_FOUND',
      expected: true,
      userMessage: options.userMessage ?? 'Esta cobranca nao foi encontrada.',
      ...options,
    });
  }
}

export class PaymentStateError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'PAYMENT_STATE_ERROR',
      expected: true,
      userMessage:
        options.userMessage ?? 'Esta cobranca nao esta mais pendente e nao pode ser alterada.',
      ...options,
    });
  }
}

export class PaymentAccountError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'PAYMENT_ACCOUNT_ERROR',
      expected: true,
      userMessage: options.userMessage ?? message,
      ...options,
    });
  }
}

// ---------------------------------------------------------------------------
// Cupons
// ---------------------------------------------------------------------------

export class CouponNotFoundError extends AppError {
  public constructor(identifier: string, options: AppErrorOptions = {}) {
    super(`Cupom nao encontrado: ${identifier}`, {
      code: 'COUPON_NOT_FOUND',
      expected: true,
      userMessage: options.userMessage ?? 'Este cupom nao foi encontrado.',
      ...options,
    });
  }
}

export class CouponInvalidError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'COUPON_INVALID',
      expected: true,
      userMessage: options.userMessage ?? message,
      ...options,
    });
  }
}

export class CouponUsageLimitError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'COUPON_USAGE_LIMIT',
      expected: true,
      userMessage: options.userMessage ?? message,
      ...options,
    });
  }
}

// ---------------------------------------------------------------------------
// Avaliacoes
// ---------------------------------------------------------------------------

export class ReviewAlreadySubmittedError extends AppError {
  public constructor(options: AppErrorOptions = {}) {
    super('Avaliacao ja registrada para este ticket', {
      code: 'REVIEW_ALREADY_SUBMITTED',
      expected: true,
      userMessage: options.userMessage ?? 'Voce ja avaliou este atendimento. Obrigado!',
      ...options,
    });
  }
}

export class ReviewInvalidError extends AppError {
  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: 'REVIEW_INVALID',
      expected: true,
      userMessage: options.userMessage ?? message,
      ...options,
    });
  }
}

/** True quando o erro e da aplicacao (seguro para exibir `userMessage`). */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
