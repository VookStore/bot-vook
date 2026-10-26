import { ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ContainerBuilder } from 'discord.js';

import { addHeader, buttonRow, container, fields, footerNote, separator, text } from '../../../components/v2';
import { COLORS, EMOJIS } from '../../../constants/branding';
import { CONFIG_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { roleMention } from '../../../utils/discord';
import type {
  AutoRoleBackfillPreview,
  AutoRoleBackfillResult,
} from '../services/AutoRoleBackfillService';

/**
 * Telas da aplicacao retroativa do cargo de boas-vindas.
 *
 * A previa NAO e enfeite. O comando escreve em centenas de membros de uma vez e
 * nao existe desfazer: o operador precisa ver o nome do cargo e a contagem
 * exata antes de confirmar, porque "aplicar o cargo errado em 300 pessoas" e um
 * estrago que so se limpa a mao.
 */

const TITLE = 'CARGO DE BOAS-VINDAS — APLICAR RETROATIVAMENTE';

/**
 * Painel de previa: o que aconteceria, e o botao que faz acontecer.
 *
 * `readOnly` desenha tudo menos o botao. E o que separa `/cargo-automatico
 * previa` de `aplicar`: qualquer administrador pode conferir a contagem sem
 * ter um botao destrutivo a um clique de distancia.
 */
export function buildBackfillPreview(
  preview: AutoRoleBackfillPreview,
  options: { readOnly?: boolean } = {},
): ContainerBuilder {
  const root = container(preview.blocker === null ? COLORS.INFO : COLORS.WARNING);
  addHeader(root, TITLE);

  root.addTextDisplayComponents(
    text(
      fields([
        ['Cargo', roleMention(preview.roleId)],
        ['Membros humanos', String(preview.humans)],
        ['Sem nenhum cargo', String(preview.targets)],
      ]),
    ),
  );

  root.addSeparatorComponents(separator());

  if (preview.blocker !== null) {
    root.addTextDisplayComponents(
      text(`⚠️ **Nao da para aplicar agora.**\n${preview.blocker}`),
    );
    return root;
  }

  if (preview.targets === 0) {
    root.addTextDisplayComponents(
      text('Todos os membros do servidor ja possuem pelo menos um cargo. Nada a fazer.'),
    );
    return root;
  }

  const alvos =
    preview.targets === 1 ? '**1 membro**' : `**${preview.targets} membros**`;

  root.addTextDisplayComponents(
    text(
      `${alvos} sem cargo nenhum vao receber ${roleMention(preview.roleId)}.\n` +
        'Quem ja tem qualquer outro cargo NAO sera tocado.',
    ),
  );

  if (preview.batch < preview.targets) {
    root.addTextDisplayComponents(
      text(
        `-# Esta rodada atende ${preview.batch}. Rode o comando de novo para continuar de onde parou.`,
      ),
    );
  }

  if (!preview.enabled) {
    root.addTextDisplayComponents(
      // O toggle governa quem ENTRA. Quem rodou este comando pediu o retroativo
      // de propósito, entao ele acontece — mas dizendo o que esta desligado.
      text(
        '-# O cargo automatico esta **desativado** para novos membros. ' +
          'Isto aqui aplica mesmo assim, so nos que ja estao no servidor.',
      ),
    );
  }

  if (options.readOnly === true) {
    root.addTextDisplayComponents(
      footerNote('Use `/cargo-automatico aplicar` para executar.'),
    );
    return root;
  }

  root.addSeparatorComponents(separator());

  root.addActionRowComponents(
    buttonRow(
      new ButtonBuilder()
        .setCustomId(buildCustomId(NAMESPACE.CONFIG, CONFIG_ACTION.AUTOROLE_BACKFILL))
        .setLabel('Aplicar agora')
        .setEmoji(EMOJIS.WELCOME)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  root.addTextDisplayComponents(footerNote('Nao existe desfazer automatico desta acao.'));

  return root;
}

/** Mensagem enquanto a varredura acontece. */
export function buildBackfillProgress(applied: number, total: number): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLE);
  root.addTextDisplayComponents(
    text(`Aplicando... **${applied}** de **${total}** membros.`),
    footerNote('Nao rode o comando de novo enquanto isto termina.'),
  );
  return root;
}

/** Resultado final. */
export function buildBackfillResult(
  result: AutoRoleBackfillResult,
  roleId: string,
): ContainerBuilder {
  const root = container(result.failed > 0 ? COLORS.WARNING : COLORS.SUCCESS);
  addHeader(root, TITLE);

  root.addTextDisplayComponents(
    text(
      fields([
        ['Cargo aplicado', roleMention(roleId)],
        ['Membros atendidos', String(result.applied)],
        ...(result.failed > 0 ? [['Falhas', String(result.failed)] as [string, string]] : []),
        ...(result.remaining > 0
          ? [['Ainda sem cargo', String(result.remaining)] as [string, string]]
          : []),
      ]),
    ),
  );

  if (result.remaining > 0) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(
      text(
        `-# Sobraram ${result.remaining} por causa do teto desta rodada. ` +
          'Rode `/cargo-automatico aplicar` de novo para continuar.',
      ),
    );
  }

  if (result.firstError !== null) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(text(`-# Primeira falha: ${result.firstError}`));
  }

  return root;
}
