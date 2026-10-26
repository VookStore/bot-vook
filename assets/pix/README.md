# Arte personalizada do QR Code PIX

Cada conta PIX pode ter uma arte própria. Quando o arquivo existe, o QR é
desenhado **dentro dela**; quando não existe, o cartão usa o QR simples de
sempre. A arte é decoração: nenhuma falha aqui impede uma cobrança de ser
gerada.

## Onde colocar o arquivo

```
assets/pix/<ID_DO_SERVIDOR>/<identificador-da-conta>.png
```

- **`<ID_DO_SERVIDOR>`** — o ID do servidor no Discord (só números).
- **`<identificador-da-conta>`** — o campo *identificador* da conta, o mesmo que
  aparece em `/config-pagamento gerenciar` (minúsculo, com hífens).

Exemplo:

```
assets/pix/1528606501248438282/principal.png
```

> A pasta inclui o ID do servidor **de propósito**. A arte traz nome, chave e
> banco impressos, e dois servidores podem ter contas com o mesmo
> identificador — sem essa separação, o cliente de um veria o titular do outro.

## Como desenhar a arte

Deixe um **quadrado branco sólido** onde o QR deve aparecer. O bot acha esse
quadrado sozinho, não é preciso configurar coordenada nenhuma.

| Requisito | Valor |
|---|---|
| Formato | PNG (nunca JPG — o ruído do JPG atrapalha a detecção e a leitura) |
| Cor do quadrado | Branco puro `#FFFFFF`, preenchimento sólido |
| Lado mínimo | 200 px (recomendado 500 px ou mais) |
| Proporção | Quadrado; um retângulo próximo disso é aceito e o QR fica centralizado |
| Cantos | Arredondados são aceitos |

**Não desenhe o quadrado do tamanho exato do QR.** O QR precisa de uma margem
branca em volta (zona silenciosa) e o bot já a desenha dentro do quadrado — por
isso o quadrado deve ser a área **total** que o QR pode ocupar.

O restante da arte (logo, nome, chave, banco, fundo) é preservado intacto.

## Conferindo

`/ticket-sistema diagnostico` mostra uma linha por conta ativa:

- **Sem arte cadastrada** — nenhum arquivo, cartão usa o QR simples;
- **Arte carregada** — quadrado encontrado, com posição e tamanho no log de boot;
- **Sem quadrado branco válido** — o arquivo existe mas o quadrado não foi
  reconhecido (provavelmente não é branco puro, é pequeno demais ou é uma faixa).

A arte fica em cache até o bot reiniciar, então trocar o PNG exige um restart.
