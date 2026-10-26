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
import type { Coupon, CouponType } from '@prisma/client';

import { COLORS, EMOJIS, TITLES } from '../../../constants/branding';
import { COUPON_ACTION, NAMESPACE, buildCustomId } from '../../../constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../../../constants/limits';
import {
  addHeader,
  bullets,
  buttonRow,
  container,
  footerNote,
  selectRow,
  separator,
  text,
} from '../../../components/v2';
import { ValidationError } from '../../../core/errors';
import { PERCENT_SCALE, parseAmountToCents, parsePercent } from '../../../utils/money';
import { truncate } from '../../../utils/sanitize';
import { describeCouponValue, summarizeCouponLimits } from '../services/CouponCalculator';
import type { CouponTermsInput } from '../services/CouponService';

/**
 * Interface administrativa de cupons (Components V2).
 *
 * Segue o padrao visual do painel de referencia (TicketPanelBuilder):
 * cabecalho -> texto -> separador -> blocos -> separador -> componentes.
 *
 * Este arquivo tambem concentra os PARSERS do formulario, porque o formato
 * aceito em cada campo e definido junto com o placeholder que o documenta.
 */

/**
 * Orcamento de texto da listagem (mesmo criterio de `PaymentAccountBuilders`).
 *
 * Contar cupons nao serve: um cupom com descricao de 200 caracteres e todas as
 * restricoes preenchidas ocupa quase 500 caracteres, entao uma pagina fixa
 * estoura o teto de texto da mensagem V2 e o painel morre com
 * "Invalid string length" antes mesmo de chegar ao Discord. O corte e feito por
 * TAMANHO ACUMULADO, deixando folga para cabecalho, rodapes e botao de retorno.
 */
const LIST_TEXT_BUDGET = Math.floor(DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL * 0.75);

/** Faixa Unicode das marcas combinantes (acentos) removidas ao normalizar chaves. */
const COMBINING_MARK_START = 0x0300;
const COMBINING_MARK_END = 0x036f;

/** Ids dos campos do modal (usados no builder e no handler do submit). */
export const COUPON_FIELD = {
  CODE: 'codigo',
  VALUE: 'valor',
  DESCRIPTION: 'descricao',
  RULES: 'regras',
  VALIDITY: 'validade',
} as const;

// ---------------------------------------------------------------------------
// Paineis
// ---------------------------------------------------------------------------

function statusLabel(coupon: Coupon): string {
  return coupon.enabled ? `${EMOJIS.ENABLE} Ativo` : `${EMOJIS.DISABLE} Desativado`;
}

function menuButton(action: string, emoji: string, label: string, style: ButtonStyle): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.COUPON, action))
    .setEmoji(emoji)
    .setLabel(truncate(label, DISCORD_LIMITS.BUTTON_LABEL))
    .setStyle(style);
}

/** Botao de retorno ao menu principal de cupons. */
function backButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.BACK))
    .setEmoji('↩️')
    .setLabel('Voltar')
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Menu principal de cupons.
 * `notice` permite reexibir o menu com o resultado da ultima acao no topo.
 */
export function buildCouponMenu(
  coupons: readonly Coupon[],
  options: { notice?: string } = {},
): ContainerBuilder {
  const root = container(COLORS.BRAND);
  addHeader(root, TITLES.COUPONS);

  root.addTextDisplayComponents(
    text(
      'Cupons sao uma ferramenta **interna** da equipe: o cliente nunca digita nem ' +
        'escolhe um cupom. Quem aplica o desconto e o vendedor, durante a criacao ' +
        'ou o gerenciamento da cobranca PIX.',
    ),
  );

  const active = coupons.filter((coupon) => coupon.enabled).length;
  root.addSeparatorComponents(separator());
  root.addTextDisplayComponents(
    text(
      [
        `**Cadastrados**\n${coupons.length}`,
        `**Ativos**\n${active}`,
        `**Desativados**\n${coupons.length - active}`,
      ].join('\n\n'),
    ),
  );

  if (options.notice !== undefined && options.notice.length > 0) {
    root.addSeparatorComponents(separator());
    root.addTextDisplayComponents(text(options.notice));
  }

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(
    buttonRow(
      menuButton(COUPON_ACTION.CREATE, EMOJIS.ADD, 'Criar Cupom', ButtonStyle.Secondary),
      menuButton(COUPON_ACTION.EDIT, EMOJIS.EDIT, 'Editar', ButtonStyle.Secondary),
      menuButton(COUPON_ACTION.TOGGLE, EMOJIS.ENABLE, 'Ativar/Desativar', ButtonStyle.Secondary),
      menuButton(COUPON_ACTION.DELETE, EMOJIS.DELETE, 'Excluir', ButtonStyle.Secondary),
      menuButton(COUPON_ACTION.LIST, EMOJIS.LIST, 'Listar', ButtonStyle.Secondary),
    ),
  );

  root.addTextDisplayComponents(
    footerNote('Somente administradores do servidor conseguem usar este painel.'),
  );

  return root;
}

