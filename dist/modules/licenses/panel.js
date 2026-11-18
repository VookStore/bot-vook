"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.details = details;
exports.detailPanel = detailPanel;
exports.listPanel = listPanel;
exports.packagesPanel = packagesPanel;
const discord_js_1 = require("discord.js");
const v2_1 = require("../../components/v2");
const prisma_1 = require("../../core/database/prisma");
const config_1 = require("./config");
const service_1 = require("./service");
const releases_1 = require("./releases");
const products_1 = require("./products");
const customIds_1 = require("../../constants/customIds");
function details(l) {
    const expiry = l.expiresAt ? `<t:${Math.floor(l.expiresAt.getTime() / 1000)}:F>` : l.plan === 'vitalicio' ? 'Nunca expira' : 'Após a primeira ativação';
    return `**${(0, products_1.productLabel)(l.product)} · ${l.plan}**\nAmbiente: **${(0, service_1.environmentLabel)(l.environment)}**\nEstado: ${(0, service_1.licenseStatus)(l)}\nVencimento: ${expiry}\nServidor: ${l.installationHash ? 'Vinculado' : 'Não vinculado'}\nCódigo: ••••${l.keySuffix}\nID: \`${l.id}\``;
}
function detailPanel(l, message) {
    return (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Sua licença'), (0, v2_1.text)((message ? message + '\n\n' : '') + details(l)))
        .addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.PACKAGES, l.id, '0')).setLabel('Baixar script com licença configurada').setStyle(discord_js_1.ButtonStyle.Secondary)))
        .addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.KEY, l.id)).setLabel('Ver código de ativação').setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.VIEW, l.id)).setLabel('Atualizar').setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.LIST, '0')).setLabel('Meus planos').setStyle(discord_js_1.ButtonStyle.Secondary)));
}
async function listPanel(userId, page = 0) {
    const guildId = (0, config_1.requireLicenses)().guildId;
    const where = { guildId, ownerId: userId };
    const total = await (0, prisma_1.getPrisma)().scriptLicense.count({ where });
    const last = Math.max(0, Math.ceil(total / 5) - 1);
    page = Math.min(last, Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0));
    const rows = await (0, prisma_1.getPrisma)().scriptLicense.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: page * 5, take: 5 });
    const panel = (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Meus planos'), (0, v2_1.text)(total ? `Escolha o produto e o ambiente para baixar. Cada ambiente tem vínculo e validade próprios. Licenças anteriores mantêm o vínculo original.\nPágina ${page + 1}/${last + 1}` : 'Você ainda não possui licenças.'));
    for (const l of rows)
        panel.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.VIEW, l.id)).setLabel(`${(0, products_1.productLabel)(l.product)} · ${l.environment === 'TEST' ? 'Testes' : l.environment === 'PRODUCTION' ? 'Produção' : 'Anterior'} · ${(0, service_1.licenseStatus)(l)} · ${l.keySuffix}`.slice(0, 80)).setStyle(discord_js_1.ButtonStyle.Secondary)));
    if (total > 5)
        panel.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.LIST, String(Math.max(0, page - 1)))).setLabel('Anterior').setDisabled(page === 0).setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.LIST, String(page + 1))).setLabel('Próxima').setDisabled(page === last).setStyle(discord_js_1.ButtonStyle.Secondary)));
    return panel;
}
async function packagesPanel(licenseId, ownerId, requestedPage = 0) {
    const { license, releases, page, last } = await (0, releases_1.availableReleases)(licenseId, ownerId, requestedPage);
    const panel = (0, v2_1.container)().addTextDisplayComponents((0, v2_1.heading)('VOOK · Download do script'), (0, v2_1.text)(`**${(0, products_1.productLabel)(license.product)} · ${(0, service_1.environmentLabel)(license.environment)}**\n${releases.length ? 'Escolha a edição e versão. O ZIP já vem com sua licença configurada. A primeira ativação vincula este ambiente à edição e ao servidor escolhidos.' : 'Ainda não há versão final publicada para esta licença. A VOOK precisa preparar e revisar o pacote.'}\nPágina ${page + 1}/${last + 1}`));
    for (const r of releases)
        panel.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.DOWNLOAD, license.id, r.id)).setLabel(`${(0, products_1.productLabel)(r.product)} · ${r.version}`).setStyle(discord_js_1.ButtonStyle.Secondary)));
    panel.addActionRowComponents((0, v2_1.buttonRow)(new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.PACKAGES, license.id, String(Math.max(0, page - 1)))).setLabel('Anterior').setDisabled(page === 0).setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.PACKAGES, license.id, String(page + 1))).setLabel('Próxima').setDisabled(page === last).setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder().setCustomId((0, customIds_1.buildCustomId)(customIds_1.NAMESPACE.LICENSE, customIds_1.LICENSE_ACTION.VIEW, license.id)).setLabel('Minha licença').setStyle(discord_js_1.ButtonStyle.Secondary)));
    return panel;
}
//# sourceMappingURL=panel.js.map