-- Quadro de demandas.
--
-- Dois canais, com papeis diferentes: no primeiro nasce o cartao de toda
-- demanda PAGA (com o link para o ticket do cliente e os botoes de status); o
-- segundo recebe uma copia quando a producao COMECA.
--
-- Por que separado de `orderChannelId`: aquele avisa que uma venda comecou, e o
-- pedido pode nem estar pago. Demanda so existe depois do pagamento, que e
-- quando ha trabalho a fazer.
ALTER TABLE "guild_configs" ADD COLUMN "demandChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "demandStartedChannelId" TEXT;

-- Onde cada cartao foi publicado. O canal vai junto do id da mensagem (como
-- `panelChannelId`/`panelMessageId` ja faz): trocar o canal configurado nao
-- pode fazer o bot procurar a mensagem antiga no lugar novo.
--
-- Nulos nos pedidos anteriores a esta mudanca — eles simplesmente nao tem
-- cartao, e o quadro passa a valer para as demandas seguintes.
ALTER TABLE "orders" ADD COLUMN "demandChannelId" TEXT;
ALTER TABLE "orders" ADD COLUMN "demandMessageId" TEXT;
ALTER TABLE "orders" ADD COLUMN "demandStartedChannelId" TEXT;
ALTER TABLE "orders" ADD COLUMN "demandStartedMessageId" TEXT;
