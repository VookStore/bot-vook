/**
 * Gera o zip que sobe para a ShardCloud.
 *
 *   npm run pack:shardcloud
 *
 * Resultado: `pacotes/vook-store-shardcloud.zip`, pronto para enviar no painel.
 *
 * O QUE VAI NO PACOTE, e so isto:
 *
 *   .shardcloud                   configuracao da plataforma
 *   package.json                  a plataforma instala as dependencias por ele
 *   dist/                         o bot compilado (feito aqui, agora)
 *   prisma/                       schema + migracoes (o generate e o migrate
 *                                 rodam la, ver iniciar-shardcloud.mjs)
 *   assets/                       modelo do OCR, artes do booster, templates do PIX
 *   scripts/iniciar-shardcloud.mjs
 *
 * O QUE FICA DE FORA, de proposito:
 *
 *  - `.env`: tem o token do bot e a senha do banco. Na ShardCloud as variaveis
 *    vao no painel; um zip com segredo dentro e um vazamento esperando um
 *    upload no lugar errado.
 *  - `node_modules`: gerado no Windows, com binarios do Windows. A plataforma
 *    instala o seu.
 *  - `package-lock.json`: a propria documentacao da ShardCloud pede para nao
 *    enviar.
 *  - `backups/`, `logs/`, `tests/`, `src/`: dado de cliente ou peso morto.
 *
 * COMPILA EM PASTA PROPRIA. O `tsc` escreve num diretorio temporario, e nao no
 * `dist/` do projeto: o bot que esta no ar no PC carrega arquivos de `dist/` sob
 * demanda, e trocar esses arquivos por baixo dele quebraria o processo vivo.
 * De quebra o pacote nunca leva um `.js` velho de arquivo que ja foi apagado.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGING = join(ROOT, '.tmp', 'shardcloud');
const OUT_DIR = join(ROOT, 'pacotes');
const OUT_FILE = join(OUT_DIR, 'vook-store-shardcloud.zip');

/** Copiados da raiz do projeto para o pacote, com o mesmo caminho. */
const COPIAR = [
  '.shardcloud',
  'package.json',
  'prisma/schema.prisma',
  'prisma/migrations',
  'assets',
  'scripts/iniciar-shardcloud.mjs',
];

/** Entradas da raiz do zip. */
const RAIZ_DO_ZIP = ['.shardcloud', 'package.json', 'dist', 'prisma', 'assets', 'scripts'];

function falhar(mensagem) {
  console.error(`\n[ERRO] ${mensagem}`);
  process.exit(1);
}

function rodar(rotulo, comando, args, opcoes = {}) {
  console.log(`> ${rotulo}`);
  const resultado = spawnSync(comando, args, { cwd: ROOT, stdio: 'inherit', ...opcoes });
  if (resultado.error) falhar(`${rotulo}: ${resultado.error.message}`);
  if (resultado.status !== 0) falhar(`${rotulo} falhou (codigo ${String(resultado.status)}).`);
}

/*
 * O `tar` certo. No Windows o do sistema (bsdtar) gera zip; o do Git Bash
 * (GNU tar), que pode vir antes no PATH, nao gera. Fora do Windows, o `zip`.
 */
function compactar() {
  if (process.platform === 'win32') {
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (!existsSync(tar)) falhar(`tar.exe nao encontrado em ${tar}.`);
    rodar('Compactando', tar, ['-a', '-c', '-f', OUT_FILE, ...RAIZ_DO_ZIP], { cwd: STAGING });
  } else {
    rodar('Compactando', 'zip', ['-r', '-q', OUT_FILE, ...RAIZ_DO_ZIP], { cwd: STAGING });
  }
}

for (const caminho of COPIAR) {
  if (!existsSync(join(ROOT, caminho))) falhar(`${caminho} nao existe no projeto.`);
}

rmSync(STAGING, { recursive: true, force: true });
mkdirSync(STAGING, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
rmSync(OUT_FILE, { force: true });

rodar('Compilando o TypeScript', process.execPath, [
  join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-p',
  'tsconfig.json',
  '--outDir',
  join(STAGING, 'dist'),
]);

for (const caminho of COPIAR) {
  cpSync(join(ROOT, caminho), join(STAGING, caminho), { recursive: true });
}

compactar();
rmSync(STAGING, { recursive: true, force: true });

const megas = (statSync(OUT_FILE).size / (1024 * 1024)).toFixed(1);
console.log(`\nPacote pronto: ${OUT_FILE} (${megas} MB)`);
console.log('Envie este zip no painel da ShardCloud. As variaveis do .env vao no painel, nao no zip.');
