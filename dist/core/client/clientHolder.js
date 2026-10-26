"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setClient = setClient;
exports.clearClient = clearClient;
exports.hasClient = hasClient;
exports.getClient = getClient;
exports.tryGetClient = tryGetClient;
const errors_1 = require("../errors");
/**
 * Referencia unica do cliente logado.
 *
 * Servicos de background (scheduler, recovery) precisam do cliente sem que ele
 * seja passado por dez camadas de funcao. Handlers de interacao continuam
 * usando `interaction.client`.
 */
let current = null;
function setClient(client) {
    current = client;
}
function clearClient() {
    current = null;
}
function hasClient() {
    return current !== null && current.isReady();
}
/** Cliente pronto. Lanca se chamado antes do login. */
function getClient() {
    if (current === null || !current.isReady()) {
        throw new errors_1.AppError('Cliente do Discord ainda nao esta pronto.', {
            code: 'CLIENT_NOT_READY',
        });
    }
    return current;
}
/** Cliente pronto ou null (para jobs que devem apenas pular a execucao). */
function tryGetClient() {
    if (current === null || !current.isReady())
        return null;
    return current;
}
//# sourceMappingURL=clientHolder.js.map