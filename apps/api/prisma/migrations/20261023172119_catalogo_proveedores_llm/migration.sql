-- Catálogo de proveedores LLM (ADR 0002, D8).
-- Nota: se eliminaron del SQL generado el DROP INDEX "KnowledgeChunk_search_idx" y el ALTER COLUMN "search"
-- (columna generada e índice GIN creados con SQL manual que Prisma no modela; ver CLAUDE.md).

-- AlterTable
ALTER TABLE "LlmConnection" ADD COLUMN     "driverOptions" JSONB,
ADD COLUMN     "headers" JSONB,
ADD COLUMN     "providerFields" JSONB,
ADD COLUMN     "providerId" TEXT;

-- AlterTable
ALTER TABLE "LlmModel" ADD COLUMN     "needsPricing" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "LlmConnection_workspaceId_providerId_idx" ON "LlmConnection"("workspaceId", "providerId");
