# Licenças por ambiente e distribuição de scripts

Implementação de 07/11/2026. Repositório confirmado: `VookStore/bot-vook`, branch `main`.
Esta alteração não executa push, deploy, emissão real nem mensagens para clientes.

## O que muda

- `/licenca criar` concede **exatamente duas licenças** a um cliente que ainda não tem licença daquele produto: **Testes/Desenvolvimento** e **Produção (servidor público)**. Cada chave tem seu próprio vínculo, ativação e prazo.
- Se já existir qualquer licença do cliente/produto, o comando preserva todas e informa que já existem. Não completa pares, não troca plano, não renova e não duplica avisos. Isso inclui licenças antigas não ativadas, suspensas, vencidas e a True Blood.
- A migração só acrescenta tabelas e colunas opcionais, sem `UPDATE`, `DELETE` ou emissão de chaves. Licenças anteriores continuam com `environment`/`issuanceId` nulos e aparecem como **Anterior · vínculo preservado**.
- A primeira autenticação continua vinculando a chave a uma instalação e edição. Baixar um ZIP não ativa, não desvincula e não inicia a validade. A chave de Testes não libera a instalação de Produção; é preciso instalar o ZIP de Produção nesse servidor.
- Planos semanal, mensal, anual e vitalício mantêm as regras existentes. Com `iniciar_agora`, ambos começam na emissão; por padrão, cada ambiente começa no próprio primeiro uso. Renovar, suspender, reativar e desvincular continuam operações explícitas **por ID de licença**. Uma operação em uma chave não modifica a outra.
- `pelucias` inclui as edições `vook_plush`/`vook_plush_tb`; `stage_hall` inclui `stage_hall`/`stage_hall_vk`. Edições não são ambientes. Uma chave vinculada a uma edição não muda para outra em um download.

## Fluxo da equipe e do comprador

1. A equipe continua conferindo o direito do comprador e concedendo acesso com `/licenca criar usuario:CLIENTE plano:mensal produto:pelucias`. A autorização não foi ligada automaticamente a qualquer pack genérico do catálogo de pagamentos: não havia um mapeamento confiável de packs para estes scripts. Não há concessão baseada apenas em ter clicado em um botão.
2. O cliente recebe o aviso normal da licença e também pode usar `/planos` no privado do bot ou no servidor oficial. Os avisos usam a fila persistente existente; privado bloqueado não remove o acesso.
3. Em `/planos`, escolhe o produto e o ambiente, clica **Baixar script com licença configurada**, seleciona a edição/versão publicada e recebe um ZIP privado.
4. A chave é inserida **somente** no arquivo privado que já faz a autenticação: `server/license.lua` em Pelúcias; `server/main.js` no Stage Hall. O protocolo de autenticação não é substituído. Não precisa copiar código nem adicionar `set ..._license` ao `server.cfg`.
5. O cliente extrai o recurso e usa `ensure NOME_DO_RECURSO`. O ZIP inclui `INSTALACAO-VOOK.txt`. Configuração de gameplay, dependências e permissões ACE continuam conforme a documentação de cada produto.
6. Repetir o download usa a mesma licença e verifica novamente proprietário, produto, estado, validade, edição vinculada e publicação. Suspensão/vencimento bloqueiam novos downloads. Licenças anteriores também podem baixar uma edição compatível sem receber outra chave.

Arquivos personalizados nunca são enviados ao canal público ou a um ticket compartilhado. A resposta em servidor é efêmera. Não há URL pública permanente. O bot não mantém ZIP personalizado em disco/cache. Os downloads ficam no CDN do Discord enquanto a mensagem/anexo existir; o comprador pode baixar novamente pelo bot, que revalida o acesso. Retirar uma versão não apaga cópias já baixadas.

## Preparação de uma versão limpa

**Nenhum pacote existente foi declarado final ou publicado nesta execução.** As instalações de desenvolvimento e os ZIPs antigos de `pacotes/` permanecem intactos. Eles não entram automaticamente no catálogo.

