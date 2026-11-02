"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseConfig = licenseConfig;
exports.requireLicenses = requireLicenses;
const errors_1 = require("../../core/errors");
function licenseConfig() {
    const guildId = process.env.LICENSE_GUILD_ID || process.env.DISCORD_GUILD_ID || '';
    const secret = process.env.LICENSE_ENCRYPTION_KEY || '';
    const enabled = process.env.LICENSE_ENABLED === 'true';
    const port = Number(process.env.LICENSE_PORT || process.env.PORT || 80);
    if (enabled && (!/^\d{17,20}$/.test(guildId) || !/^[a-f\d]{64}$/i.test(secret)
        || !Number.isInteger(port) || port < 1 || port > 65535)) {
        throw new Error('Licenças: confira LICENSE_GUILD_ID, LICENSE_ENCRYPTION_KEY (64 hex) e LICENSE_PORT.');
    }
    return { enabled, guildId, secret, port,
        adminIds: (process.env.LICENSE_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
        roleIds: (process.env.LICENSE_ADMIN_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    };
}
function requireLicenses() {
    const config = licenseConfig();
    if (!config.enabled)
        throw new errors_1.ValidationError('Licenciamento não habilitado.', { userMessage: 'O módulo de licenças ainda não foi configurado pela VOOK.' });
    return config;
}
//# sourceMappingURL=config.js.map