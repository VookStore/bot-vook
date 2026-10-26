# Vook Store Bot

Sistema comercial e de atendimento da **Vook Store** para Discord: tickets com fila,
equipes, transcript, avaliações, cobranças PIX e cupons gerenciados pela equipe.

Interface 100% **Discord Components V2**, dados em **PostgreSQL**, operação 24/7 com **PM2**.

---

## Sumário

- [Visão geral](#visão-geral)
- [Stack](#stack)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração inicial no Discord](#configuração-inicial-no-discord)
- [Comandos](#comandos)
- [Como cada sistema funciona](#como-cada-sistema-funciona)
- [Execução em produção](#execução-em-produção)
- [Scripts disponíveis](#scripts-disponíveis)
- [Arquitetura](#arquitetura)
- [Banco de dados](#banco-de-dados)
- [Testes](#testes)
- [Backup e recuperação](#backup-e-recuperação)
- [Troubleshooting](#troubleshooting)
- [Atualização](#atualização)
- [Decisões técnicas](#decisões-técnicas)

---

## Visão geral

O bot centraliza toda a operação da loja dentro do Discord:

| Sistema | O que faz |
|---|---|
| **Tickets** | Painel público, categorias, **tópico privado** por atendimento, numeração sequencial |
| **Fila** | Posição real por categoria, derivada dos tickets que aguardam atendimento |
| **Equipes** | Cargos responsáveis por categoria, com controle de acesso ao canal |
| **Atendimento** | Assumir, transferir, adicionar/remover membros, renomear canal, notificar cliente |
| **Fechamento** | Transcript HTML hospedado, log com anexo, cartão de encerramento na DM do cliente |
| **Avaliações** | Pedido por DM (1–5 estrelas + comentário) e publicação em canal público |
| **PIX** | Cobrança gerada pelo vendedor, BR Code real, QR Code, aprovação manual |
| **Anúncios** | `/anunciar` monta o anúncio (embed opcional) com botões de link e publica num canal |
| **Portfólio de lobos** | Painel da equipe: botão → formulário (cliente, tipo, render) → post no canal do portfólio |
| **Entrega do produto** | `/entregar` dentro do ticket: formulário (cliente, arquivo, observações) → cartão com o arquivo no ticket, cópia na DM e pedido marcado como entregue |
| **Quadro de demandas** | Todo pedido pago vira um cartão com link para o ticket e botões de status; ao iniciar, sai uma cópia no canal de iniciadas e o cliente é avisado por DM |
| **Cupons** | Cadastro administrativo, aplicados **somente pela equipe** na cobrança |
| **Boas-vindas** | Card de entrada e auto-role |
| **Operação** | Status, diagnóstico, auditoria, recovery de reinicialização, logs estruturados |

### Fluxo completo

```
CLIENTE
   │
   ▼
🎟️  Abre ticket (categoria → assunto → validação → anti-spam)
   │
   ▼
🕐 Entra na fila da categoria
   │
   ▼
🙋 Vendedor assume o atendimento
   │
   ├────────────────────────────┐
   │                            │
   ▼                       💳 Cobrança PIX
💬 Atendimento             (vendedor informa valor,
   │                        aplica cupom opcional,
   │                        sistema calcula o total,
   │                        gera BR Code + QR Code,
   │                        equipe aprova manualmente)
   ▼
❌ Finaliza o ticket
   ├── Transcript HTML
   ├── Log no canal configurado
   ├── Cartão de encerramento na DM
   │      (detalhes + botão "Avaliar este atendimento")
   │
   ▼
⭐ Avaliação (nota + comentário opcional)
   │
   ▼
📢 Publicação no canal de avaliações
```

---

## Stack

| Componente | Versão | Observação |
|---|---|---|
| Node.js | >= 20.18 (testado em 24.x) | LTS recomendado |
| TypeScript | 5.9.3 | `strict: true` |
| discord.js | 14.27.0 | Components V2 |
| Prisma ORM | 6.19.3 | `prisma-client-js` |
| PostgreSQL | 13+ | Fonte de verdade |
| qrcode | 1.5.4 | Geração do QR PIX |
| pngjs | 5.0.0 | Composição do QR sobre a arte da loja |
| tesseract.js | 7.0.0 | OCR do comprovante (modelo vendorizado em `assets/ocr`) |
| Vitest | 3.2.4 | Testes |
| PM2 | 5+ | Processo 24/7 |

---

## Requisitos

1. **Node.js 20.18+** — `node --version`
2. **PostgreSQL 13+** acessível, com um banco criado para o bot
3. **Aplicação Discord** criada em <https://discord.com/developers/applications>

### Intents privilegiadas (obrigatórias)

No Developer Portal → **Bot** → *Privileged Gateway Intents*, ative:

- **Server Members Intent** — necessário para boas-vindas e auto-role
- **Message Content Intent** — necessário para o conteúdo das mensagens no transcript

> Sem `Message Content`, o transcript sai sem o texto das mensagens.
> Sem `Server Members`, o evento de entrada nunca dispara.

### Permissões do bot no servidor

`Ver canais`, `Enviar mensagens`, `Gerenciar canais`, `Gerenciar cargos`,
`Ver histórico de mensagens`, `Anexar arquivos`, `Inserir links`,
`Criar tópicos privados`, `Enviar mensagens em tópicos`, `Gerenciar tópicos`.

> As três últimas são o que sustenta o ticket: ele é um **tópico privado**, e
> `Gerenciar tópicos` é literalmente o que faz um tópico privado aparecer para quem não
> foi adicionado a ele. Sem ela, a equipe não vê ticket nenhum — e o sintoma é mudo.

O comando `/ticket-sistema diagnostico` confere todas elas e aponta o que falta.

> O cargo do bot precisa estar **acima** do cargo de auto-role na hierarquia do servidor.

---

## Instalação

```bash
npm install
```

### 1. Variáveis de ambiente

Copie o exemplo e preencha:

```bash
cp .env.example .env
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DISCORD_TOKEN` | sim | Token do bot |
| `DISCORD_CLIENT_ID` | sim | Application ID (17–20 dígitos) |
| `DISCORD_GUILD_ID` | não | Se definido, registra os comandos só nesta guild (imediato) |
| `DATABASE_URL` | sim | `postgresql://usuario:senha@host:5432/banco?schema=public` |
| `NODE_ENV` | não | `production` (padrão), `development` ou `test` |
| `LOG_LEVEL` | não | `debug`, `info` (padrão), `warn` ou `error` |
| `TRANSCRIPT_BASE_URL` | não | Base do Worker que hospeda os transcripts (`https://...`, sem barra final) |
| `TRANSCRIPT_UPLOAD_TOKEN` | não | Token do `PUT` no Worker |

O bot valida tudo no passo 1 do startup e lista **todos** os problemas de uma vez.

### 2. Banco de dados

```bash
npm run prisma:generate
```

```bash
npm run prisma:migrate:deploy
```

> `migrate:deploy` aplica a migração já versionada em `prisma/migrations/` e
> **preserva os dados existentes**. Use `npm run prisma:migrate:dev` apenas em
> desenvolvimento, ao alterar o schema.

### 3. Build e registro dos comandos

```bash
npm run build
```

```bash
npm run deploy:commands
```

### 4. Primeira execução

```bash
npm start
```

O startup imprime as 8 etapas:

```
Inicializando Vook Store Bot...
[1/8] Environment
[2/8] PostgreSQL
[3/8] Prisma
[4/8] Cache
[5/8] Discord
[6/8] Recovery
[7/8] Schedulers
[8/8] Validation
Vook Store Bot operacional.
```

---

## Configuração inicial no Discord

Na ordem, dentro do servidor:

1. **`/ticket-categorias gerenciar`** → crie as categorias (ex.: Compras, Suporte, Entregas).
2. **`/ticket-destinos configurar`** → aponte cada categoria para um **canal de texto**
   (ex.: `#duvidas`). Os tickets dessa categoria viram tópicos privados dentro dele.
3. **`/ticket-equipe configurar`** → defina os cargos responsáveis por categoria.
   *Categoria sem equipe não aceita abertura de ticket — é uma trava proposital.*
4. **`/ticket-config geral`** → canais (painel, logs, boas-vindas, avaliações),
   auto-role, visual e limites.
5. **`/config-pagamento gerenciar`** → cadastre a conta PIX que receberá os valores.
6. **`/cupom gerenciar`** → cadastre os cupons (opcional).
7. **`/ticket-painel enviar`** → publique o painel público de abertura.
8. **`/ticket-painel localizadores`** → publique o painel "Localizar meu ticket" nos canais
   de atendimento. É este comando que também **acerta as permissões** de cada canal.
9. **`/ticket-sistema diagnostico`** → confirme que está tudo verde.

---

## Comandos

| Comando | Permissão | Função |
|---|---|---|
| `/ticket-config geral` | Gerenciar Servidor | Canais, auto-role, visual e limites |
| `/ticket-categorias gerenciar` | Gerenciar Servidor | CRUD de categorias, ordem e ativação |
| `/ticket-destinos configurar` | Gerenciar Servidor | Categoria lógica → categoria do Discord |
| `/ticket-equipe configurar` | Gerenciar Servidor | Cargos responsáveis por categoria |
| `/ticket-painel enviar` | Gerenciar Servidor | Publica o painel público |
| `/ticket-painel atualizar` | Gerenciar Servidor | Edita a mensagem já publicada |
| `/ticket-painel remover` | Gerenciar Servidor | Remove o painel |
| `/ticket-painel localizadores` | Gerenciar Servidor | Publica o painel "Localizar meu ticket" em cada canal de atendimento e acerta as permissões |
| `/ticket-sistema status` | Gerenciar Servidor | Status operacional |
| `/ticket-sistema diagnostico` | Gerenciar Servidor | Configuração × estado real do Discord |
| `/ticket-sistema fila` | Gerenciar Servidor | Fila por categoria |
| `/ticket-sistema testar-boas-vindas` | Gerenciar Servidor | Pré-visualização (não aplica cargo) |
| `/pagamento criar` | Equipe | Gera a cobrança PIX de um cliente e abre o pedido `VK-` dela |
| `/config-pagamento gerenciar` | Gerenciar Servidor | Contas PIX |
| `/cupom gerenciar` | Gerenciar Servidor | Cupons |
| `/catalogo ver` | Todos | Abre a loja (efêmero): categorias, packs e galeria |
| `/catalogo buscar` | Todos | Procura pack por nome, SKU ou descrição |
| `/catalogo gerenciar` | Gerenciar Servidor | Packs, imagens, categorias, preços e destaques |
| `/catalogo-painel enviar` | Gerenciar Servidor | Publica o painel público do catálogo |
| `/catalogo-painel atualizar` | Gerenciar Servidor | Edita a mensagem já publicada |
| `/catalogo-painel remover` | Gerenciar Servidor | Remove o painel do catálogo |
| `/carrinho` | Todos | Carrinho do próprio cliente (efêmero) |
| `/meus-pedidos` | Todos | Histórico dos próprios pedidos |
| `/pedidos gerenciar` | Equipe | Painel comercial com filtro por status |
| `/pedidos buscar` | Equipe | Abre um pedido pelo número ou lista os pedidos de um cliente |
| `/comprovante enviar` | Todos | Envia o comprovante do PIX pelo número do pedido (o caminho normal é o botão no cartão da cobrança) |
| `/entregar` | Equipe | Dentro do ticket: abre o formulário da entrega (cliente, arquivo, observações) |
| `/anunciar` | Gerenciar Servidor | Monta um anúncio (com ou sem embed) com botões de link e publica num canal |
| `/lobos painel` | Gerenciar Servidor | Publica o painel de anúncio de lobos no canal da equipe |
| `/lobos portfolio` | Gerenciar Servidor | Define o canal público onde os lobos são publicados |
| `/lobos atualizar` | Gerenciar Servidor | Reescreve o painel já publicado |
| `/demandas canais` | Gerenciar Servidor | Define os canais do quadro: `quadro`, `iniciadas`, `concluidas`, `tickets` (cartões da equipe) e `localizador` (canal dos clientes) |
| `/demandas sincronizar` | Gerenciar Servidor | Publica no quadro as demandas em produção que ainda não têm cartão |

---

## Como cada sistema funciona

### Tickets e fila

#### Painel público e formulário de abertura

```
[ banner da loja ]
────────────────────────────────
### Abrir ticket

Olá, seja bem-vindo(a) à Vook Store! Se você precisa falar com a nossa
equipe, sinta-se à vontade para abrir um ticket.
[ 🎟️ Iniciar atendimento ]
────────────────────────────────
-# Equipe Vook Store
```

O clique abre **um formulário só**, com motivo e categoria juntos:

| Campo | Tipo |
|---|---|
| Qual é o motivo do seu contato? | texto longo, obrigatório |
| Escolha uma categoria | seleção com nome, descrição e emoji de cada categoria |

**Um botão, não um menu.** O painel tinha o seletor de categorias direto nele: o cliente
escolhia a categoria e só então via o campo do motivo, num segundo passo — quem desistia
no meio deixava a interação pendurada. Agora o painel faz uma pergunta só ("quer abrir um
ticket?") e o formulário recebe as duas respostas no mesmo envio.

**O banner abre o painel.** Ele vinha depois dos avisos, com o argumento de que o título
precisava vir primeiro; na prática a arte da loja *é* o cabeçalho, e o painel passou a ser
lido como um cartaz. O título virou `###` — abaixo do banner ele é uma chamada, e um H2
competia em peso com a própria arte.

As categorias continuam vindo de `/ticket-categorias gerenciar` — nome, descrição e emoji
são os mesmos do cadastro. Elas são lidas **no clique**, não guardadas no botão: o painel
fica publicado por semanas, e uma categoria desativada nesse meio tempo continuaria
aparecendo. Sem nenhuma categoria ativa, o painel mostra um aviso no lugar do botão.

> O seletor aceita 25 opções. Com mais categorias que isso, o rodapé do painel avisa a
> equipe quantas ficaram de fora — o cliente não tem o que fazer com essa informação.

#### Cada ticket é um tópico privado

```
#duvidas                        ← canal de destino da categoria "Dúvidas"
 ├── [ painel: Localizar meu ticket ]
 ├── 🔒 ticket-0042             ← tópico privado do cliente A
 └── 🔒 ticket-0043             ← tópico privado do cliente B
```

**Por que tópico e não canal.** Um canal por ticket esbarra no teto de **500 canais por
servidor**: uma loja movimentada passa a fechar ticket só para poder abrir o próximo.
Tópico não consome slot nenhum, então o limite de atendimentos simultâneos volta a ser o do
negócio. E o canal de destino ganha um papel útil em vez de ser uma pasta.

**A diferença que muda tudo:** tópico **não aceita permissão própria** — ele herda do
canal-pai. Quem enxerga um tópico privado são (1) seus membros e (2) quem tem
`Gerenciar tópicos` no pai. Por isso o acesso se divide em dois:

| Quem | Como enxerga |
|---|---|
| Cliente | `ViewChannel` no canal **e** membro do tópico — as duas coisas, concedidas na abertura |
| Equipe | `Gerenciar tópicos` no canal de destino — vale para todos os tickets de uma vez |
| Resto do servidor | não vê o canal |

**O canal de atendimento é oculto por padrão.** Quem não tem ticket aberto não vê `#duvidas`
na lista de canais. O acesso é dado pessoa a pessoa na abertura e retirado quando o **último**
atendimento dela naquela categoria fecha — quem ainda tem outro continua enxergando.

> Ser membro do tópico privado **não basta**: sem `ViewChannel` no canal-pai o Discord não
> mostra a conversa nem para quem foi adicionado a ela. Por isso toda entrada em ticket
> concede as duas coisas, e participantes adicionais recebem o mesmo tratamento.

`/ticket-painel localizadores` também faz o **backfill**: concede acesso a quem já tinha
atendimento aberto quando a regra passou a valer, para ninguém perder a conversa de vista.

> Custo: um overwrite por pessoa com ticket aberto. O Discord aceita ~500 por canal, então
> serve para dezenas de atendimentos simultâneos por categoria, não centenas.

`/ticket-painel localizadores` é quem grava essas permissões: `@everyone` fica **sem ver** o
canal, os cargos de equipe ganham `Gerenciar tópicos`, e
o bot ganha o que precisa. É uma ação **explícita** do administrador, nunca um efeito
colateral de abrir ticket — e o bot usa `edit`, não `set`, para não apagar overwrites que
você criou por outros motivos.

> `invitable: false` no tópico: só quem tem `Gerenciar tópicos` adiciona gente. Sem isso o
> próprio cliente poderia trazer terceiros para dentro de um atendimento que costuma tratar
> de dado pessoal e pagamento.

#### Localizar meu ticket

```
[ banner da loja ]
────────────────────────────────
### 🔎 Localizar Ticket

Não consegue encontrar seu atendimento?
Toque no botão abaixo para ver seus tickets abertos em **Dúvidas** — e voltar
para dentro deles.
[ 🔎 Localizar meu ticket ]
```

Tópico privado não aparece na barra lateral como um canal aparecia: some quando o cliente
sai dele, quando o Discord esconde tópicos inativos, ou quando ele rola a lista para longe.
O painel devolve esse caminho.

**O clique readmite o cliente no tópico** — é o ponto do painel. O modo de falha real não é
"perdi o link", é "saí do tópico e não consigo voltar", porque link de tópico privado não
readmite ninguém. A resposta é efêmera e traz, por atendimento: número, situação (na fila
com posição, ou em atendimento), assunto e um botão de link. Falha ao readmitir não derruba
a tela — a lista continua, e o link funciona para quem nunca chegou a sair.

#### Ao fechar: arquiva, não apaga

O tópico é **trancado e depois arquivado** (nessa ordem: arquivar primeiro faria a chamada
seguinte reabri-lo). Ele sai da lista do canal mas continua consultável pela equipe, e
trancado ninguém reabre a conversa por engano. Guardar não custa nada — tópico arquivado
não ocupa slot — e o transcript HTML continua sendo gerado do mesmo jeito.

> **Tickets abertos antes da mudança continuam valendo.** Eles vivem em canais próprios e
> não são migrados: cada operação (renomear, dar acesso, fechar) reconhece as duas naturezas
> e faz a coisa certa para cada uma. Canal legado continua sendo **apagado** ao fechar, que
> é o comportamento com que ele foi criado.

#### Regras de abertura

A abertura valida, nesta ordem: guild → categoria → status → destino → equipe →
cooldown → limite por usuário → limite global → lock → número → canal → permissões.

O número é reservado por um **contador transacional** (`GuildCounter`), nunca por
`count() + 1`, e a constraint `UNIQUE (guildId, ticketNumber)` é a garantia final.

A **posição na fila não é armazenada**. Ela é derivada, a cada consulta, dos tickets
com `status = OPEN` e sem responsável, na mesma categoria — ordenados por prioridade
e número. Isso torna impossível a fila "desincronizar".

Ao assumir, o ticket sai da fila automaticamente. Para não gerar rajada de chamadas à
API, apenas os primeiros painéis da fila são reescritos; qualquer cliente pode ver a
posição exata no botão **🔄 Atualizar**.

> O campo `priority` já existe (`NORMAL`/`HIGH`/`URGENT`/`VIP`) e a fila já ordena por
> ele. Nenhuma regra VIP é aplicada automaticamente — depende de configuração futura.

### Concorrência

Dois atendentes clicando em **Assumir** no mesmo instante: o `UPDATE` é condicional
(`WHERE claimedById IS NULL AND status = 'OPEN'`), então apenas um afeta a linha; o
outro recebe a mensagem de quem assumiu. O mesmo padrão protege fechamento, aprovação
e cancelamento de cobrança. Locks em memória só evitam duplo clique — a integridade
real vem do banco.

### Fechamento

`permissão → lock → CLOSING → histórico → transcript → CLOSED → log + anexo →
cartão de encerramento na DM → exclusão do canal`.

O estado final é gravado **antes** de apagar o canal. Transcript, log e DM são
*best-effort*: nenhum deles impede o encerramento.

#### Transcript hospedado

O transcript sempre foi um HTML auto-contido, mas ia só como **anexo** no canal de logs —
o que traz dois problemas: ele é cortado pela metade repetidamente para caber nos 20 MiB do
Discord, e o cliente nunca recebe cópia. Com `TRANSCRIPT_BASE_URL` configurado, o mesmo
HTML vai para um endereço próprio e o link entra no cartão do cliente **e** no log da equipe.

```
fechamento → renderiza o HTML → PUT no Worker → grava a URL no ticket
                                      ↓
                  [ Ver histórico do atendimento ]  ← cartão na DM do cliente
                  [ Abrir transcript completo ]     ← log da equipe (+ anexo)
```

**A versão hospedada não é cortada.** O encolhimento existe para caber no anexo; fora dele
não há limite, e perder metade da conversa era a maior fraqueza do transcript. O anexo
continua indo junto no log, como cópia que não depende de serviço externo.

**Opcional e best-effort.** Sem as variáveis de ambiente o bot segue exatamente como antes.
Se o upload falhar — Worker fora do ar, token errado, timeout de 15s — o ticket fecha do
mesmo jeito, com warning no log e sem link no cartão.

##### Infraestrutura

O Worker está em `cloudflare/transcripts/` (Cloudflare Workers + R2). Ver o `wrangler.toml`
para o deploy. Escolhi Worker em vez da API S3 do R2 porque falar S3 exigiria assinatura
SigV4 — na prática, o SDK da AWS — e este projeto tem seis dependências no total. O bot faz
um `fetch` simples, e o Worker é o lugar natural para acrescentar expiração ou login depois.

##### Privacidade

O transcript carrega nome de cliente, print de conversa e às vezes comprovante com dado
bancário. O endereço secreto é a **única** barreira de leitura, então:

- **Slug com ~160 bits de entropia** (`t0042-<40 hex>`), de `randomBytes`. Um id sequencial
  ou o número do ticket tornariam o documento adivinhável.
- **`X-Robots-Tag: noindex` + `robots.txt` fechado** — sem isso, "URL secreta" dura até
  alguém colar o link onde um crawler leia.
- **`Referrer-Policy: no-referrer`** — o endereço não vaza quando o cliente clica num link
  de dentro do transcript.
- **CSP sem `script-src`** — o documento não tem JavaScript, então o navegador recusa
  qualquer um. É a segunda linha de defesa depois do escape que o `TranscriptService` faz.
- O `PUT` exige `Bearer`, comparado em tempo constante.

> **Limitação conhecida:** os anexos são links para o CDN do Discord, e essas URLs agora
> expiram (~24h). Imagens de transcripts antigos aparecem quebradas. Resolver exige
> re-hospedar os arquivos junto do HTML.

#### O cartão que o cliente recebe

```
[ banner da loja ]
────────────────────────────────
Olá, @cliente!

Seu atendimento foi encerrado em **Vook Store**. Aqui estão os detalhes:
────────────────────────────────
📂 Categoria: Suporte
🎟️ Protocolo: `#2194`
🔒 Encerrado por: @atendente (Nomad)
🔔 Motivo do encerramento: Questão solucionada!
────────────────────────────────
⭐ Com base no atendimento recebido, gostaríamos de convidá-lo(a) a
   **avaliar nosso suporte**...
[ ⭐ Avaliar este atendimento ]
-# Vook Store — a avaliação é opcional e leva menos de um minuto.
```

**Uma mensagem, não duas.** O convite de avaliação saía numa DM própria, disparada logo
atrás da de encerramento: chegavam dois cartões quase iguais em sequência e o cliente
respondia o segundo achando que era repetição. Agora o convite é um botão dentro do
próprio cartão.

O botão abre o painel das cinco notas — cinco estrelas no cartão competiriam com os
detalhes que o cliente foi ler. **Ticket já avaliado não ganha botão:** o cartão termina
no agradecimento, porque um botão que só sabe responder "você já avaliou" é pior que botão
nenhum. A checagem é refeita no clique, já que o cartão antigo continua na DM.

O banner do topo é o `ticketBannerUrl` de `/ticket-config geral`. Ele é enfeite e nunca
decide se a DM sai: ausente ou com URL inválida, o cartão apenas começa na saudação.

> "Encerrado por" é quem **fechou**, não quem assumiu — é o que o cliente procura quando
> quer saber com quem falar sobre o desfecho.

O transcript é um HTML autocontido, com todo conteúdo dinâmico escapado — mensagem,
nome, apelido, assunto, motivo e anexos. `href`/`src` aceitam somente `http`/`https`.

### Avaliações

Após o fechamento, o cliente recebe uma DM com 5 botões de nota. A nota abre um modal
de comentário **opcional**. A avaliação é publicada no canal configurado.

- `UNIQUE (ticketId)` garante **uma avaliação por ticket**, mesmo com duplo clique.
- Se a publicação falhar (canal apagado, sem permissão), **a avaliação continua salva**
  e o problema aparece no diagnóstico.
- A publicação contém apenas: estrelas, cliente, número do ticket, categoria, atendente,
  comentário e data. **Nunca** transcript, assunto, motivo ou dados financeiros.

### PIX

```
/pagamento criar (cliente, valor, descrição, conta)
        ↓
Painel de confirmação (só o vendedor vê)
        ↓
🎟️ Selecionar cupom  →  sistema recalcula o total
        ↓
💳 Gerar cobrança  →  abre o pedido VK- + BR Code e QR Code com o VALOR FINAL
        ↓
✅ Aprovar / ⚙️ Gerenciar / ❌ Cancelar / 🧾 Enviar Comprovante (cliente)
```

**Toda cobrança abre um pedido.** A venda de balcão feita por `/pagamento criar` deixou de
ser um evento solto: ela reserva um número `VK-000190` no mesmo contador do catálogo e
grava o pedido antes de emitir o PIX. O número aparece em três lugares — no **cartão da
cobrança** que o cliente recebe, no **painel do ticket** (bloco "Pedidos deste atendimento",
no topo do canal) e na confirmação que o vendedor vê.

Isso não é cosmético: comprovante, histórico em `/meus-pedidos`, painel comercial e status
de entrega são todos ancorados no pedido. Enquanto a venda de balcão não tinha um, quem
pagava por `/pagamento` **não tinha onde anexar o comprovante** — o botão não existia e
`/comprovante enviar` exigia um número de pedido que nunca fora emitido.

O pedido de balcão nasce **sem itens** (não há pack do catálogo para fotografar): o valor
vinculante é o da cobrança, e o que foi vendido continua descrito na própria cobrança. O
pedido vem *antes* da cobrança porque é ele que leva o número até o cartão; se a emissão do
PIX falhar, o pedido é cancelado junto, sem deixar fantasma na fila comercial.

O payload segue o padrão **BR Code (EMV QRCPS-MPM)** do Banco Central, com CRC-16/CCITT-FALSE.
O QR Code codifica exatamente o `pixPayload` salvo no banco — nunca fica um QR antigo
apontando para valor diferente: alterar cupom ou valor **regenera os dois**.

**Três caminhos para pagar.** Além de escanear o QR e colar o Copia e Cola, o cliente vê a
**chave PIX e o titular em texto**, para digitar direto no app do banco. Os três aparecem
nas três telas do cliente — cartão do canal, DM da cobrança e `/meus-pedidos` — e a chave
sai da *mesma conta* que emitiu o payload. Antes ela só existia se a loja a tivesse
desenhado na arte do QR; loja sem arte cadastrada não mostrava chave em lugar nenhum.

A linha avisa que **a transferência por chave não carrega o valor** — quem digita a chave
digita o total também. É o defeito mais comum desse caminho, e o que depois chega à equipe
como comprovante divergente.

> A chave aparece **inteira** aqui de propósito. Mascarar (`maskPixKey`) é regra dos painéis
> da equipe, onde a chave é dado administrativo listado ao lado de outras contas. No cartão
> ela é o próprio meio de pagamento — e já viaja em texto puro dentro do Copia e Cola logo
> acima.

> ⚠️ **Aprovação é manual.** Não há integração bancária. O botão **Aprovar** registra
> que a *equipe* confirmou o recebimento, e todo texto do bot diz exatamente isso.
> Em nenhum momento o sistema afirma que o banco confirmou o pagamento.

#### Arte personalizada do QR

Cada conta PIX pode ter um card próprio em `assets/pix/<guildId>/<identificador>.png`.
Basta deixar um **quadrado branco sólido** onde o QR deve entrar: o bot localiza esse
quadrado sozinho e desenha o QR ali, sem configuração de coordenada.

O QR é pintado **módulo a módulo em escala inteira** a partir da matriz crua do `qrcode` —
nunca redimensionado. Isso elimina a borda cinza de interpolação, que é a causa clássica
de QR que o aplicativo do banco não lê.

A arte é **decoração**: sem arquivo, com arquivo corrompido, sem quadrado reconhecível ou
com quadrado apertado demais, o cartão cai no QR simples e a cobrança segue normal.
`/ticket-sistema diagnostico` mostra o estado da arte de cada conta ativa.
Detalhes em [`assets/pix/README.md`](assets/pix/README.md).

### Cupons

Cupons são ferramenta **interna**. O cliente não digita, não escolhe e não aplica cupom —
quem seleciona é o vendedor, na criação ou no gerenciamento da cobrança.

- `PERCENTAGE` guarda base 100 (`2000` = 20,00%); `FIXED_AMOUNT` guarda centavos.
- O desconto é **fotografado** na cobrança (`couponCodeSnapshot`, `couponTypeSnapshot`,
  `couponValueSnapshot`): editar o cupom depois **não altera cobranças antigas**.
- O uso só é contabilizado quando o pagamento é **aprovado**, dentro da mesma transação,
  com a linha do cupom travada (`SELECT … FOR UPDATE`). Cobrança cancelada ou expirada
  **não consome uso**.
- `UNIQUE (paymentId)` em `CouponUsage` impede contagem dupla.

### Catálogo, carrinho e pedidos

```
🛍️ CATÁLOGO → categoria → pack → ◀️ galeria ▶️
        ↓                              ↓
  🛒 Carrinho                    ⚡ Comprar Agora
        └──────────── Pedido ──────────┘
                        ↓
              Vendedor revisa o pedido
                        ↓
              🎟️ Cupom (opcional, só a equipe)
                        ↓
              💳 Gerar Pagamento  →  PaymentService
                        ↓
              Payment APPROVED → Order PAID → 📦 Entrega
```

**O catálogo não cobra.** Ele cria o *pedido*; quem cobra é o mesmo `PaymentService`
usado por `/pagamento criar` — mesma conta PIX, mesmo BR Code, mesmos cupons, mesma
expiração e mesma auditoria. Não existe configuração financeira exclusiva do catálogo,
e `tests/order-payment-integration.test.ts` varre o código para impedir que apareça uma.

- **Galeria:** uma imagem por vez, com `◀️` / `▶️` **circulares** e contador `Imagem X de Y`.
  O índice viaja no `customId` e a lista vem do banco, então a navegação continua
  funcionando depois de qualquer restart. A mesma mensagem é **atualizada** — nunca uma
  mensagem por imagem.
- **Carrinho:** persistente no PostgreSQL e **sempre efêmero** na tela. Não congela preço:
  o valor exibido é o preço atual do produto. O snapshot vinculante nasce no **pedido**.
- **Pedido:** cada `OrderItem` guarda nome, SKU e preço do momento da compra. Alterar o
  preço do pack amanhã **não reescreve** um pedido de ontem.
- **Numeração:** `VK-000184`, reservada com `increment` atômico em `GuildCounter` dentro da
  transação do pedido — nunca `count() + 1`.
- **Duplo clique:** lock por cliente **e** checagem de pedido idêntico recente no banco;
  o carrinho só fecha com `updateMany` condicional ao status `ACTIVE`.
- **Cupom:** o cliente não vê campo, botão nem menu de desconto em nenhuma tela pública.
  Quem aplica é o vendedor, no painel do pedido, pelo módulo central de cupons.
- **Onde o cliente paga:** assim que o vendedor gera a cobrança, o cliente recebe **DM com
  QR Code, PIX Copia e Cola e a chave em texto**, e os mesmos dados passam a aparecer no pedido dele em
  `/meus-pedidos` — tela efêmera, já validada como sendo dele. O cartão publicado no canal
  continua existindo para a equipe. DM fechada não bloqueia nada: o PIX continua no painel.
- **Cobrança expirada:** o PIX vence em minutos. Quando isso acontece, o cliente é avisado
  por DM e o painel dele explica o que houve, em vez de o QR sumir da tela em silêncio; o
  card da equipe passa a estampar que é preciso emitir uma nova.

#### Comprovante de pagamento

O botão **Enviar Comprovante** fica no próprio cartão da cobrança, ao lado do PIX que o
cliente acabou de ler: um toque abre o modal, ele anexa o arquivo e pronto — sem sair da
mensagem e sem precisar do número do pedido. `/comprovante enviar` continua valendo para
quem prefere digitar, para quem não está no canal do cartão e para o pedido cuja cobrança
já expirou (o cartão vencido perde os botões, mas o pedido segue aceitando comprovante).

O botão vale para **toda cobrança**, do catálogo ou de balcão — porque toda cobrança abre
pedido (veja abaixo). Ele aparece para todo mundo que enxerga o canal, mas **só o cliente da
cobrança consegue enviar**: o dono é reconferido no servidor quando o arquivo chega, como
toda ação do bot. A única exceção são cobranças emitidas antes dessa regra, que nasceram sem
pedido e por isso não têm onde gravar a evidência.

De um jeito ou de outro, o bot valida o arquivo, lê a imagem por **OCR** e publica para a
equipe o comprovante **lado a lado com o que a cobrança esperava** — valor, data, titular e
final da chave, cada um com 🟢 / 🟡 / 🔴.

> ⚠️ **A conferência automática é auxílio, nunca prova.** Comprovante PIX é uma imagem, e
> imagem se falsifica — geradores de comprovante falso são triviais de achar. O OCR lê o
> que está escrito; num comprovante forjado, o que está escrito é justamente o valor
> "certo". Por isso ele pega **engano** (valor trocado, comprovante antigo reaproveitado,
> conta errada) e **não pega fraude**. Quem confirma o recebimento continua sendo uma
> pessoa, pelo mesmo `Aprovar` de sempre.

O viés é deliberado: divergência só é apontada em sinal forte (o valor cobrado não aparece
no comprovante, ou o comprovante é anterior à cobrança). Tudo que apenas não deu para ler
vira "não consegui conferir" — acusar um cliente honesto cujo banco imprime diferente custa
mais caro que pedir uma conferência manual.

PDF é aceito, mas não passa por OCR. O modelo de idioma fica em `assets/ocr/`, então
nenhuma conferência depende de download externo.
- **Sincronização:** `PaymentService` anuncia `approved` / `expired` / `cancelled` por um
  barramento interno; o pedido reage de forma **idempotente**. Não há webhook próprio nem
  polling. Cobrança expirada mantém o pedido em "aguardando pagamento" e libera a emissão
  de uma cobrança nova — o payload antigo nunca é reaproveitado.

### Anúncios

```
/anunciar [canal] [embed]
        ↓
Formulário  →  título, descrição, thumbnail, imagem, rodapé + ícone, cor, autor
        ↓
PRÉVIA efêmera  →  o anúncio renderizado de verdade, já com os botões
        ↓
➕ Adicionar botão  →  nome, link e emoji (opcional)
        ↓
✅ Publicar  →  a mensagem vai ao canal
```

**Nada é enviado antes do clique em Publicar.** A prévia é efêmera e mostra a mensagem
exatamente como ela vai sair — mesmo embed, mesmos botões — porque as duas pontas saem da
mesma função. Um anúncio publicado não tem como ser desfeito: quem estava no canal já leu.

**Os nove campos cabem num formulário só.** Um modal do Discord aceita **cinco** campos, e
o anúncio precisa de nove valores. Os relacionados dividem campo, separados por ` | ` —
mesmo idioma do modal visual de `/ticket-config`, que já carrega três URLs de uma vez:

| Campo do formulário | Valores |
|---|---|
| Título | título |
| Descrição | descrição (markdown do Discord) |
| `Thumbnail \| Imagem` | imagem pequena (canto) e imagem grande (rodapé do embed) |
| `Rodapé \| Ícone do rodapé` | texto e ícone do rodapé |
| `Cor \| Autor \| Ícone do autor` | cor `#8b5cf6`, nome e ícone da linha de autor |

Todos são **opcionais** — só não dá para deixar tudo vazio: um embed apenas com cor sai
como um retângulo em branco que a API aceita sem reclamar. Posição vazia no meio continua
vazia (`https://.../logo.png | ` = thumbnail sem imagem grande).

Com `embed: false` o formulário vira um campo só, de texto puro, e os botões continuam
valendo.

**Botões de link.** Até 10 por anúncio, em linhas de cinco. Cada um tem nome, link https
e emoji opcional — inclusive **emoji personalizado**, colado no formato que o Discord
produz:

```
<:hairmtc:1403457616792785017>       emoji do servidor
<a:loading:1403457616792785017>      emoji animado
🔥                                    emoji comum
```

> `:hairmtc:` — a forma que aparece ao digitar no chat — é **recusada com instrução**: sem
> o id o bot não resolve o emoji, e o Discord aceitaria o botão desenhando um quadrado
> vazio. Para obter o formato completo, escreva `\` antes do emoji e envie a mensagem.

São botões `Link`: não geram interação e por isso continuam funcionando com o bot offline
— o que se espera de um anúncio que fica no canal por semanas.

**Verificações antes de publicar:** o canal ainda existe, o bot pode enviar mensagem nele e
tem **Inserir links** (sem essa permissão o Discord aceita a mensagem e simplesmente não
desenha o embed — o anúncio sairia em branco). A prévia também avisa quando o bot não
alcança um emoji personalizado usado num botão.

> O anúncio nunca menciona ninguém: `@everyone` escrito no texto sai como texto. Para tocar
> o sino, use uma mensagem própria — notificar o servidor inteiro por engano não se desfaz.

O rascunho vive **em memória** por 30 minutos, como o rascunho de cobrança: nada foi
publicado ainda, então perdê-lo num restart não perde dado (basta repetir o comando) e não
suja o banco com anúncio que ninguém enviou.

### Portfólio de lobos

```
Painel no canal da equipe  →  🐺 Criar anúncio
        ↓
Formulário  →  cliente, Lycan ou Lobisomem, render
               (+ personalização e adicional, opcionais)
        ↓
Enviar  →  post no canal do portfólio, com o render e os emojis da loja
```

**Configuração (uma vez, administrador):**

```bash
/lobos portfolio canal:#portfolio      # onde os lobos são publicados
/lobos painel canal:#equipe            # onde fica o botão
```

A ordem não importa: o painel publicado antes do destino sai com o botão **desligado** e a
explicação do que falta, e se liga sozinho quando `/lobos portfolio` é rodado.

**Quem publica é a equipe** (os cargos de atendimento), não só administradores — ao
contrário de `/anunciar` e da tabela de preços, o post não declara preço nem benefício:
mostra um trabalho entregue. Configurar *onde* o post sai continua sendo de administrador.

**O render é reenviado pelo bot.** O arquivo do formulário tem URL assinada que expira em
poucas horas; o post aponta para um anexo da própria mensagem do bot, que não expira. O
formato é lido **dos bytes** (PNG, JPG, WEBP ou GIF) — um `.png` que na verdade é WEBP sai
com a extensão certa, e um PDF renomeado é recusado antes de virar um quadrado quebrado no
canal público.

**Tamanho: dois caminhos, escolhidos pelo tamanho do arquivo.**

1. **Cabe como anexo** → vai como anexo da própria mensagem do bot. É o preferido: a imagem
   vive junto da mensagem e não depende de mais nada. Quem limita aqui é o **reenvio do
   bot**, e bot não tem Nitro — vale só o nível de impulsos do servidor:

   | Servidor | Anexo aceito |
   |---|---|
   | Sem impulso ou nível 1 | até 20 MB |
   | Nível 2 (7 impulsos) | até 50 MB |
   | Nível 3 (14 impulsos) | até 100 MB |

2. **Não cabe** → o render sobe para o **Worker da Cloudflare** (a mesma rota `/a/<id>` que
   re-hospeda anexos de transcript) e o post aponta para a URL, até **95 MB**. É o que
   permite publicar um render grande num servidor sem impulso. Em troca, a imagem daquele
   post passa a depender do Worker continuar no ar — por isso ele é o plano B, não o padrão.

O painel e o formulário mostram o maior dos dois. Sem `TRANSCRIPT_BASE_URL` configurado, o
caminho 2 não existe e o teto volta a ser só o do anexo.

> **O endereço hospedado termina em `.png`/`.jpg`.** A extensão é decorativa para o Worker
> (o arquivo é lido pelos 32 hex), mas é ela que faz o Discord tratar o link como imagem.
> Isso exige o Worker **atualizado** — na versão antiga da rota o envio é recusado, e a
> equipe recebe uma mensagem clara em vez de um post com imagem quebrada.

Quatro cuidados sustentam os arquivos grandes:

- **Download em streaming.** `response.arrayBuffer()` custava ~3,3× o tamanho do arquivo em
  memória: 100 MiB viravam ~330 MB, e o processo inteiro (download + cópia do envio) media
  **+434 MB** — acima do `max_memory_restart: '512M'` do PM2, ou seja, o bot caía no meio do
  envio. Lendo o corpo pedaço a pedaço para um buffer do tamanho anunciado, a sequência
  completa passou a medir **+208 MB**. O corte no teto também deixou de ser cosmético:
  antes o arquivo já estava inteiro na memória quando o tamanho era conferido, então um
  `content-length` mentiroso custava a memória toda.

- **Prazo proporcional.** O cliente padrão do Discord desiste em 15 s — pouco para 100 MB.
  Download e reenvio ganham prazo pelo tamanho (até 5 min), e o reenvio vai por um
  cliente **sem repetição automática**: repetir um upload abortado pode publicar o mesmo
  lobo duas vezes. Se o prazo estourar mesmo assim, a mensagem manda **conferir o canal
  antes de publicar de novo** — o Discord pode ter recebido o arquivo inteiro antes do
  corte, e é o reenvio humano que duplicaria o post.
- **Um post por vez.** Um render de 100 MB ocupa ~200 MB de memória no pico, e o PM2
  reinicia o bot em 512 MB. Posts simultâneos entram numa **fila** — o segundo espera o
  primeiro e sai sozinho, sem ninguém perder o formulário.
- **Recusa antes do download.** Arquivo acima do teto é barrado pelo tamanho declarado, com
  a causa escrita: "exporte menor" quando é o teto da loja, "o nível de impulsos limita"
  quando é o do servidor. Se mesmo assim o Discord recusar o reenvio por tamanho (a tabela
  acima vem da FAQ de impulsos, não da referência da API), a equipe recebe a mesma frase
  clara, e o log guarda os números para ajustar o teto.

> **Não use `interaction.attachmentSizeLimit` como teto do bot.** O Discord o calcula como o
> **maior** entre o Nitro de quem clicou e o nível do servidor. A primeira versão usava esse
> valor: com Nitro na conta de quem publicou, ela prometeu 100 MB num servidor que aceita
> 20, e o reenvio tomou `DiscordAPIError[40005]`.

**O que o post mostra:** título com o emoji do lobo, o render em largura total, tipo,
cliente, personalização e adicional (cada um só quando preenchido — várias linhas viram
lista) e o convite para abrir ticket apontando para o painel de atendimento. **Não leva
preço**: o post fica no canal para sempre e ninguém o reescreve, então um "a partir de"
envelheceria a cada reajuste da tabela.

Os emojis personalizados ficam em `src/modules/wolves/data/wolves.ts`. Emoji recriado no
Discord muda de id — o conserto é uma linha ali. Eles entram **só no texto**: num botão ou
select, um emoji que o bot não alcança faz o Discord recusar o painel inteiro.

Antes de abrir o formulário o bot confere o canal do portfólio (existe, e o bot pode ver,
enviar e **anexar arquivos**): o modal não guarda nada se o envio falhar. O
`/ticket-sistema diagnostico` confere o mesmo, e acusa painel publicado sem destino.

> Publicou com erro? Apague a mensagem no canal e publique de novo pelo painel. O bot não
> guarda os posts — cada um é uma mensagem independente.

### Entrega do produto

```
Dentro do ticket  →  /entregar
        ↓
Formulário  →  cliente (select), arquivo do produto, observações (opcional)
        ↓
Enviar  →  cartão com o arquivo no ticket
           + a mesma entrega na DM do cliente
           + o pedido pago do atendimento vira ENTREGUE
           + a demanda vai para #demandas-concluidas
           + o ticket vai para #concluidos (arquivado, ainda aberto)
        ↓
Cliente toca "Confirmar recebimento"  →  ticket fecha + pedido CONCLUÍDO
```

**O comando só funciona dentro de um ticket** e não tem opção nenhuma: o atendimento vem
do canal, e o resto está no formulário. Quem entrega é a **equipe** (a mesma permissão de
"Marcar como Entregue" no painel do pedido).

**Tudo o que pode dar errado é conferido antes do formulário**: permissão, ticket aberto e
as permissões do bot no canal (ver, escrever no tópico e **anexar arquivos**). O modal do
Discord não guarda nada quando o envio falha — descobrir depois de anexar 80 MB que o
ticket estava fechado custaria o formulário e o upload junto.

**O arquivo é reenviado pelo bot**, pelo mesmo motivo do portfólio: a URL do formulário é
assinada e expira em poucas horas. O formato é lido **dos bytes** (ZIP, RAR ou 7Z) — um
`.zip` que na verdade é RAR chega ao cliente com a extensão certa, e uma imagem renomeada é
recusada antes de virar uma "entrega" que não abre.

**Tamanho: os mesmos dois caminhos do portfólio** — anexo enquanto cabe no nível de
impulsos do servidor, Worker da Cloudflare acima disso (até 95 MB), com botão de download
no cartão. A transferência entra na **mesma fila** dos renders de lobo: o arquivo é baixado
inteiro e copiado no envio, e dois desses em paralelo estouram os 512 MB em que o PM2
reinicia o processo.

> **A DM tem outro teto.** Fora do servidor não existe nível de impulsos: a DM aceita
> sempre 20 MiB. Um pacote de 50 MB entregue num servidor nível 2 vai como anexo no ticket
> e a DM sai **sem o arquivo**, dizendo onde ele está e com o botão para voltar ao
> atendimento. Quando o arquivo foi hospedado, o botão de download resolve os dois casos.

**A ordem das três coisas não é arbitrária:** primeiro o arquivo chega ao cliente, depois a
cópia na DM, por último o pedido muda de estado. É a ordem que sobrevive a uma falha no
meio — um pedido marcado ENTREGUE sem entrega seria mentira no histórico, enquanto uma
entrega feita com o pedido ainda em produção é só um clique que faltou. Por isso DM fechada
e pedido que recusa a transição **não derrubam a entrega**: viram aviso no retorno efêmero
para quem entregou.

#### Depois da entrega: o ticket vai para os concluídos

O pedido era **mover o tópico** para `#concluidos`, e o Discord não move tópico — ele
pertence para sempre ao canal onde nasceu. Então, na entrega:

1. o tópico é **arquivado**: sai da lista de tickets ativos, mas **não fecha**;
2. um cartão em `#concluidos` aponta para ele, com cliente, atendente, pedido e quem
   entregou.

Se o cliente responder, o tópico **reabre sozinho** e volta para a lista de ativos — dá para
reclamar de arquivo com defeito no mesmo atendimento.

> **Sem cartão, não arquiva.** Se o canal de concluídos não estiver configurado (ou a
> publicação falhar), o tópico fica onde está. Arquivar sem o cartão faria um atendimento
> aberto sumir da lista sem nada apontando para ele.

**O cliente acha o ticket entregue pelo canal de entregas.** Com o tópico arquivado, ele some
da lista lateral do cliente também. O canal configurado em `/demandas canais localizador:`
tem o painel **"Localizar minha entrega"**, e cada cliente passa a vê-lo na entrega e deixa de
ver quando a última entrega dele é confirmada. Ele **só lê**: escrever, reagir e abrir tópico
ficam negados, senão o canal viraria um chat em que um cliente lê o outro. O painel sai junto
com os outros em `/ticket-painel localizadores`.

> **Dois canais, públicos opostos.** Os cartões de `tickets` mostram cliente, pedido e
> atendente de cada venda, e são **só da equipe**. O `localizador` é dos **clientes**. O bot
> recusa que os dois sejam o mesmo canal, tanto no comando quanto na hora de liberar o acesso,
> porque cada cliente veria as vendas dos outros.

**Quem fecha é o cliente.** O cartão da entrega ganha o botão **"Confirmar recebimento"**, que
só o dono do ticket consegue usar. Ao tocar, o ticket fecha pelo fluxo de sempre (transcript,
log, DM de encerramento com avaliação) e o pedido vira **concluído**. O cartão em
`#concluidos` passa a dizer *"concluído pelo cliente"*. A equipe continua podendo fechar pelo
"Finalizar" — e aí o cartão registra *"encerrado pela equipe, o cliente não chegou a
confirmar"*, porque isso é informação.

> **Fechar um tópico arquivado.** O Discord só aceita editar um tópico arquivado se a própria
> edição o desarquivar. O fechamento trancava direto, a recusa virava só um aviso no log, e o
> ticket fechava no banco com o tópico **destrancado** — qualquer mensagem do cliente reabria
> um atendimento encerrado. Isso já acontecia com ticket parado 7 dias (o Discord arquiva
> sozinho); com o arquivamento na entrega, passaria a ser o caso de todo ticket entregue. Agora
> o fechamento reabre o tópico antes de trancar.

**O pedido marcado é o do canal**: mesmo atendimento, mesmo cliente, status `PAID` ou
`IN_PROGRESS`. Não existe busca de reserva por "qualquer pedido pago desse cliente" — um
pedido de outra venda, aberto em outro ticket, seria fechado por uma entrega que não é
dele. Sem candidato, a entrega acontece do mesmo jeito e o painel do pedido continua lá.

**O cartão leva um botão para o canal de avaliações**, quando ele está configurado em
`/ticket-config geral → Canais`. Sem canal configurado o convite simplesmente não entra:
um botão de link sem URL é recusado pela API e derrubaria a mensagem inteira.

### Quadro de demandas

```
Pagamento aprovado  →  cartão no canal do quadro
        ↓  equipe clica em "Iniciar demanda"
cópia no canal de iniciadas  +  DM ao cliente  +  cartão do quadro reescrito
        ↓  "Marcar entregue" / "Concluir"
os dois cartões acompanham até o fim
```

**Demanda é pedido pago.** O cartão nasce quando o pagamento é aprovado, não quando o
pedido é criado — antes disso não há trabalho a fazer. É por isso que o quadro é separado
do `orderChannelId`: aquele avisa que uma venda começou (e o pedido pode nem estar pago).

**Configuração (uma vez, administrador):**

```bash
/demandas canais quadro:#demandas iniciadas:#demandas-iniciadas
/demandas sincronizar
```

O `sincronizar` existe para o primeiro dia: sem ele o quadro nasceria vazio e só mostraria
as vendas seguintes — as que já estão em produção, que são justamente as que precisam de
acompanhamento, ficariam de fora para sempre. Ele publica em lotes de 20 e é idempotente
(a consulta só traz demanda sem cartão).

**O cartão responde sem ninguém abrir nada:** o total, o número do pedido, o cliente, o
prazo (e se ele já venceu), quem está cuidando, **o que produzir** e um botão que leva
direto ao ticket do cliente, com o número do atendimento no rótulo.

> **O que produzir** vem dos itens quando a venda saiu do catálogo, e da **descrição da
> cobrança** quando saiu do balcão (`/pagamento criar`, que nasce sem pack). Sem essa
> segunda fonte, toda venda feita dentro de um ticket viraria um cartão que não diz o que
> fazer.

**Os botões são os do estado atual** — pago oferece iniciar e assumir; em produção oferece
marcar entregue e liberar; entregue oferece concluir. Um botão que só sabe responder "essa
transição não vale agora" ensina a equipe a ignorar o cartão.

Eles **não são handlers próprios**: são os mesmos do painel de pedidos. Clicar num deles a
partir do cartão público abre o painel efêmero do pedido, porque o helper de painel
responde de forma nova quando a origem não é efêmera. Duplicar os handlers só criaria dois
caminhos para a mesma transição, e um deles envelheceria.

**O cartão do quadro não some quando a demanda inicia** — é reescrito, e a cópia vai para o
canal de iniciadas. Os dois canais contam histórias diferentes: um mostra tudo que entrou,
o outro só o que está em produção agora.

**Na entrega, o cartão MUDA de canal** — ao contrário do início, em que ganha cópia. Ele sai
de "iniciadas" e passa a viver em `#demandas-concluidas`, porque "iniciadas" só mostra o que
está em produção agora. O cartão do quadro continua lá, marcado como entregue e depois como
concluído. A ordem protege a demanda de sumir: primeiro publica no canal novo, só depois
apaga o antigo. Sem canal de concluídas, o cartão de iniciadas **fica**.

**Atualizar o quadro é responsabilidade de quem muda o estado**, não dos botões do quadro.
A mesma transição pode vir do cartão, do painel efêmero, da fila de produção ou do
`/entregar` — se só os botões do quadro atualizassem o cartão, qualquer mudança feita em
outra tela o deixaria mentindo.

**Nada disso derruba uma operação comercial.** Canal apagado, permissão faltando, DM
fechada ou mensagem removida viram `WARN` e seguem: o pedido já mudou de estado no banco
quando o quadro é atualizado, e trocar o registro pelo enfeite seria o pior dos dois
mundos. Publicar e iniciar são **idempotentes** — o recovery reprocessa pagamentos que
ficaram pela metade, e "pegar a próxima" e "iniciar demanda" chegam pelo mesmo caminho.

### Dinheiro

Todo valor monetário é **inteiro em centavos**. Nenhum cálculo usa `float`.

O campo de valor aceita `250`, `250,00`, `250.00`, `R$ 250,00`, `1.250,50` e `1,250.50`.
Agrupamento de milhar é validado: `1.2.3,45` é **recusado** em vez de virar R$ 123,45.

> Vírgula seguida de exatamente 3 dígitos é lida como separador de milhar
> (`10,555` = R$ 10.555,00), seguindo a convenção brasileira. O vendedor confere o
> total no painel de confirmação antes de gerar a cobrança.

---

## Execução em produção

### PM2

```bash
npx pm2 start ecosystem.config.js
```

```bash
npx pm2 logs vook-store-bot
```

```bash
npx pm2 restart vook-store-bot
```

Configuração: `autorestart`, `max_memory_restart: 512M`, backoff progressivo entre
reinícios e `kill_timeout` de 15s para o encerramento gracioso terminar.

Para iniciar junto com o Windows:

```bash
npx pm2 save
```

### Scripts Windows

| Arquivo | Função |
|---|---|
| `start-bot.bat` | Instala dependências, gera o Prisma Client, compila e sobe no PM2 |
| `stop-bot.bat` | Para **somente** o processo `vook-store-bot` |
| `monitor-bot.bat` | Menu: status, logs, últimas linhas, painel, restart, erros |

> `stop-bot.bat` nunca executa `pm2 kill` — outros processos PM2 da máquina ficam intactos.

### ShardCloud

```bash
npm run pack:shardcloud
```

Gera `pacotes/vook-store-shardcloud.zip`, que é enviado no painel da ShardCloud. O zip leva
`.shardcloud`, `package.json`, `dist/` (compilado na hora, numa pasta à parte — o `dist/` do
PC não é tocado), `prisma/`, `assets/` e `scripts/iniciar-shardcloud.mjs`. Ficam de fora
`.env`, `node_modules`, `package-lock.json`, `backups/`, `logs/`, `src/` e `tests/`.

Na plataforma, o `CUSTOM_COMMAND` roda `scripts/iniciar-shardcloud.mjs`, que faz
`prisma generate` (o motor do Prisma é por sistema operacional; o do Windows não roda no
Linux), `prisma migrate deploy` e carrega o bot **no mesmo processo** — assim o `SIGTERM`
de parada chega ao bot e o encerramento gracioso roda.

Variáveis no painel (não no zip): as mesmas do `.env`, com duas diferenças:

| Variável | Valor na ShardCloud |
|---|---|
| `DATABASE_URL` | String do PostgreSQL gerenciado, com `sslmode=require` (a plataforma só aceita SSL) |
| `BACKUP_ENABLED` | `false` — não há `pg_dump` lá; use o backup do banco no painel |

> **Nunca deixe o bot no ar no PC e na ShardCloud ao mesmo tempo.** Com o mesmo token, cada
> clique é processado duas vezes, inclusive aprovação de pagamento. Na virada: `stop-bot.bat`,
> copiar o banco (`pg_dump` → `pg_restore` no banco novo), e só então subir na ShardCloud.

`npm run deploy:commands` continua rodando do PC, apontando para o mesmo `DISCORD_TOKEN`.

### Encerramento gracioso

`SIGINT`/`SIGTERM` disparam: marcar shutdown → parar schedulers → limpar cache →
desconectar Prisma → destruir o cliente Discord → sair.

---

## Scripts disponíveis

| Script | O que faz |
|---|---|
| `npm run dev` | Desenvolvimento com recarga (`tsx watch`) |
| `npm run build` | Compila `src/` para `dist/` |
| `npm start` | Executa `dist/index.js` |
| `npm test` | Suíte completa (Vitest) |
| `npm run test:watch` | Testes em modo watch |
| `npm run lint` | ESLint com `--max-warnings=0` |
| `npm run typecheck` | Type-check de `src`, `scripts` e `tests` |
| `npm run deploy:commands` | Registra os slash commands |
| `npm run prisma:generate` | Gera o Prisma Client |
| `npm run prisma:migrate:dev` | Cria migração (desenvolvimento) |
| `npm run prisma:migrate:deploy` | Aplica migrações (produção) |
| `npm run prisma:studio` | Interface visual do banco |
| `npm run pack:shardcloud` | Gera o zip de upload para a ShardCloud |

---

## Arquitetura

```
Interaction
    ↓
InteractionRouter        (roteia por namespace:action do customId)
    ↓
Handler                  (fino: valida alvo, delega, responde)
    ↓
Service                  (regra de negócio, locks, transações)
    ↓
Repository               (acesso a dados)
    ↓
Prisma / PostgreSQL
```

```
src/
├── commands/       slash commands (config, coupons, payments, system)
├── components/     camada Components V2 (v2.ts) e respostas (reply.ts)
├── constants/      identidade visual, customIds, limites
├── core/           cache, client, database, errors, locks, logger,
│                   permissions, scheduler
├── events/         interactionCreate, channelDelete, guildMemberAdd, …
├── interactions/   router + handlers por módulo
├── modules/        audit, configuration, coupons, payments, reviews,
│                   system, tickets, welcome
│                   └── cada um: builders / repositories / services / types
├── types/          contratos compartilhados
└── utils/          discord, html, money, sanitize, stringify, time
```

### Componentes persistentes

Todo componente é roteado por `namespace:action[:args]` — nunca por *collector*.
Isso significa que **botões continuam funcionando depois de reiniciar o bot**.

O `customId` **nunca** é autorização: ele só identifica o alvo. Toda ação revalida a
entidade e a permissão no banco.

### Cache

O PostgreSQL é sempre a fonte de verdade. O cache guarda configuração da guild,
categorias, equipes, cupons e contas PIX. Toda escrita segue
`banco → commit → invalidação/atualização do cache`.

### Auditoria

`TicketAuditLog`, `PaymentAuditLog` e `CouponAuditLog` registram ator, alvo, valores
antigo/novo e metadados. Falha ao gravar auditoria **nunca** derruba a operação
principal — vira `WARN`.

### Logs e segredos

Logger estruturado com níveis `DEBUG`/`INFO`/`WARN`/`ERROR`/`AUDIT` e contexto
(`guildId`, `channelId`, `userId`, `entityType`, `entityId`).

Token, `DATABASE_URL`, senhas e headers de autorização são mascarados antes de
qualquer log ou persistência. Erros de infraestrutura (Prisma, SQL, stack trace)
**nunca** chegam ao usuário: ele recebe apenas a mensagem segura do `AppError`.

#### Recusa de regra × defeito

Cada classe de erro declara a própria natureza em `AppError.expected`, e é ela — não
uma lista no tratador — que decide o destino:

| | Log | `system_error_logs` | Alerta no canal |
|---|---|---|---|
| **Recusa de regra** (estado, permissão, limite, validação) | `WARN`, sem stack | não | não |
| **Defeito** (`ConfigurationError`, `DiscordResourceError`, erro cru) | `ERROR` com stack | sim | sim |

A linha é: *o pedido foi recusado por uma regra* contra *o bot não conseguiu cumprir um
pedido válido*. Um botão que continua clicável depois de a ação já ter sido feita — aprovar
uma cobrança já aprovada, assumir um ticket que alguém acabou de assumir, avaliar duas
vezes — é caminho **normal**, e o segundo clique é esperado.

> Isso já custou caro: enquanto a decisão era uma lista de quatro classes dentro do
> tratador, as outras doze caíam no ramo de falha. Um clique duplo em "Aprovar" virava
> alerta no canal de erros para o dono da loja, sem nada para consertar. Alerta que ninguém
> pode resolver ensina a ignorar o canal — e aí o alerta que importa passa despercebido.

Classe nova nasce como **defeito** (padrão `false`): ruído visível é melhor que defeito
silencioso. Uma varredura estática do fonte, em `tests/classificacao-de-erros.test.ts`,
obriga toda subclasse a escrever a decisão.

---

## Banco de dados

### Modelos

`GuildConfig`, `GuildCounter`, `TicketCategory`, `TicketTeamRole`, `Ticket`,
`TicketParticipant`, `TicketTransfer`, `TicketAuditLog`, `TicketReview`,
`PaymentAccount`, `Payment`, `PaymentAuditLog`, `Coupon`, `CouponUsage`,
`CouponAuditLog`, `CatalogCategory`, `CatalogPack`, `CatalogPackDetail`,
`PackImage`, `Cart`, `CartItem`, `Order`, `OrderItem`, `OrderAuditLog`,
`CatalogAuditLog`, `SystemErrorLog`.

### Enums

`TicketStatus`, `TicketPriority`, `TicketAuditAction`, `PaymentStatus`,
`PaymentAuditAction`, `PaymentSource`, `PixKeyType`, `CouponType`,
`CouponAuditAction`, `OrderStatus`, `CartStatus`, `OrderAuditAction`,
`CatalogAuditAction`, `SystemLogLevel`.

### Constraints que sustentam as garantias

| Constraint | Garante |
|---|---|
| `Ticket UNIQUE (guildId, ticketNumber)` | Numeração sequencial sem colisão |
| `Ticket UNIQUE (channelId)` | Um ticket por canal |
| `TicketReview UNIQUE (ticketId)` | Uma avaliação por ticket |
| `CouponUsage UNIQUE (paymentId)` | Uso de cupom contado uma única vez |
| `Coupon UNIQUE (guildId, code)` | Código único por servidor |
| `TicketParticipant UNIQUE (ticketId, userId)` | Sem participante duplicado |
| `TicketCategory UNIQUE (guildId, identifier)` | Identificador único por servidor |
| `PaymentAccount UNIQUE (guildId, identifier)` | Conta única por servidor |
| `Order UNIQUE (guildId, orderNumber)` | Numeração de pedidos sem colisão |
| `Order UNIQUE (paymentId)` | Uma cobrança atual por pedido |
| `Cart UNIQUE (guildId, activeCustomerId)` | Um carrinho ativo por cliente |
| `CartItem UNIQUE (cartId, packId)` | Pack digital nunca duplica no carrinho |
| `OrderItem UNIQUE (orderId, packId)` | Item não duplica no pedido |
| `CatalogPack UNIQUE (guildId, sku)` | SKU único por servidor (NULL permitido) |
| `CatalogPack UNIQUE (guildId, slug)` | Identificador de produto único por servidor |

### Índice da fila

```
Ticket (guildId, categoryId, status, claimedById, priority, ticketNumber)
```

Cobre exatamente a consulta de posição na fila.

### Exclusões

Categorias, cupons, contas PIX, packs e categorias do catálogo usam **soft-delete**
(`deletedAt`), porque registros históricos apontam para eles. Recriar um
identificador/código já excluído **revive** o registro com os novos termos, preservando o
histórico ligado a ele.

Pack excluído sai da vitrine e dos carrinhos abertos, mas continua em todos os pedidos já
emitidos, com nome, SKU e preço fotografados na compra.

---

## Testes

```bash
npm test
```

Cobertura atual: **1366 testes**, incluindo

- **PIX** — TLV, CRC-16/CCITT-FALSE (vetor `123456789` → `29B1` e exemplo oficial do BCB),
  formato do valor, limites de 25/15/25, validação de CPF/CNPJ/e-mail/telefone/UUID
- **Cupons** — percentual, valor fixo, teto de desconto, valor mínimo, limites de uso,
  arredondamento em centavos, cupom expirado/desativado/de outra guild
- **Transcript** — escape de HTML, `<script>`/`onerror`/`javascript:`, links com query string
- **Avaliações** — privacidade da publicação, botões, modal opcional
- **Catálogo** — galeria circular, contador `Imagem X de Y`, pack sem imagem/sem preço,
  paginação, limites reais do Discord (10 filhos, 4000 caracteres, 25 opções)
- **Carrinho** — duplicação bloqueada, corrida no `UNIQUE`, preço sempre atual,
  item indisponível marcado, remoção restrita ao próprio carrinho
- **Pedidos** — numeração atômica, snapshot de preço, duplo clique, transições de estado,
  sincronização idempotente com a cobrança aprovada/expirada/cancelada
- **Integração financeira** — o pedido cobra pelo mesmo `PaymentService` de `/pagamento`,
  e uma varredura do fonte prova que o catálogo não tem gateway nem configuração própria
- **Arte do QR** — detecção do quadrado branco, escala inteira sem interpolação, e o QR
  da imagem final é **decodificado** e comparado com o payload PIX
- **Comprovante** — leitura de valor/data em formatos reais de banco, data impossível
  descartada, comprovante anterior à cobrança sinalizado, dúvida virando "não consegui
  conferir" em vez de acusação, e a garantia de que **nenhum caminho aprova o pagamento**
- **Entrega do produto** — o arquivo sai do bot e nunca da URL do formulário, o pedido só é
  marcado depois de o arquivo ter saído, a DM respeita o próprio teto de 20 MiB, o formato
  vem dos bytes, e **nenhuma falha da DM** (fechada, 500 do Discord, rede caindo, envio
  cancelado) derruba uma entrega que já aconteceu
- **Quadro de demandas** — publicar e iniciar são idempotentes (o recovery reprocessa
  pagamentos pela metade), o cartão do quadro é reescrito e não apagado ao iniciar, o cartão
  diz o que produzir mesmo numa venda sem itens, e nenhuma falha de canal ou DM vira erro
- **Conclusão da entrega** — sem cartão em `#concluidos` o tópico não é arquivado, o cartão de
  iniciadas só some depois de a demanda estar nas concluídas, tópico arquivado é reaberto antes
  de ser trancado no fechamento, e só o dono do ticket confirma o recebimento
- **Localizador de entregas** — o canal dos clientes nunca é o dos cartões da equipe (recusa no
  comando e na hora de dar acesso), o cliente só lê o canal, e o acesso sai quando a última
  entrega pendente fecha
- **Classificação de erro** — recusa de regra não vira alerta nem linha em
  `system_error_logs`; configuração e recurso do Discord continuam virando; e uma varredura
  do fonte obriga toda classe de erro nova a declarar a própria natureza
- **Roteamento** — todo `customId` emitido tem handler, e todo handler é alcançável
- **Segurança** — `@everyone`/`@here`, caracteres de controle, path traversal,
  URL insegura, nome de canal inválido, `customId` adulterado, pedido de outro cliente,
  ausência de qualquer campo de cupom nas telas do cliente
- **Núcleo** — dinheiro em centavos, locks, cooldowns, cache, mascaramento de segredos

---

## Backup e recuperação

### Backup

```bash
pg_dump -U usuario -d vookstore -F c -f backup-vookstore.dump
```

### Restauração

```bash
pg_restore -U usuario -d vookstore --clean backup-vookstore.dump
```

Recomendado: backup diário automático. Todo o estado do bot vive no PostgreSQL —
não há dado crítico apenas em memória.

### Recovery automático

No startup, o bot verifica e corrige:

- tickets presos em `CREATING` (sem canal → removidos; com canal → promovidos a `OPEN`)
- tickets presos em `CLOSING` (canal já apagado → `CLOSED`; canal existe → devolvidos ao atendimento)
- tickets ativos cujo canal não existe mais → `ORPHANED` (e saem da fila)
- cobranças `PENDING` vencidas → `EXPIRED`, com o cartão atualizado
- painel público apagado enquanto o bot estava offline → republicado

Os jobs `PaymentExpirationJob` (1 min), `RecoveryJob` (15 min) e `MaintenanceJob`
(5 min) continuam essa manutenção durante a operação. Não existe timer por cobrança.

---

## Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `DISCORD_TOKEN nao definido` | `.env` ausente ou incompleto | Preencha o `.env` |
| `Authentication failed against database server` | Credenciais do `DATABASE_URL` | Corrija usuário/senha |
| `Can't reach database server` | PostgreSQL parado | Inicie o serviço |
| Comandos não aparecem | Comandos não registrados | `npm run deploy:commands` |
| Comandos globais demoram | Propagação do Discord | Use `DISCORD_GUILD_ID` |
| Boas-vindas não disparam | Falta *Server Members Intent* | Ative no Developer Portal |
| Transcript sem texto | Falta *Message Content Intent* | Ative no Developer Portal |
| Auto-role não aplica | Hierarquia ou cargo gerenciado | Suba o cargo do bot; veja `/ticket-sistema diagnostico` |
| "Categoria sem equipe responsável" | Categoria sem cargo | `/ticket-equipe configurar` |
| Avaliação não publicada | Canal ausente/sem permissão | Configure em `/ticket-config geral`; a avaliação continua salva |
| Cobrança não gerada | Nenhuma conta PIX ativa | `/config-pagamento gerenciar` |
| Botão não responde | Painel antigo após mudança de rota | `/ticket-painel atualizar` |

Comece sempre por:

```bash
npx pm2 logs vook-store-bot --err --lines 100
```

E, dentro do Discord, por `/ticket-sistema diagnostico`.

---

## Atualização

```bash
npx pm2 stop vook-store-bot
```

```bash
npm install
```

```bash
npm run prisma:generate
```

```bash
npm run prisma:migrate:deploy
```

```bash
npm run build
```

```bash
npx pm2 restart vook-store-bot
```

Se comandos foram adicionados ou alterados, rode `npm run deploy:commands`.

---

## Decisões técnicas

Pontos onde havia mais de um caminho razoável e a escolha foi deliberada:

- **Prisma 6 (e não 7)** — série madura, `prisma-client-js` sem exigir driver adapter.
- **Sem *path aliases*** — `tsc` não reescreve caminhos; aliases quebrariam `node dist/index.js`.
- **Posição da fila derivada** — nenhuma coluna `queuePosition` para desincronizar.
- **Rascunho de cobrança em memória** — o rascunho existe só entre o comando e o
  "Gerar cobrança"; nada foi persistido ainda, então perdê-lo num restart não perde dado.
- **Botões no cartão de cobrança** — ficam visíveis para o cliente, mas cada clique
  revalida `assertCanManagePayments`; o cliente nunca consegue aprovar ou alterar.
- **Categoria sem equipe bloqueia abertura** — sem cargo responsável, ninguém veria o
  canal; falhar cedo é melhor que criar um ticket invisível.
- **Cliente pode fechar o próprio ticket** — decisão de UX; a equipe e a administração
  também podem.
- **BR Code com campo `01 = 12`** (uso único) — coerente com uma cobrança que expira.
  Alguns geradores usam `11` (estático reutilizável); ambos são aceitos pelos bancos.
- **`ttlMs <= 0` no cache não guarda nada** — tratar TTL inválido como "guardar para
  sempre" seria o pior padrão possível.
- **Soft-delete com *revive*** — recriar um código excluído reaproveita o registro em
  vez de duplicar histórico.

---

## Licença

Uso interno da Vook Store.