/**
 * Listagem detalhada.
 *
 * `usesById` traz o total de usos confirmados por cupom (mapa vindo do
 * servico). O mapa so contem cupons COM uso registrado, entao a ausencia de uma
 * chave significa zero — nao "sem dados". Quem nao tem o dado passa `null` (ou
 * omite o argumento) e a linha de usos e suprimida por completo.
 *
 * Os blocos sao cortados por orcamento de texto, nunca por contagem fixa.
 */
export function buildCouponList(
  coupons: readonly Coupon[],
  usesById: ReadonlyMap<string, number> | null = null,
): ContainerBuilder {
  const root = container(COLORS.INFO);
  addHeader(root, TITLES.COUPONS);

  if (coupons.length === 0) {
    root.addTextDisplayComponents(
      text(`${EMOJIS.COUPON} **Nenhum cupom cadastrado.**\nUse "Criar Cupom" para comecar.`),
    );
    root.addSeparatorComponents(separator());
    root.addActionRowComponents(buttonRow(backButton()));
    return root;
  }

  const blocks: string[] = [];
  let used = 0;

  for (const coupon of coupons) {
    const lines: string[] = [
      `**${coupon.code}** — ${describeCouponValue(coupon)} · ${statusLabel(coupon)}`,
    ];

    if (coupon.description !== null && coupon.description.length > 0) {
      lines.push(truncate(coupon.description, BUSINESS_LIMITS.COUPON_DESCRIPTION_MAX));
    }

    if (usesById !== null) lines.push(`Usos confirmados: ${usesById.get(coupon.id) ?? 0}`);

    const limits = summarizeCouponLimits(coupon);
    if (limits.length > 0) lines.push(bullets(limits));
    else lines.push('Sem restricoes.');

    const block = lines.join('\n');
    // O primeiro bloco sempre entra (truncado, se preciso): melhor um cupom
    // cortado do que um painel vazio.
    if (blocks.length > 0 && used + block.length > LIST_TEXT_BUDGET) break;

    blocks.push(truncate(block, LIST_TEXT_BUDGET));
    used += block.length + 2;
  }

  root.addTextDisplayComponents(text(blocks.join('\n\n')));

  if (coupons.length > blocks.length) {
    root.addTextDisplayComponents(
      footerNote(`Exibindo ${blocks.length} de ${coupons.length} cupons cadastrados.`),
    );
  }

  root.addSeparatorComponents(separator());
  root.addActionRowComponents(buttonRow(backButton()));
  return root;
}

/**
 * Select com os cupons disponiveis para a acao informada (ate 25 opcoes).
 * Lista vazia e recusada aqui: um select sem opcao seria rejeitado pela API.
 */
