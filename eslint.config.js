// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

/**
 * Configuracao do ESLint (flat config).
 *
 * As regras foram escolhidas para reforcar as garantias do projeto:
 *  - proibir `any` e supressoes de tipo (o codigo precisa ser realmente tipado);
 *  - proibir `console` (todo log passa pelo Logger estruturado);
 *  - exigir tratamento de promessas (esquecer um await em fluxo financeiro e grave).
 */
module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'prisma/migrations/**',
      'coverage/**',
      // Configuracao CommonJS: fora do projeto TypeScript tipado.
      'eslint.config.js',
      'ecosystem.config.js',
      /*
       * Scripts de bootstrap em .mjs: rodam ANTES do build (o de Prisma roda
       * antes ate do `tsc`), entao ficam fora do projeto TypeScript tipado de
       * proposito — depender do build para preparar o build seria circular.
       */
      'scripts/**/*.mjs',
      /*
       * O Worker da Cloudflare nao pertence ao projeto TypeScript do bot: ele
       * roda no runtime de Workers, e compila e publica pelo `wrangler`, nao
       * pelo `tsc` daqui. Sem esta linha, `npm run lint` para com
       * "file was not found in any of the provided project(s)".
       */
      'cloudflare/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: __dirname,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
        module: 'writable',
        require: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // Fabrica de mock devolve `any` por natureza; o retorno tipado seria
      // reescrever o modulo inteiro so para satisfazer a regra.
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    /*
     * Scripts de linha de comando FALAM pelo stdout.
     *
     * O `no-console` do resto do projeto existe porque todo log do bot precisa
     * passar pelo Logger estruturado. Aqui e o contrario: quem roda
     * `npm run backup` no terminal espera a resposta no terminal, e o Logger
     * escreve para outro publico.
     */
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
