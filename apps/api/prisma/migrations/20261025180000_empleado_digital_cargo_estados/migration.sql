-- CreateEnum
CREATE TYPE "NivelJerarquico" AS ENUM ('EMPLEADO', 'LIDER', 'JEFE', 'DIRECTOR', 'GERENTE', 'SUPEREMPLEADO');

-- AlterEnum
-- Ampliación aditiva y retrocompatible de LaunchStatus (RF05/RF06): se conservan DRAFT y LAUNCHED.
-- Los nuevos valores no se usan en este mismo migration, por lo que el ADD VALUE es seguro en PostgreSQL 12+.
ALTER TYPE "LaunchStatus" ADD VALUE 'EN_VALIDACION';
ALTER TYPE "LaunchStatus" ADD VALUE 'SUSPENDIDO';
ALTER TYPE "LaunchStatus" ADD VALUE 'RETIRADO';

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "cargoId" TEXT,
ADD COLUMN     "responsableUserId" TEXT,
ADD COLUMN     "suplenteUserId" TEXT;

-- CreateTable
CREATE TABLE "Cargo" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "proposito" TEXT,
    "funciones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entregables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "indicadores" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "limites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nivel" "NivelJerarquico" NOT NULL DEFAULT 'EMPLEADO',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cargo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cargo_workspaceId_idx" ON "Cargo"("workspaceId");

-- AddForeignKey
ALTER TABLE "Cargo" ADD CONSTRAINT "Cargo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_responsableUserId_fkey" FOREIGN KEY ("responsableUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_suplenteUserId_fkey" FOREIGN KEY ("suplenteUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
