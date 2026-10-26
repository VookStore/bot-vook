"use strict";
/**
 * Hierarquia de erros da aplicacao.
 *
 * Regra fundamental: `message` e tecnico (vai para o log) e `userMessage` e o
 * unico texto que pode ser exibido ao usuario final. Nenhum erro de
 * infraestrutura (Prisma, SQL, stack trace, token) pode vazar para o Discord.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewInvalidError = exports.ReviewAlreadySubmittedError = exports.CouponUsageLimitError = exports.CouponInvalidError = exports.CouponNotFoundError = exports.PaymentAccountError = exports.PaymentStateError = exports.PaymentNotFoundError = exports.TicketLimitError = exports.TicketAlreadyClaimedError = exports.TicketStateError = exports.TicketNotFoundError = exports.LockBusyError = exports.RateLimitError = exports.DiscordResourceError = exports.ConfigurationError = exports.PermissionError = exports.ValidationError = exports.AppError = void 0;
exports.isAppError = isAppError;
class AppError extends Error {
    code;
    userMessage;
    context;
    cause;
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
    expected;
    constructor(message, options = {}) {
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
    toLogPayload() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            ...this.context,
        };
    }
}
exports.AppError = AppError;
/** Entrada invalida fornecida por um usuario. */
class ValidationError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'VALIDATION_ERROR',
            expected: true,
            userMessage: options.userMessage ?? message,
            ...options,
        });
    }
}
exports.ValidationError = ValidationError;
/** Usuario nao possui autorizacao para a acao solicitada. */
class PermissionError extends AppError {
    constructor(message = 'Acao nao autorizada.', options = {}) {
        super(message, {
            code: 'PERMISSION_DENIED',
            expected: true,
            userMessage: options.userMessage ?? 'Voce nao tem permissao para executar esta acao.',
            ...options,
        });
    }
}
exports.PermissionError = PermissionError;
/**
 * Sistema esta mal configurado (canal/cargo/categoria ausente etc).
 *
 * NAO e recusa de regra: alguem precisa ir la e arrumar. Fica sem
 * `expected: true` de proposito, para continuar virando alerta — e justamente
 * o tipo de coisa que passa meses quebrada porque ninguem foi avisado.
 */
class ConfigurationError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'CONFIGURATION_ERROR',
            userMessage: options.userMessage ??
                'O sistema nao esta configurado corretamente. Avise um administrador.',
            ...options,
        });
    }
}
exports.ConfigurationError = ConfigurationError;
/**
 * Recurso do Discord ausente ou inacessivel (canal apagado, cargo removido).
 *
 * Tambem sem `expected: true`: a acao do usuario era valida e o bot nao
 * conseguiu cumpri-la.
 */
