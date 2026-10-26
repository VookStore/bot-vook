import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';

import { errorContainer, infoContainer, successContainer, warningContainer } from '../src/components/reply';
import { container } from '../src/components/v2';

/**
 * Politica visual da Vook Store.
 *
 * Duas regras valem para TODO painel, embed ou aviso do bot:
 *   1. nenhuma barra de cor (accent color);
 *   2. todo botao e cinza (Secondary) — `Link` fica de fora porque nao e cor,
 *      e o tipo de botao que abre URL e nao aceita outro estilo.
 *
 * A verificacao e ESTATICA de proposito: montar um a um os ~30 paineis do bot
 * exigiria banco e Discord, e ainda assim deixaria de fora o painel novo que
 * alguem adicionar amanha. Varrer o fonte cobre 100% dos pontos de chamada.
 */

const SRC = resolve(__dirname, '..', 'src');

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = listFiles(SRC).map((path) => ({
  relative: path.slice(SRC.length + 1).split(sep).join('/'),
  source: readFileSync(path, 'utf8'),
}));

describe('politica visual: sem barra de cor', () => {
  it('nenhum painel aplica accent color', () => {
    const offenders = FILES.filter((file) => file.source.includes('.setAccentColor(')).map(
      (file) => file.relative,
    );

    expect(offenders).toEqual([]);
  });

  it('o helper container ignora a cor recebida', () => {
    // Os chamadores continuam passando a cor do estado (sucesso, erro, etc.):
    // a semantica fica no codigo, a politica fica num lugar so.
    expect(container(0xff0000).toJSON().accent_color).toBeUndefined();
    expect(container().toJSON().accent_color).toBeUndefined();
  });

  it('os avisos padronizados saem sem cor', () => {
    for (const build of [successContainer, errorContainer, warningContainer, infoContainer]) {
      expect(build('mensagem').toJSON().accent_color).toBeUndefined();
    }
  });
});

describe('politica visual: botoes cinza', () => {
  it('nenhum botao usa estilo colorido', () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      for (const style of ['Success', 'Primary', 'Danger']) {
        if (file.source.includes(`ButtonStyle.${style}`)) {
          offenders.push(`${file.relative} -> ButtonStyle.${style}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('so restam Secondary e Link no codigo', () => {
    const usados = new Set<string>();
    for (const file of FILES) {
      for (const match of file.source.matchAll(/ButtonStyle\.([A-Za-z]+)/g)) {
        const nome = match[1];
        if (nome !== undefined) usados.add(nome);
      }
    }

    expect([...usados].sort()).toEqual(['Link', 'Secondary']);
  });

  it('Secondary e Link sao os valores esperados da API', () => {
    // Guarda contra uma renumeracao do enum em atualizacao do discord.js.
    expect(ButtonStyle.Secondary).toBe(2);
    expect(ButtonStyle.Link).toBe(5);
    expect(ComponentType.Button).toBe(2);
  });
});
