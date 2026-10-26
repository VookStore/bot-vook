import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import type { ContainerBuilder } from 'discord.js';

import { buildClosureDm } from '../src/modules/tickets/builders/TicketClosureBuilder';

/**
 * Cartao de encerramento na DM do cliente.
 *
 * O QUE ESTES TESTES TRAVAM: o fechamento manda UMA mensagem. Antes eram duas —
 * o aviso e, logo atras, o convite de avaliacao — quase iguais, e o cliente
 * respondia a segunda achando que era repeticao.
 */

const OWNER_ID = '222222222222222222';
const STAFF_ID = '333333333333333333';
const TICKET_ID = 'ckticket00000000000000001';

interface Node {
  type: ComponentType;
  content?: string;
  components?: Node[];
  items?: Array<{ media?: { url?: string } }>;
  label?: string;
  style?: number;
  custom_id?: string;
}

function nodes(root: ContainerBuilder): Node[] {
  return (root.toJSON() as unknown as Node).components ?? [];
}

function allText(root: ContainerBuilder): string {
  return nodes(root)
    .filter((node) => node.type === ComponentType.TextDisplay)
    .map((node) => node.content ?? '')
    .join('\n');
}

function buttons(root: ContainerBuilder): Node[] {
  return nodes(root)
    .filter((node) => node.type === ComponentType.ActionRow)
    .flatMap((row) => row.components ?? []);
}

function galleryUrls(root: ContainerBuilder): string[] {
  return nodes(root)
    .filter((node) => node.type === ComponentType.MediaGallery)
    .flatMap((node) => (node.items ?? []).map((item) => item.media?.url ?? ''));
}

function make(overrides: Partial<Parameters<typeof buildClosureDm>[0]> = {}): ContainerBuilder {
  return buildClosureDm({
    storeName: 'Vook Store',
    ownerId: OWNER_ID,
    ticketNumber: 2194,
    categoryName: 'Suporte',
    closedById: STAFF_ID,
    closedByLabel: 'Nomad',
    closeReason: 'Questao solucionada!',
    bannerUrl: 'https://cdn.vookstore.com/ticket.png',
    reviewTicketId: TICKET_ID,
    ...overrides,
  });
}

describe('cartao de encerramento', () => {
  it('abre com a saudacao ao cliente e o nome da loja', () => {
    const texto = allText(make());

    expect(texto).toContain(`Ola, <@${OWNER_ID}>!`);
    expect(texto).toContain('**Vook Store**');
  });

  it('lista categoria, protocolo, quem encerrou e o motivo', () => {
    const texto = allText(make());

    expect(texto).toContain('Categoria: Suporte');
    expect(texto).toContain('Protocolo: `#2194`');
    expect(texto).toContain(`Encerrado por: <@${STAFF_ID}> (Nomad)`);
    expect(texto).toContain('Motivo do encerramento: Questao solucionada!');
  });

  it('sem quem encerrou, a linha diz isso em vez de sumir', () => {
    // O cliente le a lista inteira; um item que desaparece parece dado perdido.
    expect(allText(make({ closedById: null, closedByLabel: null }))).toContain(
      'Encerrado por: Nao informado',
    );
  });

  it('motivo de varias linhas vira uma linha so', () => {
    // Ele divide linha com o rotulo: uma quebra digitada no modal pelo atendente
    // empurraria o texto para fora do alinhamento do bloco.
    const texto = allText(make({ closeReason: 'Resolvido.\n\nCliente confirmou.' }));

    expect(texto).toContain('Motivo do encerramento: Resolvido. Cliente confirmou.');
  });
});

describe('banner do cartao', () => {
  it('entra quando a loja configurou um', () => {
    expect(galleryUrls(make())).toEqual(['https://cdn.vookstore.com/ticket.png']);
  });

  it('sem banner o cartao comeca na saudacao', () => {
    // A arte e enfeite: ela nunca decide se a DM sai.
    const card = make({ bannerUrl: null });

    expect(galleryUrls(card)).toEqual([]);
    expect(allText(card)).toContain('Ola,');
  });

  it('URL insegura e tratada como banner ausente, sem derrubar a DM', () => {
    // `http://` e recusado pelo validador de imagem. Deixar o erro subir aqui
    // custaria ao cliente TODA a mensagem de encerramento por causa de um
    // enfeite mal configurado.
    expect(galleryUrls(make({ bannerUrl: 'http://cdn.vookstore.com/ticket.png' }))).toEqual([]);
  });
});

