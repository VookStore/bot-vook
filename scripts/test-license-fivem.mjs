// Requer Fengari em um diretório de ferramentas; não é dependência de produção.
// node scripts/test-license-fivem.mjs "PASTA_COM_NODE_MODULES_FENGARI"
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(resolve(process.argv[2]||'.'),'package.json'));
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const source=readFileSync(join(root,'integrations/fivem/license.lua'),'utf8').replace('__VOOK_LICENSE_ENDPOINT__','https://test.example/v1/licenses/validate');
const mock=`
Mock={now=1000000,mode='valid',lease=900,threads={},timers={},kvp={},requests=0,stops=0}
os.time=function() return Mock.now end
function GetCurrentResourceName() return 'vook_plush_tb' end
function GetConvar() return Mock.key or ('VOOK-'..string.rep('A',64)) end
function GetResourceKvpString(k) return Mock.kvp[k] end
function SetResourceKvp(k,v) Mock.kvp[k]=v end
function CreateThread(fn) table.insert(Mock.threads,{co=coroutine.create(fn),wake=Mock.now}) end
function Wait(ms) return coroutine.yield(ms/1000) end
function SetTimeout(ms,fn) table.insert(Mock.timers,{at=Mock.now+ms/1000,fn=fn}) end
function StopResource() Mock.stops=Mock.stops+1 end
function TriggerEvent() Mock.ready=true end
json={encode=function(v)return v end,decode=function(v)return v end}
function PerformHttpRequest(url,cb,method,body,headers,options)
  assert(url=='https://test.example/v1/licenses/validate' and method=='POST')
  assert(headers.Authorization:match('^Bearer VOOK%-') and options.followLocation==false)
  Mock.requests=Mock.requests+1
  Mock.reply=function()
    if Mock.mode=='network' then cb(503,'')
    elseif Mock.mode=='denied' then cb(200,{valid=false,nonce=body.nonce,reason='expired'})
    else cb(200,{valid=true,nonce=Mock.mode=='nonce' and 'wrong' or body.nonce,leaseSeconds=Mock.lease,expiresAt=Mock.expiresAt}) end
  end
  if Mock.mode~='hold' then Mock.reply() end
end
function step(seconds)
  for n=0,seconds do
    for _,t in ipairs(Mock.timers) do if not t.done and t.at<=Mock.now then t.done=true t.fn() end end
    for _,t in ipairs(Mock.threads) do
      if t.wake<=Mock.now and coroutine.status(t.co)~='dead' then
        local ok,delay=coroutine.resume(t.co) assert(ok,delay) t.wake=Mock.now+(delay or 0)
      end
    end
    if n<seconds then Mock.now=Mock.now+1 end
  end
end
`;
const cases=[
  ['bloqueado até validar','',`assert(not PlushLicense.allowed()) step(0) assert(PlushLicense.allowed() and Mock.ready and Mock.requests==1)`],
  ['recusa explícita',`Mock.mode='denied'`,`step(0) assert(not PlushLicense.allowed() and Mock.stops==1)`],
  ['sem rede no início',`Mock.mode='network'`,`step(61) assert(not PlushLicense.allowed() and Mock.stops==1)`],
  ['nonce adulterado',`Mock.mode='nonce'`,`step(0) assert(not PlushLicense.allowed())`],
  ['resposta tardia',`Mock.mode='hold'`,`step(0) local reply=Mock.reply step(11) Mock.mode='valid' reply() assert(not PlushLicense.allowed())`],
  ['vencimento antes do lease',`Mock.expiresAt=Mock.now+10`,`step(0) assert(PlushLicense.allowed()) step(11) assert(not PlushLicense.allowed() and Mock.stops==1)`],
  ['indisponibilidade respeita 15 minutos','',`step(0) Mock.mode='network' step(901) assert(not PlushLicense.allowed() and Mock.stops==1)`],
  ['suspensão na revalidação','',`step(0) Mock.mode='denied' step(121) assert(not PlushLicense.allowed() and Mock.stops==1)`],
  ['lease acima do limite',`Mock.lease=901`,`step(0) assert(not PlushLicense.allowed())`],
  ['revalidação normal','',`step(0) step(1000) assert(PlushLicense.allowed() and Mock.requests>1 and Mock.stops==0)`],
  ['código ausente',`Mock.key=''`,`step(0) assert(Mock.requests==0 and Mock.stops==1)`],
];
for(const [name,setup,assertions] of cases){
  const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
  try{for(const code of [mock,setup,source,assertions])if(lauxlib.luaL_dostring(L,to_luastring(code))!==lua.LUA_OK)throw new Error(name+': '+to_jsstring(lua.lua_tostring(L,-1)));}
  finally{lua.lua_close(L);}
  console.log('PASS '+name);
}
console.log(`${cases.length} cenários Lua passaram (natives FiveM simuladas).`);
