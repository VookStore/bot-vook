/**
 * Gera o Prisma Client — mas so quando precisa, e so quando da.
 *
 *   node scripts/prisma-generate.mjs
 *
 * POR QUE ESTE ARQUIVO EXISTE. O `start-bot.bat` rodava `prisma generate` a cada
 * subida. No Windows isso falha com EPERM sempre que o bot esta no ar: o
 * processo mantem o `query_engine-windows.dll.node` carregado como modulo, e o
 * Prisma termina a geracao renomeando um `.tmp` POR CIMA desse arquivo — uma
 * substituicao, que o Windows recusa enquanto o original estiver aberto.
 *
 * O detalhe que confunde: renomear o arquivo travado FUNCIONA (o Windows deixa
 * renomear arquivo aberto). O que falha e sobrescrever. Por isso o teste de
 * trava aqui abre o arquivo para ESCRITA, e nao tenta renomea-lo.
 *
 * DUAS DECISOES:
 *
 *  1. PULA quando o cliente ja esta em dia. Na pratica o schema muda raramente,
 *     e toda subida rotineira deixa de encostar no arquivo travado. Foi assim
 *     que o problema apareceu: a geracao que derrubou a subida era desnecessaria
 *     — o schema nao mudava havia tres dias.
 *  2. Quando PRECISA gerar e o arquivo esta travado, falha ANTES de chamar o
 *     Prisma, com uma mensagem que diz o que fazer. O EPERM cru nao explica que
 *     a causa e o proprio bot em execucao.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, statSync } from 'node:fs';

const SCHEMA = 'prisma/schema.prisma';
const CLIENT = 'node_modules/.prisma/client/index.d.ts';
const ENGINE = 'node_modules/.prisma/client/query_engine-windows.dll.node';

/** mtime do arquivo, ou `null` quando ele nao existe. */
function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * True quando o cliente gerado e mais novo que o schema.
 *
 * Cliente ausente conta como desatualizado — primeira instalacao precisa gerar.
 */
function clientIsCurrent() {
  const schema = mtimeOf(SCHEMA);
  const client = mtimeOf(CLIENT);
  if (schema === null || client === null) return false;
  return client >= schema;
}

/**
 * True quando o engine esta carregado por algum processo.
 *
 * Abrir para ESCRITA e o teste certo: o Windows permite ler e ate renomear um
 * arquivo aberto, mas recusa sobrescreve-lo — que e exatamente o que o Prisma
 * faz no fim da geracao. Medido: com o bot no ar, `r+` devolve EBUSY enquanto
 * um rename simples passa.
 */
function engineIsLocked() {
  if (!existsSync(ENGINE)) return false;
  try {
    const fd = openSync(ENGINE, 'r+');
    closeSync(fd);
    return false;
  } catch {
    return true;
  }
}

if (clientIsCurrent()) {
  console.log('Prisma Client ja esta atualizado (schema inalterado). Geracao dispensada.');
  process.exit(0);
}

if (engineIsLocked()) {
  console.error('');
  console.error('[ERRO] O schema mudou, mas o engine do Prisma esta em uso.');
  console.error('');
  console.error('       Algum processo node ainda tem o arquivo carregado — quase sempre');
  console.error('       o proprio bot. Pare-o antes de gerar:');
  console.error('');
  console.error('           npx pm2 stop vook-store-bot');
  console.error('');
  console.error('       Se ele nao aparecer no pm2, procure o processo solto:');
  console.error('');
  console.error('           tasklist | findstr node.exe');
  console.error('');
  process.exit(1);
}

console.log('Schema alterado: gerando o Prisma Client...');

/*
 * `shell: true` porque no Windows o `npx` e um .cmd, e o spawn direto nao o
 * encontra. `stdio: inherit` para a saida do Prisma aparecer no terminal de
 * quem rodou o script.
 */
const result = spawnSync('npx', ['prisma', 'generate'], { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
