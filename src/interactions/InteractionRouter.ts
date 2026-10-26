import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  ModalSubmitInteraction,
  RepliableInteraction,
} from 'discord.js';

import { parseCustomId, type ParsedCustomId } from '../constants/customIds';
import { registry } from '../core/client/registry';
import { handleInteractionError } from '../core/errors/interactionErrorHandler';
import { createLogger } from '../core/logger/Logger';
import { replyError } from '../components/reply';

const logger = createLogger('router');

/**
 * Roteador central de interacoes.
 *
 * interactionCreate
 *  ├── SlashCommandRouter
 *  ├── ButtonRouter
 *  ├── SelectMenuRouter
 *  ├── ModalRouter
 *  └── AutocompleteRouter
 *
 * Handlers sao pequenos e delegam regra de negocio para services.
 * Nada de collector: tudo e resolvido por `namespace:action` do customId, o que
 * mantem os componentes funcionais depois de qualquer restart.
 */

export async function routeInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    await routeCommand(interaction);
    return;
  }
  if (interaction.isAutocomplete()) {
    await routeAutocomplete(interaction);
    return;
  }
  if (interaction.isButton()) {
    await routeButton(interaction);
    return;
  }
  if (interaction.isAnySelectMenu()) {
    await routeSelect(interaction);
    return;
  }
  if (interaction.isModalSubmit()) {
    await routeModal(interaction);
    return;
  }
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

async function routeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const command = registry.findCommand(interaction.commandName);
  if (command === undefined) {
    logger.warn('Comando desconhecido recebido.', {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      commandName: interaction.commandName,
    });
    await replyError(
      interaction,
      'Este comando nao esta mais disponivel. Atualize a lista de comandos do servidor.',
    );
    return;
  }

  const guildOnly = command.guildOnly ?? true;
  if (guildOnly && !interaction.inCachedGuild()) {
    await replyError(interaction, 'Este comando so pode ser usado dentro de um servidor.');
    return;
  }

  try {
    // `inCachedGuild()` acima garante o narrowing para comandos de guild.
    await command.execute(interaction as ChatInputCommandInteraction<'cached'>);
  } catch (error) {
    await handleInteractionError(interaction, error, {
      source: 'command',
      commandName: interaction.commandName,
    });
  }
}

async function routeAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const command = registry.findCommand(interaction.commandName);
  if (command?.autocomplete === undefined) {
    /*
     * O Discord SO pede autocomplete para uma opcao declarada como tal. Chegar
     * aqui significa que a definicao registrada na API e o codigo em execucao
     * discordam — quase sempre porque o `deploy:commands` rodou sobre um build
     * mais novo que o processo, que segue com a versao antiga carregada.
     *
     * Isso ja custou uma investigacao: o usuario via "nenhuma opcao corresponde
     * a sua busca" e o log nao dizia absolutamente nada, porque este caminho
     * respondia vazio antes do try/catch. Um aviso aqui aponta o dedo para o
     * reinicio que falta.
     */
    logger.warn('Autocomplete pedido para comando sem handler carregado.', {
      guildId: interaction.guildId,
      commandName: interaction.commandName,
      detail: 'Comando registrado no Discord declara autocomplete; o processo em execucao nao o implementa. Reinicie o bot apos o build.',
    });
    await interaction.respond([]);
    return;
  }
  try {
    if (!interaction.inCachedGuild()) {
      await interaction.respond([]);
      return;
    }
    await command.autocomplete(interaction);
  } catch (error) {
    logger.warn('Falha no autocomplete.', {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      commandName: interaction.commandName,
      detail: error instanceof Error ? error.message : String(error),
    });
    try {
      await interaction.respond([]);
    } catch {
      // Autocomplete expirado: ignorar.
    }
  }
}

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------

function parseOrWarn(
  interaction: RepliableInteraction,
  customId: string,
  kind: string,
): ParsedCustomId | null {
  const parsed = parseCustomId(customId);
  if (parsed === null) {
    logger.warn('customId invalido.', {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      customId,
      kind,
    });
  }
  return parsed;
}

async function respondUnknownComponent(interaction: RepliableInteraction): Promise<void> {
  await replyError(
    interaction,
    'Este componente nao e mais valido. Atualize o painel e tente novamente.',
  );
}

async function routeButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseOrWarn(interaction, interaction.customId, 'button');
  if (parsed === null) {
    await respondUnknownComponent(interaction);
    return;
  }

  const handler = registry.findButton(parsed.namespace, parsed.action);
  if (handler === undefined) {
    logger.warn('Botao sem handler registrado.', {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      customId: interaction.customId,
    });
    await respondUnknownComponent(interaction);
    return;
  }

  if ((handler.guildOnly ?? true) && !interaction.inCachedGuild()) {
    await replyError(interaction, 'Esta acao so pode ser usada dentro do servidor.');
    return;
  }

  try {
    await handler.handle(interaction, parsed);
  } catch (error) {
    await handleInteractionError(interaction, error, {
      source: `button:${parsed.namespace}:${parsed.action}`,
      customId: interaction.customId,
    });
  }
}

async function routeSelect(interaction: AnySelectMenuInteraction): Promise<void> {
  const parsed = parseOrWarn(interaction, interaction.customId, 'select');
  if (parsed === null) {
    await respondUnknownComponent(interaction);
    return;
  }

  const handler = registry.findSelect(parsed.namespace, parsed.action);
  if (handler === undefined) {
    logger.warn('Select sem handler registrado.', {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      customId: interaction.customId,
    });
    await respondUnknownComponent(interaction);
    return;
  }

  if ((handler.guildOnly ?? true) && !interaction.inCachedGuild()) {
    await replyError(interaction, 'Esta acao so pode ser usada dentro do servidor.');
    return;
  }

  try {
    await handler.handle(interaction, parsed);
  } catch (error) {
    await handleInteractionError(interaction, error, {
      source: `select:${parsed.namespace}:${parsed.action}`,
      customId: interaction.customId,
    });
  }
}

async function routeModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseOrWarn(interaction, interaction.customId, 'modal');
  if (parsed === null) {
    await respondUnknownComponent(interaction);
    return;
  }

  const handler = registry.findModal(parsed.namespace, parsed.action);
  if (handler === undefined) {
    logger.warn('Modal sem handler registrado.', {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      customId: interaction.customId,
    });
    await respondUnknownComponent(interaction);
    return;
  }

  if ((handler.guildOnly ?? true) && !interaction.inCachedGuild()) {
    await replyError(interaction, 'Esta acao so pode ser usada dentro do servidor.');
    return;
  }

  try {
    await handler.handle(interaction, parsed);
  } catch (error) {
    await handleInteractionError(interaction, error, {
      source: `modal:${parsed.namespace}:${parsed.action}`,
      customId: interaction.customId,
    });
  }
}
