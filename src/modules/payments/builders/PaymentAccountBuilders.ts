import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { PixKeyType, type PaymentAccount } from '@prisma/client';

import {
  addHeader,
  buttonRow,
  container,
  fields,
  footerNote,
  selectRow,
  separator,
  text,
} from '../../../components/v2';
import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { ACCOUNT_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import { ValidationError } from '../../../core/errors';
import { truncate } from '../../../utils/sanitize';
import {
  ACCOUNT_NAME_MAX,
  DEFAULT_EXPIRATION_MINUTES,
  EXPIRATION_MAX_MINUTES,
  EXPIRATION_MIN_MINUTES,
} from '../services/PaymentAccountService';
import { describePixKeyType } from '../validators/PixKeyValidator';
import { normalizePixText } from '../services/PixPayloadService';

/**
 * Paineis administrativos das contas PIX (Components V2).
 *
 * PRIVACIDADE: nenhuma listagem mostra a chave PIX completa. Toda exibicao
 * passa por `maskPixKey`. A chave inteira so aparece no modal de edicao, que e
 * privado do administrador que o abriu.
 */

/**
 * Acoes roteadas deste painel.
 *
 * Tipar as acoes (em vez de aceitar `string`) impede o defeito mais silencioso
 * da casa: um builder emitir `account:edit-selct` que nenhum handler escuta.
 */
export type AccountAction = (typeof ACCOUNT_ACTION)[keyof typeof ACCOUNT_ACTION];

/** Acoes que apresentam o select de contas. */
export type AccountSelectAction =
  | typeof ACCOUNT_ACTION.EDIT_SELECT
  | typeof ACCOUNT_ACTION.TOGGLE_SELECT
  | typeof ACCOUNT_ACTION.DELETE_SELECT;

/** Ids dos campos dentro do modal (nao sao roteados: valem so dentro do form). */
export const ACCOUNT_FIELD = {
  NAME: 'name',
  RECEIVER: 'receiver',
  PIX_KEY: 'pix-key',
  CITY: 'city',
  TYPE_EXPIRATION: 'type-expiration',
} as const;

/**
 * Orcamento de texto da listagem. Fica abaixo do teto de uma mensagem V2 para
 * sobrar espaco ao cabecalho, aos rodapes e ao botao de retorno.
 */
const LIST_TEXT_BUDGET = Math.floor(DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL * 0.75);

const MASK_CHAR = '•';
const MASK_VISIBLE_CHARS = 4;
/** Teto de marcadores para nao gerar uma linha gigante com UUID. */
const MASK_MAX_HIDDEN = 12;

/**
 * Versao segura da chave PIX para exibicao em painel.
 * Mostra apenas os ultimos caracteres; e-mail vira `a***@dominio`.
 */
export function maskPixKey(key: string, type: PixKeyType): string {
  const raw = String(key ?? '').trim();
  if (raw.length === 0) return MASK_CHAR.repeat(MASK_VISIBLE_CHARS);

  if (type === PixKeyType.EMAIL) {
    const at = raw.lastIndexOf('@');
    if (at > 0 && at < raw.length - 1) {
      const local = raw.slice(0, at);
      const domain = raw.slice(at + 1);
      const head = local.length > 1 ? local.slice(0, 1) : '';
      return `${head}***@${domain}`;
    }
  }

  if (raw.length <= MASK_VISIBLE_CHARS) return MASK_CHAR.repeat(raw.length);

  const hidden = Math.min(MASK_MAX_HIDDEN, raw.length - MASK_VISIBLE_CHARS);
  return `${MASK_CHAR.repeat(hidden)}${raw.slice(-MASK_VISIBLE_CHARS)}`;
}

function isUsable(account: PaymentAccount): boolean {
  return account.enabled && account.deletedAt === null;
}

function statusLabel(account: PaymentAccount): string {
  return isUsable(account) ? `${EMOJIS.ENABLE} Ativa` : `${EMOJIS.DISABLE} Inativa`;
}

function accountButton(
  action: AccountAction,
  label: string,
  style: ButtonStyle,
  emoji: string,
  disabled: boolean,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ACCOUNT, action))
    .setLabel(truncate(label, DISCORD_LIMITS.BUTTON_LABEL))
    .setStyle(style)
    .setEmoji(emoji)
    .setDisabled(disabled);
}

