-- CreateEnum
CREATE TYPE "PolicyEffect" AS ENUM ('ALLOW', 'DENY', 'REQUIRE_APPROVAL');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('BORRADOR', 'ACTIVA', 'ARCHIVADA');

-- CreateEnum
CREATE TYPE "ApprovalRisk" AS ENUM ('BAJO', 'MEDIO', 'ALTO');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'AJUSTE', 'EJECUTADA', 'CADUCADA', 'INVALIDADA');

-- CreateEnum
CREATE TYPE "SuspensionScope" AS ENUM ('AGENTE', 'PROCESO', 'CONECTOR', 'ORGANIZACION');

-- CreateTable
CREATE TABLE "Politica" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT,
    "nombre" TEXT NOT NULL,
    "tipoAccion" TEXT NOT NULL,
    "selector" JSONB NOT NULL DEFAULT '{}',
    "efecto" "PolicyEffect" NOT NULL,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteHasta" TIMESTAMP(3),
    "estado" "PolicyStatus" NOT NULL DEFAULT 'ACTIVA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Politica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionPolitica" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipoAccion" TEXT NOT NULL,
    "actionContextHash" TEXT NOT NULL,
    "efecto" "PolicyEffect" NOT NULL,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 0,
    "policyVersions" JSONB NOT NULL DEFAULT '[]',
    "motivo" TEXT NOT NULL,
    "aprobacionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionPolitica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aprobacion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT,
    "tareaId" TEXT,
    "proposito" TEXT,
    "tipoAccion" TEXT NOT NULL,
    "operacion" JSONB NOT NULL DEFAULT '{}',
    "identidadEjec" JSONB NOT NULL DEFAULT '{}',
    "destinatarios" JSONB NOT NULL DEFAULT '[]',
    "contenido" JSONB NOT NULL DEFAULT '{}',
    "adjuntos" JSONB,
    "contentHash" TEXT NOT NULL,
    "importe" DECIMAL(18,2),
    "moneda" TEXT,
    "riesgo" "ApprovalRisk" NOT NULL DEFAULT 'MEDIO',
    "evidencia" JSONB,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "solicitanteUserId" TEXT,
    "solicitanteAgentId" TEXT,
    "orgUnitId" TEXT,
    "decisiones" JSONB NOT NULL DEFAULT '[]',
    "estado" "ApprovalStatus" NOT NULL DEFAULT 'PENDIENTE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decisionPoliticaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Aprobacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suspension" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "alcance" "SuspensionScope" NOT NULL,
    "targetId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "motivo" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reactivadaPor" TEXT,
    "reactivadaMotivo" TEXT,
    "reactivadaAt" TIMESTAMP(3),

    CONSTRAINT "Suspension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Politica_workspaceId_tipoAccion_estado_idx" ON "Politica"("workspaceId", "tipoAccion", "estado");

-- CreateIndex
CREATE INDEX "Politica_workspaceId_empresaId_idx" ON "Politica"("workspaceId", "empresaId");

-- CreateIndex
CREATE INDEX "DecisionPolitica_workspaceId_createdAt_idx" ON "DecisionPolitica"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionPolitica_workspaceId_actionContextHash_idx" ON "DecisionPolitica"("workspaceId", "actionContextHash");

-- CreateIndex
CREATE INDEX "Aprobacion_workspaceId_estado_idx" ON "Aprobacion"("workspaceId", "estado");

-- CreateIndex
CREATE INDEX "Aprobacion_workspaceId_createdAt_idx" ON "Aprobacion"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Aprobacion_workspaceId_tareaId_idx" ON "Aprobacion"("workspaceId", "tareaId");

-- CreateIndex
CREATE INDEX "Suspension_workspaceId_activa_idx" ON "Suspension"("workspaceId", "activa");

-- CreateIndex
CREATE INDEX "Suspension_workspaceId_alcance_targetId_idx" ON "Suspension"("workspaceId", "alcance", "targetId");

-- AddForeignKey
ALTER TABLE "Politica" ADD CONSTRAINT "Politica_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionPolitica" ADD CONSTRAINT "DecisionPolitica_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aprobacion" ADD CONSTRAINT "Aprobacion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suspension" ADD CONSTRAINT "Suspension_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

