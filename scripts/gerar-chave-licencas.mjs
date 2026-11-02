import { randomBytes } from 'node:crypto';
console.log('LICENSE_ENCRYPTION_KEY='+randomBytes(32).toString('hex'));
console.log('Guarde esta chave no painel da hospedagem e em um backup privado. Não envie ao GitHub.');
console.log('Ela protege os códigos já emitidos; não troque sem migrar as credenciais existentes.');