/** Botao de retorno ao menu principal de contas. */
export function buildAccountBackButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ACCOUNT, ACCOUNT_ACTION.BACK))
    .setLabel('Voltar')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('↩️');
}

// ---------------------------------------------------------------------------
// Menu principal
// ---------------------------------------------------------------------------

/** Painel administrativo das contas PIX. Resposta sempre efemera. */
export function buildAccountMenu(accounts: readonly PaymentAccount[]): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.PAYMENT_ACCOUNTS);

  root.addTextDisplayComponents(
    text(
      'Cadastre aqui as contas que recebem os pagamentos PIX da Vook Store.\n' +
        'A chave completa nunca aparece em painel publico — nas listagens ela e exibida mascarada.',
    ),
  );
  root.addSeparatorComponents(separator());

  const active = accounts.filter(isUsable);
  const preferred = active[0];

  root.addTextDisplayComponents(
    text(
      fields([
        ['Contas cadastradas', String(accounts.length)],
        ['Contas ativas', String(active.length)],
        [
          'Conta padrao',
          preferred === undefined
            ? 'Nenhuma conta ativa'
            : `${preferred.name} (\`${preferred.identifier}\`)`,
        ],
      ]),
    ),
  );
  root.addSeparatorComponents(separator());

  const empty = accounts.length === 0;
  root.addActionRowComponents(
    buttonRow(
      accountButton(ACCOUNT_ACTION.CREATE, 'Criar', ButtonStyle.Secondary, EMOJIS.ADD, false),
      accountButton(ACCOUNT_ACTION.EDIT, 'Editar', ButtonStyle.Secondary, EMOJIS.EDIT, empty),
      accountButton(
        ACCOUNT_ACTION.TOGGLE,
        'Ativar/Desativar',
        ButtonStyle.Secondary,
        EMOJIS.ENABLE,
        empty,
      ),
      accountButton(ACCOUNT_ACTION.DELETE, 'Excluir', ButtonStyle.Secondary, EMOJIS.DELETE, empty),
      accountButton(ACCOUNT_ACTION.LIST, 'Listar', ButtonStyle.Secondary, EMOJIS.LIST, empty),
    ),
  );

  if (empty) {
    root.addTextDisplayComponents(
      footerNote('Nenhuma conta cadastrada. Use "Criar" para registrar a primeira.'),
    );
  } else if (active.length === 0) {
    root.addTextDisplayComponents(
      footerNote('Todas as contas estao inativas: nenhuma cobranca PIX podera ser gerada.'),
    );
  }

  return root;
}

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

/** Listagem detalhada com a chave PIX MASCARADA. Resposta sempre efemera. */
export function buildAccountList(accounts: readonly PaymentAccount[]): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.PAYMENT_ACCOUNTS);

  if (accounts.length === 0) {
    root.addTextDisplayComponents(text('Nenhuma conta PIX cadastrada neste servidor.'));
    root.addActionRowComponents(buttonRow(buildAccountBackButton()));
    return root;
  }

  // O limite de texto de uma mensagem V2 e somado entre todos os TextDisplay:
  // paramos de acrescentar contas antes de estourar, em vez de tomar 400 da API.
  const blocks: string[] = [];
  let used = 0;

  for (const account of accounts) {
    const lines = [
      `**${account.name}** \`${account.identifier}\` — ${statusLabel(account)}`,
      `${describePixKeyType(account.pixKeyType)}: \`${maskPixKey(account.pixKey, account.pixKeyType)}\``,
      `${account.receiverName} — ${account.city} · expira em ${account.defaultExpirationMinutes} min`,
    ];
    if (account.description !== null && account.description.length > 0) {
      lines.push(`-# ${account.description}`);
    }

    const block = lines.join('\n');
    if (blocks.length > 0 && used + block.length > LIST_TEXT_BUDGET) break;

    blocks.push(truncate(block, LIST_TEXT_BUDGET));
    used += block.length + 2;
  }

  root.addTextDisplayComponents(text(blocks.join('\n\n')));
  root.addSeparatorComponents(separator());

  if (accounts.length > blocks.length) {
    root.addTextDisplayComponents(
      footerNote(`Exibindo ${blocks.length} de ${accounts.length} contas cadastradas.`),
    );
  }
  root.addTextDisplayComponents(
    footerNote('Chaves exibidas de forma parcial. Abra "Editar" para conferir a chave completa.'),
  );
  root.addActionRowComponents(buttonRow(buildAccountBackButton()));

  return root;
}

