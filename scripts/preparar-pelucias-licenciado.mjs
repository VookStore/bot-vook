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
function change(file,from,to){const text=edits.get(file)||readFileSync(join(source,file),'utf8');if(!text.includes(from))throw new Error(`Versão incompatível em ${file}; nada foi copiado.`);edits.set(file,text.replace(from,to));}
change('fxmanifest.lua',"server_scripts { 'server/domain.lua'","server_scripts { 'server/license.lua', 'server/domain.lua'");
change('server/main.lua','local function handle(source, action, data)','local function handle(source, action, data)\n    if not PlushLicense.allowed() then return { ok = false, error = "Aguardando autenticação VOOK." } end');
change('server/main.lua','local function applyAdmin(source, data)','local function applyAdmin(source, data)\n    if not PlushLicense.allowed() then return nil, "Aguardando autenticação VOOK." end');
change('server/store.lua','function S.commit(changes)','function S.commit(changes)\n    if not PlushLicense.allowed() then return false end');
change('server/inventory.lua',"function I.ready() return I.enabled()", "function I.ready() return PlushLicense.allowed() and I.enabled()");
const inventory=edits.get('server/inventory.lua');edits.set('server/inventory.lua',inventory+'\nAddEventHandler("vook_license:ready", register)\n');
mkdirSync(dirname(out),{recursive:true});cpSync(source,out,{recursive:true,errorOnExist:true,force:false});
for(const [file,content] of edits)writeFileSync(join(out,file),content,'utf8');
writeFileSync(join(out,'server/license.lua'),readFileSync(join(root,'integrations/fivem/license.lua'),'utf8').replace('__VOOK_LICENSE_ENDPOINT__',endpoint));
console.log(`Edição licenciada criada em ${out}`);
console.log('Endereço HTTPS aplicado: '+endpoint+'. Configure o código privado no server.cfg.');
