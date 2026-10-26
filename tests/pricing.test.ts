import { ComponentType } from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { DISCORD_LIMITS } from '../src/constants/limits';
import {
  buildPricingPanel,
  renderSection,
} from '../src/modules/pricing/builders/PricingBuilder';
import { PRICE_TABLE } from '../src/modules/pricing/data/priceTable';

/*
 * Tabela de precos.
 *
 * E a unica mensagem do bot que declara um VALOR para o publico. Um preco
 * errado aqui nao e um bug de interface: e uma cobranca que a loja vai ter de
 * honrar ou desdizer na frente do cliente. Por isso os testes conferem os
 * numeros contra a fonte e nao apenas se a mensagem monta.
 */

const CONFIG = {
  storeName: 'Vook Store',
  panelBannerUrl: null,
} as unknown as GuildConfig;

function panel(config: GuildConfig = CONFIG) {
  return buildPricingPanel(config).toJSON();
}

function textOf(json: ReturnType<typeof panel>): string {
  return json.components
    .flatMap((component) => (component.type === ComponentType.TextDisplay ? [component.content] : []))
    .join('\n');
}

describe('valores publicados', () => {
  it('mostra cada preco da tabela formatado em real', () => {
    const texto = textOf(panel());

    expect(texto).toContain('**Cabelo com presilha** — R$ 110,00');
    expect(texto).toContain('**Cabelo sem presilha** — R$ 90,00');
    expect(texto).toContain('**Cílios** — R$ 30,00');
    expect(texto).toContain('**Com runas** — R$ 200,00');
    expect(texto).toContain('**Criação e conversão** — R$ 40,00 cada');
  });

  it('marca o que e valor de entrada, e nao valor final', () => {
    // "a partir de" existe para o cliente nao cobrar os R$ 180 como preco fechado.
    expect(textOf(panel())).toContain('**PED de Lobo** — a partir de R$ 180,00');
  });

  it('marca o que e acrescimo sobre outro item', () => {
    expect(textOf(panel())).toContain('**2 cabelos em 1 slot** — +R$ 50,00');
  });

  it('marca o que e cobrado uma vez so', () => {
    expect(textOf(panel())).toContain('**Cores adicionais** — R$ 20,00 (pago uma vez)');
  });

  it('diz "a combinar" onde nao ha preco fixo, nunca um numero inventado', () => {
    const texto = textOf(panel());
    expect(texto).toContain('**Criação e conversão com efeitos** — a combinar com o criador');
  });

  /*
   * Roupas nao tem tabela — e o bloco existe justamente para explicar por que,
   * antes que alguem abra um ticket pedindo orcamento de algo que a loja nao faz.
   */
  it('explica o servico que a loja nao presta internamente', () => {
    const texto = textOf(panel());
    expect(texto).toContain('Roupas');
    expect(texto).toContain('Não produzimos internamente');
  });
});

describe('estrutura da mensagem', () => {
  it('cabe no limite de filhos do container', () => {
    // Um container aceita 10 filhos. Com banner sao 7; o teste falha antes de
    // um bloco novo virar 400 num canal publico.
    expect(panel().components.length).toBeLessThanOrEqual(10);
  });

  it('continua cabendo com o banner publicado', () => {
    const comBanner = panel({
      ...CONFIG,
      panelBannerUrl: 'https://cdn.discordapp.com/banners/1/a.png',
    } as unknown as GuildConfig);

    expect(comBanner.components.length).toBeLessThanOrEqual(10);
    expect(comBanner.components.some((c) => c.type === ComponentType.MediaGallery)).toBe(true);
  });

  it('respeita o orcamento de texto da mensagem V2', () => {
    expect(textOf(panel()).length).toBeLessThan(DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL);
  });

  /*
   * A tabela e material de consulta, nao um fluxo. A unica porta de venda e o
   * painel de atendimento; um botao aqui criaria uma segunda entrada para manter.
   */
  it('nao tem botao nenhum', () => {
    expect(panel().components.some((c) => c.type === ComponentType.ActionRow)).toBe(false);
  });

  it('assina com o nome da loja vindo da configuracao', () => {
    const outra = panel({ ...CONFIG, storeName: 'Outra Loja' } as unknown as GuildConfig);
    expect(textOf(outra)).toContain('Equipe Outra Loja');
  });
});

describe('emojis personalizados', () => {
  /*
   * Emoji custom so renderiza no formato exato `<:nome:id>`. Um id trocado vira
   * texto cru no meio do titulo, e num canal publico isso passa despercebido
   * por dias.
   */
  it('usa o formato que o Discord renderiza', () => {
    for (const section of PRICE_TABLE) {
      expect(section.emoji).toMatch(/^<a?:[A-Za-z0-9_]+:\d{17,20}>$/);
    }
  });

  it('coloca o emoji no titulo de cada bloco', () => {
    for (const section of PRICE_TABLE) {
      expect(renderSection(section)).toContain(`### ${section.emoji} ${section.title}`);
    }
  });
});

describe('integridade da tabela', () => {
  it('nao tem preco negativo nem quebrado', () => {
    for (const section of PRICE_TABLE) {
      for (const line of section.lines) {
        if (line.cents === null) continue;
        expect(Number.isInteger(line.cents)).toBe(true);
        expect(line.cents).toBeGreaterThan(0);
      }
    }
  });

  /*
   * Linha sem preco PRECISA dizer o que entra no lugar. Sem isso ela cairia no
   * fallback "sob consulta", que e verdadeiro mas apaga a informacao real.
   */
  it('toda linha sem preco explica o porque', () => {
    for (const section of PRICE_TABLE) {
      for (const line of section.lines) {
        if (line.cents !== null) continue;
        expect(line.instead).toBeDefined();
        expect(line.instead?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('todo bloco tem preco ou explicacao — nunca vazio', () => {
    for (const section of PRICE_TABLE) {
      expect(section.lines.length > 0 || section.note !== undefined).toBe(true);
    }
  });
});
