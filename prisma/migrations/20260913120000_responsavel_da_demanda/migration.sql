-- Responsavel pela demanda.
--
-- A fila de producao dizia O QUE vence primeiro, mas nao QUEM esta fazendo.
-- Com mais de uma pessoa na equipe isso vira trabalho duplicado (dois pegam o
-- mesmo pedido) ou esquecido (cada um acha que o outro pegou).
--
-- NULO = demanda livre, disponivel para "Pegar proxima". O responsavel e
-- mantido depois da entrega: continua dizendo quem produziu.
ALTER TABLE "orders" ADD COLUMN "assignedToId" TEXT,
ADD COLUMN "assignedAt" TIMESTAMP(3);

-- "Minhas demandas" e a carga por pessoa filtram por responsavel.
CREATE INDEX "orders_guildId_assignedToId_status_idx" ON "orders"("guildId", "assignedToId", "status");

-- Toda troca de responsavel entra na auditoria do pedido, com quem fez.
-- Postgres 12+ aceita ADD VALUE dentro da transacao da migracao.
ALTER TYPE "OrderAuditAction" ADD VALUE 'ORDER_ASSIGNED';
ALTER TYPE "OrderAuditAction" ADD VALUE 'ORDER_UNASSIGNED';