A inspeção local dos ZIPs existentes `vook_plush-autenticado.zip` e `vook_plush_tb-autenticado.zip` os **bloqueou** por conterem caminhos/artefatos não permitidos na distribuição. É necessário preparar candidatos novos a partir de uma lista revisada de arquivos; não basta renomear ou aprovar esses ZIPs.

Prepare uma pasta de distribuição separada da instalação em uso. Escolha somente os arquivos necessários à versão final, mantenha as configurações padrão funcionais e retire dados persistidos. Não copie a pasta inteira do servidor. A revisão do conteúdo e o teste funcional da versão continuam obrigatórios.

Crie uma receita JSON com uma **lista explícita de arquivos** relativos à pasta do recurso. Exemplo de estrutura (a lista precisa ser completada com os arquivos reais dessa versão):

```json
{
  "product": "pelucias",
  "resource": "vook_plush",
  "version": "1.6.1",
  "files": [
    "fxmanifest.lua",
    "config.lua",
    "server/license.lua",
    "server/main.lua",
    "client/main.lua"
  ]
}
```

Execute na raiz do bot, com as dependências de desenvolvimento instaladas:

```powershell
npm run package:prepare -- "C:\distribuicao\vook_plush" "C:\distribuicao\receita.json" "C:\distribuicao\vook_plush-1.6.1-candidato.zip"
```

O comando não conecta ao banco/Discord, não modifica a origem e não sobrescreve o destino. Recusa links simbólicos, paths fora da origem e listas duplicadas. Substitui a leitura da convar pelo marcador de personalização **na cópia em memória**. Exibe contagem de arquivos, tamanho e SHA-256. O ZIP de catálogo não tem chave real.

Para Stage Hall use `product: "stage_hall"`, o nome correto do recurso e inclua os módulos `.cjs` usados pelo servidor. O `config.json` de distribuição deve ter **`"venues": []`**, mantendo os outros defaults necessários. O ZIP final cria `data/` vazio; nunca copia `installation.json`, layouts, playlists ou outros dados de uma instalação. A versão inspecionada em `Downloads/.../stage-hall/resource/stage_hall/config.json` contém uma sala de teste Unicorn e **não pode ser publicada como está**. A aplicação permite iniciar com `venues` vazio.

Nas Pelúcias, o modo de inventário `provider = 'internal'` é de testes e é recusado. Preserve o padrão funcional de produção e documente a dependência de inventário. Arquivos `shared/` com definições padrão de pelúcias/equipamentos são conteúdo do produto, não devem ser apagados junto com dados salvos.

## Verificações que bloqueiam cadastro, publicação e entrega

O bot abre e verifica os **bytes de cada ZIP**, não apenas a extensão ou a marcação de revisado:

- Até 25 MiB compactados, 120 MiB expandidos, 30 MiB por arquivo e 5.000 entradas; recusa caminhos duplicados, travessia de diretórios, nomes especiais de Windows e formatos inesperados.
- Estrutura limitada ao recurso e aos arquivos/diretórios de distribuição suportados. Bloqueia testes, ferramentas, logs, backups, `node_modules`, `.env`, `server.cfg`, bancos, outros ZIPs e dados persistidos, inclusive nomes conhecidos de estado em outros diretórios.
- Procura chaves VOOK reais, strings de conexão, tokens, webhooks privados, chaves privadas e atribuições literais de possíveis segredos; bloqueia modos de debug/teste ligados, endereços locais e caminhos de desenvolvimento conhecidos.
- Recusa Stage Hall com salas previamente configuradas e Pelúcias em modo de inventário interno de testes. Exige o arquivo padrão de configuração, sem removê-lo para contornar a conferência.
- Confere produto, recurso, versão final `X.Y.Z`, versão do `fxmanifest.lua`, arquivos referenciados, integração esperada e endpoint HTTPS oficial. O padrão é `https://vook-auth.shardweb.app/v1/licenses/validate`; ajuste `LICENSE_PUBLIC_ENDPOINT` somente se o endereço oficial realmente mudar.
- Aceita somente um `fxmanifest` declarativo suportado. Rejeita execução dinâmica e referências/globs que exponham código privado do servidor via `files`, `shared_scripts`, `client_scripts` ou `data_file`.
- Exige exatamente um marcador de chave, no arquivo privado correto. Depois de personalizar, abre novamente o **ZIP final**, compara todas as entradas com o conteúdo esperado e confirma que a chave aparece uma única vez e somente nesse arquivo. Qualquer divergência bloqueia a entrega.
- Confere SHA-256 do arquivo cadastrado ao publicar e a cada download. Conteúdo/versão são imutáveis; para corrigir um arquivo, cadastre uma versão nova.