// ---------------------------------------------------------------------------
// Selecao
// ---------------------------------------------------------------------------

/** Select de contas para uma acao especifica (editar, ativar, excluir). */
export function buildAccountSelect(
  accounts: readonly PaymentAccount[],
  action: AccountSelectAction,
): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.ACCOUNT, action))
    .setPlaceholder('Selecionar conta PIX')
    .setMinValues(1)
    .setMaxValues(1);

  const options = accounts.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((account) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncate(account.name, DISCORD_LIMITS.SELECT_LABEL))
      .setValue(account.id)
      .setDescription(
        truncate(
          `${account.identifier} • ${isUsable(account) ? 'ativa' : 'inativa'} • ${describePixKeyType(account.pixKeyType)}`,
          DISCORD_LIMITS.SELECT_DESCRIPTION,
        ),
      )
      .setEmoji(isUsable(account) ? EMOJIS.ENABLE : EMOJIS.DISABLE),
  );

  menu.addOptions(options);
  return menu;
}

export interface AccountSelectPanelOptions {
  /** Instrucao exibida acima do select. */
  prompt: string;
  accentColor?: number;
}

/**
 * Painel que apresenta o select de contas para a acao escolhida.
 * Quando nao ha conta, exibe aviso em vez de um select vazio (a API recusaria).
 */
export function buildAccountSelectPanel(
  accounts: readonly PaymentAccount[],
  action: AccountSelectAction,
  options: AccountSelectPanelOptions,
): ContainerBuilder {
  const root = container(options.accentColor ?? COLORS.BRAND);
  addHeader(root, TITLES.PAYMENT_ACCOUNTS);

  if (accounts.length === 0) {
    root.addTextDisplayComponents(text('Nenhuma conta PIX cadastrada neste servidor.'));
    root.addActionRowComponents(buttonRow(buildAccountBackButton()));
    return root;
  }

  root.addTextDisplayComponents(text(options.prompt));
  root.addActionRowComponents(selectRow(buildAccountSelect(accounts, action)));
  root.addActionRowComponents(buttonRow(buildAccountBackButton()));

  if (accounts.length > DISCORD_LIMITS.SELECT_OPTIONS) {
    root.addTextDisplayComponents(
      footerNote(
        `Exibindo as primeiras ${DISCORD_LIMITS.SELECT_OPTIONS} contas de ${accounts.length}.`,
      ),
    );
  }

  return root;
}

export interface AccountSummaryOptions {
  /** Linha de resultado da acao (ex.: "✅ **Conta PIX cadastrada.**"). */
  headline: string;
  accentColor?: number;
  /** Avisos de corte/estado devolvidos pelo service. */
  warnings?: readonly string[];
}