/**
 * O convite de avaliacao.
 *
 * UM botao, e nao as cinco estrelas: o cartao e um aviso de encerramento, e
 * cinco notas ali dentro competem com os detalhes que o cliente foi ler.
 */
describe('convite de avaliacao no cartao', () => {
  it('leva um botao que aponta para o proprio atendimento', () => {
    const [botao] = buttons(make());

    expect(botao?.label).toBe('Avaliar este atendimento');
    expect(botao?.custom_id).toBe(`review:start:${TICKET_ID}`);
    // Politica visual da loja: todo botao do bot e cinza.
    expect(botao?.style).toBe(ButtonStyle.Secondary);
  });

  it('ticket ja avaliado nao ganha botao', () => {
    // Botao que so sabe responder "voce ja avaliou" e pior que botao nenhum.
    const card = make({ reviewTicketId: null });

    expect(buttons(card)).toHaveLength(0);
    expect(allText(card)).toContain('Obrigado por entrar em contato');
    expect(allText(card)).not.toContain('avaliar nosso suporte');
  });
});

/**
 * O link do transcript.
 *
 * O cliente nunca recebeu copia do historico — o transcript ia como anexo no
 * canal de logs, que so a equipe ve. Com a hospedagem, ele leva o proprio
 * atendimento no bolso.
 */
describe('link do transcript no cartao', () => {
  const URL_TRANSCRIPT = 'https://transcripts.exemplo.com/t/t0042-abcdef';

  it('vira um botao de LINK ao lado do de avaliar', () => {
    const [avaliar, historico] = buttons(make({ transcriptUrl: URL_TRANSCRIPT }));

    expect(avaliar?.label).toBe('Avaliar este atendimento');
    expect(historico?.label).toBe('Ver histórico do atendimento');
    expect(historico?.style).toBe(ButtonStyle.Link);
  });

  it('sem avaliacao pendente, o cartao ainda leva o historico', () => {
    // Ticket ja avaliado nao perde o transcript: sao coisas independentes.
    const card = make({ reviewTicketId: null, transcriptUrl: URL_TRANSCRIPT });
    const [unico] = buttons(card);

    expect(buttons(card)).toHaveLength(1);
    expect(unico?.label).toBe('Ver histórico do atendimento');
    expect(allText(card)).toContain('historico completo');
  });

  it('hospedagem desligada apenas omite o botao', () => {
    // Upload falhou ou nem esta configurado: o cartao sai igual, sem o link.
    expect(buttons(make({ transcriptUrl: null }))).toHaveLength(1);
    expect(allText(make({ transcriptUrl: null }))).not.toContain('historico');
  });

  it('sem avaliacao e sem transcript, o cartao fecha no agradecimento', () => {
    const card = make({ reviewTicketId: null, transcriptUrl: null });

    expect(buttons(card)).toHaveLength(0);
    expect(allText(card)).toContain('Obrigado por entrar em contato');
  });
});

describe('limites do Discord', () => {
  it('o caminho mais pesado cabe nos 10 filhos do Container', () => {
    // Banner + saudacao + detalhes + convite + botao + rodape, com os tres
    // separadores. Sem esta conta, um bloco a mais derruba a DM com 400.
    expect(nodes(make())).toHaveLength(9);
  });

  it('o segundo botao NAO custa um componente: divide a mesma linha', () => {
    // Avaliar e transcript entram na mesma ActionRow. Cada um num bloco proprio
    // levaria o cartao a 11 filhos — um a mais do que o container aceita.
    const cheio = make({ transcriptUrl: 'https://transcripts.exemplo.com/t/t0042-abcdef' });

    expect(nodes(cheio)).toHaveLength(9);
    expect(buttons(cheio)).toHaveLength(2);
  });

  it('motivo gigante nao estoura o cartao', () => {
    const texto = allText(make({ closeReason: 'A'.repeat(5000) }));

    expect(texto.length).toBeLessThan(1000);
  });
});
