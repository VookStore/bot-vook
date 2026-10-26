import { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import type { CatalogCategory, GuildConfig } from '@prisma/client';
import type { ContainerBuilder } from 'discord.js';

import { addHeader, container, footerNote, selectRow, separator, text } from '../../../components/v2';
import { COLORS } from '../../../constants/branding';
import { BOOSTER_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { DISCORD_LIMITS } from '../../../constants/limits';
import { roleMention } from '../../../utils/discord';
import { truncate } from '../../../utils/sanitize';

/**
 * Telas de configuracao do desconto automatico de booster.
 *
 * O QUE ESTA TELA PRECISA DEIXAR OBVIO: o desconto so acontece quando os DOIS
 * lados estao definidos — o cargo (quem ganha) e o cupom (quanto). Meia
 * configuracao nao aplica nada, e o modo de falha e silencioso; quem configurou
 * so o cargo acharia que ligou.
 */

const TITLE = 'DESCONTO DE BOOSTER';

/** Estado atual da automacao, em uma tela. */
export function buildDiscountStatus(
  config: GuildConfig,
  couponLabels: { tier1: string | null; tier2: string | null },
): ContainerBuilder {
  const ligado = config.boosterRoleId !== null && config.boosterCouponId !== null;
  const root = container(ligado ? COLORS.SUCCESS : COLORS.WARNING);
  addHeader(root, TITLE);

  if (!ligado) {
    root.addTextDisplayComponents(
      text(
        '**Desligado.** Nenhum desconto e aplicado sozinho — a equipe continua ' +
          'lancando o cupom a mao no atendimento.',
      ),
    );
    return root;
  }

  const linhas = [
    `**1 boost** — ${roleMention(config.boosterRoleId as string)} recebe \`${couponLabels.tier1 ?? '?'}\``,
  ];

  if (config.boosterTier2RoleId !== null && config.boosterTier2CouponId !== null) {
    linhas.push(
      `**2 boosts** — ${roleMention(config.boosterTier2RoleId)} recebe \`${couponLabels.tier2 ?? '?'}\``,
    );
  } else {
    linhas.push(
      '-# Degrau de 2 boosts nao configurado: todo booster recebe o desconto do primeiro degrau.',
    );
  }

  root.addTextDisplayComponents(text(linhas.join('\n')));
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    footerNote(
      'Aplicado na criacao do pedido. Pedido com cupom da equipe nao e alterado, ' +
        'e o desconto nao entra se houver item de categoria nao elegivel.',
    ),
  );

  return root;
}

/**
 * Seletor de categorias elegiveis.
 *
 * MULTI-SELECT COM O ESTADO ATUAL PRE-MARCADO: o que estiver selecionado ao
 * confirmar passa a valer desconto, e o que sair deixa de valer. Uma lista de
 * "marque para excluir" seria a mesma informacao invertida e mais facil de ler
 * errado — aqui o que esta marcado e o que o cliente ganha.
 */
export function buildEligibilitySelect(
  categories: readonly CatalogCategory[],
): StringSelectMenuBuilder {
  const options = categories
    .slice(0, DISCORD_LIMITS.SELECT_OPTIONS)
    .map((category) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(category.name, 100))
        .setValue(category.id)
        .setDefault(category.boosterEligible),
    );

  return new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.BOOSTER, BOOSTER_ACTION.ELIGIBILITY_SELECT))
    .setPlaceholder('Categorias em que o desconto vale')
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);
}

/** Tela de escolha das categorias. */
export function buildEligibilityPanel(
  categories: readonly CatalogCategory[],
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, `${TITLE} — CATEGORIAS`);

  if (categories.length === 0) {
    root.addTextDisplayComponents(
      text('Nenhuma categoria de catalogo cadastrada ainda.'),
    );
    return root;
  }

  root.addTextDisplayComponents(
    text(
      'Marque as categorias em que o desconto de booster **vale**. As desmarcadas ' +
        'ficam de fora — e um pedido que tenha qualquer item delas nao recebe desconto ' +
        'automatico nenhum.',
    ),
  );

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(selectRow(buildEligibilitySelect(categories)));

  const excluidas = categories.filter((category) => !category.boosterEligible);
  root.addTextDisplayComponents(
    footerNote(
      excluidas.length === 0
        ? 'Hoje o desconto vale em todas as categorias.'
        : `Hoje fora: ${excluidas.map((category) => category.name).join(', ')}.`,
    ),
  );

  return root;
}
