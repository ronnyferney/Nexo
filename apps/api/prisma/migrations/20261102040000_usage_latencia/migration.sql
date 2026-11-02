-- ADR 0017 Inc.3: métrica aditiva de latencia del turno del modelo, junto al costo ya registrado.
-- Columna opcional (los registros previos quedan NULL); no altera el cálculo del costo (ADR 0002 intacto).
--
-- Nota de saneo (CLAUDE.md): `prisma migrate diff` incluía ademas un `DROP INDEX "KnowledgeChunk_search_idx"` y un
-- `ALTER COLUMN "search" DROP DEFAULT` espurios (la columna generada `search` tsvector y su índice GIN se crean con SQL
-- manual que Prisma no modela). Esas sentencias se ELIMINARON a propósito: solo se aplica el ADD COLUMN aditivo.

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "latenciaMs" INTEGER;
