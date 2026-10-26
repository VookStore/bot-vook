"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.welcomeButtons = void 0;
const reply_1 = require("../../components/reply");
const customIds_1 = require("../../constants/customIds");
const PermissionService_1 = require("../../core/permissions/PermissionService");
const AutoRoleBackfillBuilder_1 = require("../../modules/welcome/builders/AutoRoleBackfillBuilder");
const AutoRoleBackfillService_1 = require("../../modules/welcome/services/AutoRoleBackfillService");
const shared_1 = require("../catalog/shared");
/**
 * Confirmacao da aplicacao retroativa do cargo de boas-vindas.
 *
 * O BOTAO NAO AUTORIZA NADA. `assertCanManageSystem` roda de novo aqui: o
 * customId nao tem argumento nenhum e nao carrega prova de quem o gerou, entao
 * qualquer membro capaz de disparar `config:autorole-backfill` cairia direto
 * numa escrita em massa se a checagem morasse so no comando.
 *
 * A operacao e IDEMPOTENTE por construcao — quem ja recebeu o cargo deixa de se
 * encaixar no filtro "sem nenhum cargo". Por isso um clique repetido, ou um
 * botao antigo achado no historico, nao causa dano: no pior caso ele varre o
 * servidor e nao encontra ninguem.
 */
const backfillButton = {
    namespace: customIds_1.NAMESPACE.CONFIG,
    action: customIds_1.CONFIG_ACTION.AUTOROLE_BACKFILL,
    async handle(interaction) {
        const { guild, member } = (0, shared_1.requireGuildContext)(interaction);
        (0, PermissionService_1.assertCanManageSystem)(member);
        await (0, reply_1.deferUpdateIfNeeded)(interaction);
        const result = await (0, AutoRoleBackfillService_1.runAutoRoleBackfill)(guild, async (applied, total) => {
            await (0, reply_1.updateV2)(interaction, (0, AutoRoleBackfillBuilder_1.buildBackfillProgress)(applied, total));
        });
        await (0, reply_1.updateV2)(interaction, (0, AutoRoleBackfillBuilder_1.buildBackfillResult)(result, result.roleId));
    },
};
exports.welcomeButtons = [backfillButton];
//# sourceMappingURL=index.js.map