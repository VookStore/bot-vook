-- Conclusao da entrega.
--
-- Depois do `/entregar`, a demanda MUDA de canal (sai de "iniciadas" e vai para
-- o de concluidas) e o ticket ganha um cartao no canal de concluidos. O ticket
-- so fecha quando o cliente confirma o recebimento.
--
-- O ticket NAO muda de canal: o Discord nao move topico. Ele e arquivado (sai
-- da lista de ativos, sem fechar) e o cartao no canal de concluidos e o atalho.

ALTER TABLE "guild_configs" ADD COLUMN "demandDoneChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "ticketDoneChannelId" TEXT;

-- Onde cada cartao foi publicado: canal junto do id da mensagem, como os pares
-- que ja existem, para trocar o canal configurado nao fazer o bot procurar a
-- mensagem antiga no lugar novo.
ALTER TABLE "orders" ADD COLUMN "demandDoneChannelId" TEXT;
ALTER TABLE "orders" ADD COLUMN "demandDoneMessageId" TEXT;

ALTER TABLE "tickets" ADD COLUMN "doneCardChannelId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "doneCardMessageId" TEXT;

-- Quando e por quem o produto foi entregue. No ticket, e nao so no pedido,
-- porque ha entrega sem pedido (venda combinada sem cobranca pelo bot).
ALTER TABLE "tickets" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "deliveredById" TEXT;
