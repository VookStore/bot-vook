-- Prazo de producao por categoria do catalogo.
--
-- Tudo que a loja vende e feito sob encomenda — cabelo, PED, pelucia — e ate
-- aqui o pedido nao carregava prazo nenhum: o cliente que pagou nao sabia
-- quando receberia, e a equipe nao tinha uma fila ordenada por vencimento.
--
-- NULO = sem prazo definido. Categoria sem prazo simplesmente nao gera previsao
-- no pedido, em vez de assumir um numero inventado.
ALTER TABLE "catalog_categories" ADD COLUMN "leadTimeDays" INTEGER;

-- Previsao de entrega do pedido.
--
-- Calculada UMA VEZ, no momento em que o pedido e pago — nao na criacao. Antes
-- do pagamento nao ha compromisso, e a producao so comeca a contar quando o
-- dinheiro entra. Congelada como data absoluta: mudar o prazo da categoria
-- depois nao pode reescrever a promessa feita a quem ja comprou.
ALTER TABLE "orders" ADD COLUMN "dueAt" TIMESTAMP(3);

-- Fila de producao: pedidos em aberto ordenados por vencimento.
CREATE INDEX "orders_guildId_status_dueAt_idx" ON "orders"("guildId", "status", "dueAt");
