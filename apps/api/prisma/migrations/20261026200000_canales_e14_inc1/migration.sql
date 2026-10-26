-- CreateEnum
CREATE TYPE "CanalTipo" AS ENUM ('CORREO', 'WHATSAPP', 'VOZ');

-- CreateEnum
CREATE TYPE "CanalCuentaEstado" AS ENUM ('ACTIVA', 'SUSPENDIDA', 'RETIRADA');

-- CreateEnum
CREATE TYPE "DireccionMensaje" AS ENUM ('SALIENTE', 'ENTRANTE');

-- CreateEnum
CREATE TYPE "EstadoMensajeCanal" AS ENUM ('PENDIENTE', 'ENVIADO', 'ENTREGADO', 'FALLIDO', 'SIMULADO');

-- CreateTable
CREATE TABLE "CanalCuenta" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "CanalTipo" NOT NULL,
    "proveedor" TEXT NOT NULL,
    "estado" "CanalCuentaEstado" NOT NULL DEFAULT 'ACTIVA',
    "secretRef" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanalCuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MensajeCanal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "canalCuentaId" TEXT NOT NULL,
    "direccion" "DireccionMensaje" NOT NULL DEFAULT 'SALIENTE',
    "idempotencyKey" TEXT NOT NULL,
    "tareaId" TEXT,
    "misionId" TEXT,
    "destino" TEXT NOT NULL,
    "asunto" TEXT,
    "cuerpo" TEXT NOT NULL,
    "estado" "EstadoMensajeCanal" NOT NULL DEFAULT 'PENDIENTE',
    "proveedorMensajeId" TEXT,
    "error" TEXT,
    "aprobacionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensajeCanal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanalCuenta_workspaceId_tipo_idx" ON "CanalCuenta"("workspaceId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "CanalCuenta_workspaceId_empresaId_tipo_proveedor_key" ON "CanalCuenta"("workspaceId", "empresaId", "tipo", "proveedor");

-- CreateIndex
CREATE INDEX "MensajeCanal_workspaceId_canalCuentaId_idx" ON "MensajeCanal"("workspaceId", "canalCuentaId");

-- CreateIndex
CREATE INDEX "MensajeCanal_workspaceId_tareaId_idx" ON "MensajeCanal"("workspaceId", "tareaId");

-- CreateIndex
CREATE UNIQUE INDEX "MensajeCanal_workspaceId_idempotencyKey_key" ON "MensajeCanal"("workspaceId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "MensajeCanal" ADD CONSTRAINT "MensajeCanal_canalCuentaId_fkey" FOREIGN KEY ("canalCuentaId") REFERENCES "CanalCuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
