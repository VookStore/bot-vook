import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

import { createLogger } from '../logger/Logger';
import type {
  ButtonHandler,
  ModalHandler,
  SelectHandler,
  SlashCommandDefinition,
} from '../../types';

const logger = createLogger('registry');

/**
 * Registro central de comandos e handlers de componentes.
 *
 * Os componentes sao roteados por `namespace:action`, logo sobrevivem a
 * reinicializacoes do processo (nao existe collector por ticket).
 */

function handlerKey(namespace: string, action: string): string {
  return `${namespace}:${action}`;
}

export class Registry {
  public readonly commands = new Map<string, SlashCommandDefinition>();
  public readonly buttons = new Map<string, ButtonHandler>();
  public readonly selects = new Map<string, SelectHandler>();
  public readonly modals = new Map<string, ModalHandler>();

  public registerCommand(command: SlashCommandDefinition): void {
    const name = command.builder.name;
    if (this.commands.has(name)) {
      throw new Error(`Comando duplicado no registro: /${name}`);
    }
    this.commands.set(name, command);
  }

  public registerCommands(commands: readonly SlashCommandDefinition[]): void {
    for (const command of commands) this.registerCommand(command);
  }

  public registerButton(handler: ButtonHandler): void {
    const key = handlerKey(handler.namespace, handler.action);
    if (this.buttons.has(key)) throw new Error(`Handler de botao duplicado: ${key}`);
    this.buttons.set(key, handler);
  }

  public registerButtons(handlers: readonly ButtonHandler[]): void {
    for (const handler of handlers) this.registerButton(handler);
  }

  public registerSelect(handler: SelectHandler): void {
    const key = handlerKey(handler.namespace, handler.action);
    if (this.selects.has(key)) throw new Error(`Handler de select duplicado: ${key}`);
    this.selects.set(key, handler);
  }

  public registerSelects(handlers: readonly SelectHandler[]): void {
    for (const handler of handlers) this.registerSelect(handler);
  }

  public registerModal(handler: ModalHandler): void {
    const key = handlerKey(handler.namespace, handler.action);
    if (this.modals.has(key)) throw new Error(`Handler de modal duplicado: ${key}`);
    this.modals.set(key, handler);
  }

  public registerModals(handlers: readonly ModalHandler[]): void {
    for (const handler of handlers) this.registerModal(handler);
  }

  public findCommand(name: string): SlashCommandDefinition | undefined {
    return this.commands.get(name);
  }

  public findButton(namespace: string, action: string): ButtonHandler | undefined {
    return this.buttons.get(handlerKey(namespace, action));
  }

  public findSelect(namespace: string, action: string): SelectHandler | undefined {
    return this.selects.get(handlerKey(namespace, action));
  }

  public findModal(namespace: string, action: string): ModalHandler | undefined {
    return this.modals.get(handlerKey(namespace, action));
  }

  /** Payload para registrar os slash commands na API do Discord. */
  public toApplicationCommands(): RESTPostAPIApplicationCommandsJSONBody[] {
    return [...this.commands.values()].map((command) => command.builder.toJSON());
  }

  public summary(): { commands: number; buttons: number; selects: number; modals: number } {
    return {
      commands: this.commands.size,
      buttons: this.buttons.size,
      selects: this.selects.size,
      modals: this.modals.size,
    };
  }

  public logSummary(): void {
    const summary = this.summary();
    logger.info('Registro carregado.', { ...summary });
  }

  public clear(): void {
    this.commands.clear();
    this.buttons.clear();
    this.selects.clear();
    this.modals.clear();
  }
}

export const registry = new Registry();
