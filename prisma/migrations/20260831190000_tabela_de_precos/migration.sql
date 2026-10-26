-- Onde a tabela de precos foi publicada.
--
-- Mesmo par (canal, mensagem) que o painel de atendimento ja usa, e pelo mesmo
-- motivo: guardar o id da mensagem e o que permite REESCREVER a tabela no lugar
-- quando um preco muda. Sem isso, cada atualizacao publicaria uma tabela nova e
-- o canal acumularia versoes conflitantes — num canal de precos, a versao velha
-- que fica visivel e uma promessa que a loja nao quer cumprir.
--
-- Nulos ate a primeira publicacao.
ALTER TABLE "guild_configs" ADD COLUMN "pricingChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "pricingMessageId" TEXT;
