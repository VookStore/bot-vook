import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import type { ContainerBuilder } from 'discord.js';

import {
  NOTIFY_BUTTON_LABEL,
  buildClientNotifyDm,
} from '../src/modules/tickets/builders/TicketNotifyBuilder';

/**
 * DM de "a equipe esta te aguardando".
 *
 * O QUE ESTES TESTES TRAVAM: a DM carrega a ULTIMA MENSAGEM DA EQUIPE. Antes
 * ela dizia so "seu atendimento recebeu uma atualizacao", e o cliente tinha de
 * abrir o ticket para descobrir o que perguntaram — a ida que a notificacao
 * existe para evitar.
 */

const GUILD = '1528606501248438282';
const CANAL = '999999999999999999';
const OWNER = '222222222222222222';
const STAFF = '333333333333333333';

interface Node {
  type: ComponentType;
  content?: string;
  components?: Array<{ label?: string; style?: number; url?: string }>;
}

function nodes(root: ContainerBuilder): Node[] {
  return (root.toJSON() as unknown as { components: Node[] }).components;
}

function allText(root: ContainerBuilder): string {
  return nodes(root)
    .filter((n) => n.type === ComponentType.TextDisplay)
    .map((n) => n.content ?? '')
    .join('\n');
}

function make(lastMessage: Parameters<typeof buildClientNotifyDm>[0]['lastMessage']) {
  return buildClientNotifyDm({
    storeName: 'Vook Store',
    guildId: GUILD,
    channelId: CANAL,
    ownerId: OWNER,
    ticketNumber: 1,
    categoryName: 'Cabelos (Perucas)',
    staffId: STAFF,
    bannerUrl: null,
    lastMessage,
  });
}

const MENSAGEM = {
  authorId: STAFF,
  authorName: 'Hades',
  content: 'Consegue me enviar o print do erro?',
  createdAt: new Date('2026-08-30T14:00:00.000Z'),
};

describe('DM de notificacao', () => {
  it('diz quem respondeu e em qual atendimento', () => {
    const texto = allText(make(MENSAGEM));

    expect(texto).toContain(`<@${OWNER}>`);
    expect(texto).toContain(`<@${STAFF}>`);
    expect(texto).toContain('#0001');
    expect(texto).toContain('Cabelos (Perucas)');
  });

  it('cita a ultima mensagem da equipe', () => {
    const texto = allText(make(MENSAGEM));

    expect(texto).toContain('Hades');
    expect(texto).toContain('> Consegue me enviar o print do erro?');
  });

  it('sem mensagem para citar, a DM ainda avisa', () => {
    // Historico indisponivel ou equipe sem fala nas ultimas 50 mensagens: a
    // notificacao continua valendo, so perde a citacao.
    const semCitacao = make(null);

    expect(allText(semCitacao)).toContain('aguardando sua resposta');
    expect(allText(semCitacao)).not.toContain('Consegue me enviar');
    // O bloco da citacao some inteiro, junto do separador que o antecede.
    expect(nodes(semCitacao).length).toBeLessThan(nodes(make(MENSAGEM)).length);
  });

  it('escapa markdown que quebraria o cartao', () => {
    // `#` no comeco viraria titulo; crase abriria bloco de codigo engolindo o
    // rodape. O escape mexe so no que quebra a estrutura.
    const texto = allText(
      make({ ...MENSAGEM, content: '# titulo `codigo` > citacao [link]' }),
    );

    expect(texto).toContain('\\#');
    expect(texto).toContain('\\`');
    expect(texto).toContain('\\[');
  });

  it('cada linha da citacao leva o proprio prefixo', () => {
    // `>>>` transformaria em citacao tudo que viesse depois, inclusive o rodape.
    const texto = allText(make({ ...MENSAGEM, content: 'linha um\nlinha dois' }));

    expect(texto).toContain('> linha um');
    expect(texto).toContain('> linha dois');
    expect(texto).not.toContain('>>>');
  });

  it('mensagem gigante nao vira parede de texto', () => {
    const texto = allText(make({ ...MENSAGEM, content: 'A'.repeat(5000) }));
    expect(texto.length).toBeLessThan(1200);
  });

  it('leva um botao de LINK para a conversa', () => {
    const row = nodes(make(MENSAGEM)).find((n) => n.type === ComponentType.ActionRow);
    const botao = row?.components?.[0];

    expect(botao?.label).toBe(NOTIFY_BUTTON_LABEL);
    expect(botao?.style).toBe(ButtonStyle.Link);
    expect(botao?.url).toBe(`https://discord.com/channels/${GUILD}/${CANAL}`);
  });

  it('cabe nos 10 filhos do Container', () => {
    expect(nodes(make(MENSAGEM)).length).toBeLessThanOrEqual(10);
  });
});