export function buildCouponSelect(
  coupons: readonly Coupon[],
  action: string,
): StringSelectMenuBuilder {
  if (coupons.length === 0) {
    throw new ValidationError('Select de cupons sem nenhuma opcao.', {
      userMessage: 'Nao ha cupons cadastrados para esta acao.',
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(NAMESPACE.COUPON, action))
    .setPlaceholder('Selecionar cupom')
    .setMinValues(1)
    .setMaxValues(1);

  const options = coupons.slice(0, DISCORD_LIMITS.SELECT_OPTIONS).map((coupon) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(truncate(coupon.code, DISCORD_LIMITS.SELECT_LABEL))
      .setValue(coupon.id)
      .setDescription(
        truncate(
          `${describeCouponValue(coupon)} · ${coupon.enabled ? 'ativo' : 'desativado'}`,
          DISCORD_LIMITS.SELECT_DESCRIPTION,
        ),
      );
    option.setEmoji(coupon.enabled ? EMOJIS.ENABLE : EMOJIS.DISABLE);
    return option;
  });

  menu.addOptions(options);
  return menu;
}

/** Painel intermediario: instrucao + select da acao + voltar. */
export function buildCouponSelectPanel(
  coupons: readonly Coupon[],
  action: string,
  options: { title: string; instruction: string; accent?: number },
): ContainerBuilder {
  const root = container(options.accent ?? COLORS.BRAND);
  addHeader(root, options.title);
  root.addTextDisplayComponents(text(options.instruction));
  root.addSeparatorComponents(separator());
  root.addActionRowComponents(selectRow(buildCouponSelect(coupons, action)));

  if (coupons.length > DISCORD_LIMITS.SELECT_OPTIONS) {
    root.addTextDisplayComponents(
      footerNote(
        `Exibindo os primeiros ${DISCORD_LIMITS.SELECT_OPTIONS} cupons de ${coupons.length}.`,
      ),
    );
  }

  root.addActionRowComponents(buttonRow(backButton()));
  return root;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalFieldOptions {
  customId: string;
  label: string;
  description: string;
  placeholder: string;
  style: TextInputStyle;
  maxLength: number;
  required: boolean;
  value?: string | null;
}

/** Campo do modal no formato atual (Label + TextInput). */
function modalField(options: ModalFieldOptions): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(options.customId)
    .setStyle(options.style)
    .setRequired(options.required)
    .setMaxLength(options.maxLength)
    .setPlaceholder(truncate(options.placeholder, DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER));

  if (options.value !== undefined && options.value !== null && options.value.length > 0) {
    input.setValue(truncate(options.value, options.maxLength));
  }

  return new LabelBuilder()
    .setLabel(truncate(options.label, DISCORD_LIMITS.TEXT_INPUT_LABEL))
    .setDescription(truncate(options.description, DISCORD_LIMITS.TEXT_INPUT_PLACEHOLDER))
    .setTextInputComponent(input);
}

/**
 * Formulario de cupom (5 campos, o maximo permitido pelo Discord).
 *
 * O formato aceito por cada campo esta documentado na descricao e no
 * placeholder, e e interpretado pelos parsers no fim deste arquivo.
 */
export function buildCouponModal(mode: 'create' | 'edit', coupon?: Coupon): ModalBuilder {
  if (mode === 'edit' && coupon === undefined) {
    throw new ValidationError('Modal de edicao exige o cupom carregado.', {
      userMessage: 'Nao foi possivel abrir este cupom. Atualize o painel e tente novamente.',
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(
      mode === 'create'
        ? buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.CREATE_MODAL)
        : buildCustomId(NAMESPACE.COUPON, COUPON_ACTION.EDIT_MODAL, coupon?.id ?? ''),
    )
    .setTitle(mode === 'create' ? 'VOOK STORE — NOVO CUPOM' : 'VOOK STORE — EDITAR CUPOM');

  modal.addLabelComponents(
    modalField({
      customId: COUPON_FIELD.CODE,
      label: 'Codigo do cupom',
      description: 'Letras, numeros, hifen e underline. Convertido para maiusculo.',
      placeholder: 'VOOK20',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.COUPON_CODE_MAX,
      required: true,
      value: coupon?.code,
    }),
    modalField({
      customId: COUPON_FIELD.VALUE,
      label: 'Tipo e valor',
      description: 'Com % vira percentual; com R$ ou so numero vira valor fixo.',
      placeholder: '20%  ou  R$ 50,00',
      style: TextInputStyle.Short,
      maxLength: 20,
      required: true,
      value: coupon === undefined ? null : formatCouponValueInput(coupon),
    }),
    modalField({
      customId: COUPON_FIELD.DESCRIPTION,
      label: 'Descricao (opcional)',
      description: 'Nota interna para a equipe identificar a campanha.',
      placeholder: 'Campanha de boas-vindas',
      style: TextInputStyle.Short,
      maxLength: BUSINESS_LIMITS.COUPON_DESCRIPTION_MAX,
      required: false,
      value: coupon?.description,
    }),
    modalField({
      customId: COUPON_FIELD.RULES,
      label: 'Regras (opcional)',
      description: 'Chaves aceitas: min, teto, usos, porcliente. Vazio remove tudo.',
      placeholder: 'min=100,00 | teto=50,00 | usos=100 | porcliente=1',
      style: TextInputStyle.Short,
      maxLength: 120,
      required: false,
      value: coupon === undefined ? null : formatCouponRulesInput(coupon),
    }),
    modalField({
      customId: COUPON_FIELD.VALIDITY,
      label: 'Validade (opcional)',
      description: 'Inicio 00:00 e fim 23:59, horario de Brasilia. Vazio = sem prazo.',
      placeholder: '01/09/2026 - 30/09/2026   ou   - 30/09/2026',
      style: TextInputStyle.Short,
      maxLength: 30,
      required: false,
      value: coupon === undefined ? null : formatCouponValidityInput(coupon),
    }),
  );

  return modal;
}

// ---------------------------------------------------------------------------
// Parsers e formatadores do formulario
// ---------------------------------------------------------------------------

/**
 * Brasil nao adota horario de verao desde 2019, entao o deslocamento de
 * Brasilia e fixo em UTC-3. Datas digitadas sao interpretadas nesse fuso.
 */
const BRASILIA_OFFSET_MINUTES = 180;

const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/** Centavos em texto reeditavel ("10000" -> "100,00"), sem separador de milhar. */
function centsToPlainText(cents: number): string {
  const safe = Math.max(0, Math.trunc(cents));
  return `${Math.trunc(safe / 100)},${String(safe % 100).padStart(2, '0')}`;
}

/** Valor do cupom no formato aceito pelo campo "Tipo e valor". */
export function formatCouponValueInput(coupon: Coupon): string {
  if (coupon.type === 'PERCENTAGE') {
    const percent = Math.max(0, Math.trunc(coupon.value)) / 100;
    // "12.50" volta como "12,5": zero a direita so polui o campo do formulario.
    const rendered = Number.isInteger(percent)
      ? String(percent)
      : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
    return `${rendered}%`;
  }
  return `R$ ${centsToPlainText(coupon.value)}`;
}

/** Regras do cupom no formato aceito pelo campo "Regras". */
export function formatCouponRulesInput(coupon: Coupon): string {
  const parts: string[] = [];
  if (coupon.minimumAmount !== null) parts.push(`min=${centsToPlainText(coupon.minimumAmount)}`);
  if (coupon.maximumDiscount !== null) {
    parts.push(`teto=${centsToPlainText(coupon.maximumDiscount)}`);
  }
  if (coupon.maxUses !== null) parts.push(`usos=${Math.trunc(coupon.maxUses)}`);
  if (coupon.maxUsesPerCustomer !== null) {
    parts.push(`porcliente=${Math.trunc(coupon.maxUsesPerCustomer)}`);
  }
  return parts.join(' | ');
}

/** Validade do cupom no formato aceito pelo campo "Validade". */
export function formatCouponValidityInput(coupon: Coupon): string {
  const start = coupon.startsAt !== null ? formatDateOnly(coupon.startsAt) : '';
  const end = coupon.expiresAt !== null ? formatDateOnly(coupon.expiresAt) : '';
  if (start === '' && end === '') return '';
  return `${start} - ${end}`.trim();
}

function formatDateOnly(date: Date): string {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return '';
  return DATE_ONLY_FORMATTER.format(date);
}

/**
 * "20%" -> percentual base 100; "R$ 50,00" / "50" -> valor fixo em centavos.
 * A presenca do sinal `%` e o unico criterio de decisao do tipo.
 */
export function parseCouponValueInput(raw: string): { type: CouponType; value: number } {
  const value = raw.trim();
  if (value.length === 0) {
    throw new ValidationError('Tipo e valor do cupom nao informados.', {
      userMessage: 'Informe o valor do cupom. Exemplos: `20%` ou `R$ 50,00`.',
    });
  }

  if (value.includes('%')) {
    const percent = parsePercent(value);
    if (percent > PERCENT_SCALE) {
      throw new ValidationError(`Percentual acima de 100%: ${value}`, {
        userMessage: 'O percentual do cupom nao pode ultrapassar 100%.',
      });
    }
    return { type: 'PERCENTAGE', value: percent };
  }

  const cents = parseAmountToCents(value);
  if (cents <= 0) {
    throw new ValidationError(`Valor fixo invalido: ${value}`, {
      userMessage: 'O valor do cupom precisa ser maior que zero. Exemplo: `R$ 50,00`.',
    });
  }
  if (cents > BUSINESS_LIMITS.PAYMENT_MAX_CENTS) {
    throw new ValidationError(`Valor fixo acima do teto: ${cents}`, {
      userMessage: 'O valor do cupom e alto demais. Revise o numero informado.',
    });
  }
  return { type: 'FIXED_AMOUNT', value: cents };
}

export interface CouponRules {
  minimumAmount: number | null;
  maximumDiscount: number | null;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
}

const EMPTY_RULES: CouponRules = {
  minimumAmount: null,
  maximumDiscount: null,
  maxUses: null,
  maxUsesPerCustomer: null,
};

/** Aliases tolerados para cada regra (o vendedor digita rapido). */
const RULE_ALIASES = new Map<string, keyof CouponRules>([
  ['min', 'minimumAmount'],
  ['minimo', 'minimumAmount'],
  ['minimum', 'minimumAmount'],
  ['valorminimo', 'minimumAmount'],
  ['compraminima', 'minimumAmount'],
  ['teto', 'maximumDiscount'],
  ['tetodesconto', 'maximumDiscount'],
  ['maxdesconto', 'maximumDiscount'],
  ['descontomaximo', 'maximumDiscount'],
  ['usos', 'maxUses'],
  ['uses', 'maxUses'],
  ['maxusos', 'maxUses'],
  ['limite', 'maxUses'],
  ['porcliente', 'maxUsesPerCustomer'],
  ['percliente', 'maxUsesPerCustomer'],
  ['porusuario', 'maxUsesPerCustomer'],
  ['usosporcliente', 'maxUsesPerCustomer'],
]);

const RULES_HELP =
  'Formato: `min=100,00 | teto=50,00 | usos=100 | porcliente=1`. ' +
  'Chaves aceitas: min, teto, usos, porcliente.';

/** Normaliza a chave: sem acento, sem espaco, sem pontuacao, minuscula. */
function normalizeRuleKey(raw: string): string {
  let output = '';
  // Percorre por code point para nao depender de faixas invisiveis em regex:
  // marcas combinantes (acentos) sao descartadas e so letras a-z permanecem.
  for (const char of raw.normalize('NFD')) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    if (code >= COMBINING_MARK_START && code <= COMBINING_MARK_END) continue;
    const lower = char.toLowerCase();
    if (lower >= 'a' && lower <= 'z') output += lower;
  }
  return output;
}

/** Valores que significam "remover este limite". */
function isEmptyRuleValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === '-' || normalized === 'nenhum';
}

function parseRuleCount(label: string, raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError(`Quantidade invalida em "${label}": ${raw}`, {
      userMessage: `O valor de \`${label}\` precisa ser um numero inteiro. Exemplo: \`${label}=10\`.`,
    });
  }
  const count = Number(raw);
  if (count <= 0 || count > 1_000_000) {
    throw new ValidationError(`Quantidade fora do intervalo em "${label}": ${raw}`, {
      userMessage: `O valor de \`${label}\` precisa ficar entre 1 e 1.000.000.`,
    });
  }
  return count;
}

