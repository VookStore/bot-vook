import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as customIds from '../src/constants/customIds';
import { Registry } from '../src/core/client/registry';
import { registerAll } from '../src/interactions';

/**
 * Teste de roteamento.
 *
 * O defeito mais silencioso deste tipo de bot e um componente cujo customId
 * nenhum handler escuta: o botao aparece bonito no Discord e simplesmente nao
 * faz nada. Aqui cruzamos, nos dois sentidos, o que os builders emitem com o
 * que o Registry escuta.
 */

const SRC_DIR = resolve(__dirname, '..', 'src');

function listTypeScriptFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      found.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts')) found.push(fullPath);
  }
  return found;
}

/** Resolve `NAMESPACE.TICKET` / `TICKET_ACTION.CLAIM` para o valor real. */
function resolveConstant(objectName: string, key: string): string | null {
  const table = (customIds as unknown as Record<string, Record<string, string> | undefined>)[
    objectName
  ];
  if (table === undefined) return null;
  const value = table[key];
  return typeof value === 'string' ? value : null;
}

/** Chamada direta: buildCustomId(NAMESPACE.X, ACTION.Y, ...). */
const DIRECT_PATTERN =
  /buildCustomId\(\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;

const ACTION_REFERENCE_PATTERN = /\b([A-Z][A-Z0-9_]*_ACTION)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;

interface EmittedId {
  namespace: string;
  action: string;
  file: string;
}

const SOURCE_FILES = listTypeScriptFiles(SRC_DIR).map((file) => ({
  path: file,
  relative: file.slice(SRC_DIR.length + 1),
  source: readFileSync(file, 'utf8'),
}));

/**
 * Emissoes com namespace E acao literais. Preciso o bastante para exigir um
 * handler correspondente.
 */
function collectDirectEmissions(): EmittedId[] {
  const emitted: EmittedId[] = [];
  for (const file of SOURCE_FILES) {
    for (const match of file.source.matchAll(DIRECT_PATTERN)) {
      const namespace = resolveConstant(match[1] ?? '', match[2] ?? '');
      const action = resolveConstant(match[3] ?? '', match[4] ?? '');
      if (namespace === null || action === null) continue;
      emitted.push({ namespace, action, file: file.relative });
    }
  }
  return emitted;
}

/**
 * Cada objeto de acao pertence a um namespace: COUPON_ACTION -> NAMESPACE.COUPON.
 * Isso permite resolver a rota mesmo quando a acao viaja como variavel.
 */
function namespaceOfActionObject(actionObject: string): string | null {
  const suffix = '_ACTION';
  if (!actionObject.endsWith(suffix)) return null;
  return resolveConstant('NAMESPACE', actionObject.slice(0, -suffix.length));
}

/**
 * DECLARACAO de handler: o literal `{ namespace: ..., action: ... }` que define
 * a rota escutada. Um handler sempre cita a propria rota, entao contar essas
 * ocorrencias tornaria todo handler trivialmente "alcancavel" e o teste nao
 * provaria nada.
 *
 * Repare que nao basta ignorar linhas que comecam com `action:` — os builders
 * tambem recebem a acao por objeto de opcoes
 * (`buildCategoryPickerPanel({ action: CATEGORY_ACTION.EDIT_SELECT })`), e essa
 * ocorrencia e justamente a prova de que a rota e alcancavel.
 */
const HANDLER_DECLARATION_PATTERN =
  /namespace\s*:\s*NAMESPACE\.[A-Za-z_][A-Za-z0-9_]*\s*,[\s\S]{0,120}?action\s*:\s*[A-Z][A-Z0-9_]*_ACTION\.[A-Za-z_][A-Za-z0-9_]*/g;

function declarationRanges(source: string): Array<[number, number]> {
  return [...source.matchAll(HANDLER_DECLARATION_PATTERN)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

function collectReachableKeys(): Set<string> {
  const reachable = new Set<string>();

  for (const entry of collectDirectEmissions()) {
    reachable.add(`${entry.namespace}:${entry.action}`);
  }

  for (const file of SOURCE_FILES) {
    const skip = declarationRanges(file.source);

    for (const match of file.source.matchAll(ACTION_REFERENCE_PATTERN)) {
      const position = match.index;
      if (skip.some(([start, end]) => position >= start && position < end)) continue;

      const actionObject = match[1] ?? '';
      const action = resolveConstant(actionObject, match[2] ?? '');
      const namespace = namespaceOfActionObject(actionObject);
      if (action === null || namespace === null) continue;
      reachable.add(`${namespace}:${action}`);
    }
  }

  return reachable;
}

describe('roteamento de componentes', () => {
  const registry = registerAll(new Registry());

  const registeredKeys = new Set<string>([
    ...registry.buttons.keys(),
    ...registry.selects.keys(),
    ...registry.modals.keys(),
  ]);

  it('registra comandos e handlers sem duplicidade', () => {
    // O proprio Registry lanca em caso de chave duplicada; chegar aqui ja prova
    // que nao ha colisao. As contagens evitam um registro vazio silencioso.
    const summary = registry.summary();
    expect(summary.commands).toBeGreaterThan(0);
    expect(summary.buttons).toBeGreaterThan(0);
    expect(summary.selects).toBeGreaterThan(0);
    expect(summary.modals).toBeGreaterThan(0);
  });

  it('todo customId emitido por um builder possui handler registrado', () => {
    const emitted = collectDirectEmissions();
    expect(emitted.length).toBeGreaterThan(0);

    const orphans = emitted
      .filter((entry) => !registeredKeys.has(`${entry.namespace}:${entry.action}`))
      .map((entry) => `${entry.namespace}:${entry.action} (emitido em ${entry.file})`);

    expect([...new Set(orphans)]).toEqual([]);
  });

  it('nenhum handler registrado fica sem componente que o acione', () => {
    const reachable = collectReachableKeys();
    const unreachable = [...registeredKeys].filter((key) => !reachable.has(key));
    expect(unreachable).toEqual([]);
  });

  it('todo comando possui nome unico e builder serializavel', () => {
    const payload = registry.toApplicationCommands();
    const names = payload.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
    for (const command of payload) {
      expect(command.name).toMatch(/^[\w-]{1,32}$/);
      // Todos os comandos do bot sao chat input, logo precisam de descricao.
      // (comandos de menu de contexto nao possuem `description`.)
      expect('description' in command).toBe(true);
      if ('description' in command) {
        expect(typeof command.description).toBe('string');
        expect(command.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('nenhum customId literal ultrapassa o limite do Discord', () => {
    // Prefixo namespace:action ja consome parte do orcamento; sobra pouco para
    // os argumentos (ids de 32 chars). Garante folga real.
    for (const entry of collectDirectEmissions()) {
      const prefix = `${entry.namespace}:${entry.action}`;
      expect(prefix.length).toBeLessThanOrEqual(45);
    }
  });
});
