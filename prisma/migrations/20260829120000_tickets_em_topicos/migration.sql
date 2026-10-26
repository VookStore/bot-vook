-- Tickets passam a ser TOPICOS PRIVADOS dentro de um canal de texto, em vez de
-- um canal por ticket dentro de uma categoria do Discord.
--
-- O destino muda de significado (categoria -> canal de texto), por isso a coluna
-- e renomeada em vez de reaproveitada em silencio: o valor antigo aponta para
-- uma categoria e sera recusado pela validacao, que pede ao administrador
-- reconfigurar o destino em /ticket-destinos configurar.
ALTER TABLE "ticket_categories" RENAME COLUMN "discordCategoryId" TO "destinationChannelId";

-- Mensagem do painel "Localizar meu ticket" publicada no canal de destino.
-- Guardada para reeditar a mesma mensagem em vez de empilhar copias a cada
-- republicacao.
ALTER TABLE "ticket_categories" ADD COLUMN "locatorMessageId" TEXT;
