-- E3 · Jerarquía / organigrama de empleados digitales (RF32). Migración ADITIVA: auto-relación opcional de línea de
-- mando entre agentes. Ninguna columna existente cambia de tipo ni se vuelve obligatoria. La jerarquía NO concede
-- acceso a datos (ADR 0007); el acceso efectivo lo sigue resolviendo AgentAccessService.
-- NOTA: se omiten a propósito el `DROP INDEX "KnowledgeChunk_search_idx"` y el `ALTER COLUMN "search" DROP DEFAULT`
-- espurios que `prisma migrate diff` emite por la columna generada `tsvector` y su índice GIN (ver CLAUDE.md).

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "reportaAAgentId" TEXT;

-- CreateIndex
CREATE INDEX "Agent_workspaceId_reportaAAgentId_idx" ON "Agent"("workspaceId", "reportaAAgentId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_reportaAAgentId_fkey" FOREIGN KEY ("reportaAAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