/** Resumo de uma conta apos criacao/edicao (efemero, chave mascarada). */
export function buildAccountSummary(
  account: PaymentAccount,
  options: AccountSummaryOptions,
): ContainerBuilder {
  const root = container(options.accentColor ?? COLORS.SUCCESS);
  addHeader(root, TITLES.PAYMENT_ACCOUNTS);

  root.addTextDisplayComponents(text(options.headline));
  root.addSeparatorComponents(separator());

  root.addTextDisplayComponents(
    text(
      fields([
        ['Conta', `${account.name} (\`${account.identifier}\`)`],
        ['Situacao', statusLabel(account)],
        [
          'Chave PIX',
          `${describePixKeyType(account.pixKeyType)} · \`${maskPixKey(account.pixKey, account.pixKeyType)}\``,
        ],
        ['Recebedor', `${account.receiverName} — ${account.city}`],
        ['Expiracao padrao', `${account.defaultExpirationMinutes} minutos`],
      ]),
    ),
  );

  const warnings = options.warnings ?? [];
  if (warnings.length > 0) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(
      text(`${EMOJIS.PENDING} **Ajustes aplicados**\n${warnings.map((w) => `• ${w}`).join('\n')}`),
    );
  }

  root.addActionRowComponents(buttonRow(buildAccountBackButton()));
  return root;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export type AccountModalMode = 'create' | 'edit';

