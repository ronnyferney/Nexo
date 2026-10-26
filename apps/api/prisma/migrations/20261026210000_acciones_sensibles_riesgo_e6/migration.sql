-- Catálogo configurable de tipos de acción sensible + niveles de riesgo (E6+ · puntos 7 y 8 del patrocinador).
-- Migración ADITIVA: no toca datos existentes. Se eliminaron del diff generado los cambios espurios sobre
-- `KnowledgeChunk.search` (DROP INDEX / ALTER COLUMN DROP DEFAULT) que Prisma no modela (ver CLAUDE.md).

-- CreateEnum
CREATE TYPE "NivelRiesgo" AS ENUM ('BAJO', 'MEDIO', 'ALTO', 'CRITICO', 'DESCONOCIDO');

-- CreateTable
CREATE TABLE "TipoAccionSensible" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "requiereAprobacion" BOOLEAN NOT NULL DEFAULT false,
    "requiereDobleAprobacion" BOOLEAN NOT NULL DEFAULT false,
    "nivelRiesgoPorDefecto" "NivelRiesgo" NOT NULL DEFAULT 'DESCONOCIDO',
    "umbralMonto" DECIMAL(18,2),
    "moneda" TEXT,
    "limiteAcumuladoPeriodo" DECIMAL(18,2),
    "esSistema" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoAccionSensible_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TipoAccionSensible_workspaceId_idx" ON "TipoAccionSensible"("workspaceId");

-- CreateIndex
CREATE INDEX "TipoAccionSensible_workspaceId_codigo_activo_idx" ON "TipoAccionSensible"("workspaceId", "codigo", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "TipoAccionSensible_workspaceId_empresaId_codigo_key" ON "TipoAccionSensible"("workspaceId", "empresaId", "codigo");

-- AddForeignKey
ALTER TABLE "TipoAccionSensible" ADD CONSTRAINT "TipoAccionSensible_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (SQL manual, no modelado por Prisma): unicidad de las entradas de workspace (empresaId IS NULL), porque
-- en Postgres los NULL no colisionan en el UNIQUE compuesto. Garantiza la idempotencia de la semilla de referencia y
-- evita duplicados en altas concurrentes, igual que `Dimension_codigo_org_wide`.
CREATE UNIQUE INDEX "TipoAccionSensible_codigo_ws_wide" ON "TipoAccionSensible"("workspaceId", "codigo") WHERE "empresaId" IS NULL;
