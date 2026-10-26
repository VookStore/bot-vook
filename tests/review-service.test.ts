import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType, TextInputStyle } from 'discord.js';
import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIComponentInMessageActionRow,
  APILabelComponent,
  APITextDisplayComponent,
  APITextInputComponent,
  ContainerBuilder,
  ModalBuilder,
} from 'discord.js';

import {
  REVIEW_COMMENT_INPUT_ID,
  buildPublishedReview,
  buildReviewCommentModal,
  buildReviewRequest,
  buildReviewThanks,
  formatTicketNumber,
} from '../src/modules/reviews/builders/ReviewBuilders';
import { TITLES, renderStars } from '../src/constants/branding';
import { MAX_CUSTOM_ID_LENGTH } from '../src/constants/customIds';
import { BUSINESS_LIMITS, DISCORD_LIMITS } from '../src/constants/limits';

/**
 * Testes das partes PURAS do sistema de avaliacao: builders e formatacao.
 * Nada aqui toca banco, cache ou Discord.
 */

const TICKET_ID = 'ckq1abc2xyz0000dados';
const CUSTOMER_ID = '111111111111111111';
const STAFF_ID = '222222222222222222';
const CREATED_AT = new Date('2026-08-22T15:00:00.000Z');

/**
 * Conteudo privado do atendimento que NUNCA pode aparecer na publicacao.
 * Nenhuma destas strings e sequer parametro dos builders — o teste garante
 * que ninguem as reintroduza no futuro.
 */
const CONTEUDO_PRIVADO = {
  assunto: 'Quero comprar 3 contas premium e parcelar no cartao',
  motivoEncerramento: 'Cliente desistiu apos ver o valor final',
  chavePix: '12345678900',
  transcript: 'cliente: qual o valor? | atendente: R$ 250,00',
  valor: 'R$ 250,00',
};

// ---------------------------------------------------------------------------
// Helpers de leitura do JSON dos componentes
// ---------------------------------------------------------------------------

function textBlocks(root: ContainerBuilder): string[] {
  return root
    .toJSON()
    .components.filter(
      (component): component is APITextDisplayComponent =>
        component.type === ComponentType.TextDisplay,
    )
    .map((component) => component.content);
}

function renderedText(root: ContainerBuilder): string {
  return textBlocks(root).join('\n');
}

function buttonsOf(root: ContainerBuilder): APIButtonComponent[] {
  return root
    .toJSON()
    .components.filter(
      (
        component,
      ): component is APIActionRowComponent<APIComponentInMessageActionRow> =>
        component.type === ComponentType.ActionRow,
    )
    .flatMap((row) =>
      row.components.filter(
        (component): component is APIButtonComponent =>
          component.type === ComponentType.Button,
      ),
    );
}

/** Rotulos em negrito no formato `**Label**` usados pelos campos V2. */
function fieldLabels(root: ContainerBuilder): string[] {
  return [...renderedText(root).matchAll(/\*\*([^*\n]+)\*\*/g)].map((match) => match[1] ?? '');
}

function textInputOf(modal: ModalBuilder): APITextInputComponent {
  const label = modal
    .toJSON()
    .components.find(
      (component): component is APILabelComponent => component.type === ComponentType.Label,
    );
  expect(label).toBeDefined();
  const input = label?.component;
  expect(input?.type).toBe(ComponentType.TextInput);
  return input as APITextInputComponent;
}

// ---------------------------------------------------------------------------
// formatTicketNumber
// ---------------------------------------------------------------------------

describe('formatTicketNumber', () => {
  it('formata o numero do atendimento com 4 digitos', () => {
    expect(formatTicketNumber(125)).toBe('#0125');
    expect(formatTicketNumber(1)).toBe('#0001');
    expect(formatTicketNumber(12345)).toBe('#12345');
  });
});

// ---------------------------------------------------------------------------
// buildReviewRequest
// ---------------------------------------------------------------------------

