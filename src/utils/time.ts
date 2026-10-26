/** Timestamps dinamicos do Discord e formatacao de datas em pt-BR. */

export type DiscordTimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

/** Gera `<t:UNIX:STYLE>` — renderizado no fuso de cada usuario. */
export function discordTimestamp(date: Date | number, style: DiscordTimestampStyle = 'f'): string {
  const ms = date instanceof Date ? date.getTime() : date;
  const seconds = Math.floor(ms / 1000);
  return `<t:${seconds}:${style}>`;
}

/** Formato absoluto + relativo: "22/08/2026 20:15 (ha 2 horas)". */
export function discordFullAndRelative(date: Date): string {
  return `${discordTimestamp(date, 'F')} (${discordTimestamp(date, 'R')})`;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** Data legivel fixa (usada em transcript HTML, onde nao ha render dinamico). */
export function formatDateTimeBR(date: Date): string {
  return DATE_FORMATTER.format(date);
}

const DAY_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/**
 * So o dia: "31/08/2026".
 *
 * Para linhas onde a hora nao acrescenta nada — "ultima compra em 12/07/2026"
 * responde a pergunta, e o horario exato so gastaria espaco no painel.
 */
export function formatDateBR(date: Date): string {
  return DAY_FORMATTER.format(date);
}

/** Uptime do processo em formato curto: "3d 12h 04m". */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function secondsBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 1000);
}

/** Promessa que resolve apos `ms` (usada em backoff controlado). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}
