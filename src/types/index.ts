import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';

import type { ParsedCustomId } from '../constants/customIds';

/**
 * Contratos compartilhados entre comandos, handlers e routers.
 *
 * Tipagem estrutural do builder: aceita SlashCommandBuilder e todas as suas
 * variantes (`...SubcommandsOnlyBuilder`, `...OptionsOnlyBuilder`) sem precisar
 * de uniao manual que quebra a cada versao do discord.js.
 */
export interface CommandBuilderLike {
  readonly name: string;
  toJSON(): RESTPostAPIApplicationCommandsJSONBody;
}

/** Interacao de comando garantidamente dentro de uma guild. */
export type GuildChatInputInteraction = ChatInputCommandInteraction<'cached'>;

export interface SlashCommandDefinition {
  readonly builder: CommandBuilderLike;
  /**
   * Quando true (padrao), o comando so roda dentro de uma guild e o router
   * garante `interaction.inCachedGuild()` antes de executar.
   */
  readonly guildOnly?: boolean;
  execute(interaction: GuildChatInputInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction<'cached'>): Promise<void>;
}

/**
 * Handler de componente persistente.
 *
 * Roteado por `namespace` + `action` do customId, portanto continua funcionando
 * apos restart do processo (nada de collectors eternos por ticket).
 */
export interface ComponentHandler<TInteraction> {
  readonly namespace: string;
  readonly action: string;
  /**
   * Quando true, a interacao precisa vir de uma guild.
   * Handlers de avaliacao rodam na DM e por isso usam `false`.
   */
  readonly guildOnly?: boolean;
  handle(interaction: TInteraction, parsed: ParsedCustomId): Promise<void>;
}

export type ButtonHandler = ComponentHandler<ButtonInteraction>;
export type ModalHandler = ComponentHandler<ModalSubmitInteraction>;
export type StringSelectHandler = ComponentHandler<StringSelectMenuInteraction>;
export type UserSelectHandler = ComponentHandler<UserSelectMenuInteraction>;
export type RoleSelectHandler = ComponentHandler<RoleSelectMenuInteraction>;
export type ChannelSelectHandler = ComponentHandler<ChannelSelectMenuInteraction>;
export type SelectHandler = ComponentHandler<AnySelectMenuInteraction>;

/** Resultado padronizado de operacoes que podem falhar por regra de negocio. */
export type OperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly userMessage: string };

export function ok<T>(value: T): OperationResult<T> {
  return { ok: true, value };
}

export function fail<T>(reason: string, userMessage: string): OperationResult<T> {
  return { ok: false, reason, userMessage };
}
