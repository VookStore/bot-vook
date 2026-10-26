import { EmbedBuilder, type Client, type Message } from 'discord.js';

import { getEnv } from '../../../config/env';
import { createLogger } from '../../../core/logger/Logger';

const logger = createLogger('influencer:twitch');
const DEFAULT_APPROVAL_CHANNEL_ID = '1564371577686986782';
let accessToken: { value: string; expiresAt: number } | null = null;

interface TwitchStream {
  id: string;
  user_login: string;
  user_name: string;
  game_name: string;
  title: string;
  viewer_count: number;
  thumbnail_url: string;
  started_at: string;
}

function twitchLogin(message: Message): string | null {
  const embed = message.embeds[0];
  if (embed === undefined || !embed.footer?.text.includes('APROVADA')) return null;
  const platforms = embed.fields.find((field) => field.name === 'Plataformas')?.value ?? '';
  if (!platforms.toLowerCase().includes('twitch')) return null;
  const profiles = embed.fields.find((field) => field.name === 'Perfis')?.value ?? '';
  for (const raw of profiles.split(/\s+/)) {
    try {
      const url = new URL(raw);
      if (/(^|\.)twitch\.tv$/i.test(url.hostname)) {
        const login = url.pathname.split('/').filter(Boolean)[0];
        if (login !== undefined && /^[a-z0-9_]{3,25}$/i.test(login)) return login.toLowerCase();
      }
    } catch {
      // Os outros perfis podem nao ser URLs da Twitch.
    }
  }
  return null;
}

async function approvedLogins(client: Client): Promise<string[]> {
  const channelId = getEnv().INFLUENCER_APPROVAL_CHANNEL_ID ?? DEFAULT_APPROVAL_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId);
  if (channel === null || !channel.isTextBased() || !('messages' in channel)) return [];
  const messages = await channel.messages.fetch({ limit: 100 });
  return [...new Set(messages.map(twitchLogin).filter((value): value is string => value !== null))];
}

async function token(): Promise<string> {
  if (accessToken !== null && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const env = getEnv();
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID!,
      client_secret: env.TWITCH_CLIENT_SECRET!,
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) throw new Error(`Twitch OAuth respondeu ${response.status}`);
  const data = (await response.json()) as { access_token: string; expires_in: number };
  accessToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export async function announceTwitchLives(client: Client): Promise<number> {
  const env = getEnv();
  if (env.TWITCH_CLIENT_ID === null || env.TWITCH_CLIENT_SECRET === null || env.TWITCH_ANNOUNCEMENT_CHANNEL_ID === null) return 0;
  const logins = await approvedLogins(client);
  if (logins.length === 0) return 0;

  const query = new URLSearchParams();
  for (const login of logins.slice(0, 100)) query.append('user_login', login);
  const response = await fetch(`https://api.twitch.tv/helix/streams?${query}`, {
    headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${await token()}` },
  });
  if (!response.ok) throw new Error(`Twitch Helix respondeu ${response.status}`);
  const { data } = (await response.json()) as { data: TwitchStream[] };

  const channel = await client.channels.fetch(env.TWITCH_ANNOUNCEMENT_CHANNEL_ID);
  if (channel === null || !channel.isTextBased() || !channel.isSendable() || !('messages' in channel)) return 0;
  const recent = await channel.messages.fetch({ limit: 100 });
  const announced = new Set(
    [...recent.values()].flatMap((message) =>
      message.embeds.map((embed) => embed.footer?.text ?? ''),
    ),
  );
  let count = 0;
  for (const stream of data) {
    const marker = `Twitch stream ${stream.id}`;
    if (announced.has(marker)) continue;
    const url = `https://twitch.tv/${stream.user_login}`;
    const image = `${stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')}?v=${Date.now()}`;
    await channel.send({
      content: `🔴 **${stream.user_name} está ao vivo!**\n${url}`,
      embeds: [new EmbedBuilder().setColor(0x9146ff).setTitle(stream.title || `${stream.user_name} está ao vivo`).setURL(url).setDescription(`**${stream.game_name || 'Ao vivo na Twitch'}** · ${stream.viewer_count} espectadores`).setImage(image).setTimestamp(new Date(stream.started_at)).setFooter({ text: marker })],
      allowedMentions: { parse: [] },
    });
    count += 1;
  }
  if (count > 0) logger.info('Lives da Twitch anunciadas.', { count });
  return count;
}
