import { REST, Routes } from 'discord.js';

import { getEnv } from '../src/config/env';
import { registry } from '../src/core/client/registry';
import { registerAll } from '../src/interactions';
import { createLogger } from '../src/core/logger/Logger';

/**
 * Registro dos slash commands na API do Discord.
 *
 *   npm run deploy:commands
 *
 * Com DISCORD_GUILD_ID definido, o registro e por guild (efeito imediato).
 * Sem ele, o registro e global (o Discord leva ate ~1 hora para propagar).
 */

const logger = createLogger('deploy-commands');

async function main(): Promise<void> {
  const env = getEnv();

  registerAll(registry);
  const body = registry.toApplicationCommands();

  if (body.length === 0) {
    logger.error('Nenhum comando encontrado para registrar.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  const route =
    env.DISCORD_GUILD_ID !== null
      ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
      : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

  logger.info('Registrando comandos...', {
    escopo: env.DISCORD_GUILD_ID !== null ? `guild ${env.DISCORD_GUILD_ID}` : 'global',
    total: body.length,
    comandos: body.map((command) => `/${command.name}`).join(', '),
  });

  const result = (await rest.put(route, { body })) as unknown[];

  logger.info('Comandos registrados com sucesso.', { total: result.length });
}

main().catch((error: unknown) => {
  logger.error('Falha ao registrar os comandos.', error);
  process.exit(1);
});