/**
 * Parser tolerante das regras.
 * Separadores aceitos entre as regras: `|`, `;` e quebra de linha.
 * Campo vazio remove TODAS as regras (comportamento documentado no modal).
 */
export function parseCouponRulesInput(raw: string): CouponRules {
  const value = raw.trim();
  if (value.length === 0) return { ...EMPTY_RULES };

  const rules: CouponRules = { ...EMPTY_RULES };
  const seen = new Set<keyof CouponRules>();

  for (const chunk of value.split(/[|;\n]/)) {
    const entry = chunk.trim();
    if (entry.length === 0) continue;

    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      throw new ValidationError(`Regra sem "=": ${entry}`, {
        userMessage: `Regra invalida: \`${truncate(entry, 40)}\`. ${RULES_HELP}`,
      });
    }

    const rawKey = entry.slice(0, separatorIndex);
    const rawValue = entry.slice(separatorIndex + 1).trim();
    const field = RULE_ALIASES.get(normalizeRuleKey(rawKey));

    if (field === undefined) {
      throw new ValidationError(`Regra desconhecida: ${rawKey}`, {
        userMessage: `Nao reconheci a regra \`${truncate(rawKey.trim(), 20)}\`. ${RULES_HELP}`,
      });
    }
    if (seen.has(field)) {
      throw new ValidationError(`Regra repetida: ${rawKey}`, {
        userMessage: `A regra \`${truncate(rawKey.trim(), 20)}\` foi informada mais de uma vez.`,
      });
    }
    seen.add(field);

    if (isEmptyRuleValue(rawValue)) {
      rules[field] = null;
      continue;
    }

    if (field === 'maxUses') {
      rules.maxUses = parseRuleCount('usos', rawValue);
    } else if (field === 'maxUsesPerCustomer') {
      rules.maxUsesPerCustomer = parseRuleCount('porcliente', rawValue);
    } else {
      const cents = parseAmountToCents(rawValue);
      if (cents <= 0 || cents > BUSINESS_LIMITS.PAYMENT_MAX_CENTS) {
        throw new ValidationError(`Valor de regra fora do intervalo: ${rawValue}`, {
          userMessage: `O valor \`${truncate(rawValue, 20)}\` esta fora do intervalo permitido.`,
        });
      }
      rules[field] = cents;
    }
  }

  return rules;
}

