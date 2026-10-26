-- CreateEnum
CREATE TYPE "EstadoIdempotencia" AS ENUM ('EN_PROGRESO', 'COMPLETADA', 'FALLIDA');

-- CreateEnum
CREATE TYPE "ClaseFallo" AS ENUM ('TEMPORAL', 'PERMANENTE', 'INCIERTO');

-- CreateEnum
CREATE TYPE "EstadoExcepcion" AS ENUM ('ABIERTA', 'EN_PROGRESO', 'CONCILIADA', 'REASIGNADA', 'CANCELADA', 'RESUELTA');

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "estado" "EstadoIdempotencia" NOT NULL DEFAULT 'EN_PROGRESO',
    "resultado" JSONB,
    "hash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Excepcion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT,
    "causa" TEXT NOT NULL,
    "clase" "ClaseFallo",
    "impacto" TEXT,
    "procesoId" TEXT,
    "tareaId" TEXT,
    "executionId" TEXT,
    "paso" TEXT,
    "evidencia" JSONB NOT NULL DEFAULT '{}',
    "duenoUserId" TEXT,
    "siguienteAccion" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'MANUAL',
    "idempotencyKeyId" TEXT,
    "estado" "EstadoExcepcion" NOT NULL DEFAULT 'ABIERTA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Excepcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcepcionEvento" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "excepcionId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "detalle" JSONB NOT NULL DEFAULT '{}',
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcepcionEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyKey_workspaceId_scope_idx" ON "IdempotencyKey"("workspaceId", "scope");

-- CreateIndex
CREATE INDEX "IdempotencyKey_workspaceId_estado_idx" ON "IdempotencyKey"("workspaceId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_workspaceId_clave_key" ON "IdempotencyKey"("workspaceId", "clave");

-- CreateIndex
CREATE INDEX "Excepcion_workspaceId_estado_idx" ON "Excepcion"("workspaceId", "estado");

-- CreateIndex
CREATE INDEX "Excepcion_workspaceId_tareaId_idx" ON "Excepcion"("workspaceId", "tareaId");

-- CreateIndex
CREATE INDEX "Excepcion_workspaceId_createdAt_idx" ON "Excepcion"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ExcepcionEvento_workspaceId_excepcionId_idx" ON "ExcepcionEvento"("workspaceId", "excepcionId");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Excepcion" ADD CONSTRAINT "Excepcion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcepcionEvento" ADD CONSTRAINT "ExcepcionEvento_excepcionId_fkey" FOREIGN KEY ("excepcionId") REFERENCES "Excepcion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
