-- Localizador de entregas.
--
-- O canal onde o CLIENTE acha o ticket entregue: o painel de localizar, aberto a
-- cada cliente enquanto ele tiver uma entrega esperando a confirmacao dele.
--
-- Separado do canal dos cartoes de ticket entregue (`ticketDoneChannelId`), que e
-- so da equipe e mostra cliente, pedido e atendente de cada venda. Os dois nunca
-- podem ser o mesmo canal.
ALTER TABLE "guild_configs" ADD COLUMN "deliveredLocatorChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "deliveredLocatorMessageId" TEXT;