Essas regras verificam condições conhecidas e a integridade da transformação. Elas não comprovam, sozinhas, que todo código está funcional ou que qualquer dado arbitrário é um default legítimo. Por isso a equipe precisa revisar o arquivo exato e testar uma instalação limpa antes de publicá-lo; o botão de aprovação não substitui as verificações automáticas. Manifestos fora do formato suportado são recusados, não executados.

## Cadastrar, revisar e publicar

1. `/licenca pacote_cadastrar produto:pelucias recurso:vook_plush versao:1.6.1 arquivo:ZIP`.
2. O bot persiste o ZIP no PostgreSQL como **DRAFT** e retorna ID, SHA-256 e número de arquivos. Não usa o link temporário do anexo como armazenamento. Reenviar o mesmo ZIP/versão reutiliza o registro; conteúdo diferente na mesma versão é recusado.
3. Revise o candidato identificado pelo SHA-256 e conclua os testes funcionais da versão. Para validar a personalização sem mensagens reais, use os testes locais; para homologação real, use uma conta interna autorizada após o deploy.
4. `/licenca pacote_publicar id:ID sha256:HASH revisado:true`. Somente dono/equipe explicitamente autorizada no servidor oficial pode cadastrar/publicar/retirar. O conteúdo é verificado novamente antes de liberar.
5. `/licenca pacotes pagina:1` consulta rascunhos/publicados/retirados. `/licenca pacote_retirar id:ID` impede novos downloads. Uma versão retirada exige nova versão para republicação.

O seletor do comprador lista versões publicadas, cinco por página, mais recentes primeiro. Sem versão aprovada, mostra **“Ainda não há versão final publicada”**. Pacote maior que o limite de anexos da interação é recusado sem criar chaves; tente `/planos` no servidor oficial ou reduza os assets do pacote antes de publicar. O limite de cadastro de 25 MiB não garante que todo contexto Discord aceite um anexo desse tamanho.

## Deploy posterior na ShardCloud via GitHub

O código compilado em `dist/` faz parte deste repositório e foi atualizado. Não foi executado push/deploy nem `prisma migrate deploy` contra o banco real.

