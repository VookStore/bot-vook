-- URL publica do transcript do atendimento.
--
-- Nula por padrao: a hospedagem e opcional (TRANSCRIPT_BASE_URL) e o upload e
-- best-effort. Ticket fechado sem URL continua tendo o transcript em anexo no
-- canal de logs, que era o unico caminho antes desta coluna.
ALTER TABLE "tickets" ADD COLUMN "transcriptUrl" TEXT;