const VALIDITY_HELP =
  'Formato: `dd/mm/aaaa - dd/mm/aaaa`. Para so o fim use `- dd/mm/aaaa`; ' +
  'deixe vazio para cupom sem prazo.';

/**
 * Converte dd/mm/aaaa em Date no fuso de Brasilia.
 * `endOfDay` leva a data para 23:59:59.999 (para a validade terminar no fim do dia).
 */
function parseDateBR(raw: string, endOfDay: boolean): Date {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (match === null) {
    throw new ValidationError(`Data invalida: ${raw}`, {
      userMessage: `Data invalida: \`${truncate(raw.trim(), 20)}\`. ${VALIDITY_HELP}`,
    });
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const utcMs = Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  const probe = new Date(utcMs);

  // Rejeita datas inexistentes (31/02, mes 13...): o Date "corrige" sozinho.
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new ValidationError(`Data inexistente: ${raw}`, {
      userMessage: `A data \`${truncate(raw.trim(), 20)}\` nao existe no calendario.`,
    });
  }

  return new Date(utcMs + BRASILIA_OFFSET_MINUTES * 60_000);
}

export interface CouponValidity {
  startsAt: Date | null;
  expiresAt: Date | null;
}

/**
 * Parser do periodo de validade.
 * Aceita "dd/mm/aaaa - dd/mm/aaaa", "- dd/mm/aaaa" (so fim) e
 * "dd/mm/aaaa -" (so inicio). Campo vazio remove o prazo.
 */
