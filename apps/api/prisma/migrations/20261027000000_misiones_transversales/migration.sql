-- Misiones transversales (superempleado digital, ADR 0016 · Incremento 1). Migración ADITIVA: solo crea el enum
-- `EstadoMision` y las tablas `MisionTransversal`/`MisionParticipante`/`MisionVinculo` con sus índices y FKs. No cambia
-- ninguna columna existente ni la vuelve obligatoria. Se eliminaron del diff generado por Prisma las líneas
-- `DROP INDEX "KnowledgeChunk_search_idx"` y `ALTER COLUMN "search" DROP DEFAULT` (índice GIN y columna generada que se
-- mantienen con SQL manual, según CLAUDE.md; Prisma no los modela y no deben tocarse).

-- CreateEnum
CREATE TYPE "EstadoMision" AS ENUM ('PROPUESTA', 'AUTORIZADA', 'EN_CURSO', 'EN_VALIDACION', 'LOGRADA', 'DETENIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "MisionTransversal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "proposito" TEXT,
    "resultadoEsperado" TEXT NOT NULL,
    "indicador" TEXT,
    "lineaBase" TEXT,
    "meta" TEXT,
    "plazo" TIMESTAMP(3),
    "estado" "EstadoMision" NOT NULL DEFAULT 'PROPUESTA',
    "duenoUserId" TEXT NOT NULL,
    "coordinadorAgentId" TEXT,
    "canalId" TEXT,
    "autorizadaPorUserId" TEXT,
    "autorizadaAt" TIMESTAMP(3),
    "motivo" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MisionTransversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisionParticipante" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "misionId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "duenoLocalUserId" TEXT,
    "agenteLiderId" TEXT,
    "alcance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MisionParticipante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisionVinculo" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "misionId" TEXT NOT NULL,
    "objetivoId" TEXT,
    "tareaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MisionVinculo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MisionTransversal_canalId_key" ON "MisionTransversal"("canalId");

-- CreateIndex
CREATE INDEX "MisionTransversal_workspaceId_estado_idx" ON "MisionTransversal"("workspaceId", "estado");

-- CreateIndex
CREATE INDEX "MisionTransversal_workspaceId_coordinadorAgentId_idx" ON "MisionTransversal"("workspaceId", "coordinadorAgentId");

-- CreateIndex
CREATE INDEX "MisionParticipante_workspaceId_misionId_idx" ON "MisionParticipante"("workspaceId", "misionId");

-- CreateIndex
CREATE UNIQUE INDEX "MisionParticipante_workspaceId_misionId_orgUnitId_key" ON "MisionParticipante"("workspaceId", "misionId", "orgUnitId");

-- CreateIndex
CREATE INDEX "MisionVinculo_workspaceId_misionId_idx" ON "MisionVinculo"("workspaceId", "misionId");

-- CreateIndex
CREATE INDEX "MisionVinculo_workspaceId_objetivoId_idx" ON "MisionVinculo"("workspaceId", "objetivoId");

-- CreateIndex
CREATE INDEX "MisionVinculo_workspaceId_tareaId_idx" ON "MisionVinculo"("workspaceId", "tareaId");

-- AddForeignKey
ALTER TABLE "MisionTransversal" ADD CONSTRAINT "MisionTransversal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionTransversal" ADD CONSTRAINT "MisionTransversal_duenoUserId_fkey" FOREIGN KEY ("duenoUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionTransversal" ADD CONSTRAINT "MisionTransversal_coordinadorAgentId_fkey" FOREIGN KEY ("coordinadorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionTransversal" ADD CONSTRAINT "MisionTransversal_canalId_fkey" FOREIGN KEY ("canalId") REFERENCES "Canal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionTransversal" ADD CONSTRAINT "MisionTransversal_autorizadaPorUserId_fkey" FOREIGN KEY ("autorizadaPorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionParticipante" ADD CONSTRAINT "MisionParticipante_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionParticipante" ADD CONSTRAINT "MisionParticipante_misionId_fkey" FOREIGN KEY ("misionId") REFERENCES "MisionTransversal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionParticipante" ADD CONSTRAINT "MisionParticipante_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionParticipante" ADD CONSTRAINT "MisionParticipante_duenoLocalUserId_fkey" FOREIGN KEY ("duenoLocalUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionVinculo" ADD CONSTRAINT "MisionVinculo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionVinculo" ADD CONSTRAINT "MisionVinculo_misionId_fkey" FOREIGN KEY ("misionId") REFERENCES "MisionTransversal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionVinculo" ADD CONSTRAINT "MisionVinculo_objetivoId_fkey" FOREIGN KEY ("objetivoId") REFERENCES "Objetivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionVinculo" ADD CONSTRAINT "MisionVinculo_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
