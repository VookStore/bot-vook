import { ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ScriptLicense } from '@prisma/client';
import { container, heading, text, buttonRow } from '../../components/v2';
import { getPrisma } from '../../core/database/prisma';
import { requireLicenses } from './config';
import { licenseStatus } from './service';
import { buildCustomId, NAMESPACE, LICENSE_ACTION } from '../../constants/customIds';
export function details(l: ScriptLicense) {
    const expiry = l.expiresAt ? `<t:${Math.floor(l.expiresAt.getTime() / 1000)}:F>` : l.plan === 'vitalicio' ? 'Nunca expira' : 'Após a primeira ativação';
    return `**Pelúcias · ${l.plan}**\nEstado: ${licenseStatus(l)}\nVencimento: ${expiry}\nServidor: ${l.installationHash ? 'Vinculado' : 'Não vinculado'}\nCódigo: ••••${l.keySuffix}\nID: \`${l.id}\``;
}
export function detailPanel(l: ScriptLicense, message?: string) {
    return container().addTextDisplayComponents(heading('VOOK · Sua licença'), text((message ? message + '\n\n' : '') + details(l)))
        .addActionRowComponents(buttonRow(new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.LICENSE, LICENSE_ACTION.KEY, l.id)).setLabel('Ver código de ativação').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.LICENSE, LICENSE_ACTION.VIEW, l.id)).setLabel('Atualizar').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.LICENSE, LICENSE_ACTION.LIST, '0')).setLabel('Meus planos').setStyle(ButtonStyle.Secondary)));
}
export async function listPanel(userId: string, page = 0) {
    const guildId = requireLicenses().guildId;
    const where = { guildId, ownerId: userId };
    const total = await getPrisma().scriptLicense.count({ where });
    const last = Math.max(0, Math.ceil(total / 5) - 1);
    page = Math.min(last, Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0));
    const rows = await getPrisma().scriptLicense.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: page * 5, take: 5 });
    const panel = container().addTextDisplayComponents(heading('VOOK · Meus planos'), text(total ? `Suas licenças · Página ${page + 1}/${last + 1}` : 'Você ainda não possui licenças.'));
    for (const l of rows)
        panel.addActionRowComponents(buttonRow(new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.LICENSE, LICENSE_ACTION.VIEW, l.id)).setLabel(`Pelúcias · ${licenseStatus(l)} · ${l.keySuffix}`).setStyle(ButtonStyle.Secondary)));
    if (total > 5)
        panel.addActionRowComponents(buttonRow(new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.LICENSE, LICENSE_ACTION.LIST, String(Math.max(0, page - 1)))).setLabel('Anterior').setDisabled(page === 0).setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE.LICENSE, LICENSE_ACTION.LIST, String(page + 1))).setLabel('Próxima').setDisabled(page === last).setStyle(ButtonStyle.Secondary)));
    return panel;
}
