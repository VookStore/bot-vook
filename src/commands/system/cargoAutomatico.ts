import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferIfNeeded, editReplyV2 } from '../../components/reply';
import { assertCanManageSystem } from '../../core/permissions/PermissionService';
import { buildBackfillPreview } from '../../modules/welcome/builders/AutoRoleBackfillBuilder';
import { previewAutoRoleBackfill } from '../../modules/welcome/services/AutoRoleBackfillService';
import type { GuildChatInputInteraction, SlashCommandDefinition } from '../../types';

/**
 * /cargo-automatico previa | aplicar
 *
 * Aplica o cargo de boas-vindas (o mesmo de `/ticket-config geral`) a quem esta
 * no servidor SEM NENHUM cargo. Serve para fechar o buraco de quem entrou antes
 * de o cargo existir, ou enquanto ele estava desligado.
 *
 * AS DUAS SUBCOMANDOS MOSTRAM A MESMA PREVIA. A diferenca e so o botao: em
 * `previa` ele nao aparece. Isso deixa qualquer administrador conferir a
 * contagem sem correr o risco de um clique errado abrir a operacao.
 */

const builder = new SlashCommandBuilder()
  .setName('cargo-automatico')
  .setDescription('Aplica o cargo de boas-vindas em quem esta sem nenhum cargo')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('previa')
      .setDescription('Mostra quantos membros receberiam o cargo, sem aplicar nada'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('aplicar')
      .setDescription('Mostra a previa e libera o botao para aplicar o cargo'),
  );

async function execute(interaction: GuildChatInputInteraction): Promise<void> {
  /*
   * `setDefaultMemberPermissions` some do lado do servidor quando um admin
   * reconfigura as permissoes do comando na interface do Discord. A checagem
   * aqui e a que realmente vale — escrever em centenas de membros nao pode
   * depender de uma configuracao que outra pessoa consegue afrouxar.
   */
  assertCanManageSystem(interaction.member);

  // A varredura busca a lista completa de membros pelo gateway: passa fácil
  // dos 3 segundos de prazo da interacao num servidor grande.
  await deferIfNeeded(interaction, { ephemeral: true });

  const preview = await previewAutoRoleBackfill(interaction.guild);
  const somenteLeitura = interaction.options.getSubcommand() === 'previa';

  await editReplyV2(interaction, buildBackfillPreview(preview, { readOnly: somenteLeitura }));
}

export const cargoAutomaticoCommand: SlashCommandDefinition = {
  builder,
  guildOnly: true,
  execute,
};
