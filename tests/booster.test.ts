import { ComponentType } from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { DISCORD_LIMITS } from '../src/constants/limits';
import {
  buildBoosterPanel,
  renderRules,
  renderTier,
} from '../src/modules/booster/builders/BoosterBuilder';
import {
  BOOSTER_RULES,
  BOOSTER_RULES_TITLE,
  BOOSTER_TIERS,
} from '../src/modules/booster/data/boosterTiers';

/*
 * Anuncio de beneficios de booster.
 *
 * Depois da tabela de precos, e a segunda mensagem do bot que declara um
 * compromisso comercial: um percentual errado aqui e um desconto que a loja vai
 * ter de honrar ou desdizer na frente de quem impulsionou o servidor. Os testes
 * conferem os numeros contra a fonte, e nao apenas se a mensagem monta.
 */

const CONFIG = { storeName: 'Vook Store' } as unknown as GuildConfig;

function panel(art: string | null = null, config: GuildConfig = CONFIG) {
  return buildBoosterPanel(config, art).toJSON();
}

function textOf(json: ReturnType<typeof panel>): string {
  return json.components
    .flatMap((component) => {
      if (component.type === ComponentType.TextDisplay) return [component.content];
      if (component.type === ComponentType.Section) {
        return component.components.map((child) => child.content);
      }
      return [];
    })
    .join('\n');
}

describe('beneficios anunciados', () => {
  it('mostra os dois niveis com os respectivos descontos', () => {
    const texto = textOf(panel());

    expect(texto).toContain('1 Boost');
    expect(texto).toContain('5% de desconto em suas compras');
    expect(texto).toContain('2 Boosts');
    expect(texto).toContain('10% de desconto em suas compras');
  });

  it('mostra os beneficios que nao sao desconto', () => {
    const texto = textOf(panel());

    expect(texto).toContain('Cargo exclusivo de Booster');
    expect(texto).toContain('Prioridade no suporte');
  });

  /*
   * O BLOCO MAIS IMPORTANTE DEPOIS DOS PERCENTUAIS. E o unico que RETIRA algo e
   * o unico que diz como resgatar; em letra miuda vira discussao no atendimento
   * com quem leu so os numeros. Vai como citacao destacada, nunca como rodape.
   */
  it('destaca as regras em vez de escondê-las no rodape', () => {
    const texto = textOf(panel());

    expect(texto).toContain(`> ### ⚠️ ${BOOSTER_RULES_TITLE}`);
    for (const regra of BOOSTER_RULES) {
      expect(texto).toContain(`> ・${regra}`);
      expect(texto).not.toContain(`-# ${regra}`);
    }
  });

  /*
   * As tres perguntas que sobram de quem leu "10% de desconto": onde vale, onde
   * nao vale e como resgatar. Faltando qualquer uma, o cliente descobre no
   * atendimento — que e o lugar caro de descobrir.
   */
  it('responde onde vale, onde nao vale e como resgatar', () => {
    const texto = textOf(panel());

    expect(texto).toContain('cabelos');
    for (const excluido of ['PEDs', 'roupas', 'props']) {
      expect(texto).toContain(excluido);
    }
    expect(texto).toContain('Abra um ticket');
  });

  /*
   * O bot NAO aplica desconto sozinho: o abatimento e lancado pela equipe pelo
   * sistema de cupons. Sem esta linha o cliente esperaria um preco ja abatido
   * no cartao de cobranca.
   */
  it('deixa claro que quem aplica o desconto e a equipe', () => {
    expect(textOf(panel())).toContain('a equipe aplica o desconto na cobrança');
  });

  it('assina com o nome da loja vindo da configuracao', () => {
    const outra = panel(null, { storeName: 'Outra Loja' } as unknown as GuildConfig);
    expect(textOf(outra)).toContain('Equipe Outra Loja');
  });
});

