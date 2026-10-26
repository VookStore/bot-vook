# Sugestões — 03/09/2026

**Tema:** validar o que existe antes de abrir superfície nova
**Autor:** Roberto (sem acesso ao código, banco ou logs — ver "Suposições" no fim)
**Contexto do pedido:** primeira rodada de sugestões para o bot da Vook Store

---

## Resumo em uma linha

O sistema está grande e testado, mas só o backup rodou em produção de verdade.
A recomendação principal é **não construir recurso novo agora** — e sim fechar
três buracos que já estão abertos.

---

## Por que "não construa nada" é a resposta principal

Você tem 19 comandos, 7 rotinas, 27 tabelas e ~1000 testes. Disso, **um item
tem confirmação de produção: o backup.** Todo o resto está numa categoria
específica e perigosa — *parece pronto*.

Isso conflita direto com duas coisas que você mesmo estabeleceu:

- **Convenção 7 — "falha silenciosa é o inimigo."** Um recurso que nunca rodou
  em produção é, por definição, uma falha silenciosa em potencial: você não sabe
  se ele funciona, e não vai saber até um cliente real passar por ele.
- **"Um recurso pela metade vale menos que zero, porque parece pronto."** Você
  escreveu isso sobre features. Vale igual para features inteiras não validadas.

Adicionar recurso novo agora aumenta a superfície não-validada. O trabalho de
maior valor é converter "testado" em "confirmado".

---

## Sugestão 1 — Terminar a fila de produção por vencimento

**Prioridade: alta. É a única das três que envolve escrever código.**

### O problema hoje

A data de vencimento **é gravada e é exibida** — mas nenhuma listagem ordena por
ela. Na prática isso significa que o bot te dá a informação de um pedido por vez,
e nunca responde à pergunta que importa na segunda-feira de manhã:

> "O que vence primeiro?"

### O que acontece hoje sem isso

Você continua gerenciando prazo de cabeça, ou numa anotação paralela ao bot.
Duas consequências:

1. **A anotação paralela e o banco divergem.** O bot vira fonte de verdade
   parcial, que é pior que não ser fonte de verdade nenhuma.
2. **Você descobre o atraso pelo cliente.** O pedido vence, ninguém percebe, e a
   primeira notificação é uma DM perguntando "e aí, saiu?". Isso é exatamente o
   modo de falha que a convenção 7 existe para evitar.

E tem o agravante do "pela metade": porque a data aparece na tela, o sistema
comunica que existe controle de prazo. Não existe. Ele mostra a data e não faz
nada com ela.

### O que a sugestão é

Uma listagem — comando ou painel — que devolve os pedidos em produção
**ordenados por vencimento, do mais próximo para o mais distante**, com o
estado de cada um.

Elementos que fazem diferença:

| Elemento | Por quê |
|---|---|
| Ordenar ascendente por vencimento | É a pergunta que se quer responder |
| Filtrar por status ativo (`PAID`, `IN_PROGRESS`) | Pedido entregue não é fila |
| Marcar vencido / vence hoje **por texto**, não por cor | Convenção 1 |
| Mostrar categoria junto | Prazo de Cabelos ≠ prazo de PED |

### Custo

Baixo. É **leitura sobre campos que já existem**. Não cria tabela, não muda o
ciclo do pedido, não toca em dinheiro, não toca em permissão de canal.

### Risco

Quase nulo — operação de leitura. Os dois pontos a cuidar:

- **Permissão.** É informação de operação, não de cliente. Pela convenção 4, a
  checagem tem que estar no código, não só na configuração do Discord.
- **Paginação.** Se a lista crescer além do limite de embed do Discord, precisa
  cortar. Enquanto a loja é pequena, provavelmente não é problema — mas é um
  limite que aparece de repente, não gradualmente.

### Como saber que funcionou

Um pedido com vencimento no passado aparece no topo da lista, marcado como
vencido, sem você ter precisado procurar.

---

## Sugestão 2 — Publicar o Worker e testar o transcript ponta a ponta

**Prioridade: alta. Não é código novo — é validação de algo já construído.**

### O problema hoje

A rota dos anexos do Worker ainda não está publicada. Enquanto isso, o
fechamento de ticket é um processo que termina educadamente e falha depois:

1. Ticket fecha
2. Cliente recebe o link do transcript
3. Cliente abre — e vê imagem quebrada

E aqui entra um limite que você já descobriu:

> **URL de anexo do Discord expira em poucas horas.**

O re-hospedamento de anexos existe justamente por causa disso. Ou seja: **a
parte do transcript que mais precisa ser provada é a que ainda não está no ar.**
Pior, o sintoma é atrasado — o link funciona logo depois de fechar o ticket e
quebra algumas horas depois. É o tipo de bug que só aparece com o tempo passando,
e por isso **teste automatizado não pega**. Precisa ser teste com relógio real.

### O que acontece hoje sem isso

Todo ticket fechado gera um link que vai apodrecer. E como transcript é
"acessório" pela convenção 3, uma falha nele **não derruba nada** — o ticket
fecha, a venda acontece, e ninguém é avisado. Perfeito para o negócio, péssimo
para descobrir o problema. É falha silenciosa por construção.

### O que a sugestão é

Publicar o Worker e rodar um roteiro de validação manual:

- [ ] Abrir um ticket de teste
- [ ] Anexar **uma imagem** (jpg/png)
- [ ] Anexar **um arquivo que não é imagem** (zip, pdf, .blend — o que aparece
      na prática)
- [ ] Trocar algumas mensagens, para o transcript ter conversa de verdade
- [ ] Fechar o ticket
- [ ] Abrir o link **na hora** → tudo carrega?
- [ ] Abrir o mesmo link **no dia seguinte** → tudo ainda carrega?
- [ ] Abrir o link numa aba anônima → não depende de estar logado no Discord?

O item do dia seguinte é o único que realmente prova o re-hospedamento. Os
outros provam que a página existe.

### Custo

Nenhum desenvolvimento previsto — deploy mais ~15 minutos de teste manual,
divididos em dois dias.

### Risco

O risco é o teste **encontrar** um problema, e aí virar trabalho. Mas é melhor
encontrar num ticket de teste do que num cliente.

Um ponto que eu não consigo confirmar daqui: **se o re-hospedamento falhar, isso
grita em algum lugar?** Pela convenção 3 ele não pode derrubar o fechamento —
correto. Mas pela convenção 7 ele precisa avisar. As duas convivem: falha vira
alerta, não exceção. Se hoje ele só engole o erro, isso é uma correção pequena
e vale fazer junto. **Precisa conferir no código.**

---

## Sugestão 3 — Fechar as duas decisões de configuração

**Prioridade: alta, esforço quase zero. Não é código — é decisão sua.**

São dois campos parados que têm efeito direto em dinheiro e em promessa ao
cliente.

### 3a. Prazo de produção da categoria Cabelos

A previsão de entrega é **congelada no pagamento** e contada em dias úteis. Sem
o prazo definido para Cabelos, uma de duas coisas acontece — e eu não sei qual,
**precisa conferir no código**:

- ou a previsão não é exibida (cliente sem promessa nenhuma),
- ou cai num valor padrão que ninguém escolheu (cliente com promessa que você
  não fez).

O segundo caso é o ruim: você fica devendo uma data que o sistema inventou.

Como Cabelos é o carro-chefe da tabela (R$ 90 a R$ 110, e é onde entram cores
adicionais, cílios, 2-em-1), esse é o prazo que mais aparece.

### 3b. Marcar as categorias que não dão desconto de booster

A tabela é explícita:

> Boosters ganham 5% (1 boost) ou 10% (2 boosts). **Não vale para PEDs, roupas
> e props.**

E existe um limite conhecido que torna isso mais delicado:

> **Cupom não filtra por categoria. Desconto é do pedido inteiro ou de nada.**

Ou seja: a exclusão **não pode ser resolvida pelo cupom** — ela tem que ser
resolvida antes, na decisão de aplicar ou não o cupom naquele pedido.

O dinheiro em jogo, se estiver aplicando quando não devia:

| Item | Preço | 10% |
|---|---|---|
| PED com runas | R$ 200,00 | R$ 20,00 |
| PED de Lobo | a partir de R$ 180,00 | R$ 18,00+ |
| Props / pelúcias | R$ 40,00 cada | R$ 4,00 |

Não é catastrófico por pedido. Mas é silencioso, recorrente, e sai sem você ver.

**A pergunta que importa e que eu não consigo responder daqui:** qual é o
comportamento padrão quando a categoria **não** está marcada?

- Se o padrão é **não aplicar** o desconto → o sistema erra a favor da loja, o
  booster reclama, você descobre. Chato, mas visível.
