-- Voz (E14 · ADR 0015 D2/D4), sandbox sin gasto. Migración ADITIVA: nuevo enum `EstadoLlamadaVoz` y tabla `VoiceCall`
-- (metadatos de llamada por empresa, reusa `CanalCuenta` tipo VOZ). No toca tablas/datos existentes.
-- NOTA: se eliminaron del script generado por `prisma migrate diff` las sentencias espurias sobre la columna generada
-- `KnowledgeChunk.search` (DROP INDEX "KnowledgeChunk_search_idx" / ALTER COLUMN "search" DROP DEFAULT), que Prisma no
-- modela y NO deben alterarse (CLAUDE.md · migraciones Prisma).

-- CreateEnum
CREATE TYPE "EstadoLlamadaVoz" AS ENUM ('INICIADA', 'EN_CURSO', 'TRANSFERIDA', 'FINALIZADA', 'FALLIDA', 'SIMULADA');

-- CreateTable
CREATE TABLE "VoiceCall" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT,
    "canalCuentaId" TEXT,
    "proveedor" TEXT NOT NULL,
    "proveedorCallId" TEXT NOT NULL,
    "direccion" "DireccionMensaje" NOT NULL DEFAULT 'SALIENTE',
    "estado" "EstadoLlamadaVoz" NOT NULL DEFAULT 'INICIADA',
    "tareaId" TEXT,
    "misionId" TEXT,
    "duracionSeg" INTEGER,
    "transcripcionRef" TEXT,
    "costoEstimado" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceCall_workspaceId_canalCuentaId_idx" ON "VoiceCall"("workspaceId", "canalCuentaId");

-- CreateIndex
CREATE INDEX "VoiceCall_workspaceId_estado_idx" ON "VoiceCall"("workspaceId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCall_workspaceId_proveedor_proveedorCallId_key" ON "VoiceCall"("workspaceId", "proveedor", "proveedorCallId");

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_canalCuentaId_fkey" FOREIGN KEY ("canalCuentaId") REFERENCES "CanalCuenta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
