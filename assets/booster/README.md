# Arte do anúncio de booster

A miniatura que aparece ao lado do título em `/booster`. Quando o arquivo
existe, o bot o envia **como anexo da própria mensagem** e a miniatura o
referencia por `attachment://`. Quando não existe, o anúncio é publicado sem
miniatura — a arte é decoração e nunca impede a publicação.

## Onde colocar o arquivo

Qualquer um destes serve — o bot procura nesta ordem:

```
assets/booster/<ID_DO_SERVIDOR>.png     ← preferido
assets/booster/booster.png              ← vale para qualquer servidor
```

- **`<ID_DO_SERVIDOR>`** — o ID do servidor no Discord (só números).

Exemplo:

```
assets/booster/1042089361279287366.png
```

Extensões aceitas: `.png`, `.webp`, `.jpg`, `.jpeg`, `.gif`. **Não precisa
converter nem renomear** — arraste o arquivo e ele é encontrado.

> Separar por servidor existe pelo mesmo motivo da arte do PIX: o bot atende
> mais de uma guild, e cada uma tem a própria marca. O nome genérico
> `booster.png` é o atalho para quem só tem um servidor.

Não sabe se o bot achou? Rode **`/booster previa`** — quando não há arte, ele
avisa e mostra os caminhos exatos onde procurou.

## Por que anexo e não link

Link de anexo do Discord **expira**. Um anúncio fixo num canal é exatamente o
lugar onde isso dá errado sem ninguém ver: a mensagem fica meses no ar e um dia
a imagem simplesmente some. Com o arquivo aqui no repositório, toda publicação
(e toda atualização) reenvia a arte, e ela nunca depende de um link assinado.

## Requisitos

| Requisito | Valor |
|---|---|
| Formato | PNG |
| Proporção | Quadrada — a miniatura do Discord é quadrada e recorta o resto |
| Lado recomendado | 512 px ou mais |
| Fundo | Transparente funciona bem nos dois temas do Discord |
| Tamanho do arquivo | Abaixo de 8 MB (limite de anexo sem Nitro) |

## Trocando a imagem

**Não precisa reiniciar o bot.** O cache é invalidado pela data de modificação
do arquivo, então basta substituir a imagem e rodar `/booster atualizar` — a
mensagem publicada é reescrita no lugar, com a arte nova, sem virar um segundo
anúncio no canal.
