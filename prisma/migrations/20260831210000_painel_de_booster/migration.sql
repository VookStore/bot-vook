-- Onde o anuncio de booster foi publicado.
--
-- Mesmo par (canal, mensagem) da tabela de precos, e pelo mesmo motivo: o id da
-- mensagem e o que permite REESCREVER o anuncio no lugar quando um beneficio
-- muda. Um anuncio antigo que continua visivel acima do novo e um desconto que
-- a loja vai ter de honrar ou desdizer na frente de quem impulsionou.
--
-- Nulos ate a primeira publicacao.
ALTER TABLE "guild_configs" ADD COLUMN "boosterChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "boosterMessageId" TEXT;
