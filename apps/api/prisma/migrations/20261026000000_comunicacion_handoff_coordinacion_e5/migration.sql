-- CreateEnum
CREATE TYPE "TipoMensaje" AS ENUM ('ASIGNACION', 'ACEPTACION', 'SOLICITUD_INFO', 'ENTREGA', 'DEVOLUCION', 'BLOQUEO', 'ESCALAMIENTO', 'CIERRE', 'HANDOFF');

-- CreateEnum
CREATE TYPE "EstadoTransferencia" AS ENUM ('PROPUESTO', 'ACEPTADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "TipoCanal" AS ENUM ('MISION', 'PROCESO', 'AREA');


-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "secuenciaSegmento" INTEGER;


-- CreateTable
CREATE TABLE "MensajeAgente" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT,
    "messageId" TEXT NOT NULL,
    "correlationId" TEXT,
    "emisorAgentId" TEXT,
    "destinatarioAgentId" TEXT,
    "destinatarioEquipoId" TEXT,
    "canalId" TEXT,
    "misionId" TEXT,
    "tareaId" TEXT,
    "tipo" "TipoMensaje" NOT NULL,
    "prioridad" INTEGER NOT NULL DEFAULT 3,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fechaLimite" TIMESTAMP(3),
    "referencias" JSONB NOT NULL DEFAULT '[]',
    "permisos" JSONB NOT NULL DEFAULT '{}',
    "enviadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recibidoAt" TIMESTAMP(3),
    "aceptadoAt" TIMESTAMP(3),
    "resueltoAt" TIMESTAMP(3),
    "motivo" TEXT,
    "recibidoPorAgentId" TEXT,
    "aceptadoPorAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensajeAgente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContratoTransferencia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "secuenciaSegmento" INTEGER NOT NULL,
    "fromAgentId" TEXT,
    "toAgentId" TEXT,
    "toEquipoId" TEXT,
    "estadoAlcanzado" JSONB NOT NULL DEFAULT '{}',
    "entregableParcial" JSONB,
    "contextoAutorizado" JSONB NOT NULL DEFAULT '[]',
    "criterioSiguiente" TEXT,
    "permisos" JSONB NOT NULL DEFAULT '{}',
    "responsableEntranteUserId" TEXT,
    "workflowId" TEXT,
    "estado" "EstadoTransferencia" NOT NULL DEFAULT 'PROPUESTO',
    "motivoRechazo" TEXT,
    "mensajeId" TEXT,
    "executionId" TEXT,
    "profundidadDelegacion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididoAt" TIMESTAMP(3),

    CONSTRAINT "ContratoTransferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Canal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "tipo" "TipoCanal" NOT NULL,
    "misionId" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Canal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiloCanal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "canalId" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "intercambios" INTEGER NOT NULL DEFAULT 0,
    "tareaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiloCanal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MensajeAgente_workspaceId_correlationId_idx" ON "MensajeAgente"("workspaceId", "correlationId");

-- CreateIndex
CREATE INDEX "MensajeAgente_workspaceId_tareaId_idx" ON "MensajeAgente"("workspaceId", "tareaId");

-- CreateIndex
CREATE INDEX "MensajeAgente_workspaceId_destinatarioAgentId_idx" ON "MensajeAgente"("workspaceId", "destinatarioAgentId");

-- CreateIndex
CREATE INDEX "MensajeAgente_workspaceId_fechaLimite_idx" ON "MensajeAgente"("workspaceId", "fechaLimite");

-- CreateIndex
CREATE UNIQUE INDEX "MensajeAgente_workspaceId_messageId_key" ON "MensajeAgente"("workspaceId", "messageId");

-- CreateIndex
CREATE INDEX "ContratoTransferencia_workspaceId_tareaId_idx" ON "ContratoTransferencia"("workspaceId", "tareaId");

-- CreateIndex
CREATE INDEX "ContratoTransferencia_workspaceId_estado_idx" ON "ContratoTransferencia"("workspaceId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "ContratoTransferencia_workspaceId_tareaId_secuenciaSegmento_key" ON "ContratoTransferencia"("workspaceId", "tareaId", "secuenciaSegmento");

-- CreateIndex
CREATE INDEX "Canal_workspaceId_tipo_idx" ON "Canal"("workspaceId", "tipo");

-- CreateIndex
CREATE INDEX "HiloCanal_workspaceId_canalId_idx" ON "HiloCanal"("workspaceId", "canalId");

-- AddForeignKey
ALTER TABLE "MensajeAgente" ADD CONSTRAINT "MensajeAgente_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MensajeAgente" ADD CONSTRAINT "MensajeAgente_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoTransferencia" ADD CONSTRAINT "ContratoTransferencia_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoTransferencia" ADD CONSTRAINT "ContratoTransferencia_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Canal" ADD CONSTRAINT "Canal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiloCanal" ADD CONSTRAINT "HiloCanal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiloCanal" ADD CONSTRAINT "HiloCanal_canalId_fkey" FOREIGN KEY ("canalId") REFERENCES "Canal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

