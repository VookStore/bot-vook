import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { ScriptLicense } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { newLicenseKey, encryptKey, decryptKey, expiry, digest } from '../src/modules/licenses/crypto';
import { redactString, redactValue } from '../src/core/logger/redact';

const db=vi.hoisted(()=>({scriptLicenseIssuance:{create:vi.fn()},scriptLicense:{create:vi.fn(),findFirst:vi.fn(),findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),findMany:vi.fn(),update:vi.fn()},scriptLicenseEvent:{create:vi.fn(),findMany:vi.fn(),upsert:vi.fn(),updateMany:vi.fn()},$transaction:vi.fn()}));
vi.mock('../src/core/database/prisma',()=>({getPrisma:()=>db}));
import { createLicense, validateLicense, changeLicense, revealKey, serial } from '../src/modules/licenses/service';
import { assertLicenseAdmin, licenseCommand, plansCommand, licenseButtons } from '../src/modules/licenses/commands';
import { createLicenseServer, queueLicenseReminders, deliverLicenseEvents } from '../src/modules/licenses/runtime';
import { Prisma } from '@prisma/client';
import { activationInstructions } from '../src/modules/licenses/products';
import { details } from '../src/modules/licenses/panel';
import type { Client } from 'discord.js';

const guildId='123456789012345678';const ownerId='223456789012345678';const secret='a1'.repeat(32);
const input={product:'pelucias',resource:'vook_plush_tb',installation:'install_12345678901234567890',nonce:'nonce_12345678901234567890'};
function fixture(overrides:Partial<ScriptLicense>={}):ScriptLicense{return {id:'license1',guildId,ownerId,product:'pelucias',plan:'mensal',state:'ACTIVE',keyHash:'hash',keyCipher:'cipher',keySuffix:'123456',startsOnUse:true,activatedAt:null,expiresAt:null,installationHash:null,resource:null,lastSeenAt:null,createdAt:new Date(),updatedAt:new Date(),environment:null,issuanceId:null,...overrides};}
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv('LICENSE_ENABLED','true');vi.stubEnv('LICENSE_GUILD_ID',guildId);vi.stubEnv('LICENSE_ENCRYPTION_KEY',secret);vi.stubEnv('LICENSE_ADMIN_IDS','');vi.stubEnv('LICENSE_ADMIN_ROLE_IDS','');
  db.$transaction.mockImplementation((fn:(value:typeof db)=>unknown)=>fn(db));
  db.scriptLicenseEvent.create.mockResolvedValue({});
  db.scriptLicense.findMany.mockResolvedValue([]);
  db.scriptLicenseIssuance.create.mockResolvedValue({id:'grant1'});
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});

