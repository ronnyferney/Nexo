-- Pasaporte de resultado (ADR 0014 · E14). Migración ADITIVA: solo crea la tabla `PasaporteResultado` y su back-relation
-- (FK) hacia `ContratoResultado`. No altera ninguna columna existente ni la vuelve obligatoria. Se omiten a propósito
-- los `DROP INDEX "KnowledgeChunk_search_idx"` / `ALTER COLUMN "search" DROP DEFAULT` que Prisma añade de forma espuria
-- (índice GIN y columna generada creados con SQL manual; ver CLAUDE.md): esta migración no los debe tocar.

-- CreateTable
CREATE TABLE "PasaporteResultado" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contratoResultadoId" TEXT NOT NULL,
    "tareaId" TEXT,
    "documentoRef" JSONB NOT NULL DEFAULT '{}',
    "documentHash" TEXT NOT NULL,
    "auditSeq" INTEGER NOT NULL,
    "auditEntryId" TEXT NOT NULL,
    "reemplazaAId" TEXT,
    "emitidoPorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasaporteResultado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasaporteResultado_workspaceId_contratoResultadoId_idx" ON "PasaporteResultado"("workspaceId", "contratoResultadoId");

-- CreateIndex
CREATE UNIQUE INDEX "PasaporteResultado_workspaceId_contratoResultadoId_document_key" ON "PasaporteResultado"("workspaceId", "contratoResultadoId", "documentHash");

-- AddForeignKey
ALTER TABLE "PasaporteResultado" ADD CONSTRAINT "PasaporteResultado_contratoResultadoId_fkey" FOREIGN KEY ("contratoResultadoId") REFERENCES "ContratoResultado"("id") ON DELETE CASCADE ON UPDATE CASCADE;
