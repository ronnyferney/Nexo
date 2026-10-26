-- Marco de dimensiones configurables (ADR 0011 · D8, estilo NetSuite / SAP CO-PA). Migración ADITIVA y retrocompatible:
--  - `UsageRecord` gana la columna `dimensiones JSONB NOT NULL DEFAULT '{}'` (snapshot histórico, RF46/QA16): los
--    registros previos quedan `{}`. NO cambia el cálculo del costo (ADR 0002 intacto): es solo etiqueta analítica.
--  - Tablas nuevas vacías: Dimension, DimensionValue, DimensionAssignment.
-- NOTA (regla de CLAUDE.md): se eliminaron del SQL generado por `prisma migrate diff` las sentencias espurias
--   `DROP INDEX "KnowledgeChunk_search_idx"` y `ALTER COLUMN "search" DROP DEFAULT` (columna/índice generados por SQL
--   manual que Prisma no modela). NO reintroducir en futuras migraciones.

-- CreateEnum
CREATE TYPE "DimensionTipoValor" AS ENUM ('LISTA', 'REFERENCIA', 'TEXTO', 'NUMERO');

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "dimensiones" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Dimension" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoValor" "DimensionTipoValor" NOT NULL DEFAULT 'LISTA',
    "referenciaEntidad" TEXT,
    "jerarquica" BOOLEAN NOT NULL DEFAULT false,
    "obligatoria" BOOLEAN NOT NULL DEFAULT false,
    "obligatoriaParaEfectoEconomico" BOOLEAN NOT NULL DEFAULT false,
    "aplicaA" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "esSistema" BOOLEAN NOT NULL DEFAULT false,
    "estado" "EstadoEstructura" NOT NULL DEFAULT 'ACTIVA',
    "vigenteDesde" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DimensionValue" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "padreId" TEXT,
    "estado" "EstadoEstructura" NOT NULL DEFAULT 'ACTIVA',
    "vigenteDesde" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DimensionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DimensionAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "dimensionValueId" TEXT,
    "valorLiteral" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DimensionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dimension_workspaceId_empresaId_idx" ON "Dimension"("workspaceId", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Dimension_workspaceId_empresaId_codigo_key" ON "Dimension"("workspaceId", "empresaId", "codigo");

-- CreateIndex
CREATE INDEX "DimensionValue_workspaceId_dimensionId_idx" ON "DimensionValue"("workspaceId", "dimensionId");

-- CreateIndex
CREATE UNIQUE INDEX "DimensionValue_dimensionId_codigo_key" ON "DimensionValue"("dimensionId", "codigo");

-- CreateIndex
CREATE INDEX "DimensionAssignment_workspaceId_targetType_targetId_idx" ON "DimensionAssignment"("workspaceId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "DimensionAssignment_workspaceId_dimensionId_dimensionValueI_idx" ON "DimensionAssignment"("workspaceId", "dimensionId", "dimensionValueId");

-- CreateIndex
CREATE UNIQUE INDEX "DimensionAssignment_workspaceId_dimensionId_targetType_targ_key" ON "DimensionAssignment"("workspaceId", "dimensionId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Dimension" ADD CONSTRAINT "Dimension_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DimensionValue" ADD CONSTRAINT "DimensionValue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DimensionValue" ADD CONSTRAINT "DimensionValue_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "Dimension"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DimensionValue" ADD CONSTRAINT "DimensionValue_padreId_fkey" FOREIGN KEY ("padreId") REFERENCES "DimensionValue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DimensionAssignment" ADD CONSTRAINT "DimensionAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índice parcial único (SQL manual; al estilo de OrgUnit_root_per_workspace): completa la unicidad de `codigo` por
-- (workspaceId, empresaId) para las dimensiones de organización (empresaId IS NULL), donde Postgres trata los NULL como
-- distintos y el índice único compuesto no bastaría. Hace idempotente la siembra de las 3 dimensiones de sistema.
-- NO eliminar este índice en futuras migraciones (regla de CLAUDE.md).
CREATE UNIQUE INDEX "Dimension_codigo_org_wide"
  ON "Dimension"("workspaceId", "codigo")
  WHERE "empresaId" IS NULL;