describe('arte do anuncio', () => {
  /*
   * A miniatura aponta para o ANEXO da propria mensagem, nunca para uma URL do
   * CDN: link de anexo do Discord expira, e num anuncio fixo a imagem sumiria
   * meses depois sem ninguem ver.
   */
  it('referencia o anexo da mensagem, nao uma URL externa', () => {
    const json = panel('booster.png');
    const section = json.components.find((c) => c.type === ComponentType.Section);
    const accessory = section?.accessory;

    expect(accessory?.type).toBe(ComponentType.Thumbnail);
    expect(accessory?.type === ComponentType.Thumbnail ? accessory.media.url : null).toBe(
      'attachment://booster.png',
    );
  });

  /*
   * Sem arquivo no disco NAO pode haver miniatura: um `attachment://` sem anexo
   * correspondente deixa um quadrado quebrado no anuncio publicado.
   */
  it('sai sem miniatura quando nao ha arte', () => {
    const json = panel(null);

    expect(json.components.some((c) => c.type === ComponentType.Section)).toBe(false);
    expect(JSON.stringify(json)).not.toContain('attachment://');
  });

  it('anuncia o mesmo conteudo com ou sem arte', () => {
    // A arte e decoracao: nenhum beneficio pode depender de o arquivo existir.
    for (const trecho of ['5% de desconto', '10% de desconto', ...BOOSTER_RULES]) {
      expect(textOf(panel(null))).toContain(trecho);
      expect(textOf(panel('booster.png'))).toContain(trecho);
    }
  });
});

describe('estrutura da mensagem', () => {
  it('cabe no limite de filhos do container, com e sem arte', () => {
    expect(panel(null).components.length).toBeLessThanOrEqual(10);
    expect(panel('booster.png').components.length).toBeLessThanOrEqual(10);
  });

  it('respeita o orcamento de texto da mensagem V2', () => {
    expect(textOf(panel('booster.png')).length).toBeLessThan(
      DISCORD_LIMITS.COMPONENTS_V2_TEXT_TOTAL,
    );
  });

  /*
   * O anuncio e informativo. Impulsionar acontece na interface do Discord, nao
   * numa acao do bot — um botao aqui prometeria algo que ele nao faz.
   */
  it('nao tem botao nenhum', () => {
    expect(panel().components.some((c) => c.type === ComponentType.ActionRow)).toBe(false);
  });
});

describe('emoji personalizado', () => {
  /*
   * Emoji custom so renderiza no formato exato `<:nome:id>`. Um id trocado vira
   * texto cru no titulo, e num canal publico isso passa dias despercebido.
   */
  it('usa o formato que o Discord renderiza', () => {
    expect(textOf(panel())).toMatch(/<a?:[A-Za-z0-9_]+:\d{17,20}>/);
  });
});

describe('regras do desconto', () => {
  it('toda regra entra no bloco, dentro da citacao', () => {
    const bloco = renderRules();
    for (const regra of BOOSTER_RULES) expect(bloco).toContain(`> ・${regra}`);
  });

  /*
   * Toda linha do bloco precisa comecar com `>`. Uma linha sem o prefixo quebra
   * a barra lateral em dois blocos e a regra orfa passa a parecer texto solto.
   */
  it('nao quebra a citacao no meio', () => {
    for (const linha of renderRules().split('\n')) {
      expect(linha.startsWith('>')).toBe(true);
    }
  });
});

describe('integridade dos niveis', () => {
  it('todo nivel tem titulo, emoji e ao menos um beneficio', () => {
    for (const tier of BOOSTER_TIERS) {
      expect(tier.title.length).toBeGreaterThan(0);
      expect(tier.emoji.length).toBeGreaterThan(0);
      expect(tier.perks.length).toBeGreaterThan(0);
    }
  });

  /*
   * Os niveis acumulam: quem tem 2 boosts nao pode perder nada que 1 boost da.
   * Este teste falha se alguem editar `boosterTiers.ts` e esquecer de repetir um
   * beneficio no nivel de cima — o anuncio passaria a prometer um downgrade.
   */
  it('o nivel maior mantem todos os beneficios do menor', () => {
    const [menor, maior] = BOOSTER_TIERS;
    if (menor === undefined || maior === undefined) return;

    const naoDesconto = menor.perks.filter((perk) => !perk.includes('%'));
    for (const perk of naoDesconto) {
      expect(maior.perks).toContain(perk);
    }
    expect(maior.perks.length).toBeGreaterThanOrEqual(menor.perks.length);
  });

  it('cada nivel entra no anuncio com titulo e marcadores', () => {
    for (const tier of BOOSTER_TIERS) {
      const bloco = renderTier(tier);
      expect(bloco).toContain(`### ${tier.emoji} ${tier.title}`);
      for (const perk of tier.perks) expect(bloco).toContain(`・${perk}`);
    }
  });
});