class DiscordResourceError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'DISCORD_RESOURCE_ERROR',
            userMessage: options.userMessage ?? 'Nao foi possivel acessar um recurso necessario no Discord.',
            ...options,
        });
    }
}
exports.DiscordResourceError = DiscordResourceError;
/** Operacao bloqueada por cooldown / rate limit interno. */
class RateLimitError extends AppError {
    retryAfterSeconds;
    constructor(retryAfterSeconds, options = {}) {
        super(`Rate limit atingido. Retry em ${retryAfterSeconds}s`, {
            code: 'RATE_LIMITED',
            expected: true,
            userMessage: options.userMessage ??
                `Aguarde ${retryAfterSeconds} segundo(s) antes de tentar novamente.`,
            ...options,
        });
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
exports.RateLimitError = RateLimitError;
/** Outra operacao concorrente ja detem o lock. */
class LockBusyError extends AppError {
    constructor(resource, options = {}) {
        super(`Recurso ocupado: ${resource}`, {
            code: 'LOCK_BUSY',
            expected: true,
            userMessage: options.userMessage ?? 'Esta operacao ja esta em andamento. Aguarde alguns segundos.',
            ...options,
        });
    }
}
exports.LockBusyError = LockBusyError;
// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------
class TicketNotFoundError extends AppError {
    constructor(identifier, options = {}) {
        super(`Ticket nao encontrado: ${identifier}`, {
            code: 'TICKET_NOT_FOUND',
            expected: true,
            userMessage: options.userMessage ?? 'Este atendimento nao foi encontrado.',
            ...options,
        });
    }
}
exports.TicketNotFoundError = TicketNotFoundError;
class TicketStateError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'TICKET_STATE_ERROR',
            expected: true,
            userMessage: options.userMessage ?? 'Este atendimento nao esta em um estado que permita esta acao.',
            ...options,
        });
    }
}
exports.TicketStateError = TicketStateError;
class TicketAlreadyClaimedError extends AppError {
    constructor(claimedById, options = {}) {
        super(`Ticket ja assumido por ${claimedById}`, {
            code: 'TICKET_ALREADY_CLAIMED',
            expected: true,
            userMessage: options.userMessage ?? `Este atendimento ja foi assumido por <@${claimedById}>.`,
            ...options,
        });
    }
}
exports.TicketAlreadyClaimedError = TicketAlreadyClaimedError;
class TicketLimitError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'TICKET_LIMIT_REACHED',
            expected: true,
            userMessage: options.userMessage ?? message,
            ...options,
        });
    }
}
exports.TicketLimitError = TicketLimitError;
// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------
class PaymentNotFoundError extends AppError {
    constructor(identifier, options = {}) {
        super(`Pagamento nao encontrado: ${identifier}`, {
            code: 'PAYMENT_NOT_FOUND',
            expected: true,
            userMessage: options.userMessage ?? 'Esta cobranca nao foi encontrada.',
            ...options,
        });
    }
}
exports.PaymentNotFoundError = PaymentNotFoundError;
class PaymentStateError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'PAYMENT_STATE_ERROR',
            expected: true,
            userMessage: options.userMessage ?? 'Esta cobranca nao esta mais pendente e nao pode ser alterada.',
            ...options,
        });
    }
}
exports.PaymentStateError = PaymentStateError;
class PaymentAccountError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'PAYMENT_ACCOUNT_ERROR',
            expected: true,
            userMessage: options.userMessage ?? message,
            ...options,
        });
    }
}
exports.PaymentAccountError = PaymentAccountError;
// ---------------------------------------------------------------------------
// Cupons
// ---------------------------------------------------------------------------
class CouponNotFoundError extends AppError {
    constructor(identifier, options = {}) {
        super(`Cupom nao encontrado: ${identifier}`, {
            code: 'COUPON_NOT_FOUND',
            expected: true,
            userMessage: options.userMessage ?? 'Este cupom nao foi encontrado.',
            ...options,
        });
    }
}
exports.CouponNotFoundError = CouponNotFoundError;
class CouponInvalidError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'COUPON_INVALID',
            expected: true,
            userMessage: options.userMessage ?? message,
            ...options,
        });
    }
}
exports.CouponInvalidError = CouponInvalidError;
class CouponUsageLimitError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'COUPON_USAGE_LIMIT',
            expected: true,
            userMessage: options.userMessage ?? message,
            ...options,
        });
    }
}
exports.CouponUsageLimitError = CouponUsageLimitError;
// ---------------------------------------------------------------------------
// Avaliacoes
// ---------------------------------------------------------------------------
class ReviewAlreadySubmittedError extends AppError {
    constructor(options = {}) {
        super('Avaliacao ja registrada para este ticket', {
            code: 'REVIEW_ALREADY_SUBMITTED',
            expected: true,
            userMessage: options.userMessage ?? 'Voce ja avaliou este atendimento. Obrigado!',
            ...options,
        });
    }
}
exports.ReviewAlreadySubmittedError = ReviewAlreadySubmittedError;
class ReviewInvalidError extends AppError {
    constructor(message, options = {}) {
        super(message, {
            code: 'REVIEW_INVALID',
            expected: true,
            userMessage: options.userMessage ?? message,
            ...options,
        });
    }
}
exports.ReviewInvalidError = ReviewInvalidError;
/** True quando o erro e da aplicacao (seguro para exibir `userMessage`). */
function isAppError(error) {
    return error instanceof AppError;
}
//# sourceMappingURL=index.js.map