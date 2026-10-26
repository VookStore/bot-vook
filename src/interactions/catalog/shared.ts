import { GuildMember, MessageFlags } from 'discord.js';
import type {
  AnySelectMenuInteraction,
  AttachmentBuilder,
  ButtonInteraction,
  ContainerBuilder,
  Guild,
  ModalSubmitInteraction,
  RepliableInteraction,
} from 'discord.js';

import { deferIfNeeded, deferUpdateIfNeeded, editReplyV2 } from '../../components/reply';
import { PermissionError, ValidationError } from '../../core/errors';

/**
 * Utilitarios compartilhados pelos handlers de catalogo, carrinho e pedidos.
 *
 * O ponto central aqui e `beginPanel`/`showPanel`: o MESMO botao pode estar num
 * painel publico fixo (canal do catalogo) ou dentro da loja efemera do cliente.
 * No painel publico, `update` reescreveria a mensagem que todo mundo ve; na
 * loja efemera, responder cria uma segunda mensagem e quebra a continuidade.
 * Por isso a decisao e tomada pela origem da interacao, nao pelo customId.
 */

export type ComponentSource = ButtonInteraction | AnySelectMenuInteraction;

/** True quando o componente clicado vive em uma mensagem efemera. */
export function isEphemeralSource(interaction: ComponentSource): boolean {
  return interaction.message.flags.has(MessageFlags.Ephemeral);
}

/**
 * Prepara a resposta: atualiza a mensagem efemera atual ou abre uma nova
 * resposta privada quando o clique veio de um painel publico.
 */
export async function beginPanel(interaction: ComponentSource): Promise<void> {
  if (isEphemeralSource(interaction)) {
    await deferUpdateIfNeeded(interaction);
    return;
  }
  await deferIfNeeded(interaction, { ephemeral: true });
}

/**
 * Entrega o painel (funciona depois de `beginPanel` nos dois caminhos).
 * `files` serve para paineis que carregam imagem — o QR do pedido, por exemplo.
 */
export async function showPanel(
  interaction: RepliableInteraction,
  root: ContainerBuilder,
  options: { files?: readonly AttachmentBuilder[] } = {},
): Promise<void> {
  await editReplyV2(interaction, root, options.files === undefined ? {} : { files: options.files });
}

/** Contexto de guild garantido (o router ja filtra, isto fecha o tipo). */
export interface GuildContext {
  guild: Guild;
  member: GuildMember;
}

export function requireGuildContext(
  interaction: RepliableInteraction | ModalSubmitInteraction,
): GuildContext {
  const { guild, member } = interaction;
  if (guild === null || !(member instanceof GuildMember)) {
    throw new PermissionError('Interacao de catalogo fora de uma guild em cache.', {
      userMessage: 'Esta acao so pode ser usada dentro do servidor.',
      context: { userId: interaction.user.id, guildId: interaction.guildId },
    });
  }
  return { guild, member };
}

/** Valor selecionado em um select de texto. */
export function readSelectedValue(interaction: AnySelectMenuInteraction): string {
  if (!interaction.isStringSelectMenu()) {
    throw new ValidationError('Select com tipo inesperado.', {
      userMessage: 'Este componente esta invalido. Atualize o painel e tente novamente.',
    });
  }
  const value = interaction.values[0];
  if (value === undefined || value.length === 0) {
    throw new ValidationError('Select sem valor.', {
      userMessage: 'Nenhuma opcao foi selecionada. Tente novamente.',
    });
  }
  return value;
}

/**
 * Campo opcional de modal.
 * Um input opcional em branco pode nem vir no payload; nesse caso vale como
 * texto vazio, em vez de derrubar o envio do formulario inteiro.
 */
export function optionalField(interaction: ModalSubmitInteraction, customId: string): string {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return '';
  }
}

/** Numero de pagina vindo do customId (1 quando ausente ou invalido). */
export function parsePage(raw: string | undefined): number {
  const page = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/** Indice de imagem vindo do customId (0 quando ausente ou invalido). */
export function parseIndex(raw: string | undefined): number {
  const index = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(index) ? index : 0;
}

/** Recorta uma pagina de uma lista ja ordenada. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  size: number,
): { items: T[]; page: number; totalPages: number; total: number } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  const start = (safePage - 1) * size;
  return { items: items.slice(start, start + size), page: safePage, totalPages, total };
}
