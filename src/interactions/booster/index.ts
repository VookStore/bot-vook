import type { StringSelectMenuInteraction } from 'discord.js';

import { deferUpdateIfNeeded, updateV2 } from '../../components/reply';
import { BOOSTER_ACTION, NAMESPACE } from '../../constants/customIds';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { ValidationError } from '../../core/errors';
import { buildEligibilityPanel } from '../../modules/booster/builders/BoosterConfigBuilder';
import {
  getCatalogCategories,
  setBoosterEligibility,
} from '../../modules/catalog/services/CatalogCategoryService';
import type { SelectHandler } from '../../types';
import { requireGuildContext } from '../catalog/shared';

/**
 * Escolha das categorias em que o desconto de booster vale.
 *
 * O SELECT ENTREGA O ESTADO FINAL, nao um delta: o que veio marcado passa a
 * valer desconto e todo o resto deixa de valer. Aplicar como delta ("marcou,
 * liga") tornaria impossivel DESMARCAR — e desmarcar e justamente a operacao
 * que protege PEDs, roupas e props.
 *
 * A tela e redesenhada com o que o banco devolveu, nunca com o que foi enviado:
 * se uma categoria sumiu no meio do caminho, o operador ve a verdade.
 */

const eligibilitySelect: SelectHandler = {
  namespace: NAMESPACE.BOOSTER,
  action: BOOSTER_ACTION.ELIGIBILITY_SELECT,
  async handle(interaction: StringSelectMenuInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    // O customId nao autoriza nada: esta acao muda quanto a loja cobra.
    assertCanManageSystem(member);

    await deferUpdateIfNeeded(interaction);

    const categories = await getCatalogCategories(guild.id);
    const marcadas = new Set(interaction.values);

    /*
     * So as categorias exibidas sao afetadas. O painel corta em 25 (limite do
     * select); sem este filtro, uma loja com 30 categorias veria as 5 nao
     * exibidas perderem o desconto por nunca terem tido a chance de ser marcadas.
     */
    const exibidas = categories.slice(0, 25);
    if (exibidas.length === 0) {
      throw new ValidationError('Nenhuma categoria para configurar.', {
        userMessage: 'Nenhuma categoria de catalogo cadastrada ainda.',
      });
    }

    await setBoosterEligibility(
      guild.id,
      exibidas.map((category) => ({
        id: category.id,
        eligible: marcadas.has(category.id),
      })),
    );

    await updateV2(interaction, buildEligibilityPanel(await getCatalogCategories(guild.id)));
  },
};

export const boosterSelects: readonly SelectHandler[] = [eligibilitySelect];