function textField(
  customId: string,
  label: string,
  description: string,
  configure: (input: TextInputBuilder) => TextInputBuilder,
): LabelBuilder {
  return new LabelBuilder()
    .setLabel(truncate(label, DISCORD_LIMITS.TEXT_INPUT_LABEL))
    .setDescription(truncate(description, DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER))
    .setTextInputComponent(
      configure(
        new TextInputBuilder()
          .setCustomId(customId)
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
}

/** Texto do campo combinado "tipo | minutos" exibido na edicao. */
function typeExpirationValue(account: PaymentAccount): string {
  return `${account.pixKeyType} | ${account.defaultExpirationMinutes}`;
}

/**
 * Formulario de cadastro/edicao da conta PIX.
 *
 * O modal tem no maximo 5 campos, entao o tipo da chave e a expiracao dividem
 * um unico campo no formato "EMAIL | 30" (ver `parseKeyTypeAndExpiration`).
 */
export function buildAccountModal(mode: AccountModalMode, account?: PaymentAccount): ModalBuilder {
  let customId: string;
  if (mode === 'edit') {
    if (account === undefined) {
      throw new ValidationError('Modal de edicao exige a conta de origem.', {
        userMessage: 'Nao foi possivel abrir o formulario. Atualize o painel e tente novamente.',
      });
    }
    customId = buildCustomId(NAMESPACE.ACCOUNT, ACCOUNT_ACTION.EDIT_MODAL, account.id);
  } else {
    customId = buildCustomId(NAMESPACE.ACCOUNT, ACCOUNT_ACTION.CREATE_MODAL);
  }

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(
      truncate(mode === 'edit' ? 'Editar conta PIX' : 'Nova conta PIX', DISCORD_LIMITS.MODAL_TITLE),
    );

  modal.addLabelComponents(
    textField(
      ACCOUNT_FIELD.NAME,
      'Nome de exibicao',
      'Como a conta aparece para a equipe.',
      (input) => {
        input.setPlaceholder('Conta principal').setMaxLength(ACCOUNT_NAME_MAX).setMinLength(2);
        if (account !== undefined) input.setValue(account.name);
        return input;
      },
    ),
    textField(
      ACCOUNT_FIELD.RECEIVER,
      'Nome do recebedor',
      `Sem acento, MAIUSCULO, ate ${BUSINESS_LIMITS.PIX_RECEIVER_NAME_MAX} caracteres.`,
      (input) => {
        input.setPlaceholder('VOOK STORE LTDA').setMaxLength(80);
        if (account !== undefined) input.setValue(account.receiverName);
        return input;
      },
    ),
    textField(ACCOUNT_FIELD.PIX_KEY, 'Chave PIX', 'CPF, CNPJ, e-mail, telefone ou aleatoria.', (input) => {
      input.setPlaceholder('pagamentos@vookstore.com').setMaxLength(120);
      if (account !== undefined) input.setValue(account.pixKey);
      return input;
    }),
    textField(
      ACCOUNT_FIELD.CITY,
      'Cidade',
      `Sem acento, MAIUSCULO, ate ${BUSINESS_LIMITS.PIX_CITY_MAX} caracteres.`,
      (input) => {
        input.setPlaceholder('SAO PAULO').setMaxLength(60);
        if (account !== undefined) input.setValue(account.city);
        return input;
      },
    ),
    textField(
      ACCOUNT_FIELD.TYPE_EXPIRATION,
      'Tipo da chave e expiracao',
      `Ex.: EMAIL | 30 (minutos entre ${EXPIRATION_MIN_MINUTES} e ${EXPIRATION_MAX_MINUTES}).`,
      (input) => {
        input.setPlaceholder('EMAIL | 30').setMaxLength(40);
        input.setValue(
          account !== undefined
            ? typeExpirationValue(account)
            : `EMAIL | ${DEFAULT_EXPIRATION_MINUTES}`,
        );
        return input;
      },
    ),
  );

  return modal;
}

// ---------------------------------------------------------------------------
// Leitura do campo combinado "tipo | minutos"
// ---------------------------------------------------------------------------

/** Sinonimos aceitos no campo de tipo (o usuario pode digitar em portugues). */
const PIX_KEY_TYPE_ALIASES: ReadonlyMap<string, PixKeyType> = new Map([
  ['CPF', PixKeyType.CPF],
  ['CNPJ', PixKeyType.CNPJ],
  ['EMAIL', PixKeyType.EMAIL],
  ['MAIL', PixKeyType.EMAIL],
  ['PHONE', PixKeyType.PHONE],
  ['TEL', PixKeyType.PHONE],
  ['TELEFONE', PixKeyType.PHONE],
  ['CELULAR', PixKeyType.PHONE],
  ['RANDOM', PixKeyType.RANDOM],
  ['ALEATORIA', PixKeyType.RANDOM],
  ['ALEATORIO', PixKeyType.RANDOM],
  ['CHAVEALEATORIA', PixKeyType.RANDOM],
  ['UUID', PixKeyType.RANDOM],
]);

/** Folga para ler o rotulo do tipo antes de normalizar (cabe em "chave aleatoria"). */
const TYPE_TOKEN_SCAN_LIMIT = 40;

export interface KeyTypeAndExpiration {
  pixKeyType: PixKeyType;
  defaultExpirationMinutes: number;
}

/**
 * Interpreta "EMAIL | 30", "email/30", "telefone 45" ou apenas "CPF".
 * Sem os minutos, assume a expiracao padrao — a faixa valida e conferida
 * depois, no PaymentAccountService.
 */
export function parseKeyTypeAndExpiration(raw: string): KeyTypeAndExpiration {
  const cleaned = String(raw ?? '').trim();

  let parts = cleaned
    .split(/[|/,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const single = parts.length === 1 ? parts[0] : undefined;
  if (single !== undefined) {
    parts = single.split(/\s+/).filter((part) => part.length > 0);
  }

  // O rotulo do tipo pode ocupar mais de um token ("chave aleatoria"); os
  // minutos sao o primeiro token que contem digito. Sem isso, um rotulo
  // composto separado por espaco nunca chegaria a tabela de sinonimos.
  const minutesIndex = parts.findIndex((part) => /[0-9]/.test(part));
  const typeParts = minutesIndex === -1 ? parts : parts.slice(0, minutesIndex);

  const typeToken = normalizePixText(typeParts.join(' '), TYPE_TOKEN_SCAN_LIMIT)
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

  const pixKeyType = PIX_KEY_TYPE_ALIASES.get(typeToken);
  if (pixKeyType === undefined) {
    throw new ValidationError(`Tipo de chave PIX nao reconhecido: "${cleaned}"`, {
      userMessage:
        'Tipo de chave invalido. Use CPF, CNPJ, EMAIL, PHONE ou RANDOM — ' +
        'por exemplo: `EMAIL | 30`.',
    });
  }

  const minutesToken =
    minutesIndex === -1 ? '' : (parts[minutesIndex] ?? '').replace(/[^0-9]/g, '');
  const minutes =
    minutesToken.length > 0 ? Number.parseInt(minutesToken, 10) : DEFAULT_EXPIRATION_MINUTES;

  return { pixKeyType, defaultExpirationMinutes: minutes };
}
