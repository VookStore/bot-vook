import { ComponentType } from 'discord.js';
import { TicketStatus, type Ticket } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  buildAdminPanel,
  buildInternalPanel,
} from '../src/modules/tickets/builders/TicketInternalPanelBuilder';
import {
  buildAddMemberSelect,
  buildTransferSelect,
} from '../src/modules/tickets/builders/TicketModalBuilder';
import { sanitizeImageUrl } from '../src/utils/sanitize';

/**
 * O que o painel do ticket entrega para a API.
 *
 * Duas classes de defeito moram aqui, as duas invisiveis em desenvolvimento
 * porque o discord.js serializa sem validar nada:
 *  - validar um texto e enviar OUTRO (a URL crua no lugar da normalizada);
 *  - deixar markdown de configuracao ou de usuario escapar do bloco de codigo.
 */

const OWNER = '111111111111111111';
const STAFF = '222222222222222222';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ckq1abc2xyz0000dadosaqui',
    guildId: '1528606501248438282',
    ticketNumber: 153,
    categoryId: 'c1',
    ownerId: OWNER,
    subject: 'EMBED PAG',
    channelId: 'ch1',
    channelName: 'ticket-0153',
    status: TicketStatus.OPEN,
    priority: 'NORMAL',
    claimedById: null,
    claimedAt: null,
    closedById: null,
    closedAt: null,
    closeReason: null,
    panelMessageId: null,
    lastClientNotifyAt: null,
    lastRenamedAt: null,
    createdAt: new Date('2026-08-23T00:00:00.000Z'),
    updatedAt: new Date('2026-08-23T00:00:00.000Z'),
    ...overrides,
  } as unknown as Ticket;
}

function panel(options: {
  subject?: string;
  categoryName?: string;
  thumbnailUrl?: string | null;
  bannerUrl?: string | null;
}) {
  return buildInternalPanel({
    ticket: makeTicket(options.subject === undefined ? {} : { subject: options.subject }),
    categoryName: options.categoryName ?? 'Outros',
    queuePosition: 1,
    participantIds: [],
    thumbnailUrl: options.thumbnailUrl ?? null,
    bannerUrl: options.bannerUrl ?? null,
    storeName: 'Vook Store',
  }).toJSON();
}

function galleryUrls(json: ReturnType<typeof panel>): string[] {
  return json.components.flatMap((component) =>
    component.type === ComponentType.MediaGallery
      ? component.items.map((item) => item.media.url)
      : [],
  );
}

function thumbnailUrls(json: ReturnType<typeof panel>): string[] {
  return json.components.flatMap((component) => {
    if (component.type !== ComponentType.Section) return [];
    const accessory = component.accessory;
    return accessory.type === ComponentType.Thumbnail ? [accessory.media.url] : [];
  });
}

function textOf(json: ReturnType<typeof panel>): string {
  return json.components
    .flatMap((component) => {
      if (component.type === ComponentType.TextDisplay) return [component.content];
      if (component.type === ComponentType.Section) return component.components.map((t) => t.content);
      return [];
    })
    .join('\n');
}

describe('a URL enviada e exatamente a URL validada', () => {
  it('espaco nas pontas nao viaja para o payload', () => {
    // Com `isSafeImageUrl(x) ? x : null` isto passava na validacao (que
    // normaliza) e chegava a API com os espacos — 400 na hora do envio.
    const json = panel({
      thumbnailUrl: '  https://cdn.vook.store/logo.png  ',
      bannerUrl: '  https://cdn.vook.store/banner.gif  ',
    });

    expect(galleryUrls(json)).toEqual(['https://cdn.vook.store/banner.gif']);
    expect(thumbnailUrls(json)).toEqual(['https://cdn.vook.store/logo.png']);
  });

  it('recusa protocolo perigoso e http sem TLS', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:image/png;base64,AAA',
      'file:///etc/passwd',
      'http://inseguro/x.gif',
      '//evil/a.png',
      'https://user:senha@evil/a.png',
    ]) {
      const json = panel({ thumbnailUrl: url, bannerUrl: url });
      expect(galleryUrls(json), url).toEqual([]);
      expect(thumbnailUrls(json), url).toEqual([]);
    }
  });
});