describe('buildReviewRequest', () => {
  const painel = buildReviewRequest({
    ticketId: TICKET_ID,
    storeName: 'Vook Store',
    ticketNumber: 125,
    categoryName: 'Suporte',
  });

  it('usa o titulo padrao da Vook Store', () => {
    expect(renderedText(painel)).toContain(TITLES.REVIEW_REQUEST);
  });

  it('anuncia o encerramento do atendimento e convida a avaliar', () => {
    const texto = renderedText(painel);
    expect(texto).toContain('Seu atendimento #0125 foi concluido.');
    expect(texto).toContain('Como foi sua experiencia com nossa equipe?');
  });

  it('gera exatamente 5 botoes de nota, todos em uma unica action row', () => {
    const rows = painel
      .toJSON()
      .components.filter((component) => component.type === ComponentType.ActionRow);

    expect(rows).toHaveLength(1);
    expect(buttonsOf(painel)).toHaveLength(5);
  });

  it('gera os customIds corretos: review:rate:<ticketId>:<nota>', () => {
    const botoes = buttonsOf(painel);

    expect(botoes.map((botao) => ('custom_id' in botao ? botao.custom_id : null))).toEqual([
      `review:rate:${TICKET_ID}:1`,
      `review:rate:${TICKET_ID}:2`,
      `review:rate:${TICKET_ID}:3`,
      `review:rate:${TICKET_ID}:4`,
      `review:rate:${TICKET_ID}:5`,
    ]);
  });

  it('rotula os botoes de "⭐ 1" a "⭐ 5" no estilo Secondary', () => {
    const botoes = buttonsOf(painel);

    expect(botoes.map((botao) => ('label' in botao ? botao.label : null))).toEqual([
      '⭐ 1',
      '⭐ 2',
      '⭐ 3',
      '⭐ 4',
      '⭐ 5',
    ]);
    expect(botoes.every((botao) => botao.style === ButtonStyle.Secondary)).toBe(true);
  });

  it('mantem todo customId dentro do limite real do Discord', () => {
    for (const botao of buttonsOf(painel)) {
      const customId = 'custom_id' in botao ? botao.custom_id : '';
      expect(customId.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
      expect(customId.length).toBeLessThanOrEqual(DISCORD_LIMITS.CUSTOM_ID);
    }
  });

  it('nunca escreve "Pedding"', () => {
    expect(JSON.stringify(painel.toJSON())).not.toContain('Pedding');
  });
});

// ---------------------------------------------------------------------------
// buildPublishedReview — privacidade
// ---------------------------------------------------------------------------

describe('buildPublishedReview — privacidade', () => {
  const publicacao = buildPublishedReview({
    storeName: 'Vook Store',
    rating: 5,
    customerId: CUSTOMER_ID,
    ticketNumber: 125,
    categoryName: 'Suporte',
    staffId: STAFF_ID,
    comment: 'Atendimento rapido e educado.',
    createdAt: CREATED_AT,
  });

  const serializado = JSON.stringify(publicacao.toJSON());

  it('nao vaza o assunto do ticket', () => {
    expect(serializado).not.toContain(CONTEUDO_PRIVADO.assunto);
  });

  it('nao vaza o motivo de encerramento', () => {
    expect(serializado).not.toContain(CONTEUDO_PRIVADO.motivoEncerramento);
  });

  it('nao vaza chave PIX nem valores financeiros', () => {
    expect(serializado).not.toContain(CONTEUDO_PRIVADO.chavePix);
    expect(serializado).not.toContain(CONTEUDO_PRIVADO.valor);
  });

  it('nao vaza transcript da conversa', () => {
    expect(serializado).not.toContain(CONTEUDO_PRIVADO.transcript);
  });

  /*
   * A LISTA DE PERMITIDOS continua sendo a regra; o que mudou foi o layout.
   * A ficha tecnica saiu de rotulos em negrito para subtexto, entao a
   * conferencia deixou de caber num casamento por `**rotulo**` — os rotulos que
   * restaram sao checados aqui, e a PRESENCA de cada dado permitido logo
   * abaixo. Quem garante que nada novo entrou sao os quatro testes de vazamento
   * acima, que continuam valendo qualquer que seja o layout.
   */
  it('so destaca em negrito os campos permitidos', () => {
    expect(fieldLabels(publicacao)).toEqual(['5/5', 'Cliente', 'Atendente']);
  });

  it('continua publicando todo dado permitido, mesmo fora do negrito', () => {
    const texto = renderedText(publicacao);

    expect(texto).toContain('#0125');
    expect(texto).toContain('Suporte');
    expect(texto).toContain('Atendimento rapido e educado.');
    expect(texto).toContain('Avaliado');
  });
});

// ---------------------------------------------------------------------------
// buildPublishedReview — conteudo
// ---------------------------------------------------------------------------

describe('buildPublishedReview', () => {
  function publicar(
    overrides: Partial<Parameters<typeof buildPublishedReview>[0]> = {},
  ): ContainerBuilder {
    return buildPublishedReview({
      storeName: 'Vook Store',
      rating: 5,
      customerId: CUSTOMER_ID,
      ticketNumber: 125,
      categoryName: 'Suporte',
      staffId: STAFF_ID,
      comment: 'Atendimento rapido e educado.',
      createdAt: CREATED_AT,
      ...overrides,
    });
  }

  it('usa o titulo e a cor dourada da avaliacao publicada', () => {
    const publicacao = publicar();
    expect(renderedText(publicacao)).toContain(TITLES.REVIEW_PUBLISHED);
    // Politica visual: nenhum painel tem barra de cor (ver container() em v2.ts).
    expect(publicacao.toJSON().accent_color).toBeUndefined();
  });

  it.each([1, 2, 3, 4, 5])('mostra as estrelas correspondentes a nota %i', (nota) => {
    const texto = renderedText(publicar({ rating: nota }));
    expect(texto).toContain(renderStars(nota));
    expect(texto).toContain(`**${nota}/5**`);
  });

  it('diferencia visualmente 2 estrelas de 4 estrelas', () => {
    expect(renderedText(publicar({ rating: 2 }))).toContain('⭐⭐☆☆☆');
    expect(renderedText(publicar({ rating: 4 }))).toContain('⭐⭐⭐⭐☆');
  });

  it('mostra cliente, numero do atendimento e categoria', () => {
    const texto = renderedText(publicar());
    expect(texto).toContain(`<@${CUSTOMER_ID}>`);
    expect(texto).toContain('#0125');
    expect(texto).toContain('Suporte');
  });

  it('mostra o atendente quando o ticket foi assumido', () => {
    expect(renderedText(publicar({ staffId: STAFF_ID }))).toContain(`<@${STAFF_ID}>`);
  });

  it('mostra "Nao atribuido" quando ninguem assumiu o ticket', () => {
    const texto = renderedText(publicar({ staffId: null }));
    expect(texto).toContain('**Atendente** nao atribuido');
  });

  it('exibe o comentario entre aspas', () => {
    const texto = renderedText(publicar({ comment: 'Atendimento rapido e educado.' }));
    expect(texto).toContain('"Atendimento rapido e educado."');
  });

  it('exibe "Nenhum comentario informado." quando o comentario e null', () => {
    const texto = renderedText(publicar({ comment: null }));
    expect(texto).toContain('Nenhum comentario informado.');
    expect(texto).not.toContain('""');
  });

  it('trata comentario apenas com espacos como ausente', () => {
    expect(renderedText(publicar({ comment: '   \n  ' }))).toContain(
      'Nenhum comentario informado.',
    );
  });

  it('mostra a data da avaliacao como timestamp relativo do Discord', () => {
    const esperado = `<t:${Math.floor(CREATED_AT.getTime() / 1000)}:R>`;
    expect(renderedText(publicar())).toContain(esperado);
  });

  it('nunca escreve "Pedding"', () => {
    expect(JSON.stringify(publicar().toJSON())).not.toContain('Pedding');
  });
});

// ---------------------------------------------------------------------------
// buildReviewCommentModal
// ---------------------------------------------------------------------------

describe('buildReviewCommentModal', () => {
  const modal = buildReviewCommentModal(TICKET_ID, 4);

  it('marca o campo de comentario como OPCIONAL', () => {
    expect(textInputOf(modal).required).toBe(false);
  });

  it('usa campo de paragrafo com o limite de negocio do comentario', () => {
    const input = textInputOf(modal);
    expect(input.style).toBe(TextInputStyle.Paragraph);
    expect(input.max_length).toBe(BUSINESS_LIMITS.REVIEW_COMMENT_MAX);
  });

  it('usa o rotulo combinado com o cliente', () => {
    const label = modal
      .toJSON()
      .components.find(
        (component): component is APILabelComponent => component.type === ComponentType.Label,
      );
    expect(label?.label).toBe('Conte um pouco sobre sua experiencia');
  });

  it('identifica o campo com um id estavel e sem forma de rota', () => {
    expect(textInputOf(modal).custom_id).toBe(REVIEW_COMMENT_INPUT_ID);
    expect(REVIEW_COMMENT_INPUT_ID).toBe('comment');
    // Campo de modal nao passa pelo router: usar "namespace:action" aqui daria a
    // entender que existe um handler escutando essa rota (e nao existe).
    expect(REVIEW_COMMENT_INPUT_ID).not.toContain(':');
  });

  it('carrega ticket e nota no customId do modal', () => {
    expect(modal.toJSON().custom_id).toBe(`review:comment-modal:${TICKET_ID}:4`);
    expect(modal.toJSON().custom_id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
  });

  it('respeita o limite de 45 caracteres do titulo do modal', () => {
    for (const nota of [1, 2, 3, 4, 5]) {
      const titulo = buildReviewCommentModal(TICKET_ID, nota).toJSON().title ?? '';
      expect(titulo.length).toBeGreaterThan(0);
      expect(titulo.length).toBeLessThanOrEqual(DISCORD_LIMITS.MODAL_TITLE);
    }
  });
});

// ---------------------------------------------------------------------------
// buildReviewThanks
// ---------------------------------------------------------------------------

describe('buildReviewThanks', () => {
  it.each([1, 3, 5])('agradece mostrando a nota %i escolhida', (nota) => {
    const texto = renderedText(buildReviewThanks(nota));
    expect(texto).toContain(renderStars(nota));
    expect(texto).toContain(`**${nota}/5**`);
  });

  it('nao expoe nenhum botao (e apenas uma confirmacao efemera)', () => {
    expect(buttonsOf(buildReviewThanks(5))).toHaveLength(0);
  });
});
