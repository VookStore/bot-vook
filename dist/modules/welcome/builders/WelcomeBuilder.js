"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWelcomeCard = buildWelcomeCard;
const v2_1 = require("../../../components/v2");
const branding_1 = require("../../../constants/branding");
const sanitize_1 = require("../../../utils/sanitize");
const time_1 = require("../../../utils/time");
/** Contagem de membros formatada em pt-BR ("1.234"). */
function formatMemberCount(memberCount) {
    const safe = Number.isFinite(memberCount) ? Math.max(0, Math.trunc(memberCount)) : 0;
    return safe.toLocaleString('pt-BR');
}
function buildWelcomeCard(data) {
    const root = (0, v2_1.container)(branding_1.COLORS.BRAND);
    (0, v2_1.addHeader)(root, branding_1.TITLES.WELCOME, {
        thumbnailUrl: (0, sanitize_1.isSafeImageUrl)(data.guildIconUrl) ? data.guildIconUrl : null,
        // `null` explicito: a logo entra sem texto alternativo.
        thumbnailDescription: null,
    });
    const previewNotice = data.isPreview
        ? '⚠️ **PRE-VISUALIZACAO** — esta e uma amostra do cartao de boas-vindas.\n' +
            'Nenhum membro foi notificado e nenhum cargo foi aplicado.\n\n'
        : '';
    root.addTextDisplayComponents((0, v2_1.text)(`${previewNotice}${branding_1.EMOJIS.WELCOME} Seja muito bem-vindo, <@${data.userId}>!`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.text)(`**Conta criada** ${(0, time_1.discordTimestamp)(data.accountCreatedAt, 'R')}\n` +
        `**Entrou** ${(0, time_1.discordTimestamp)(data.joinedAt, 'F')}`));
    if ((0, sanitize_1.isSafeImageUrl)(data.bannerUrl)) {
        root.addMediaGalleryComponents((0, v2_1.mediaGallery)([data.bannerUrl], data.storeName));
    }
    root.addTextDisplayComponents((0, v2_1.text)(`📈 Agora somos **${formatMemberCount(data.memberCount)}** membros.`));
    root.addSeparatorComponents((0, v2_1.separator)());
    root.addTextDisplayComponents((0, v2_1.footerNote)(`ID: ${data.userId}`));
    return root;
}
//# sourceMappingURL=WelcomeBuilder.js.map