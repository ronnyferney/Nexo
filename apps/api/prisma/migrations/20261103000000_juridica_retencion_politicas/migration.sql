-- CreateEnum
CREATE TYPE "CanalRetencion" AS ENUM ('CORREO', 'WHATSAPP', 'VOZ', 'CHAT');

-- CreateEnum
CREATE TYPE "TipoInformacion" AS ENUM ('ORDINARIA', 'EVIDENCIA', 'SENSIBLE');

-- AlterTable
ALTER TABLE "GrabacionConfig" ADD COLUMN     "grabacionAutorizadaJuridicamente" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PoliticaRetencion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "canal" "CanalRetencion",
    "tipoInformacion" "TipoInformacion",
    "retencionDias" INTEGER,
    "eliminacionSegura" BOOLEAN NOT NULL DEFAULT false,
    "consentimientoRequerido" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoliticaRetencion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoliticaRetencion_workspaceId_idx" ON "PoliticaRetencion"("workspaceId");

-- CreateIndex
CREATE INDEX "PoliticaRetencion_workspaceId_canal_tipoInformacion_idx" ON "PoliticaRetencion"("workspaceId", "canal", "tipoInformacion");

-- AddForeignKey
ALTER TABLE "PoliticaRetencion" ADD CONSTRAINT "PoliticaRetencion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
