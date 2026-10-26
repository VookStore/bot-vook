import type { ButtonInteraction } from 'discord.js';

import { deferUpdateIfNeeded, updateV2 } from '../../components/reply';
import { CONFIG_ACTION, NAMESPACE } from '../../constants/customIds';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import {
  buildBackfillProgress,
  buildBackfillResult,
} from '../../modules/welcome/builders/AutoRoleBackfillBuilder';
import { runAutoRoleBackfill } from '../../modules/welcome/services/AutoRoleBackfillService';
import type { ButtonHandler } from '../../types';
import { requireGuildContext } from '../catalog/shared';

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

const backfillButton: ButtonHandler = {
  namespace: NAMESPACE.CONFIG,
  action: CONFIG_ACTION.AUTOROLE_BACKFILL,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    assertCanManageSystem(member);

    await deferUpdateIfNeeded(interaction);

    const result = await runAutoRoleBackfill(guild, async (applied, total) => {
      await updateV2(interaction, buildBackfillProgress(applied, total));
    });

    await updateV2(interaction, buildBackfillResult(result, result.roleId));
  },
};

export const welcomeButtons: readonly ButtonHandler[] = [backfillButton];
