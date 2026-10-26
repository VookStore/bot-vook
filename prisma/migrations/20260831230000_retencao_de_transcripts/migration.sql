-- Ids dos anexos re-hospedados junto do transcript.
--
-- Sem esta coluna nao ha como apagar os anexos: as chaves no R2 sao aleatorias
-- de proposito (o endereco secreto e a unica barreira de leitura) e nao carregam
-- o numero do ticket. Apagar so o HTML deixaria para tras justamente os
-- arquivos mais sensiveis — print de conversa e comprovante bancario.
--
-- Vazio para todo ticket fechado antes desta migracao: os anexos daqueles
-- transcripts nao sao rastreaveis e permanecem no R2.
ALTER TABLE "tickets" ADD COLUMN "transcriptAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Varredura do job de retencao: ele filtra por (transcriptUrl IS NOT NULL,
-- closedAt). Sem indice, seria sequential scan diario na tabela inteira.
CREATE INDEX "tickets_transcriptUrl_closedAt_idx" ON "tickets"("transcriptUrl", "closedAt");
