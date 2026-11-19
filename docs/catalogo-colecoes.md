# Catálogo de sistemas e companheiros

Esta publicação apresenta os produtos sem habilitar compras ou pagamentos dessas ofertas. Os outros produtos da loja continuam com as regras que já tinham. TrueBlood é uma adaptação privada para uma cidade e não integra o catálogo comercial.

| Produto mostrado ao cliente | Produto da licença | ZIP de distribuição |
| --- | --- | --- |
| Sistema de Pelúcias · Base | `pelucias_base` | `sistema-base-1.10.0.zip` |
| Sistema de Pelúcias · Dragões | `pelucias_dragoes` | `sistema-dragoes-1.10.0.zip` |
| Companheiros · Sanrio | `companheiros_sanrio` | `colecao-sanrio-1.10.0.zip` |
| Companheiros · Monster High | `companheiros_monster_high` | `colecao-monster-high-1.10.0.zip` |

## Conteúdo das entregas

- **Base:** sistema de pelúcias com catálogo inicial vazio e artes dos dragões no menu.
- **Dragões:** sistema completo com seis pelúcias de brinde e o recurso de modelos `vk_htyd`. Os dragões são acessórios equipáveis; não são anunciados como companheiros animados.
- **Sanrio:** sete companheiros, modelos `vook_sanrio_hk`, animações, artes de perfil/corpo inteiro, box e `/pet` com tema rosa.
- **Monster High:** dez companheiras com os modelos, animações, artes, box e `/pet` independente.

As coleções incluem **box e VIP no mesmo ZIP**, selecionados em `vook_plush/edition.lua`. O modo box verifica a posse do companheiro; o VIP verifica a permissão configurada. Cada entrega contém seus próprios leia-me de instalação, dependências, integração de inventário, cadastro de coleções e raridades/pesos. Uma instalação usa uma edição de `vook_plush`: não sobrescreva uma instalação existente para juntar dois pacotes sem seguir a integração documentada e preservar os dados.

## Como a equipe entrega o produto

1. Acesse `/licenca criar` no servidor oficial, com a conta/cargo administrativo autorizado.
2. Selecione **o produto correto**, a duração e o cliente. O padrão, se o produto for omitido, é **Sistema Base**.
3. O cliente recebe acesso a Testes/Desenvolvimento e Produção, com códigos e vínculos separados. Repetir a concessão preserva as licenças existentes.
4. O cliente usa `/planos` e escolhe produto, ambiente e versão. O servidor verifica dono, situação, validade, produto, recurso vinculado, publicação e integridade do arquivo.
5. O ZIP já contém a licença no arquivo privado do servidor. O cliente segue `INSTALACAO-VOOK.txt` e os `LEIA-ME.md`.

As quatro opções de produto não são as durações semanal, mensal, anual e vitalícia: **produto define o arquivo; duração define a validade**. Escolher box ou VIP não emite outra licença nem troca o arquivo adquirido.

Licenças anteriores de `pelucias` conservam suas chaves e vínculos. Não são convertidas automaticamente para outro produto nem recebem todas as coleções. TrueBlood permanece restrita às instalações privadas já vinculadas; não aparece entre as novas concessões comerciais.

## Arquivos maiores que o limite do Discord

Quando necessário, o bot responde de forma privada com um link HTTPS que expira em **cinco minutos**, permite **um uso** e não contém a chave da licença. O download revalida o acesso e a publicação antes de preparar o ZIP. Reiniciar o bot invalida links pendentes; o cliente gera outro em `/planos`. Não compartilhe o link nem o ZIP personalizado.

Os arquivos de distribuição ficam no banco, com SHA-256 e versão imutáveis. Não são links públicos de anexos do Discord. Apenas as artes de divulgação ficam públicas, em `/catalog-assets/`, com nomes explicitamente permitidos.

## Preparar e publicar uma atualização

```powershell
npx tsx scripts/prepare-collection-catalog.ts "PASTA_DAS_ENTREGAS_PADRAO" "DESTINO_NOVO"
npx tsx scripts/publish-script-catalog.ts "DESTINO_NOVO" "ARQUIVO_ENV_PRIVADO"
# Após revisar o resumo, os hashes e concluir os testes:
npx tsx scripts/publish-script-catalog.ts "DESTINO_NOVO" "ARQUIVO_ENV_PRIVADO" --apply
```

