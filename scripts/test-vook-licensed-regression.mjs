import * as fs from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const [resourceArg,toolsArg]=process.argv.slice(2);
if(!resourceArg||!toolsArg)throw new Error('Informe recurso e testes de origem.');
const root=resolve(resourceArg),fixtures=resolve(toolsArg);
const realRequire=createRequire(join(fixtures,'package.json'));
const mappedFs={...fs,readFileSync(file,...args){const rel=relative(join(root,'tests'),String(file));return fs.readFileSync(!rel.startsWith('..')&&!isAbsolute(rel)?join(fixtures,rel):file,...args);}};
let code=fs.readFileSync(join(fixtures,'run-lua.cjs'),'utf8')
 .replace("const root = path.resolve(__dirname, '..');",`const root = ${JSON.stringify(root)};`)
 .replace('lualib.luaL_openlibs(L);','lualib.luaL_openlibs(L); lauxlib.luaL_dostring(L,to_luastring("PlushLicense={allowed=function()return true end}"));');
runInNewContext(code,{require:name=>name==='node:fs'?mappedFs:realRequire(name),__dirname:fixtures,console,process,Buffer});