export function parseCouponValidityInput(raw: string): CouponValidity {
  const value = raw.trim();
  if (value.length === 0) return { startsAt: null, expiresAt: null };

  const parts = value.split('-');
  if (parts.length !== 2) {
    throw new ValidationError(`Periodo de validade invalido: ${value}`, {
      userMessage: `Periodo invalido: \`${truncate(value, 40)}\`. ${VALIDITY_HELP}`,
    });
  }

  const rawStart = (parts[0] ?? '').trim();
  const rawEnd = (parts[1] ?? '').trim();

  const startsAt = rawStart.length > 0 ? parseDateBR(rawStart, false) : null;
  const expiresAt = rawEnd.length > 0 ? parseDateBR(rawEnd, true) : null;

  if (startsAt === null && expiresAt === null) {
    throw new ValidationError('Periodo de validade sem nenhuma data.', {
      userMessage: `Informe ao menos uma data. ${VALIDITY_HELP}`,
    });
  }
  if (startsAt !== null && expiresAt !== null && expiresAt.getTime() <= startsAt.getTime()) {
    throw new ValidationError('Periodo de validade invertido.', {
      userMessage: 'A data final precisa ser posterior a data inicial.',
    });
  }

  return { startsAt, expiresAt };
}

/** Resumo textual dos termos, usado nas confirmacoes das acoes administrativas. */
export function describeCouponTerms(terms: CouponTermsInput): string {
  const parts = [
    terms.type === 'PERCENTAGE'
      ? `${terms.value / 100}%`.replace('.', ',')
      : `R$ ${centsToPlainText(terms.value)}`,
  ];
  if (terms.minimumAmount !== null) parts.push(`min ${centsToPlainText(terms.minimumAmount)}`);
  if (terms.maximumDiscount !== null) parts.push(`teto ${centsToPlainText(terms.maximumDiscount)}`);
  if (terms.maxUses !== null) parts.push(`${terms.maxUses} usos`);
  if (terms.maxUsesPerCustomer !== null) parts.push(`${terms.maxUsesPerCustomer}/cliente`);
  return parts.join(' · ');
}
