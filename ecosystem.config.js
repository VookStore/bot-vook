/**
 * Configuracao do PM2 — Vook Store Bot.
 *
 *   npm run build
 *   pm2 start ecosystem.config.js
 *   pm2 logs vook-store-bot
 *   pm2 restart vook-store-bot
 *   pm2 stop vook-store-bot
 *
 * O bot roda 24/7: `autorestart` reergue o processo apos qualquer queda e
 * `max_memory_restart` protege contra vazamento de memoria.
 */
module.exports = {
  apps: [
    {
      name: 'vook-store-bot',
      script: 'dist/index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,

      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      // Espera crescente entre reinicios para nao entrar em loop de crash.
      // `restart_delay` e `exp_backoff_restart_delay` sao mutuamente
      // exclusivos no PM2 (o backoff vence e o fixo e ignorado): fica so o
      // backoff, que e o comportamento desejado aqui.
      exp_backoff_restart_delay: 250,
      max_restarts: 20,
      min_uptime: 20000,

      /*
       * Encerramento gracioso.
       *
       * O deploy e Windows, onde nao existem sinais POSIX: o "SIGTERM" do PM2
       * vira TerminateProcess e os handlers de sinal do Node NAO rodam — o
       * `kill_timeout` abaixo seria irrelevante porque nao haveria janela
       * graciosa nenhuma. Com `shutdown_with_message` o PM2 envia a mensagem
       * IPC 'shutdown', tratada em `registerProcessHandlers` (src/index.ts).
       */
      kill_timeout: 15000,
      listen_timeout: 15000,
      shutdown_with_message: true,

      env: {
        NODE_ENV: 'production',
      },

      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