- Se o padrão é **aplicar** → o sistema erra contra a loja, ninguém reclama, e
  você nunca descobre. **Falha silenciosa clássica.**

Vale conferir isso no código antes de qualquer outra coisa deste item. Se o
padrão for "aplicar", eu inverteria — recusar por omissão é o lado seguro.

E tem o caso misto, que também precisa de resposta: **um pedido com um cabelo e
um PED junto.** Como o cupom é tudo-ou-nada, o desconto vai no pedido inteiro
(incluindo o PED) ou em nada (penalizando o cabelo). Precisa haver uma regra
escolhida por você, não emergente do código.

---

## Não é tarefa, mas prepare: o primeiro boost real

Isto não entra na lista porque **você não controla quando acontece**. Mas é
evento de uma chance só.

O limite conhecido:

> **O Discord não informa quantos boosts um membro tem.** Só `premium_since`.
> A contagem só existe na mensagem de sistema publicada no momento do boost.

Se a leitura dessa mensagem falhar — formato diferente, idioma diferente,
mensagem em outro formato que o Discord decidiu usar — e o código só tentar
interpretar e desistir, **a informação some para sempre.** Não dá para voltar
no tempo e reler.

**Precaução barata:** garantir que a mensagem de sistema crua fique registrada
em algum lugar (log ou canal de alertas) *antes* de tentar interpretar. Assim,
se a leitura falhar, você tem o texto real em mãos para ajustar o parser — em
vez de ficar esperando o próximo booster aparecer.

**Não sei se isso já existe. Precisa conferir no código.** Se já existir, ótimo,
ignore. Se não existir, é uma linha e vale fazer antes do primeiro boost, não
depois.

---

## Discordância registrada

**Não ligue a retenção de transcripts agora.**

Se em algum momento a ideia aparecer — e ela aparece, porque está na lista como
"desligada por escolha" e coisa desligada incomoda —, a ordem certa é o
contrário:

1. Retenção **apaga** coisa. É irreversível.
2. Você ainda não confirmou que os transcripts estão sendo gerados
   corretamente (ver Sugestão 2).
3. Ligar apagamento automático sobre um sistema não validado é a combinação com
   pior desfecho possível: perder o que talvez já estivesse errado, sem cópia.

Retenção é a **última** coisa a ligar. Depois que os transcripts rodarem em
produção por um tempo e você souber que estão certos, aí faz sentido.

---

## Ordem sugerida de execução

| # | Item | Tipo | Esforço | Depende de |
|---|---|---|---|---|
| 1 | Decidir prazo de Cabelos | Decisão | minutos | — |
| 2 | Marcar categorias sem desconto + conferir o padrão | Decisão + conferir | minutos | — |
| 3 | Publicar o Worker | Deploy | curto | — |
| 4 | Testar transcript (dia 1) | Validação | ~15 min | 3 |
| 5 | Reabrir o link do transcript (dia 2) | Validação | ~2 min | 4 |
| 6 | Fila de produção por vencimento | Código | médio | 1 |

Os itens 1 e 2 vêm primeiro porque são decisões suas e destravam o resto — o
item 6 fica melhor com o prazo de Cabelos já definido.

---

## Suposições e o que não consigo confirmar

Esta seção existe porque **não tenho acesso ao código, ao banco nem aos logs.**
Tudo abaixo é coisa que eu tratei como incerta e que precisa de conferência:

1. **A fila por vencimento realmente não tem listagem ordenada.** Baseado no que
   você me disse ("a data é gravada e exibida, mas nenhuma listagem ordena por
   ela"). Se já existir em algum lugar, a Sugestão 1 cai.
2. **O comportamento da previsão de entrega quando o prazo da categoria não está
   definido** — não sei se é omissão ou valor padrão.
3. **O comportamento padrão do desconto de booster para categoria não marcada** —
   não sei se aplica ou recusa. É a pergunta mais importante do documento.
4. **Se a falha de re-hospedamento de anexo gera alerta** — não sei.
5. **Se a mensagem de sistema do boost é registrada crua antes de ser
   interpretada** — não sei.
6. **A regra para pedido misto** (item com desconto + item sem) — não sei se
   existe regra escolhida ou se é comportamento emergente.

Nenhum número, nome de arquivo ou comando neste documento foi inventado: os
preços vêm da tabela da loja e os limites vêm da lista de limites já descobertos.