describe('credenciais e prazos',()=>{
  it('gera códigos distintos e cifra autenticada, sem chave em logs',()=>{
    const key=newLicenseKey();expect(key).not.toBe(newLicenseKey());expect(key).toMatch(/^VOOK-[A-F\d]{64}$/);
    const encrypted=encryptKey(key,secret);expect(encrypted).not.toContain(key);expect(decryptKey(encrypted,secret)).toBe(key);
    expect(()=>decryptKey(encrypted,'bb'.repeat(32))).toThrow();
    expect(redactString(`pedido ${key}`)).not.toContain(key);expect(redactValue({keyCipher:encrypted})).toEqual({keyCipher:'[REDACTED]'});
  });
  it.each([['semanal',7],['mensal',30],['anual',365]] as const)('%s usa dias corridos', (plan,days)=>{
    const start=new Date('2026-11-01T00:00:00Z');expect(expiry(plan,start)?.getTime()).toBe(start.getTime()+days*86400000);
  });
  it('vitalícia não expira',()=>expect(expiry('vitalicio',new Date())).toBeNull());
  it('emissão manual grava hash/cifra e aviso na mesma transação',async()=>{
    db.scriptLicense.create.mockImplementation(({data}:{data:Partial<ScriptLicense>})=>Promise.resolve(fixture(data)));
    const {licenses:[l,production],created}=await createLicense(ownerId,'mensal','admin');
    expect(created).toBe(true);expect(l.environment).toBe('TEST');expect(production.environment).toBe('PRODUCTION');
    expect(l.keyHash).not.toBe(production.keyHash);expect(db.scriptLicense.create).toHaveBeenCalledTimes(2);
    expect(l.expiresAt).toBeNull();expect(digest(decryptKey(l.keyCipher,secret))).toBe(l.keyHash);
    expect(db.scriptLicenseEvent.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({licenseId:l.id,kind:'CREATED'})}));
  });
});
describe('validação do servidor',()=>{
  it('Stage Hall é emitido e validado separadamente de Pelúcias, com instruções corretas',async()=>{
    db.scriptLicense.create.mockImplementation(({data}:{data:Partial<ScriptLicense>})=>Promise.resolve(fixture(data)));
    const {licenses:[license]}=await createLicense(ownerId,'mensal','admin',true,'stage_hall');
    expect(license.product).toBe('stage_hall');expect(details(license)).toContain('Stage Hall');
    const instructions=activationInstructions('stage_hall','TEST_ONLY');expect(instructions).toContain('set stage_hall_license');expect(instructions).not.toContain('vook_plush_license');
    expect(activationInstructions('pelucias','TEST_ONLY')).toContain('vook_plush_tb_license');
    db.scriptLicense.findUnique.mockResolvedValue(license);
    db.scriptLicense.update.mockImplementation(({data}:{data:Partial<ScriptLicense>})=>Promise.resolve({...license,...data}));
    const hallInput={...input,product:'stage_hall',resource:'stage_hall'};
    expect(await validateLicense(newLicenseKey(),hallInput)).toMatchObject({valid:true,leaseSeconds:900});
    expect(await validateLicense(newLicenseKey(),input)).toMatchObject({valid:false,reason:'invalid'});
    db.scriptLicense.findUnique.mockResolvedValue(fixture());
    expect(await validateLicense(newLicenseKey(),hallInput)).toMatchObject({valid:false,reason:'invalid'});
    expect(await validateLicense(newLicenseKey(),{...hallInput,resource:'vook_plush'})).toMatchObject({valid:false});
    const command=JSON.stringify(licenseCommand.builder.toJSON());expect(command).toContain('stage_hall');
  });
  it('mesma instalação não troca recurso depois de vinculada',async()=>{
    db.scriptLicense.findUnique.mockResolvedValue(fixture({installationHash:digest(input.installation),resource:'vook_plush'}));
    expect(await validateLicense(newLicenseKey(),input)).toMatchObject({valid:false,reason:'server_mismatch'});
    expect(db.scriptLicense.update).not.toHaveBeenCalled();
  });
  it('aceita Stage Hall VK sem permitir trocar vínculo ou usar licença de Pelúcias',async()=>{
    const vkInput={...input,product:'stage_hall',resource:'stage_hall_vk'};
    const license=fixture({product:'stage_hall'});
    db.scriptLicense.findUnique.mockResolvedValue(license);
    db.scriptLicense.update.mockImplementation(({data}:{data:Partial<ScriptLicense>})=>Promise.resolve({...license,...data}));
    expect(await validateLicense(newLicenseKey(),vkInput)).toMatchObject({valid:true});
    expect(db.scriptLicense.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({resource:'stage_hall_vk',installationHash:digest(input.installation)})}));
    db.scriptLicense.update.mockClear();
    db.scriptLicense.findUnique.mockResolvedValue(fixture({product:'stage_hall',resource:'stage_hall',installationHash:digest(input.installation)}));
    expect(await validateLicense(newLicenseKey(),vkInput)).toMatchObject({valid:false,reason:'server_mismatch'});
    db.scriptLicense.findUnique.mockResolvedValue(fixture());
    expect(await validateLicense(newLicenseKey(),vkInput)).toMatchObject({valid:false,reason:'invalid'});
    expect(db.scriptLicense.update).not.toHaveBeenCalled();
  });
  it('ativa e vincula no primeiro uso, com prazo e nonce',async()=>{
    const l=fixture();db.scriptLicense.findUnique.mockResolvedValue(l);
    db.scriptLicense.update.mockImplementation(({data}:{data:Partial<ScriptLicense>})=>Promise.resolve({...l,...data}));
    const result=await validateLicense(newLicenseKey(),input);
    expect(result).toMatchObject({valid:true,nonce:input.nonce,leaseSeconds:900});
    expect(db.scriptLicense.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({installationHash:digest(input.installation),expiresAt:expect.any(Date)})}));
  });
  it.each([
    [{state:'SUSPENDED'},'suspended'],[{expiresAt:new Date(0)},'expired'],[{installationHash:'other'},'server_mismatch'],[{guildId:'other'},'invalid'],[{product:'other'},'invalid']
  ])('recusa licença inválida %j',async(overrides,reason)=>{
    db.scriptLicense.findUnique.mockResolvedValue(fixture(overrides as Partial<ScriptLicense>));
    expect(await validateLicense(newLicenseKey(),input)).toMatchObject({valid:false,reason});expect(db.scriptLicense.update).not.toHaveBeenCalled();
  });
  it('não estende validade em uma revalidação',async()=>{
    const l=fixture({activatedAt:new Date(),expiresAt:new Date(Date.now()+60000),installationHash:digest(input.installation)});
    db.scriptLicense.findUnique.mockResolvedValue(l);db.scriptLicense.update.mockResolvedValue(l);
    const result=await validateLicense(newLicenseKey(),input);expect(result.valid).toBe(true);
    const data=db.scriptLicense.update.mock.calls[0][0].data;expect(data).not.toHaveProperty('expiresAt');
    expect(result).toMatchObject({expiresAt:Math.floor(l.expiresAt!.getTime()/1000)});
  });
  it('rejeita recurso/nonce adulterado antes de consultar banco',async()=>{
    expect(await validateLicense(newLicenseKey(),{...input,resource:'other'})).toMatchObject({valid:false});
    expect(await validateLicense(newLicenseKey(),{...input,nonce:''})).toMatchObject({valid:false});expect(db.scriptLicense.findUnique).not.toHaveBeenCalled();
  });
  it('repete conflito serializável de vínculo concorrente',async()=>{
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('conflict',{code:'P2034',clientVersion:'6'})).mockResolvedValueOnce('ok');
    expect(await serial(()=>Promise.resolve('ok'))).toBe('ok');expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.$transaction.mock.calls[0][1]).toEqual({isolationLevel:'Serializable'});
  });
});
describe('administração e isolamento',()=>{
  it.each([false,true])('preserva integralmente licença antiga, ativada=%s, mesmo ao repetir criar',async activated=>{
    const old=fixture({activatedAt:activated?new Date('2026-11-01'):null,installationHash:activated?'true-blood-server':null,resource:activated?'vook_plush_tb':null});
    const before=structuredClone(old);db.scriptLicense.findMany.mockResolvedValue([old]);
    const result=await createLicense(ownerId,'vitalicio','admin',false);
    expect(result).toEqual({licenses:[before],created:false});expect(old).toEqual(before);
    expect(db.scriptLicense.create).not.toHaveBeenCalled();expect(db.scriptLicense.update).not.toHaveBeenCalled();
    expect(db.scriptLicenseIssuance.create).not.toHaveBeenCalled();expect(db.scriptLicenseEvent.create).not.toHaveBeenCalled();
  });
  it('repetir emissão devolve o par existente mesmo suspenso, sem renovar ou gerar avisos',async()=>{
    const pair=[fixture({environment:'TEST',issuanceId:'pair',state:'SUSPENDED'}),fixture({id:'prod',environment:'PRODUCTION',issuanceId:'pair'})];
    db.scriptLicense.findMany.mockResolvedValue(pair);
    expect(await createLicense(ownerId,'anual','admin')).toEqual({licenses:pair,created:false});
    expect(db.scriptLicense.create).not.toHaveBeenCalled();expect(db.scriptLicense.update).not.toHaveBeenCalled();
  });
  it('ativa os dois ambientes em servidores independentes e recusa troca posterior',async()=>{
    const rows=new Map<string,ScriptLicense>();
    db.scriptLicense.create.mockImplementation(({data}:{data:Partial<ScriptLicense>})=>{
      const l=fixture({...data,id:data.environment!});rows.set(l.keyHash,l);return Promise.resolve(l);
    });
    db.scriptLicense.findUnique.mockImplementation(({where}:{where:{keyHash:string}})=>Promise.resolve(rows.get(where.keyHash)));
    db.scriptLicense.update.mockImplementation(({where,data}:{where:{id:string};data:Partial<ScriptLicense>})=>{
      const l=[...rows.values()].find(l=>l.id===where.id)!;Object.assign(l,data);return Promise.resolve(l);
    });
    const {licenses}=await createLicense(ownerId,'mensal','admin');
    const testKey=decryptKey(licenses[0].keyCipher,secret),prodKey=decryptKey(licenses[1].keyCipher,secret);
    expect(await validateLicense(testKey,input)).toMatchObject({valid:true});
    expect(licenses[1].installationHash).toBeNull();expect(licenses[1].expiresAt).toBeNull();
    const prodInput={...input,installation:'production_12345678901234567890'};
    expect(await validateLicense(prodKey,prodInput)).toMatchObject({valid:true});
    expect(licenses[0].installationHash).not.toBe(licenses[1].installationHash);
    expect(await validateLicense(testKey,prodInput)).toMatchObject({valid:false,reason:'server_mismatch'});
    expect(await validateLicense(prodKey,input)).toMatchObject({valid:false,reason:'server_mismatch'});
  });
  it.each(['semanal','mensal','anual','vitalicio'] as const)('aplica plano %s em ambos os ambientes quando inicia agora',async plan=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-07T10:00:00Z'));
    db.scriptLicense.create.mockImplementation(({data}:{data:Partial<ScriptLicense>})=>Promise.resolve(fixture(data)));
    const {licenses}=await createLicense(ownerId,plan,'admin',false);
    expect(licenses).toHaveLength(2);for(const l of licenses){expect(l.expiresAt).toEqual(expiry(plan,new Date()));expect(l.startsOnUse).toBe(false);}
  });
  it('recupera corrida de emissão sem completar ou duplicar par já confirmado',async()=>{
    db.scriptLicenseIssuance.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique',{code:'P2002',clientVersion:'6'}));
    const pair=[fixture({environment:'TEST'}),fixture({environment:'PRODUCTION'})];
    db.scriptLicense.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(pair);
    expect(await createLicense(ownerId,'mensal','admin')).toEqual({licenses:pair,created:false});expect(db.scriptLicense.create).not.toHaveBeenCalled();
  });
  it('renova sem trocar código nem retirar suspensão',async()=>{
    const end=new Date(Date.now()+86400000);const l=fixture({expiresAt:end,activatedAt:new Date(),state:'SUSPENDED'});
    db.scriptLicense.findFirst.mockResolvedValue(l);db.scriptLicense.update.mockResolvedValue(l);
    await changeLicense(l.id,'admin','renovar','semanal');
    expect(db.scriptLicense.update).toHaveBeenCalledWith({where:{id:l.id},data:{plan:'semanal',expiresAt:new Date(end.getTime()+7*86400000)}});
  });
  it('impede consultar chave de outra pessoa',async()=>{
    db.scriptLicense.findFirst.mockResolvedValue(null);await expect(revealKey('license1','attacker')).rejects.toThrow();
    expect(db.scriptLicense.findFirst).toHaveBeenCalledWith({where:{id:'license1',guildId,ownerId:'attacker'}});
  });
  it('dono de outro servidor não pode emitir',async()=>{
    await expect(assertLicenseAdmin({guildId:'other',user:{id:ownerId}} as ChatInputCommandInteraction)).rejects.toThrow();
  });
  it('administrador Discord sem permissão explícita não pode emitir',async()=>{
    const guild={ownerId:'different',fetch:vi.fn(),members:{fetch:vi.fn().mockResolvedValue({roles:{cache:new Map()}})}};guild.fetch.mockResolvedValue(guild);
    await expect(assertLicenseAdmin({guildId,guild,user:{id:ownerId}} as unknown as ChatInputCommandInteraction)).rejects.toThrow();
    vi.stubEnv('LICENSE_ADMIN_IDS',ownerId);await expect(assertLicenseAdmin({guildId,guild,user:{id:ownerId}} as unknown as ChatInputCommandInteraction)).resolves.toBeUndefined();
  });
  it('comandos serializam, planos permite DM e botões exigem proprietário',()=>{
    expect(licenseCommand.builder.toJSON().options).toHaveLength(11);expect(plansCommand.builder.toJSON().contexts).toContain(1);
    expect(licenseButtons.every(b=>b.guildOnly===false)).toBe(true);
  });
});
describe('API HTTP',()=>{
  it('valida autenticação, corpo, throttling e não vaza erro do banco',async()=>{
    const validator=vi.fn().mockResolvedValue({valid:true,nonce:input.nonce,leaseSeconds:900});
    const api=createLicenseServer(validator);await new Promise<void>(resolve=>api.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${(api.address() as AddressInfo).port}/v1/licenses/validate`;
    const headers={authorization:`Bearer ${newLicenseKey()}`,'content-type':'application/json'};
    try{
      expect((await fetch(url,{method:'POST'})).status).toBe(401);
      expect((await fetch(url,{method:'POST',headers,body:'{'})).status).toBe(400);
      expect((await fetch(url,{method:'POST',headers,body:JSON.stringify({...input,nonce:5})})).status).toBe(400);
      const valid=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});expect(await valid.json()).toMatchObject({valid:true});expect(valid.headers.get('cache-control')).toBe('no-store');
      validator.mockRejectedValueOnce(new Error('secret-database-password'));
      const fail=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});expect(fail.status).toBe(503);expect(await fail.text()).not.toContain('secret');
      let status=0;for(let n=0;n<21;n++) status=(await fetch(url,{method:'POST',headers,body:JSON.stringify(input)})).status;
      expect(status).toBe(429);
    }finally{await new Promise<void>(resolve=>{api.close(()=>resolve());api.closeAllConnections();});}
  });
});
describe('avisos persistentes',()=>{
  it('deduplica lembrete por vencimento e registra expiração',async()=>{
    const now=new Date();const l=fixture({expiresAt:new Date(now.getTime()+4000)});
    db.scriptLicense.findMany.mockResolvedValue([l]);await queueLicenseReminders(now);await queueLicenseReminders(now);
    expect(db.scriptLicenseEvent.upsert.mock.calls[0][0].where).toEqual(db.scriptLicenseEvent.upsert.mock.calls[1][0].where);
    await queueLicenseReminders(new Date(now.getTime()+5000));expect(db.scriptLicenseEvent.upsert.mock.calls[2][0].create.kind).toBe('EXPIRED');
  });
  it('privado bloqueado não invalida licença e registra falha de entrega',async()=>{
    const l=fixture();db.scriptLicenseEvent.findMany.mockResolvedValue([{id:'e1',licenseId:l.id,license:l,attempts:0,kind:'CREATED',message:'Criada'}]);
    db.scriptLicenseEvent.updateMany.mockResolvedValue({count:1});db.scriptLicense.findUniqueOrThrow.mockResolvedValue(l);
    const client={users:{fetch:vi.fn().mockRejectedValue({code:50007})}} as unknown as Client<true>;
    await deliverLicenseEvents(client);
    expect(db.scriptLicenseEvent.updateMany.mock.calls[1][0].data.failedAt).toBeInstanceOf(Date);expect(db.scriptLicense.update).not.toHaveBeenCalled();
  });
  it('não envia lembrete antigo após renovação',async()=>{
    const old=fixture({expiresAt:new Date(0)});const current=fixture({expiresAt:new Date(Date.now()+86400000)});
    db.scriptLicenseEvent.findMany.mockResolvedValue([{id:'e1',licenseId:old.id,license:old,attempts:0,kind:'EXPIRED',dedupe:'old'}]);
    db.scriptLicenseEvent.updateMany.mockResolvedValue({count:1});db.scriptLicense.findUniqueOrThrow.mockResolvedValue(current);
    const fetchUser=vi.fn();await deliverLicenseEvents({users:{fetch:fetchUser}} as unknown as Client<true>);expect(fetchUser).not.toHaveBeenCalled();
  });
});
