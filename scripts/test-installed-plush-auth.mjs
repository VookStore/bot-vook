// Testa bloqueios com os arquivos reais da instalação, sem FiveM/banco remoto.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const [resourceArg,toolsArg]=process.argv.slice(2);
if(!resourceArg||!toolsArg)throw new Error('Informe o recurso e a pasta de testes original com Fengari.');
const root=resolve(resourceArg),fixtures=resolve(toolsArg);
const require=createRequire(join(fixtures,'package.json'));
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const resource=readFileSync(join(root,'fxmanifest.lua'),'utf8').match(/^name '([^']+)'/m)?.[1];
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(name,code){if(lauxlib.luaL_dostring(L,to_luastring(code))!==lua.LUA_OK)throw new Error(name+': '+to_jsstring(lua.lua_tostring(L,-1)));}
try{
 for(const file of ['config.lua','shared/plushies.lua','shared/boxes.lua','shared/equipment.lua','shared/settings.lua','server/domain.lua'])run(file,readFileSync(join(root,file),'utf8'));
 run('mock',readFileSync(join(fixtures,'fivem-mock.lua'),'utf8').replaceAll('vook_plush',resource));
 run('licença simulada',`Config.Framework='standalone'; AuthAllowed=false; PlushLicense={allowed=function()return AuthAllowed end}`);
 for(const file of ['server/store.lua','server/settings.lua','server/inventory.lua','server/main.lua'])run(file,readFileSync(join(root,file),'utf8'));
 run('gates',`
 local function blocked(result) assert(result.ok==false and result.error=='Aguardando autenticação VOOK.') end
 blocked(Mock.request(1,'sync'))
 assert(not PlushStore.commit({}))
 assert(not PlushSettings.save({}))
 assert(not PlushInventory.ready())
 AuthAllowed=true
 assert(Mock.request(1,'sync',{},'cached-license-check').ok)
 local before=PlushStore.get('license:one')
 AuthAllowed=false
 blocked(Mock.request(1,'sync',{},'cached-license-check'))
 blocked(Mock.request(1,'admin',{operation='kit',target=1}))
 blocked(Mock.request(1,'saveSettings',{}))
 Mock.commands[Config.AdminCommand](1,{'kit','1'})
 Mock.commands[Config.AdminCommand](1,{'painel'})
 local after=PlushStore.get('license:one')
 assert(PlushDomain.total(before.items)==PlushDomain.total(after.items))
 assert(before.version==after.version)
 assert(not PlushStore.commit({['license:one']=after}))
 for _,packet in ipairs(Mock.packets)do assert(packet.name~='${resource}:openAdmin') end
 AuthAllowed=true
 assert(Mock.request(1,'sync').ok)
 print('PASS ${resource}: início bloqueado, cache não contorna licença, ADM/painel/configuração/inventário/gravação bloqueados, liberação após validar')
 `);
}finally{lua.lua_close(L);}
