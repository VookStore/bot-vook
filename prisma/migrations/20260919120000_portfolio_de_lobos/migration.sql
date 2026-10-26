-- Portfolio de lobos.
--
-- Painel da equipe (par canal+mensagem, reescrito no lugar como a tabela de
-- precos e o anuncio de booster) e o canal publico onde cada lobo entregue vira
-- um post.
--
-- O canal do portfolio fica SEPARADO do painel de proposito: o painel mora num
-- canal da equipe, e o post sai num canal que o cliente enxerga. Sao publicos
-- diferentes, e trocar um nao pode mover o outro.
--
-- Nulos ate a primeira configuracao.
ALTER TABLE "guild_configs" ADD COLUMN "wolfPanelChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "wolfPanelMessageId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "wolfPortfolioChannelId" TEXT;
