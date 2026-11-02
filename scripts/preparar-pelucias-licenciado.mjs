// Produz uma cópia. Nunca modifica a instalação de origem ou apaga destinos.
import { readFileSync, writeFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [sourceArg,outArg,endpointArg]=process.argv.slice(2);
if(!sourceArg||!outArg){throw new Error('Uso: node scripts/preparar-pelucias-licenciado.mjs "origem" "destino novo" [https://app.shardweb.app]');}
const source=resolve(sourceArg),out=resolve(outArg);
const rel=relative(source,out);
if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw new Error('O destino precisa estar fora da origem.');
if(existsSync(out))throw new Error('O destino já existe; escolha uma nova pasta para preservar o conteúdo.');
let endpoint='https://vook-auth.shardweb.app/v1/licenses/validate';
if(endpointArg){const url=new URL(endpointArg);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/','/v1/licenses/validate'].includes(url.pathname))throw new Error('Informe a origem HTTPS pública, sem credenciais ou parâmetros.');endpoint=url.origin+'/v1/licenses/validate';}
const edits=new Map();
const manifest=readFileSync(join(source,'fxmanifest.lua'),'utf8');
const resource=manifest.match(/^name\s+'(vook_plush(?:_tb)?)'/m)?.[1];
if(!resource)throw new Error('Recurso não reconhecido.');
if(manifest.includes('server/license.lua'))throw new Error('Esta origem já tem autenticação. Use o atualizador específico para evitar duplicação.');
function change(file,from,to){const text=edits.get(file)||readFileSync(join(source,file),'utf8');if(!text.includes(from))throw new Error(`Versão incompatível em ${file}; nada foi copiado.`);edits.set(file,text.replace(from,to));}
change('fxmanifest.lua',"server_scripts { 'server/domain.lua'","server_scripts { 'server/license.lua', 'server/domain.lua'");
change('server/main.lua','local function handle(source, action, data)','local function handle(source, action, data)\n    if not PlushLicense.allowed() then return { ok = false, error = "Aguardando autenticação VOOK." } end');
change('server/main.lua','local function applyAdmin(source, data)','local function applyAdmin(source, data)\n    if not PlushLicense.allowed() then return nil, "Aguardando autenticação VOOK." end');
change('server/store.lua','function S.commit(changes)','function S.commit(changes)\n    if not PlushLicense.allowed() then return false end');
change('server/settings.lua','function S.save(data)','function S.save(data)\n    if not PlushLicense.allowed() then return nil, "Aguardando autenticação VOOK." end');
change('server/main.lua',"    local now = GetGameTimer()",`    if not PlushLicense.allowed() then\n        TriggerClientEvent('${resource}:response', source, requestId, { ok = false, error = 'Aguardando autenticação VOOK.' })\n        return\n    end\n    local now = GetGameTimer()`);
change('server/main.lua',"            if not S.ready then cancel(t, 'Troca interrompida: armazenamento indisponível.')", "            if not PlushLicense.allowed() then cancel(t, 'Troca interrompida: licença indisponível.')\n            elseif not S.ready then cancel(t, 'Troca interrompida: armazenamento indisponível.')");
change('server/main.lua','RegisterCommand(Config.AdminCommand, function(source, args)','RegisterCommand(Config.AdminCommand, function(source, args)\n    if not PlushLicense.allowed() then notify(source, "Aguardando autenticação VOOK.", "error") return end');
change('server/inventory.lua',"function I.ready() return I.enabled()", "function I.ready() return PlushLicense.allowed() and I.enabled()");
const inventory=edits.get('server/inventory.lua');edits.set('server/inventory.lua',inventory+`\nAddEventHandler('${resource}:licenseReady', register)\n`);
mkdirSync(dirname(out),{recursive:true});cpSync(source,out,{recursive:true,errorOnExist:true,force:false});
for(const [file,content] of edits)writeFileSync(join(out,file),content,'utf8');
writeFileSync(join(out,'server/license.lua'),readFileSync(join(root,'integrations/fivem/license.lua'),'utf8').replace('__VOOK_LICENSE_ENDPOINT__',endpoint));
writeFileSync(join(out,'LICENCA.txt'),`AUTENTICAÇÃO VOOK OBRIGATÓRIA\n\nAntes de iniciar este recurso, configure no server.cfg PRIVADO:\n\nset ${resource}_license "CODIGO_DA_LICENCA"\nensure ${resource}\n\nUse o código emitido pelo bot da VOOK (/licenca criar), consultado pelo cliente em /planos.\nNunca use setr ou sets, nem coloque a chave em config.lua/shared/web.\nCada recurso/instalação possui vínculo próprio: use licenças distintas para VOOK e True Blood.\nA API é ${endpoint}.\nSem licença válida, o sistema não libera operações e encerra este recurso.\nApós corrigir a chave, renovar ou reativar, use restart ${resource}.\nAs coleções e configurações salvas permanecem intactas.\nValidação a cada 2 minutos; falhas transitórias toleradas apenas dentro da autorização\njá recebida, por no máximo 15 minutos e nunca além do vencimento da licença.\nLua aberto pode ser alterado: esta integração não equivale à proteção Asset Escrow.\n`);
console.log(`Edição licenciada criada em ${out}`);
console.log('Endereço HTTPS aplicado: '+endpoint+'. Configure o código privado no server.cfg.');
