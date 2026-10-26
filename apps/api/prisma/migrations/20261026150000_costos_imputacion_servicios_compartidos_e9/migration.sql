-- Costos e imputación / servicios compartidos (ADR 0011 · D5 / E9 · RF44/RF45). Migración ADITIVA y retrocompatible:
--  - `UsageRecord` gana las dimensiones de imputación integradas (snapshot histórico, RF46/QA16): `empresaId`,
--    `areaEjecutoraId`, `lineaBeneficiariaId`, `centroCostoId`, `sedeId`. Todas nullable: los registros previos quedan
--    `NULL` y se siguen imputando por `orgUnitId` como hoy. NO cambian el cálculo del costo (ADR 0002 intacto): son solo
--    etiquetas analíticas, no un segundo libro mayor.
--  - Tablas nuevas vacías: `ServicioInterno` (RF44) e `ImputacionCosto` (RF45, reparto que suma 100 % por servicio+periodo).
--    El reparto es reporte: NO toca `BudgetLedger` (sin doble reserva) ni cuenta un gasto dos veces.
-- NOTA (regla de CLAUDE.md): se eliminaron del SQL generado por `prisma migrate diff` las sentencias espurias
--   `DROP INDEX "KnowledgeChunk_search_idx"` y `ALTER COLUMN "search" DROP DEFAULT` (columna/índice generados por SQL
--   manual que Prisma no modela). NO reintroducir en futuras migraciones.

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "areaEjecutoraId" TEXT,
ADD COLUMN     "centroCostoId" TEXT,
ADD COLUMN     "empresaId" TEXT,
ADD COLUMN     "lineaBeneficiariaId" TEXT,
ADD COLUMN     "sedeId" TEXT;

-- CreateTable
CREATE TABLE "ServicioInterno" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "areaDuenoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "responsableUserId" TEXT,
    "responsableAgentId" TEXT,
    "acuerdoServicio" JSONB NOT NULL DEFAULT '{}',
    "clientesInternos" JSONB NOT NULL DEFAULT '[]',
    "estado" "EstadoEstructura" NOT NULL DEFAULT 'ACTIVA',
    "vigenteDesde" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicioInterno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImputacionCosto" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "servicioInternoId" TEXT NOT NULL,
    "periodoKey" TEXT NOT NULL,
    "lineaNegocioId" TEXT,
    "orgUnitId" TEXT,
    "centroCostoId" TEXT,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImputacionCosto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicioInterno_workspaceId_empresaId_idx" ON "ServicioInterno"("workspaceId", "empresaId");

-- CreateIndex
CREATE INDEX "ServicioInterno_workspaceId_areaDuenoId_idx" ON "ServicioInterno"("workspaceId", "areaDuenoId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicioInterno_workspaceId_empresaId_codigo_key" ON "ServicioInterno"("workspaceId", "empresaId", "codigo");

-- CreateIndex
CREATE INDEX "ImputacionCosto_workspaceId_servicioInternoId_periodoKey_idx" ON "ImputacionCosto"("workspaceId", "servicioInternoId", "periodoKey");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_empresaId_createdAt_idx" ON "UsageRecord"("workspaceId", "empresaId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_lineaBeneficiariaId_createdAt_idx" ON "UsageRecord"("workspaceId", "lineaBeneficiariaId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_centroCostoId_createdAt_idx" ON "UsageRecord"("workspaceId", "centroCostoId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_areaEjecutoraId_createdAt_idx" ON "UsageRecord"("workspaceId", "areaEjecutoraId", "createdAt");

-- AddForeignKey
ALTER TABLE "ServicioInterno" ADD CONSTRAINT "ServicioInterno_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImputacionCosto" ADD CONSTRAINT "ImputacionCosto_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImputacionCosto" ADD CONSTRAINT "ImputacionCosto_servicioInternoId_fkey" FOREIGN KEY ("servicioInternoId") REFERENCES "ServicioInterno"("id") ON DELETE CASCADE ON UPDATE CASCADE;
