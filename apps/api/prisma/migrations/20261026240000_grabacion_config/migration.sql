-- GrabacionConfig (E14 · ADR 0015 D3/D4 · decisión Jurídica D7): controles configurables de grabación y retención por
-- empresa, TODO OFF/null por defecto. Migración ADITIVA: nueva tabla `GrabacionConfig`; no toca tablas/datos existentes.
-- NOTA: se eliminaron del script generado por `prisma migrate diff` las sentencias espurias sobre la columna generada
-- `KnowledgeChunk.search` (DROP INDEX "KnowledgeChunk_search_idx" / ALTER COLUMN "search" DROP DEFAULT), que Prisma no
-- modela y NO deben alterarse (CLAUDE.md · migraciones Prisma).

-- CreateTable
CREATE TABLE "GrabacionConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "grabarAudio" BOOLEAN NOT NULL DEFAULT false,
    "guardarTranscripcion" BOOLEAN NOT NULL DEFAULT false,
    "guardarResumen" BOOLEAN NOT NULL DEFAULT false,
    "guardarEvidencia" BOOLEAN NOT NULL DEFAULT false,
    "requiereAutorizacion" BOOLEAN NOT NULL DEFAULT true,
    "finalidad" TEXT,
    "retencionDias" INTEGER,
    "accesoRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eliminacionAutomatica" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrabacionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrabacionConfig_workspaceId_idx" ON "GrabacionConfig"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "GrabacionConfig_workspaceId_empresaId_key" ON "GrabacionConfig"("workspaceId", "empresaId");
