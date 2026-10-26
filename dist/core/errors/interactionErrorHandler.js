"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleInteractionError = handleInteractionError;
exports.handleBackgroundError = handleBackgroundError;
exports.toAppError = toAppError;
const discord_js_1 = require("discord.js");
const reply_1 = require("../../components/reply");
const SystemErrorRepository_1 = require("../../modules/audit/repositories/SystemErrorRepository");
const AlertService_1 = require("./AlertService");
const discord_1 = require("../../utils/discord");
const Logger_1 = require("../logger/Logger");
const index_1 = require("./index");
const logger = (0, Logger_1.createLogger)('interaction');
/**
 * Erros esperados de fluxo — logados como WARN, sem stack e sem persistencia.
 *
 * QUEM DECIDE E A CLASSE DO ERRO (`AppError.expected`), nao esta funcao.
 *
 * Antes havia aqui uma lista de quatro classes, e as outras doze — incluindo
 * toda recusa de ESTADO — caiam no ramo de falha. Na pratica: clicar em
 * "Aprovar" numa cobranca ja aprovada disparava alerta no canal de erros e
 * gravava linha em `system_error_logs`, embora o segundo clique seja esperado
 * (o botao continua clicavel ate o cartao ser reescrito) e a cobranca nao
 * tenha sofrido nada — o guard fez exatamente o que devia.
 *
 * Com a natureza declarada na classe, uma classe de erro nova e obrigada a
 * escolher; uma lista aqui simplesmente a esqueceria.
 */
function isExpectedError(error) {
    return (0, index_1.isAppError)(error) && error.expected;
}
/**
 * Resposta unica para qualquer erro em interacao.
 *
 * NUNCA envia ao usuario: stack trace, mensagem do Prisma, SQL ou token.
 * Erros de aplicacao mostram `userMessage`; o resto vira mensagem generica.
 */
async function handleInteractionError(interaction, error, context) {
    const expected = isExpectedError(error);
    const appError = (0, index_1.isAppError)(error) ? error : null;
    const logContext = {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        interactionId: interaction.id,
        source: context.source,
        ...(context.customId !== undefined ? { customId: context.customId } : {}),
        ...(context.commandName !== undefined ? { commandName: context.commandName } : {}),
        ...(appError !== null ? { code: appError.code } : {}),
    };
    if (expected) {
        logger.warn(appError !== null ? appError.message : 'Interacao rejeitada.', logContext);
    }
    else {
        logger.error('Falha ao processar interacao.', error, logContext);
        await (0, SystemErrorRepository_1.recordSystemError)({
            guildId: interaction.guildId,
            module: context.source,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? (error.stack ?? null) : null,
            metadata: logContext,
        });
        // Log e tabela sao consultados por quem ja desconfia de alguma coisa. O
        // alerta e para quem ainda nao desconfia.
        await (0, AlertService_1.notifyAlert)(context.source, error, logContext);
    }
    const userMessage = appError !== null
        ? appError.userMessage
        : 'Ocorreu um erro inesperado ao processar sua acao. A equipe foi notificada.';
    const root = expected ? (0, reply_1.warningContainer)(userMessage) : (0, reply_1.errorContainer)(userMessage);
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                components: [root],
                flags: discord_js_1.MessageFlags.IsComponentsV2 | discord_js_1.MessageFlags.Ephemeral,
                allowedMentions: discord_1.NO_MENTIONS,
            });
            return;
        }
        await interaction.reply({
            components: [root],
            flags: discord_js_1.MessageFlags.IsComponentsV2 | discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: discord_1.NO_MENTIONS,
        });
    }
    catch (replyError) {
        // Interacao expirada (3s) ou ja consumida: nada mais a fazer.
        if ((0, discord_1.isUnknownResourceError)(replyError))
            return;
        logger.warn('Nao foi possivel responder ao usuario apos o erro.', {
            ...logContext,
            detail: replyError instanceof Error ? replyError.message : String(replyError),
        });
    }
}
/**
 * Erro fora de interacao (jobs, eventos): registra e segue.
 *
 * A mesma regra do ramo de interacao vale aqui. O recovery, por exemplo,
 * reprocessa pagamentos que ficaram pela metade: encontrar um que ja foi
 * sincronizado devolve uma recusa de ESTADO, que e o resultado correto — e nao
 * algo que o dono da loja precise ver as tres da manha.
 */
async function handleBackgroundError(moduleName, error, context = {}) {
    if (isExpectedError(error)) {
        logger.warn(`Operacao recusada em ${moduleName}.`, {
            ...context,
            ...((0, index_1.isAppError)(error) ? { code: error.code, detail: error.message } : {}),
        });
        return;
    }
    logger.error(`Falha em ${moduleName}.`, error, context);
    await (0, AlertService_1.notifyAlert)(moduleName, error, context);
    await (0, SystemErrorRepository_1.recordSystemError)({
        guildId: typeof context['guildId'] === 'string' ? context['guildId'] : null,
        module: moduleName,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
        metadata: context,
    });
}
/** Converte erro desconhecido em AppError preservando a causa. */
function toAppError(error, fallbackMessage) {
    if ((0, index_1.isAppError)(error))
        return error;
    return new index_1.AppError(error instanceof Error ? error.message : String(error), {
        userMessage: fallbackMessage,
        cause: error,
    });
}
//# sourceMappingURL=interactionErrorHandler.js.map