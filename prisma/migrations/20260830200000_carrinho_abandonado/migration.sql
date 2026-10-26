-- Quando o lembrete de carrinho abandonado foi enviado.
--
-- Nula = ainda nao foi avisado. O job de lembrete usa esta coluna como trava de
-- "uma vez so": sem ela, todo carrinho parado ha mais de 24h receberia uma DM a
-- cada rodada do agendador, o que transformaria uma ferramenta de recuperacao
-- de venda em spam — e faria o cliente bloquear as DMs do bot, perdendo junto
-- os avisos de pedido e de pagamento.
--
-- O carrinho ativo e unico por cliente e sobrevive ao checkout apenas como
-- historico (status CHECKED_OUT), entao a coluna nao precisa ser reiniciada:
-- cada carrinho novo nasce com ela nula.
ALTER TABLE "carts" ADD COLUMN "abandonedNoticeAt" TIMESTAMP(3);

-- Indice do job: ele varre por (status, abandonedNoticeAt, updatedAt) e nada
-- mais. Sem ele, a varredura de meia em meia hora faria sequential scan na
-- tabela inteira de carrinhos.
CREATE INDEX "carts_status_abandonedNoticeAt_updatedAt_idx"
  ON "carts"("status", "abandonedNoticeAt", "updatedAt");
