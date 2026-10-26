import { ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ContainerBuilder } from 'discord.js';

import { addHeader, buttonRow, container, footerNote, separator, text } from '../../../components/v2';
import { COLORS, EMOJIS } from '../../../constants/branding';
import { NAMESPACE, TICKET_ACTION, buildCustomId } from '../../../constants/customIds';
import type { OrphanCleanupResult, OrphanThread } from '../services/OrphanThreadService';

/**
 * Telas da limpeza de topicos orfaos.
 *
 * A previa lista NOME e CANAL de cada topico antes de qualquer remocao. Apagar
 * canal nao tem desfazer, e a lista e curta o bastante para caber — nao existe
 * motivo para o operador confirmar no escuro.
 */

const TITLE = 'TOPICOS ORFAOS';

/** Quantos topicos sao listados por nome antes de virar contagem. */
const LISTED = 15;

/**
 * O corte vai no customId.
 *
 * Ao clicar, o handler varre de novo e so apaga o que ja existia no momento da
 * previa. Um ticket aberto entre a previa e o clique fica de fora mesmo que a
 * abertura dele tenha falhado — o operador nunca o viu na lista, e apagar o que
 * nao foi mostrado e exatamente o que uma confirmacao deveria impedir.
 */
export function buildOrphanCleanupButton(cutoff: Date): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(
      buildCustomId(NAMESPACE.TICKET, TICKET_ACTION.CLEAN_ORPHANS, String(cutoff.getTime())),
    )
    .setLabel('Apagar os listados')
    .setEmoji(EMOJIS.DELETE)
    .setStyle(ButtonStyle.Secondary);
}

/** Previa: o que existe e o botao que apaga. */
export function buildOrphanPreview(orphans: readonly OrphanThread[], cutoff: Date): ContainerBuilder {
  const root = container(orphans.length === 0 ? COLORS.SUCCESS : COLORS.WARNING);
  addHeader(root, TITLE);

  if (orphans.length === 0) {
    root.addTextDisplayComponents(
      text(
        'Nenhum topico de ticket sem registro no banco.\n' +
          '-# Sao varridos apenas os topicos ativos dos canais de atendimento.',
      ),
    );
    return root;
  }

  root.addTextDisplayComponents(
    text(
      `**${orphans.length}** topico(s) com nome de ticket nao tem registro no banco. ` +
        'Eles sobraram de aberturas que falharam depois de o topico ser criado — ' +
        'estao vazios e ninguem consegue fecha-los pelo bot.',
    ),
  );

  root.addSeparatorComponents(separator());

  const linhas = orphans
    .slice(0, LISTED)
    .map((orphan) => `• **${orphan.name}** — <#${orphan.parentId}>`);

  const resto = orphans.length - linhas.length;
  if (resto > 0) linhas.push(`-# e mais ${resto}`);

  root.addTextDisplayComponents(text(linhas.join('\n')));
  root.addSeparatorComponents(separator());
  root.addActionRowComponents(buttonRow(buildOrphanCleanupButton(cutoff)));
  root.addTextDisplayComponents(
    footerNote('Apagar um topico nao tem desfazer. Nenhum ticket registrado e tocado.'),
  );

  return root;
}

/** Resultado da limpeza. */
export function buildOrphanCleanupResult(result: OrphanCleanupResult): ContainerBuilder {
  const root = container(result.failed > 0 ? COLORS.WARNING : COLORS.SUCCESS);
  addHeader(root, TITLE);

  const linhas = [`**${result.deleted}** topico(s) removido(s).`];
  if (result.failed > 0) {
    linhas.push(
      `-# ${result.failed} nao pode(m) ser removido(s) — ou ja sumiu(ram), ou o bot perdeu acesso.`,
    );
  }

  root.addTextDisplayComponents(text(linhas.join('\n')));
  return root;
}
