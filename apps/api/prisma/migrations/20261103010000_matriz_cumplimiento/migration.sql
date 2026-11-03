-- CreateEnum
CREATE TYPE "TipoDatoCumplimiento" AS ENUM ('TEXTO', 'NUMERO', 'BOOLEANO', 'FECHA', 'LISTA', 'OBJETO');

-- CreateTable
CREATE TABLE "ReglaCumplimiento" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jurisdiccion" TEXT,
    "sector" TEXT,
    "proceso" TEXT,
    "nivelRiesgo" "NivelRiesgo",
    "campoClave" TEXT NOT NULL,
    "tipoDato" "TipoDatoCumplimiento" NOT NULL,
    "reglaValidacion" JSONB,
    "controlProteccion" TEXT,
    "descripcion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReglaCumplimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReglaCumplimiento_workspaceId_idx" ON "ReglaCumplimiento"("workspaceId");

-- CreateIndex
CREATE INDEX "ReglaCumplimiento_workspaceId_activa_idx" ON "ReglaCumplimiento"("workspaceId", "activa");

-- CreateIndex
CREATE INDEX "ReglaCumplimiento_workspaceId_jurisdiccion_sector_proceso_n_idx" ON "ReglaCumplimiento"("workspaceId", "jurisdiccion", "sector", "proceso", "nivelRiesgo");

-- AddForeignKey
ALTER TABLE "ReglaCumplimiento" ADD CONSTRAINT "ReglaCumplimiento_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
