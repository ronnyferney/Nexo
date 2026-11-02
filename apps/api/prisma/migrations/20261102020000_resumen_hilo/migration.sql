-- Memoria de corto plazo compacta del hilo (ADR 0017 Inc.2): resumen incremental aditivo en la conversación.
-- Nota: el diff de Prisma incluye además `DROP INDEX "KnowledgeChunk_search_idx"` y `ALTER COLUMN "search" DROP DEFAULT`,
-- artefactos de la columna generada tsvector y su índice GIN que Prisma no modela. Se eliminan a propósito (CLAUDE.md):
-- esta migración es puramente aditiva sobre "Conversation" y no toca KnowledgeChunk.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "resumen" TEXT,
ADD COLUMN     "resumenMensajes" INTEGER NOT NULL DEFAULT 0;
