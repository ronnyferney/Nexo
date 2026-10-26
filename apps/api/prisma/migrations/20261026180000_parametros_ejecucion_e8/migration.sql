-- Parámetros de ejecución del empleado digital (E8): estación virtual + salida a internet. Migración ADITIVA:
-- ninguna columna existente cambia de tipo ni se vuelve obligatoria. Se eliminaron del diff generado por Prisma los
-- cambios espurios sobre `KnowledgeChunk.search` (DROP INDEX "KnowledgeChunk_search_idx" y ALTER COLUMN "search"
-- DROP DEFAULT), que Prisma no modela y que esta migración NO debe tocar (ver CLAUDE.md).

-- CreateEnum
CREATE TYPE "EstadoEstacion" AS ENUM ('ACTIVA', 'SUSPENDIDA', 'RETIRADA');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "estacionVirtualId" TEXT,
ADD COLUMN     "parametrosEjecucion" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "salidaInternet" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EstacionVirtual" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" "EstadoEstacion" NOT NULL DEFAULT 'ACTIVA',
    "proveedor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstacionVirtual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstacionVirtual_workspaceId_idx" ON "EstacionVirtual"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EstacionVirtual_workspaceId_nombre_key" ON "EstacionVirtual"("workspaceId", "nombre");

-- CreateIndex
CREATE INDEX "Agent_estacionVirtualId_idx" ON "Agent"("estacionVirtualId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_estacionVirtualId_fkey" FOREIGN KEY ("estacionVirtualId") REFERENCES "EstacionVirtual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstacionVirtual" ADD CONSTRAINT "EstacionVirtual_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