describe('attachment:// nunca chega ao painel do ticket', () => {
  it('o sanitizador aceita o esquema — por isso o painel precisa recusar', () => {
    // Contexto do teste abaixo: `attachment://` e legitimo para QR code e
    // transcript, entao `sanitizeImageUrl` deixa passar.
    expect(sanitizeImageUrl('attachment://logo.png')).toBe('attachment://logo.png');
  });

  it('um valor desses no banco vira painel sem imagem, nao 400', () => {
    // O painel interno nao envia arquivo nenhum. Com `attachment://` no
    // payload o Discord responde 400 e derruba a criacao do ticket e todo
    // refresh; sem ele, o pior caso e um painel sem banner.
    const json = panel({
      thumbnailUrl: 'attachment://logo.png',
      bannerUrl: 'attachment://banner.gif',
    });

    expect(galleryUrls(json)).toEqual([]);
    expect(thumbnailUrls(json)).toEqual([]);
  });

  it('zero-width nao reconstroi o esquema depois da validacao', () => {
    // Por que a recusa no modal de configuracao roda sobre o valor JA
    // normalizado: comparar o texto digitado nao ve este `attachment://`.
    const disfarcado = `attach${String.fromCodePoint(0x200b)}ment://logo.png`;
    expect(disfarcado.startsWith('attachment://')).toBe(false);
    expect(sanitizeImageUrl(disfarcado)).toBe('attachment://logo.png');

    expect(galleryUrls(panel({ bannerUrl: disfarcado }))).toEqual([]);
  });
});

describe('nada escapa do bloco de codigo do painel interno', () => {
  const ataques = [
    'crase simples: `',
    'cerca: ```',
    'cerca com quebra: ```\n# TITULO FALSO\n[clique](https://phishing.example)',
    'fecha e reabre: ```\n```md\n# H1\n```',
    'CR solitario: a\r```\r# H1',
    `separador unicode: a\u2028\`\`\`\u2029# H1`,
    `sosia ja no texto: ${'ˋ'.repeat(3)} ainda fecha?`,
    `sosia mais crase: ${'ˋ'.repeat(2)}\` fecha?`,
    'grave fullwidth: ｀｀｀',
    'assunto gigante: ' + 'x'.repeat(4000) + '```',
  ];

  it.each(ataques)('assunto %j nao abre cerca nem sobra linha solta', (subject) => {
    const conteudo = textOf(panel({ subject }));

    // Toda cerca aberta foi fechada.
    expect((conteudo.split('```').length - 1) % 2).toBe(0);
    // Nenhum terminador de linha cru sobrou dentro do valor.
    expect(conteudo).not.toContain('\r');
    expect(conteudo).not.toContain('\u2028');
    expect(conteudo).not.toContain('\u2029');
    // O texto do atacante continua sendo conteudo, nunca estrutura.
    expect(conteudo).not.toContain('\n# TITULO FALSO');
    expect(conteudo).toContain('Assunto do Ticket');
  });

  it('cabe folgado no orcamento de texto da mensagem V2', () => {
    const conteudo = textOf(
      panel({ subject: 'y'.repeat(4000), categoryName: 'z'.repeat(400) }),
    );
    expect(conteudo.length).toBeLessThan(4000);
  });
});

describe('nome da categoria no painel administrativo', () => {
  it('vai dentro de trecho de codigo, sem virar titulo nem link', () => {
    const ticket = makeTicket();
    const conteudo = buildAdminPanel({
      ticket,
      categoryName: '# CATEGORIA](https://phishing.example)',
      actorId: STAFF,
      addMemberSelect: buildAddMemberSelect(ticket.id),
      transferSelect: buildTransferSelect(ticket.id),
      removeMemberSelect: null,
      thumbnailUrl: null,
      storeName: 'Vook Store',
    })
      .map((container) => container.toJSON())
      .flatMap((json) =>
        json.components.flatMap((component) => {
          if (component.type === ComponentType.TextDisplay) return [component.content];
          if (component.type === ComponentType.Section) {
            return component.components.map((t) => t.content);
          }
          return [];
        }),
      )
      .join('\n');

    expect(conteudo).toContain('`# CATEGORIA](https://phishing.example)`');
    expect((conteudo.split('`').length - 1) % 2).toBe(0);
  });
});
