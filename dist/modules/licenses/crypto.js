"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANS = exports.newLicenseKey = exports.digest = void 0;
exports.encryptKey = encryptKey;
exports.decryptKey = decryptKey;
exports.isPlan = isPlan;
exports.expiry = expiry;
const node_crypto_1 = require("node:crypto");
const digest = (text) => (0, node_crypto_1.createHash)('sha256').update(text).digest('hex');
exports.digest = digest;
const newLicenseKey = () => 'VOOK-' + (0, node_crypto_1.randomBytes)(32).toString('hex').toUpperCase();
exports.newLicenseKey = newLicenseKey;
function encryptKey(value, secret) {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.');
}
function decryptKey(value, secret) {
    const parts = value.split('.').map(s => Buffer.from(s, 'base64url'));
    if (parts.length !== 3)
        throw new Error('Formato da credencial inválido.');
    const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', Buffer.from(secret, 'hex'), parts[0]);
    decipher.setAuthTag(parts[1]);
    return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8');
}
exports.PLANS = { semanal: 7, mensal: 30, anual: 365, vitalicio: null };
function isPlan(value) { return Object.hasOwn(exports.PLANS, value); }
function expiry(plan, from) {
    const days = exports.PLANS[plan];
    return days === null ? null : new Date(from.getTime() + days * 86400000);
}
//# sourceMappingURL=crypto.js.map