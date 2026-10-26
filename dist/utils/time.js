"use strict";
/** Timestamps dinamicos do Discord e formatacao de datas em pt-BR. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.discordTimestamp = discordTimestamp;
exports.discordFullAndRelative = discordFullAndRelative;
exports.formatDateTimeBR = formatDateTimeBR;
exports.formatDateBR = formatDateBR;
exports.formatUptime = formatUptime;
exports.minutesFromNow = minutesFromNow;
exports.secondsBetween = secondsBetween;
exports.delay = delay;
/** Gera `<t:UNIX:STYLE>` — renderizado no fuso de cada usuario. */
function discordTimestamp(date, style = 'f') {
    const ms = date instanceof Date ? date.getTime() : date;
    const seconds = Math.floor(ms / 1000);
    return `<t:${seconds}:${style}>`;
}
/** Formato absoluto + relativo: "22/08/2026 20:15 (ha 2 horas)". */
function discordFullAndRelative(date) {
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
function formatDateTimeBR(date) {
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
function formatDateBR(date) {
    return DAY_FORMATTER.format(date);
}
/** Uptime do processo em formato curto: "3d 12h 04m". */
function formatUptime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const days = Math.floor(total / 86_400);
    const hours = Math.floor((total % 86_400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (days > 0)
        return `${days}d ${hours}h ${String(minutes).padStart(2, '0')}m`;
    if (hours > 0)
        return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    if (minutes > 0)
        return `${minutes}m ${String(secs).padStart(2, '0')}s`;
    return `${secs}s`;
}
function minutesFromNow(minutes) {
    return new Date(Date.now() + minutes * 60_000);
}
function secondsBetween(from, to) {
    return Math.round((to.getTime() - from.getTime()) / 1000);
}
/** Promessa que resolve apos `ms` (usada em backoff controlado). */
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms).unref?.();
    });
}
//# sourceMappingURL=time.js.map