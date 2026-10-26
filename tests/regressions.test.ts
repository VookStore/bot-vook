import { describe, expect, it } from 'vitest';
import { CouponType, PaymentStatus, TicketStatus } from '@prisma/client';

import { LOCK_NAMESPACE, LockService } from '../src/core/locks/LockService';
import { checkCouponEligibility } from '../src/modules/coupons/services/CouponCalculator';
import type { CouponLike } from '../src/modules/coupons/types/coupon';
import { buildPublishedReview } from '../src/modules/reviews/builders/ReviewBuilders';
import { buildCategorySelect } from '../src/modules/tickets/builders/TicketModalBuilder';
import { escapeMarkdownLayout, sanitizeReviewComment } from '../src/utils/sanitize';

/**
 * Regressoes da revisao final.
 *
 * Cada bloco trava UM defeito que existia antes desta revisao. Todos falham no
 * codigo anterior; a descricao diz o que quebrava.
 */

// ---------------------------------------------------------------------------
// LockService: release cruzado depois do TTL
// ---------------------------------------------------------------------------

describe('LockService — release nao pode apagar o lock de outro dono', () => {
  it('A, que estourou o TTL, nao derruba o lock que B adquiriu depois', async () => {
    const locks = new LockService();
    const ordem: string[] = [];

    // A roda com TTL curtissimo e demora mais que ele.
    const a = locks.withLock(
      LOCK_NAMESPACE.TICKET_CLOSE,
      'ticket-1',
      async () => {
        ordem.push('A:start');
        await new Promise((resolve) => setTimeout(resolve, 60));
        ordem.push('A:end');
      },
      { ttlMs: 10 },
    );

    // Depois do TTL de A, B adquire o MESMO recurso com TTL longo.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(locks.tryAcquire(LOCK_NAMESPACE.TICKET_CLOSE, 'ticket-1', 10_000)).toBe(true);
    ordem.push('B:acquired');

    // Quando A termina, o finally dele NAO pode apagar a chave de B.
    await a;

    expect(ordem).toEqual(['A:start', 'B:acquired', 'A:end']);
    expect(locks.isLocked(LOCK_NAMESPACE.TICKET_CLOSE, 'ticket-1')).toBe(true);
    // E ninguem mais entra em paralelo com B.
    expect(locks.tryAcquire(LOCK_NAMESPACE.TICKET_CLOSE, 'ticket-1')).toBe(false);
  });

  it('release sem token continua apagando (uso administrativo)', () => {
    const locks = new LockService();
    expect(locks.tryAcquire(LOCK_NAMESPACE.PANEL_UPDATE, 'g1')).toBe(true);
    locks.release(LOCK_NAMESPACE.PANEL_UPDATE, 'g1');
    expect(locks.isLocked(LOCK_NAMESPACE.PANEL_UPDATE, 'g1')).toBe(false);
  });

  it('withLock libera normalmente quando nao ha disputa', async () => {
    const locks = new LockService();
    await locks.withLock(LOCK_NAMESPACE.REVIEW_SUBMIT, 'r1', () => Promise.resolve());
    expect(locks.isLocked(LOCK_NAMESPACE.REVIEW_SUBMIT, 'r1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cupom que zera o total
// ---------------------------------------------------------------------------

function coupon(overrides: Partial<CouponLike> = {}): CouponLike {
  return {
    id: 'c1',
    guildId: 'g1',
    code: 'BRINDE',
    type: CouponType.FIXED_AMOUNT,
    value: 5000,
    minimumAmount: null,
    maximumDiscount: null,
    maxUses: null,
    maxUsesPerCustomer: null,
    startsAt: null,
    expiresAt: null,
    enabled: true,
    deletedAt: null,
    ...overrides,
  };
}

const contexto = { guildId: 'g1', amountCents: 5000, now: new Date(), totalUses: 0, customerUses: 0 };

describe('cupom que zera o total nao pode ser oferecido', () => {
  it('recusa FIXED_AMOUNT igual ao valor da compra', () => {
    // Antes: {ok: true} -> vendedor via "Total R$ 0,00", clicava em Gerar
    // Cobranca e so entao levava "o valor precisa ser maior que zero".
    const resultado = checkCouponEligibility(coupon(), contexto);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toBe('zeroes_total');
      expect(resultado.userMessage).toContain('zera o total');
    }
  });

  it('recusa PERCENTAGE de 100%', () => {
    const resultado = checkCouponEligibility(
      coupon({ type: CouponType.PERCENTAGE, value: 10_000 }),
      contexto,
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reason).toBe('zeroes_total');
  });

  it('continua aceitando cupom que deixa pelo menos 1 centavo', () => {
    const resultado = checkCouponEligibility(coupon({ value: 4999 }), contexto);
    expect(resultado.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comentario de avaliacao publicado em canal publico
// ---------------------------------------------------------------------------

describe('comentario de avaliacao nao pode forjar um anuncio da loja', () => {
  const PHISHING = '# BRINDE OFICIAL\n[CLIQUE PARA RESGATAR](https://phishing.example/vook)';

  it('escapa link mascarado, cabecalho, crase e citacao', () => {
    const saida = escapeMarkdownLayout(PHISHING);

    // Nenhum caractere de layout sobra SEM a barra invertida na frente — e a
    // barra e o que faz o Discord renderizar o caractere como texto literal.
    expect(saida).not.toMatch(/(^|[^\\])[[\]#`>]/);
    expect(saida).toContain('\\[CLIQUE PARA RESGATAR\\]');
    expect(saida).toContain('\\#');

    expect(escapeMarkdownLayout('`codigo`')).toBe('\\`codigo\\`');
    expect(escapeMarkdownLayout('> citacao')).toBe('\\> citacao');
    // A propria barra e escapada, senao "\[" do usuario reabriria o link.
    expect(escapeMarkdownLayout('\\')).toBe('\\\\');
  });

  it('o payload publicado no canal sai com o markdown neutralizado', () => {
    const json = buildPublishedReview({
      storeName: 'Vook Store',
      rating: 5,
      customerId: '111',
      ticketNumber: 7,
      categoryName: 'Suporte',
      staffId: '222',
      comment: sanitizeReviewComment(PHISHING),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }).toJSON();

    const conteudo = JSON.stringify(json);
    // O texto do cliente continua legivel...
    expect(conteudo).toContain('CLIQUE PARA RESGATAR');
    // ...mas nao como link mascarado clicavel: o "]" antes do "(" esta escapado.
    expect(conteudo).not.toMatch(/[^\\]\]\(https/);
  });

  it('comentario comum passa intacto', () => {
    const texto = JSON.stringify(
      buildPublishedReview({
        storeName: 'Vook Store',
        rating: 5,
        customerId: '111',
        ticketNumber: 7,
        categoryName: 'Suporte',
        staffId: null,
        comment: sanitizeReviewComment('Atendimento otimo, muito rapido!'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }).toJSON(),
    );
    expect(texto).toContain('Atendimento otimo, muito rapido!');
  });
});

// ---------------------------------------------------------------------------
// Emoji de categoria vindo direto do banco
// ---------------------------------------------------------------------------

describe('painel publico nao aceita emoji invalido vindo do banco', () => {
  function categoria(emoji: string | null) {
    return {
      id: 'cat-1',
      guildId: 'g1',
      name: 'Suporte',
      identifier: 'suporte',
      description: null,
      emoji,
      destinationChannelId: null,
    locatorMessageId: null,
      position: 0,
      enabled: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('descarta emoji textual que derrubaria a mensagem com 400', () => {
    // `setEmoji('carrinho')` nao lanca: serializa {"name":"carrinho"} e o
    // Discord recusa a mensagem INTEIRA do painel publico.
    const json = buildCategorySelect([categoria('carrinho')]).toJSON();
    expect(json.options[0]?.emoji).toBeUndefined();
  });

  it('mantem emoji unicode valido', () => {
    const json = buildCategorySelect([categoria('🛒')]).toJSON();
    expect(json.options[0]?.emoji?.name).toBe('🛒');
  });
});

// ---------------------------------------------------------------------------
// beginClosingAtomic devolve o status real de origem
// ---------------------------------------------------------------------------

describe('beginClosingAtomic devolve o status anterior REAL', () => {
  interface Linha {
    status: TicketStatus;
  }

  function fakeDb(linha: Linha, aoLer?: () => void) {
    return {
      ticket: {
        findUnique: (): Promise<Linha | null> => {
          aoLer?.();
          return Promise.resolve({ status: linha.status });
        },
        updateMany: (args: { where: { status: TicketStatus } }): Promise<{ count: number }> => {
          if (linha.status !== args.where.status) return Promise.resolve({ count: 0 });
          linha.status = TicketStatus.CLOSING;
          return Promise.resolve({ count: 1 });
        },
      },
    };
  }

  it('devolve CLAIMED quando o ticket foi assumido antes do lock', async () => {
    const { beginClosingAtomic } = await import(
      '../src/modules/tickets/repositories/TicketRepository'
    );

    const linha: Linha = { status: TicketStatus.CLAIMED };
    // Antes, o service usava o status lido FORA do lock (OPEN) e o revert
    // deixava OPEN + claimedById: fora da fila, impossivel de assumir,
    // impossivel de transferir e invisivel para o recovery.
    const anterior = await beginClosingAtomic(
      't1',
      fakeDb(linha) as unknown as Parameters<typeof beginClosingAtomic>[1],
    );

    expect(anterior).toBe(TicketStatus.CLAIMED);
    expect(linha.status).toBe(TicketStatus.CLOSING);
  });

  it('devolve OPEN quando o ticket estava mesmo em OPEN', async () => {
    const { beginClosingAtomic } = await import(
      '../src/modules/tickets/repositories/TicketRepository'
    );
    const linha: Linha = { status: TicketStatus.OPEN };
    const anterior = await beginClosingAtomic(
      't1',
      fakeDb(linha) as unknown as Parameters<typeof beginClosingAtomic>[1],
    );
    expect(anterior).toBe(TicketStatus.OPEN);
  });

  it('devolve null quando o ticket ja nao e fechavel', async () => {
    const { beginClosingAtomic } = await import(
      '../src/modules/tickets/repositories/TicketRepository'
    );
    const linha: Linha = { status: TicketStatus.CLOSING };
    const anterior = await beginClosingAtomic(
      't1',
      fakeDb(linha) as unknown as Parameters<typeof beginClosingAtomic>[1],
    );
    expect(anterior).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Snapshot do cupom
// ---------------------------------------------------------------------------

describe('snapshot do cupom nao pode ser reescrito com os termos atuais', () => {
  it('reprecificar mantendo o mesmo cupom usa o snapshot, nao o cupom vivo', async () => {
    const { setPrisma } = await import('../src/core/database/prisma');
    const { changePaymentAmount } = await import(
      '../src/modules/payments/services/PaymentService'
    );

    // Cobranca emitida a 20%; o admin editou o cupom para 50% depois disso.
    const linha = {
      id: 'p1',
      guildId: 'g1',
      customerId: 'cli',
      description: 'Produto',
      status: PaymentStatus.PENDING,
      originalAmount: 10_000,
      discountAmount: 2_000,
      finalAmount: 8_000,
      couponId: 'cup1',
      couponCodeSnapshot: 'VOOK20',
      couponTypeSnapshot: CouponType.PERCENTAGE,
      couponValueSnapshot: 2_000,
      pixPayload: 'antigo',
      expiresAt: new Date(Date.now() + 600_000),
      channelId: null,
      messageId: null,
      account: {
        id: 'acc1',
        pixKey: 'chave@vook.com',
        receiverName: 'VOOK STORE',
        city: 'SAO PAULO',
        enabled: true,
        deletedAt: null,
      },
    };

    const fake = {
      payment: {
        findUnique: () => Promise.resolve({ ...linha }),
        updateMany: (args: { data: Record<string, unknown> }) => {
          Object.assign(linha, args.data);
          return Promise.resolve({ count: 1 });
        },
      },
      paymentAuditLog: { create: () => Promise.resolve({}) },
    };
    setPrisma(fake as never);

    try {
      const staff = { id: 'staff1' } as never;
      const { payment, droppedCoupon } = await changePaymentAmount('g1', staff, 'p1', 10_000);

      // 20% do snapshot, NAO 50% do cupom vivo.
      expect(payment.discountAmount).toBe(2_000);
      expect(payment.finalAmount).toBe(8_000);
      expect(payment.couponValueSnapshot).toBe(2_000);
      expect(droppedCoupon).toBeNull();
    } finally {
      setPrisma(null);
    }
  });
});
