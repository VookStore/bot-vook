import { MessageFlags, type RepliableInteraction } from 'discord.js';

import { errorContainer, warningContainer } from '../../components/reply';
import { recordSystemError } from '../../modules/audit/repositories/SystemErrorRepository';
import { notifyAlert } from './AlertService';
import { NO_MENTIONS, isUnknownResourceError } from '../../utils/discord';
import { createLogger } from '../logger/Logger';
import { AppError, isAppError } from './index';

const logger = createLogger('interaction');

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
function isExpectedError(error: unknown): boolean {
  return isAppError(error) && error.expected;
}

export interface InteractionErrorContext {
  source: string;
  customId?: string;
  commandName?: string;
}

/**
 * Resposta unica para qualquer erro em interacao.
 *
 * NUNCA envia ao usuario: stack trace, mensagem do Prisma, SQL ou token.
 * Erros de aplicacao mostram `userMessage`; o resto vira mensagem generica.
 */
export async function handleInteractionError(
  interaction: RepliableInteraction,
  error: unknown,
  context: InteractionErrorContext,
): Promise<void> {
  const expected = isExpectedError(error);
  const appError = isAppError(error) ? error : null;

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
    logger.warn(
      appError !== null ? appError.message : 'Interacao rejeitada.',
      logContext,
    );
  } else {
    logger.error('Falha ao processar interacao.', error, logContext);
    await recordSystemError({
      guildId: interaction.guildId,
      module: context.source,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? null) : null,
      metadata: logContext,
    });
    // Log e tabela sao consultados por quem ja desconfia de alguma coisa. O
    // alerta e para quem ainda nao desconfia.
    await notifyAlert(context.source, error, logContext);
  }

  const userMessage =
    appError !== null
      ? appError.userMessage
      : 'Ocorreu um erro inesperado ao processar sua acao. A equipe foi notificada.';

  const root = expected ? warningContainer(userMessage) : errorContainer(userMessage);

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        components: [root],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: NO_MENTIONS,
      });
      return;
    }
    await interaction.reply({
      components: [root],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: NO_MENTIONS,
    });
  } catch (replyError) {
    // Interacao expirada (3s) ou ja consumida: nada mais a fazer.
    if (isUnknownResourceError(replyError)) return;
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
export async function handleBackgroundError(
  moduleName: string,
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  if (isExpectedError(error)) {
    logger.warn(`Operacao recusada em ${moduleName}.`, {
      ...context,
      ...(isAppError(error) ? { code: error.code, detail: error.message } : {}),
    });
    return;
  }

  logger.error(`Falha em ${moduleName}.`, error, context);
  await notifyAlert(moduleName, error, context);
  await recordSystemError({
    guildId: typeof context['guildId'] === 'string' ? context['guildId'] : null,
    module: moduleName,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
    metadata: context,
  });
}

/** Converte erro desconhecido em AppError preservando a causa. */
export function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (isAppError(error)) return error;
  return new AppError(error instanceof Error ? error.message : String(error), {
    userMessage: fallbackMessage,
    cause: error,
  });
}
