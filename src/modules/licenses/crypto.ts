import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const newLicenseKey = () => 'VOOK-' + randomBytes(32).toString('hex').toUpperCase();
export function encryptKey(value: string, secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.');
}
export function decryptKey(value: string, secret: string): string {
    const parts = value.split('.').map(s => Buffer.from(s, 'base64url'));
    if (parts.length !== 3)
        throw new Error('Formato da credencial inválido.');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), parts[0]);
    decipher.setAuthTag(parts[1]);
    return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8');
}
export const PLANS = { semanal: 7, mensal: 30, anual: 365, vitalicio: null } as const;
export type LicensePlan = keyof typeof PLANS;
export function isPlan(value: string): value is LicensePlan { return Object.hasOwn(PLANS, value); }
export function expiry(plan: LicensePlan, from: Date): Date | null {
    const days = PLANS[plan];
    return days === null ? null : new Date(from.getTime() + days * 86400000);
}
