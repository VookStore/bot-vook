import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

import { deferIfNeeded, editReplyV2, successContainer } from '../../components/reply';
import { NAMESPACE, WOLF_ACTION } from '../../constants/customIds';
import { ValidationError } from '../../core/errors';
import { assertCanPublishWolfPortfolio } from '../../core/permissions/PermissionService';
import { messageUrl } from '../../utils/discord';
import { getGuildConfig } from '../../modules/configuration/services/GuildConfigService';
import {
  WOLF_FIELD,
  buildWolfModal,
  readWolfSubmission,
} from '../../modules/wolves/builders/WolfBuilders';
import {
  publishWolfPost,
  resolvePortfolioChannel,
} from '../../modules/wolves/services/WolfPortfolioService';
import { effectiveRenderLimit } from '../../modules/wolves/validators/render';
import { isAssetHostingEnabled } from '../../modules/hosting/AssetHostingService';
import type { ButtonHandler, ModalHandler } from '../../types';
import { requireGuildContext } from '../catalog/shared';

/**
 * Painel de lobos: botao -> formulario -> post no portfolio.
 *
 * A permissao e conferida nos DOIS passos. O botao confere para nao abrir um
 * formulario inutil; o envio confere de novo porque e outra interacao — entre
 * abrir e enviar, o cargo pode ter sido retirado, e o customId nunca autoriza
 * nada.
 */

/** Texto de um campo; ausente e vazio significam a mesma coisa. */
function readText(interaction: ModalSubmitInteraction, customId: string): string {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    // Campo opcional nao preenchido pode nem chegar no payload.
    return '';
  }
}

const createButton: ButtonHandler = {
  namespace: NAMESPACE.WOLF,
  action: WOLF_ACTION.CREATE,
  async handle(interaction: ButtonInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanPublishWolfPortfolio(member);

    /*
     * O destino e conferido ANTES do formulario.
     *
     * O modal nao guarda nada se o envio falhar. Descobrir que o portfolio
     * sumiu (ou perdeu a permissao de anexo) depois de digitar tudo e anexar o
     * render custaria o formulario inteiro.
     */
    const config = await getGuildConfig(guild.id);
    await resolvePortfolioChannel(guild, config.wolfPortfolioChannelId);

    // `showModal` precisa ser a PRIMEIRA resposta da interacao — nada de defer.
    // O teto no formulario e o que o BOT consegue reenviar neste servidor (nivel
    // de impulsos) — nunca o `attachmentSizeLimit` da interacao, que inclui o
    // Nitro de quem clicou (ver `guildUploadLimit`).
    await interaction.showModal(buildWolfModal(effectiveRenderLimit(guild, isAssetHostingEnabled())));
  },
};

const createModal: ModalHandler = {
  namespace: NAMESPACE.WOLF,
  action: WOLF_ACTION.CREATE_MODAL,
  async handle(interaction: ModalSubmitInteraction): Promise<void> {
    const { guild, member } = requireGuildContext(interaction);
    await assertCanPublishWolfPortfolio(member);

    // Valida ANTES do defer: erro de preenchimento responde direto, sem a
    // mensagem "pensando..." que o defer deixaria na tela.
    const submission = readWolfSubmission({
      customer: readText(interaction, WOLF_FIELD.CUSTOMER),
      kind: interaction.fields.getStringSelectValues(WOLF_FIELD.KIND)[0],
      personalization: readText(interaction, WOLF_FIELD.PERSONALIZATION),
      additional: readText(interaction, WOLF_FIELD.ADDITIONAL),
    });

    const file = interaction.fields.getUploadedFiles(WOLF_FIELD.RENDER)?.first();
    if (file === undefined) {
      throw new ValidationError('Formulario de lobo sem render.', {
        userMessage: 'Anexe o render do lobo e envie de novo.',
      });
    }

    // Download + reenvio do render passam facil dos 3 segundos da interacao —
    // com 100 MB, podem levar minutos. O defer segura a resposta por ate 15.
    await deferIfNeeded(interaction, { ephemeral: true });

    const message = await publishWolfPost({
      guild,
      actorId: member.id,
      submission,
      render: {
        url: file.url,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
      },
      maxRenderBytes: effectiveRenderLimit(guild, isAssetHostingEnabled()),
    });

    await editReplyV2(
      interaction,
      successContainer(
        `Lobo publicado no portfólio: ${messageUrl(guild.id, message.channelId, message.id)}`,
        { footer: 'Errou algo? Apague a mensagem no canal e publique de novo pelo painel.' },
      ),
    );
  },
};

export const wolfButtons: ButtonHandler[] = [createButton];

export const wolfModals: ModalHandler[] = [createModal];