O primeiro comando lê somente as entregas padrão, valida caminhos e dependências, prepara a autenticação do produto e remove metadados de origem das imagens sem alterar seus pixels. Não copia o recurso TrueBlood. A versão desta implementação é `1.10.0`; publique uma versão nova quando o conteúdo mudar.

O segundo comando faz uma validação local sem alterar o Discord nem o banco. Com `--apply`, confere primeiro se o código atualizado está ativo no endpoint oficial; registra/publica os quatro arquivos validados, atualiza somente as categorias/ofertas correspondentes, as artes e o painel já existente, e atualiza apenas `/licenca` e `/planos`. Não emite licenças, não envia DMs de clientes e não cria pedidos/pagamentos. A operação pode ser repetida sem duplicar os produtos ou substituir bytes de uma versão já publicada. Há backup da configuração e dos produtos anteriores em `backups/`.

Use o arquivo privado do ambiente correto. Não copie segredos para o Git, imagens, mensagens, terminal ou parâmetros de linha de comando. O `LICENSE_ENCRYPTION_KEY` já configurado na hospedagem deve ser preservado: substituí-lo impediria a leitura dos códigos anteriores.

Na ShardCloud, o histórico em **Configurações → Deploy** pode indicar envio concluído enquanto o processo ainda usa o código anterior. Confira a opção **Reiniciar após Deploy**. Se o reinício automático estiver desativado, use **Projeto → Reiniciar** uma vez após confirmar o commit recebido. A publicação aguarda `/health` responder com a versão nova antes de atualizar os produtos.

## Fórum e edição simplificada

O catálogo oficial usa o fórum `1572775765928312902`, com visualização em galeria e as etiquetas **Coleções** e **Sistemas**. Há um tópico por produto. `/catalogo-painel enviar canal:<fórum>` vincula outro fórum do mesmo servidor; `/catalogo-painel atualizar` sincroniza os tópicos já vinculados. Atualizar título, descrição, conteúdo ou capa edita a publicação inicial sem apagar respostas ou criar outro tópico. Produtos ocultos têm o tópico arquivado. As permissões do canal continuam sendo as configuradas pela equipe no Discord.

Em `/catalogo gerenciar`, escolha **Editar produto** uma única vez. O painel do produto reúne **Editar textos**, **Trocar capa**, **Artes e ordem**, **Conteúdo incluído**, **Arquivar / ocultar** e **Ver como cliente**. O formulário de texto pede somente nome, resumo e descrição; preserva o identificador e o estado de apresentação do produto. Trocar a capa substitui o link da imagem existente e mantém sua posição e marcação de capa. Toda edição exige a permissão administrativa do catálogo e confere o servidor ao qual o produto pertence.

Os tópicos mostram a capa e um resumo curto, com a indicação discreta de catálogo de apresentação no rodapé. **Ver detalhes** abre a descrição completa e o conteúdo incluído em uma resposta privada, sem encher a publicação principal. **Ver outras artes** abre a galeria privada; **Meus arquivos** consulta somente as licenças de quem clicou. Não há carrinho nem checkout para as quatro ofertas de apresentação. Em servidores com outro tipo de catálogo, a navegação anterior permanece disponível.

## Pagamentos nesta etapa

O catálogo mostra **Em breve · apresentação**. Os botões de compra não aparecem no card desses produtos. As verificações no servidor recusam compra e checkout, inclusive para carrinhos antigos e preços alterados no painel administrativo. Alterar apenas o preço não habilita a venda. Uma futura ativação de pagamentos exige implementar e revisar essa etapa explicitamente.

## Artes

`assets/catalog/` contém os flyers Sanrio, Monster High e Como Treinar Seu Dragão, criados com a ferramenta integrada de geração de imagens, e as imagens dos personagens reaproveitadas das entregas. Os flyers usam os personagens como referência e omitem informações técnicas, sistemas, planos e pagamentos. O briefing está em `assets/catalog/arte-divulgacao.json`. A caixa comercial dos dragões usa a marca VOOK; a arte privada TrueBlood não é publicada.
