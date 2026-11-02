// Executa as regressões existentes das pelúcias contra a cópia licenciada.
// Argumentos: pasta da instalação de testes; pasta licenciada; ferramentas Fengari.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const [fixtureArg,resourceArg,toolsArg]=process.argv.slice(2);
if(!fixtureArg||!resourceArg||!toolsArg)throw new Error('Informe pasta de fixtures, recurso e ferramentas Lua.');
const fixture=resolve(fixtureArg),resource=resolve(resourceArg);
const require=createRequire(join(resolve(toolsArg),'package.json'));
let code=readFileSync(join(fixture,'validar.cjs'),'utf8');
const substitutions=[
  ["const root=path.join(__dirname,'vook_plush_tb')",`const root=${JSON.stringify(resource)}`],
  ['lualib.luaL_openlibs(L);try{',`lualib.luaL_openlibs(L);lauxlib.luaL_dostring(L,to_luastring('PlushLicense={allowed=function()return true end}'));try{`],
  ['}}finally{lua.lua_close(L);}',`}
    const gates = 'if PlushStore and Mock and Mock.request then PlushLicense.allowed=function()return false end assert(not PlushStore.commit({}),"unauthenticated commit") local id=Mock.players[1] and 1 or 4 local result=Mock.request(id,"sync") assert(result.ok==false and result.error=="Aguardando autenticação VOOK.","unauthenticated sync") end';
    if(lauxlib.luaL_dostring(L,to_luastring(gates))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));
  }finally{lua.lua_close(L);}`],
];
for(const [from,to] of substitutions){if(!code.includes(from))throw new Error('Fixture incompatível.');code=code.replace(from,to);}
runInNewContext(code,{require,__dirname:fixture,console,process,Buffer});
