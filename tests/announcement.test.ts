import { afterEach, describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import type { APIEmbed } from 'discord.js';

import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../src/constants/limits';
import { ValidationError } from '../src/core/errors';
import {
  ANNOUNCE_FIELD,
  buildAnnouncementButtonModal,
  buildAnnouncementButtonRows,
  buildAnnouncementModal,
  buildAnnouncementPayload,
  buildAnnouncementPreview,
  buildButtonRemoveSelect,
  isDraftPublishable,
  readAnnouncementButton,
  readAnnouncementEmbed,
  readAnnouncementPlainText,
} from '../src/modules/announcements/builders/AnnouncementBuilders';
import {
  addDraftButton,
  clearAnnouncementDrafts,
  createDraft,
  emptyEmbed,
  getDraft,
  removeDraftButton,
  setDraftEmbed,
  type AnnouncementButton,
  type AnnouncementDraft,
} from '../src/modules/announcements/services/AnnouncementDraftService';
import { formatButtonEmoji, parseButtonEmoji } from '../src/modules/announcements/validators/emoji';
import {
  formatEmbedColor,
  parseEmbedColor,
  sanitizeLinkUrl,
} from '../src/modules/announcements/validators/link';

/**
 * Anuncios.
 *
 * O QUE ESTES TESTES TRAVAM: nada chega ao canal sem passar pela previa, e a
 * previa mostra exatamente o que sera publicado. As duas pontas saem da mesma
 * funcao (`buildAnnouncementPayload`) — se um dia divergirem, o autor aprova uma
 * coisa e o servidor le outra.
 */

const GUILD_ID = '111111111111111111';
const CHANNEL_ID = '222222222222222222';
const AUTHOR_ID = '333333333333333333';

afterEach(() => {
  clearAnnouncementDrafts();
});

function makeDraft(overrides: Partial<AnnouncementDraft> = {}): AnnouncementDraft {
  return {
    id: 'draft1',
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    createdById: AUTHOR_ID,
    withEmbed: true,
    plainText: null,
    embed: emptyEmbed(),
    buttons: [],
    expiresAt: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

function makeButton(overrides: Partial<AnnouncementButton> = {}): AnnouncementButton {
  return {
    label: 'Ver catalogo',
    url: 'https://vookstore.com/catalogo',
    emoji: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Leitura do JSON dos componentes
// ---------------------------------------------------------------------------

interface TextInputJson {
  custom_id: string;
  label: string;
  required?: boolean;
  max_length?: number;
  value?: string;
}

interface ModalJson {
  custom_id: string;
  title: string;
  components: Array<{ components: TextInputJson[] }>;
}

function modalFields(modal: { toJSON: () => unknown }): TextInputJson[] {
  const json = modal.toJSON() as ModalJson;
  return json.components.flatMap((row) => row.components);
}

interface ButtonJson {
  type: number;
  style: number;
  label?: string;
  url?: string;
  custom_id?: string;
  disabled?: boolean;
  emoji?: { name?: string; id?: string; animated?: boolean };
}

interface RowJson {
  type: number;
  components: ButtonJson[];
}

function rowsOf(components: ReadonlyArray<{ toJSON: () => unknown }>): RowJson[] {
  return components.map((row) => row.toJSON() as RowJson);
}

/** Le os campos do modal como o handler le: por customId, vazio quando ausente. */
function readerFrom(values: Record<string, string>): (customId: string) => string {
  return (customId) => values[customId] ?? '';
}

// ---------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------

/**
 * O emoji customizado e o unico dado do formulario que o Discord aceita ERRADO
 * sem reclamar: `name` sem `id` produz um botao pelado, sem erro nem log.
 */
describe('emoji do botao', () => {
  it('aceita a colagem que o proprio Discord produz', () => {
    expect(parseButtonEmoji('<:hairmtc:1403457616792785017>')).toEqual({
      name: 'hairmtc',
      id: '1403457616792785017',
    });
  });

  it('reconhece emoji animado', () => {
    expect(parseButtonEmoji('<a:loading:1403457616792785017>')).toEqual({
      name: 'loading',
      id: '1403457616792785017',
      animated: true,
    });
  });

  it('aceita emoji unicode', () => {
    expect(parseButtonEmoji('🔥')).toEqual({ name: '🔥' });
  });

  it('campo vazio nao e erro: emoji e opcional', () => {
    expect(parseButtonEmoji('')).toBeNull();
    expect(parseButtonEmoji('   ')).toBeNull();
    expect(parseButtonEmoji(null)).toBeNull();
  });

  it('recusa `:nome:` explicando como obter o id', () => {
    // Essa e a forma que aparece ao DIGITAR no chat, e a que mais gente cola.
    // Aceitar em silencio publicaria um botao sem emoji nenhum.
    expect(() => parseButtonEmoji(':hairmtc:')).toThrow(ValidationError);
    try {
      parseButtonEmoji(':hairmtc:');
    } catch (error) {
      expect((error as ValidationError).userMessage).toContain('<:nome:');
    }
  });

  it('recusa texto solto', () => {
    expect(() => parseButtonEmoji('hairmtc')).toThrow(ValidationError);
  });

  it('volta ao formato colavel para reabrir o formulario', () => {
    const raw = '<a:loading:1403457616792785017>';
    expect(formatButtonEmoji(parseButtonEmoji(raw))).toBe(raw);
    expect(formatButtonEmoji(parseButtonEmoji('🔥'))).toBe('🔥');
    expect(formatButtonEmoji(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Link e cor
// ---------------------------------------------------------------------------

describe('link do botao', () => {
  it('aceita https', () => {
    expect(sanitizeLinkUrl('https://vookstore.com/catalogo')).toBe(
      'https://vookstore.com/catalogo',
    );
  });

  it('recusa http, credencial embutida e campo vazio', () => {
    expect(() => sanitizeLinkUrl('http://vookstore.com')).toThrow(ValidationError);
    expect(() => sanitizeLinkUrl('https://user:senha@vookstore.com')).toThrow(ValidationError);
    expect(() => sanitizeLinkUrl('')).toThrow(ValidationError);
  });

  /*
   * A razao de este validador existir separado de `sanitizeImageUrl`, que aplica
   * as mesmas regras: aquela ACEITA `attachment://`, valido em thumbnail de
   * embed e fatal num botao — a mensagem inteira toma 400, e o erro apareceria
   * so no clique em Publicar.
   */
  it('recusa attachment://, que a validacao de imagem aceita', () => {
    expect(() => sanitizeLinkUrl('attachment://banner.png')).toThrow(ValidationError);
  });
});

describe('cor do embed', () => {
  it('aceita hexadecimal com e sem #', () => {
    expect(parseEmbedColor('#8b5cf6')).toBe(0x8b5cf6);
    expect(parseEmbedColor('8b5cf6')).toBe(0x8b5cf6);
  });

  it('campo vazio significa sem cor, nao erro', () => {
    // Embed sem barra lateral e um resultado legitimo — nao um descuido para
    // corrigir com um padrao imposto.
    expect(parseEmbedColor('')).toBeNull();
  });

  it('recusa valor que nao e hexadecimal de 6 digitos', () => {
    expect(() => parseEmbedColor('roxo')).toThrow(ValidationError);
    expect(() => parseEmbedColor('#abc')).toThrow(ValidationError);
  });

  it('volta ao formulario no formato que ele aceita', () => {
    expect(formatEmbedColor(0x8b5cf6)).toBe('#8b5cf6');
    expect(formatEmbedColor(0x00ff00)).toBe('#00ff00');
    expect(formatEmbedColor(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

/**
 * O modal do Discord aceita CINCO campos e o anuncio precisa de nove valores.
 * Por isso os campos vem agrupados por assunto, no mesmo idioma do modal visual
 * da configuracao. Estes testes seguram os dois lados: o teto e o agrupamento.
 */
describe('formulario do anuncio', () => {
  it('cabe nos cinco campos que o Discord permite', () => {
    const campos = modalFields(buildAnnouncementModal(makeDraft()));

    expect(campos.length).toBeLessThanOrEqual(5);
    expect(campos.map((campo) => campo.custom_id)).toEqual([
      ANNOUNCE_FIELD.TITLE,
      ANNOUNCE_FIELD.DESCRIPTION,
      ANNOUNCE_FIELD.IMAGES,
      ANNOUNCE_FIELD.FOOTER,
      ANNOUNCE_FIELD.STYLE,
    ]);
  });

  it('todo campo do embed e opcional', () => {
    // O pedido e "poder colocar opcionalmente": um anuncio so com imagem, ou so
    // com texto, precisa passar sem preencher o resto.
    const campos = modalFields(buildAnnouncementModal(makeDraft()));
    expect(campos.every((campo) => campo.required !== true)).toBe(true);
  });

  it('sem embed o formulario e um campo de texto so, obrigatorio', () => {
    const campos = modalFields(buildAnnouncementModal(makeDraft({ withEmbed: false })));

    expect(campos).toHaveLength(1);
    expect(campos[0]?.custom_id).toBe(ANNOUNCE_FIELD.PLAIN);
    expect(campos[0]?.required).toBe(true);
  });

  it('reabre preenchido com o que ja foi escrito', () => {
    // Quem volta so para trocar a cor nao pode perder a descricao.
    const draft = makeDraft({
      embed: {
        ...emptyEmbed(),
        title: 'Promocao',
        description: 'Tudo 30% off',
        thumbnailUrl: 'https://cdn.vookstore.com/logo.png',
        color: 0x8b5cf6,
        authorName: 'Vook Store',
      },
    });
    const campos = modalFields(buildAnnouncementModal(draft));
    const byId = new Map(campos.map((campo) => [campo.custom_id, campo.value]));

    expect(byId.get(ANNOUNCE_FIELD.TITLE)).toBe('Promocao');
    expect(byId.get(ANNOUNCE_FIELD.DESCRIPTION)).toBe('Tudo 30% off');
    expect(byId.get(ANNOUNCE_FIELD.IMAGES)).toBe('https://cdn.vookstore.com/logo.png | ');
    expect(byId.get(ANNOUNCE_FIELD.STYLE)).toBe('#8b5cf6 | Vook Store | ');
  });

  it('o formulario do botao pede nome, link e emoji opcional', () => {
    const campos = modalFields(buildAnnouncementButtonModal('draft1'));

    expect(campos.map((campo) => campo.custom_id)).toEqual([
      ANNOUNCE_FIELD.BUTTON_LABEL,
      ANNOUNCE_FIELD.BUTTON_URL,
      ANNOUNCE_FIELD.BUTTON_EMOJI,
    ]);
    expect(campos[2]?.required).not.toBe(true);
  });
});

describe('leitura do formulario', () => {
  it('separa os campos agrupados por posicao', () => {
    const embed = readAnnouncementEmbed(
      readerFrom({
        [ANNOUNCE_FIELD.TITLE]: 'Promocao',
        [ANNOUNCE_FIELD.IMAGES]: 'https://cdn.vookstore.com/logo.png | https://cdn.vookstore.com/banner.png',
        [ANNOUNCE_FIELD.FOOTER]: 'Vook Store | https://cdn.vookstore.com/icone.png',
        [ANNOUNCE_FIELD.STYLE]: '#8b5cf6 | Vook Store | https://cdn.vookstore.com/autor.png',
      }),
    );

    expect(embed.thumbnailUrl).toBe('https://cdn.vookstore.com/logo.png');
    expect(embed.imageUrl).toBe('https://cdn.vookstore.com/banner.png');
    expect(embed.footerText).toBe('Vook Store');
    expect(embed.footerIconUrl).toBe('https://cdn.vookstore.com/icone.png');
    expect(embed.color).toBe(0x8b5cf6);
    expect(embed.authorName).toBe('Vook Store');
  });

  it('posicao vazia continua vazia, e nao string em branco', () => {
    // `imageUrl: ''` seria recusado pelo Discord; o certo e o campo nao existir.
    const embed = readAnnouncementEmbed(
      readerFrom({
        [ANNOUNCE_FIELD.TITLE]: 'Promocao',
        [ANNOUNCE_FIELD.IMAGES]: 'https://cdn.vookstore.com/logo.png',
      }),
    );

    expect(embed.thumbnailUrl).toBe('https://cdn.vookstore.com/logo.png');
    expect(embed.imageUrl).toBeNull();
    expect(embed.footerText).toBeNull();
  });

  it('recusa embed sem nada visivel', () => {
    // So cor produz um retangulo vazio que a API ACEITA — o anuncio sairia
    // publicado em branco, que e pior que o erro.
    expect(() => readAnnouncementEmbed(readerFrom({ [ANNOUNCE_FIELD.STYLE]: '#8b5cf6' }))).toThrow(
      ValidationError,
    );
  });

  it('recusa quando a SOMA dos textos estoura o teto do embed', () => {
    // Cada campo cabe no proprio limite; e o total de 6000 que escapa, e o
    // Discord recusa a mensagem inteira.
    expect(() =>
      readAnnouncementEmbed(
        readerFrom({
          [ANNOUNCE_FIELD.TITLE]: 'A'.repeat(DISCORD_LIMITS.EMBED_TITLE),
          [ANNOUNCE_FIELD.DESCRIPTION]: 'B'.repeat(DISCORD_LIMITS.EMBED_TOTAL),
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('anuncio sem embed exige texto', () => {
    expect(() => readAnnouncementPlainText(readerFrom({}))).toThrow(ValidationError);
    expect(readAnnouncementPlainText(readerFrom({ [ANNOUNCE_FIELD.PLAIN]: ' Oi ' }))).toBe('Oi');
  });

  it('le o botao com emoji customizado', () => {
    const button = readAnnouncementButton(
      readerFrom({
        [ANNOUNCE_FIELD.BUTTON_LABEL]: 'Ver catalogo',
        [ANNOUNCE_FIELD.BUTTON_URL]: 'https://vookstore.com/catalogo',
        [ANNOUNCE_FIELD.BUTTON_EMOJI]: '<:hairmtc:1403457616792785017>',
      }),
      parseButtonEmoji,
    );

    expect(button.emoji).toEqual({ name: 'hairmtc', id: '1403457616792785017' });
  });
});

// ---------------------------------------------------------------------------
// Mensagem publicada
// ---------------------------------------------------------------------------

describe('botoes de link do anuncio', () => {
  it('sao botoes de LINK: sobrevivem ao bot offline', () => {
    // Anuncio fica no canal por semanas. Botao com customId pararia de
    // responder no primeiro restart; `Link` nao gera interacao nenhuma.
    const [row] = rowsOf(buildAnnouncementButtonRows([makeButton()]));
    const [button] = row?.components ?? [];

    expect(button?.style).toBe(ButtonStyle.Link);
    expect(button?.url).toBe('https://vookstore.com/catalogo');
    expect(button?.custom_id).toBeUndefined();
  });

  it('quebra em linhas de cinco', () => {
    const rows = rowsOf(
      buildAnnouncementButtonRows(
        Array.from({ length: 7 }, (_, index) => makeButton({ label: `Link ${index}` })),
      ),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.components).toHaveLength(DISCORD_LIMITS.BUTTONS_PER_ROW);
    expect(rows[1]?.components).toHaveLength(2);
  });

  it('leva o emoji customizado para o botao', () => {
    const [row] = rowsOf(
      buildAnnouncementButtonRows([
        makeButton({ emoji: { name: 'hairmtc', id: '1403457616792785017' } }),
      ]),
    );

    expect(row?.components[0]?.emoji).toMatchObject({
      name: 'hairmtc',
      id: '1403457616792785017',
    });
  });
});

describe('mensagem publicada', () => {
  it('com embed nao leva texto solto', () => {
    const payload = buildAnnouncementPayload(
      makeDraft({ embed: { ...emptyEmbed(), title: 'Promocao' } }),
    );

    expect(payload.content).toBeUndefined();
    expect(payload.embeds).toHaveLength(1);
  });

  it('sem embed leva o texto e nenhum embed', () => {
    const payload = buildAnnouncementPayload(
      makeDraft({ withEmbed: false, plainText: 'Chegou coisa nova.' }),
    );

    expect(payload.content).toBe('Chegou coisa nova.');
    expect(payload.embeds).toHaveLength(0);
  });

  it('so e publicavel com conteudo', () => {
    expect(isDraftPublishable(makeDraft())).toBe(false);
    expect(isDraftPublishable(makeDraft({ embed: { ...emptyEmbed(), imageUrl: 'https://a/b.png' } }))).toBe(
      true,
    );
    expect(isDraftPublishable(makeDraft({ withEmbed: false, plainText: '' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Previa
// ---------------------------------------------------------------------------

/**
 * A previa E o painel: o anuncio aparece renderizado de verdade e a ultima
 * linha traz as acoes de quem monta. Descrever o embed em texto seria mais
 * facil e pior — ninguem julga corte de imagem lendo uma lista de campos.
 */
describe('previa do anuncio', () => {
  it('mostra o MESMO embed que sera publicado', () => {
    // Uma fonte so. Se a previa montasse o proprio embed, o autor aprovaria uma
    // coisa e o servidor leria outra.
    const draft = makeDraft({ embed: { ...emptyEmbed(), title: 'Promocao' } });
    const preview = buildAnnouncementPreview(draft);
    const payload = buildAnnouncementPayload(draft);

    expect(JSON.stringify(preview.embeds[0])).toBe(JSON.stringify(payload.embeds[0]));
    // A previa acrescenta a propria nota DEPOIS do anuncio, nunca no lugar dele.
    expect(preview.embeds).toHaveLength(2);
  });

  it('a nota da previa vai num embed proprio, fora do anuncio', () => {
    // No modo sem embed o `content` E o anuncio: um cabecalho escrito ali
    // falsearia justamente o texto que esta sendo aprovado.
    const preview = buildAnnouncementPreview(
      makeDraft({ withEmbed: false, plainText: 'Chegou coisa nova.' }),
    );

    expect(preview.content).toBe('Chegou coisa nova.');
    expect(preview.embeds).toHaveLength(1);
    expect((preview.embeds[0] as APIEmbed).footer?.text).toContain('Previa');
  });

  it('Publicar fica travado enquanto nao ha conteudo', () => {
    const rows = rowsOf(buildAnnouncementPreview(makeDraft()).components);
    const actions = rows[rows.length - 1]?.components ?? [];
    const publicar = actions.find((button) => button.label === 'Publicar');

    expect(publicar?.disabled).toBe(true);
  });

  it('Remover botao so acende quando existe botao', () => {
    const semBotao = rowsOf(buildAnnouncementPreview(makeDraft()).components);
    const comBotao = rowsOf(
      buildAnnouncementPreview(makeDraft({ buttons: [makeButton()] })).components,
    );

    const remover = (rows: RowJson[]): ButtonJson | undefined =>
      (rows[rows.length - 1]?.components ?? []).find(
        (button) => button.label === 'Remover botao',
      );

    expect(remover(semBotao)?.disabled).toBe(true);
    expect(remover(comBotao)?.disabled).toBe(false);
  });

  it('Adicionar botao trava no teto de botoes do anuncio', () => {
    const cheio = makeDraft({
      buttons: Array.from({ length: BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS }, () => makeButton()),
    });
    const rows = rowsOf(buildAnnouncementPreview(cheio).components);
    const adicionar = (rows[rows.length - 1]?.components ?? []).find(
      (button) => button.label === 'Adicionar botao',
    );

    expect(adicionar?.disabled).toBe(true);
  });

  it('cabe nas cinco linhas de componentes que a mensagem permite', () => {
    // Teto de botoes (2 linhas) + acoes + o seletor de remocao ainda deixa
    // folga. Sem esta conta, o painel cheio derrubaria a previa com 400.
    const cheio = makeDraft({
      buttons: Array.from({ length: BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS }, () => makeButton()),
    });
    const preview = buildAnnouncementPreview(cheio);

    expect(preview.components.length + 1).toBeLessThanOrEqual(
      DISCORD_LIMITS.ACTION_ROWS_PER_MESSAGE,
    );
  });

  it('o seletor de remocao rotula cada botao como ele aparece', () => {
    const draft = makeDraft({
      buttons: [makeButton({ label: 'Catalogo' }), makeButton({ label: 'Suporte' })],
    });
    const row = buildButtonRemoveSelect(draft).toJSON() as unknown as {
      components: Array<{ type: number; options: Array<{ label: string; value: string }> }>;
    };
    const select = row.components[0];

    expect(select?.type).toBe(ComponentType.StringSelect);
    expect(select?.options.map((option) => option.label)).toEqual(['1. Catalogo', '2. Suporte']);
  });
});

// ---------------------------------------------------------------------------
// Rascunho
// ---------------------------------------------------------------------------

/**
 * O `draftId` viaja no customId, que qualquer um le num print da tela efemera.
 * Ele identifica; quem autoriza e o service — mais a permissao reconferida no
 * handler.
 */
describe('rascunho do anuncio', () => {
  const novo = (): AnnouncementDraft =>
    createDraft({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      createdById: AUTHOR_ID,
      withEmbed: true,
    });

  it('recusa leitura de outro servidor e de outro autor', () => {
    const draft = novo();

    expect(() => getDraft(draft.id, '999999999999999999', AUTHOR_ID)).toThrow(ValidationError);
    expect(() => getDraft(draft.id, GUILD_ID, '999999999999999999')).toThrow();
  });

  it('rascunho inexistente vira instrucao, nao erro cru', () => {
    try {
      getDraft('naoexiste', GUILD_ID, AUTHOR_ID);
      expect.unreachable('deveria ter lancado');
    } catch (error) {
      expect((error as ValidationError).userMessage).toContain('/anunciar');
    }
  });

  it('trava no teto de botoes', () => {
    const draft = novo();
    for (let index = 0; index < BUSINESS_LIMITS.ANNOUNCE_MAX_BUTTONS; index += 1) {
      addDraftButton(draft.id, GUILD_ID, AUTHOR_ID, makeButton({ label: `Link ${index}` }));
    }

    expect(() => addDraftButton(draft.id, GUILD_ID, AUTHOR_ID, makeButton())).toThrow(
      ValidationError,
    );
  });

  it('remove pelo indice e preserva a ordem do resto', () => {
    const draft = novo();
    for (const label of ['A', 'B', 'C']) {
      addDraftButton(draft.id, GUILD_ID, AUTHOR_ID, makeButton({ label }));
    }

    const updated = removeDraftButton(draft.id, GUILD_ID, AUTHOR_ID, 1);
    expect(updated.buttons.map((button) => button.label)).toEqual(['A', 'C']);
  });

  it('recusa indice que ja nao existe', () => {
    const draft = novo();
    expect(() => removeDraftButton(draft.id, GUILD_ID, AUTHOR_ID, 0)).toThrow(ValidationError);
  });

  it('editar o conteudo nao apaga os botoes ja cadastrados', () => {
    const draft = novo();
    addDraftButton(draft.id, GUILD_ID, AUTHOR_ID, makeButton());
    const updated = setDraftEmbed(draft.id, GUILD_ID, AUTHOR_ID, {
      ...emptyEmbed(),
      title: 'Promocao',
    });

    expect(updated.buttons).toHaveLength(1);
    expect(updated.embed.title).toBe('Promocao');
  });
});
