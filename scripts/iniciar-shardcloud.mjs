/**
 * Inicializacao do bot na ShardCloud.
 *
 *   node scripts/iniciar-shardcloud.mjs      (o CUSTOM_COMMAND do .shardcloud)
 *
 * No PC quem prepara o terreno e o `start-bot.bat`. La nao tem .bat nem PM2,
 * entao este arquivo faz o equivalente, em tres passos:
 *
 *  1. `prisma generate` — o Prisma Client gerado no Windows NAO roda no Linux:
 *     o motor de consulta e um binario por sistema. O pacote enviado nao leva
 *     `node_modules`, e a geracao aqui garante o motor certo para a maquina
 *     em que o bot de fato roda, seja qual for a distribuicao dela.
 *  2. `prisma migrate deploy` — aplica as migracoes pendentes. No banco
 *     restaurado de um dump todas ja constam como aplicadas e nada muda; numa
 *     atualizacao com migracao nova, ela entra antes do codigo que depende
 *     dela. Migracao que falha DERRUBA a subida: codigo novo sobre schema
 *     velho quebraria em producao de um jeito muito pior.
 *  3. Carrega `dist/index.js` NESTE MESMO processo, com `require`.
 *
 * POR QUE NAO UM "a && b && node dist/index.js" NO CUSTOM_COMMAND. Uma cadeia
 * com `&&` roda dentro de um shell, e o shell vira o pai do bot: o SIGTERM que
 * a plataforma manda ao parar ou reiniciar chega ao shell, nao ao Node, e o
 * encerramento gracioso (fechar ticket em andamento, desconectar do banco)
 * nunca roda. Carregando o bot aqui, o processo que recebe o sinal e o
 * proprio bot.
 *
 * O `dist/` vai pronto no pacote (`npm run pack:shardcloud`), compilado no PC
 * pelos mesmos tsc e testes de sempre. Compilar la exigiria as
 * devDependencies e esconderia um erro de tipo ate a hora de subir.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'dist', 'index.js');

/** Mesma versao minima do `engines` do package.json. */
const NODE_MINIMO = [20, 18];

function falhar(mensagem) {
  console.error(`[iniciar] ${mensagem}`);
  process.exit(1);
}

/** Roda o CLI do Prisma instalado no projeto, nunca um baixado pelo npx. */
function prisma(...args) {
  const cli = join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(cli)) {
    falhar('Prisma CLI nao instalado. O "prisma" precisa estar em dependencies no package.json.');
  }
  console.log(`[iniciar] prisma ${args.join(' ')}`);
  const resultado = spawnSync(process.execPath, [cli, ...args], { cwd: ROOT, stdio: 'inherit' });
  if (resultado.status !== 0) {
    falhar(`"prisma ${args.join(' ')}" falhou (codigo ${String(resultado.status)}).`);
  }
}

const [maior, menor] = process.versions.node.split('.').map(Number);
if (maior < NODE_MINIMO[0] || (maior === NODE_MINIMO[0] && menor < NODE_MINIMO[1])) {
  falhar(`Node ${process.versions.node} e antigo demais; o bot precisa de ${NODE_MINIMO.join('.')} ou mais novo.`);
}

if (!existsSync(ENTRY)) {
  falhar('dist/index.js nao existe. Gere o pacote com "npm run pack:shardcloud", que compila antes.');
}

// Caminhos relativos do bot (assets/ocr, backups) partem da raiz do projeto.
process.chdir(ROOT);

prisma('generate');
prisma('migrate', 'deploy');

console.log('[iniciar] Subindo o bot...');
createRequire(import.meta.url)(ENTRY);
