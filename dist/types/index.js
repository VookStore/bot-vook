"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.fail = fail;
function ok(value) {
    return { ok: true, value };
}
function fail(reason, userMessage) {
    return { ok: false, reason, userMessage };
}
//# sourceMappingURL=index.js.map