1. Faça backup do banco de produção com o processo já usado pela VOOK. Preserve `DATABASE_URL`, `LICENSE_ENCRYPTION_KEY` e os demais segredos da hospedagem; trocar a chave de criptografia impediria recuperar licenças antigas.
2. Revise e inclua no commit as alterações de `src/`, `dist/`, `prisma/schema.prisma`, a nova migração, dependências/lockfile, script de preparação, testes e documentação. Não inclua `.env`, backups, receitas privadas ou ZIPs de clientes.
3. Antes de publicar, execute `npm ci`, `npm run prisma:generate`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` e `npm run prisma:validate`. Se o bot local estiver em execução, compile numa pasta isolada ou pare-o antes de atualizar o `dist/` usado por ele.
4. Faça o commit/push para o branch de deploy somente quando autorizado. A configuração atual `.shardcloud` inicia com `node scripts/iniciar-shardcloud.mjs`: ele gera o Prisma Client e executa `prisma migrate deploy` **antes** de carregar `dist/index.js`. Confirme que a integração GitHub da hospedagem continua usando esse comando.
5. Mantenha `LICENSE_ENABLED=true`, IDs oficiais/equipe e a chave de criptografia existente. `LICENSE_PUBLIC_ENDPOINT` é opcional quando se usa o endereço padrão. Não execute reset, backfill, desvinculação em lote ou reemissão para clientes antigos.
6. O runtime registra automaticamente as novas opções de `/licenca` e `/planos` no startup. Confira o registro e `/health`. Em caso de falha, não inicie o processo em cima de um schema antigo.
7. Confira uma licença antiga e uma emissão para uma conta interna nova; teste Testes/Produção em instalações distintas. Depois prepare/revise/publique os ZIPs finais de cada produto. A migração cria um catálogo vazio de propósito.

Os arquivos ficam no banco: inclua `ScriptRelease` nos backups e dimensione espaço para cada versão. `ScriptDownload` registra **geração do arquivo**, não confirmação de que o Discord ou o cliente concluiu o download. Em rollback, mantenha as tabelas/colunas aditivas; não remova licenças nem registros de entrega. Não volte a emitir pelo código antigo de licença única.

## Validação local

Resultado desta implementação: **57 arquivos de teste, 1.449 testes aprovados**; `npm run lint`, `npm run typecheck`, `npm run build` e `npm run prisma:validate` concluídos. A migração foi aplicada somente no PostgreSQL em memória do teste. Não foi feita homologação ao vivo no Discord/FiveM nem deploy remoto.

- Testes de serviço: emissão exata do par, prazos, conflitos/repetição, vínculo independente, preservação de licenças antigas e isolamento de proprietário.
- Testes de pacote: arquivos indevidos, dados de testes, segredos, manifestos que expõem servidor, limites de expansão, publicação por hash, retirada, suspensão, versões/produtos, resposta privada, personalização e verificação do ZIP final.
- Teste da migração em PostgreSQL WASM (PGlite em memória), sem `DATABASE_URL`: compara todos os campos anteriores, verifica restrições e rollback atômico. O teste de concorrência PGlite serializa transações; o tratamento de conflitos de processos PostgreSQL separados também é coberto por mocks de `P2034`/`P2002`, não por uma carga real em múltiplas instâncias.
- Compilação, tipos, lint e suíte geral do bot. As notificações Discord são simuladas; nenhum cliente recebe mensagem nos testes.

Referências de integração: [manifestos FiveM](https://docs.fivem.net/docs/scripting-reference/resource-manifest/) e [API de ZIP fflate](https://github.com/101arrowz/fflate#usage).

## Arquivos desta alteração

- `src/modules/licenses/service.ts`, `commands.ts`, `panel.ts`, `products.ts`, `packages.ts`, `releases.ts`: emissão, ambientes, validação de pacote, catálogo e entrega privada. A integração de Stage Hall que já estava alterada localmente foi preservada.
- `src/constants/customIds.ts`: ações de consulta e download.
- `prisma/schema.prisma` e `prisma/migrations/20261107120000_license_pairs_and_releases/migration.sql`: estrutura aditiva, restrições e histórico de geração de arquivos.
- `scripts/prepare-script-package.ts`: preparação local por lista explícita.
- `tests/licenses.test.ts`, `tests/script-packages.test.ts`, `tests/script-package-cli.test.ts`, `tests/license-migration.test.ts`: validação e regressões.
- `package.json`/`package-lock.json`: fflate em produção, PGlite somente para testes; descoberta dos testes restrita a `tests/` para não executar cópias de backups/temporários.
- `eslint.config.js`: ignora artefatos locais, backups e pacotes. `src/modules/influencers/services/TwitchLiveService.ts`: conversão explícita de `URLSearchParams.toString()`, correção pontual de lint preexistente, sem mudar a requisição.
- `.env.example`, `README.md`, este guia e correspondentes compilados `.js`/`.map` em `dist/`.
