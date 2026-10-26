"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registry = exports.Registry = void 0;
const Logger_1 = require("../logger/Logger");
const logger = (0, Logger_1.createLogger)('registry');
/**
 * Registro central de comandos e handlers de componentes.
 *
 * Os componentes sao roteados por `namespace:action`, logo sobrevivem a
 * reinicializacoes do processo (nao existe collector por ticket).
 */
function handlerKey(namespace, action) {
    return `${namespace}:${action}`;
}
class Registry {
    commands = new Map();
    buttons = new Map();
    selects = new Map();
    modals = new Map();
    registerCommand(command) {
        const name = command.builder.name;
        if (this.commands.has(name)) {
            throw new Error(`Comando duplicado no registro: /${name}`);
        }
        this.commands.set(name, command);
    }
    registerCommands(commands) {
        for (const command of commands)
            this.registerCommand(command);
    }
    registerButton(handler) {
        const key = handlerKey(handler.namespace, handler.action);
        if (this.buttons.has(key))
            throw new Error(`Handler de botao duplicado: ${key}`);
        this.buttons.set(key, handler);
    }
    registerButtons(handlers) {
        for (const handler of handlers)
            this.registerButton(handler);
    }
    registerSelect(handler) {
        const key = handlerKey(handler.namespace, handler.action);
        if (this.selects.has(key))
            throw new Error(`Handler de select duplicado: ${key}`);
        this.selects.set(key, handler);
    }
    registerSelects(handlers) {
        for (const handler of handlers)
            this.registerSelect(handler);
    }
    registerModal(handler) {
        const key = handlerKey(handler.namespace, handler.action);
        if (this.modals.has(key))
            throw new Error(`Handler de modal duplicado: ${key}`);
        this.modals.set(key, handler);
    }
    registerModals(handlers) {
        for (const handler of handlers)
            this.registerModal(handler);
    }
    findCommand(name) {
        return this.commands.get(name);
    }
    findButton(namespace, action) {
        return this.buttons.get(handlerKey(namespace, action));
    }
    findSelect(namespace, action) {
        return this.selects.get(handlerKey(namespace, action));
    }
    findModal(namespace, action) {
        return this.modals.get(handlerKey(namespace, action));
    }
    /** Payload para registrar os slash commands na API do Discord. */
    toApplicationCommands() {
        return [...this.commands.values()].map((command) => command.builder.toJSON());
    }
    summary() {
        return {
            commands: this.commands.size,
            buttons: this.buttons.size,
            selects: this.selects.size,
            modals: this.modals.size,
        };
    }
    logSummary() {
        const summary = this.summary();
        logger.info('Registro carregado.', { ...summary });
    }
    clear() {
        this.commands.clear();
        this.buttons.clear();
        this.selects.clear();
        this.modals.clear();
    }
}
exports.Registry = Registry;
exports.registry = new Registry();
//# sourceMappingURL=registry.js.map