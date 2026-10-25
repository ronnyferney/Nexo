-- CreateEnum
CREATE TYPE "EstadoTarea" AS ENUM ('PENDIENTE', 'EN_EJECUCION', 'ESPERANDO_APROBACION', 'BLOQUEADA', 'EN_REVISION', 'COMPLETADA', 'FALLIDA_CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoResultado" AS ENUM ('PROPUESTO', 'COMPROMETIDO', 'EN_PRODUCCION', 'PENDIENTE_VALIDACION', 'ACEPTADO', 'DEVUELTO_INCUMPLIDO');

-- CreateEnum
CREATE TYPE "TipoResultado" AS ENUM ('PRODUCTO_INTERMEDIO', 'RESULTADO_NEGOCIO');

-- CreateEnum
CREATE TYPE "ModoValidacion" AS ENUM ('DETERMINISTA', 'HUMANA', 'ASISTIDA');

-- CreateEnum
CREATE TYPE "VeredictoValidacion" AS ENUM ('ACEPTA', 'DEVUELVE');

-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "tareaId" TEXT;

-- CreateTable
CREATE TABLE "Objetivo" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "indicador" TEXT,
    "lineaBase" TEXT,
    "meta" TEXT,
    "plazo" TIMESTAMP(3),
    "duenoUserId" TEXT,
    "responsableAgentId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Objetivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "objetivoId" TEXT,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "criterioAceptacion" TEXT,
    "entradas" JSONB NOT NULL DEFAULT '{}',
    "responsableAgentId" TEXT,
    "equipoId" TEXT,
    "duenoUserId" TEXT,
    "prioridad" INTEGER NOT NULL DEFAULT 3,
    "fechaLimite" TIMESTAMP(3),
    "estado" "EstadoTarea" NOT NULL DEFAULT 'PENDIENTE',
    "tipoResultado" "TipoResultado" NOT NULL DEFAULT 'PRODUCTO_INTERMEDIO',
    "parentTareaId" TEXT,
    "profundidadDelegacion" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContratoResultado" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tareaId" TEXT,
    "resultadoEsperado" TEXT NOT NULL,
    "alcance" TEXT,
    "entradas" JSONB NOT NULL DEFAULT '{}',
    "responsableAgentId" TEXT,
    "duenoUserId" TEXT,
    "fecha" TIMESTAMP(3),
    "presupuestoUsd" DECIMAL(18,8),
    "indicador" TEXT,
    "reglaValidacion" JSONB NOT NULL DEFAULT '{}',
    "evidenciaExigida" JSONB NOT NULL DEFAULT '[]',
    "tipoResultado" "TipoResultado" NOT NULL DEFAULT 'RESULTADO_NEGOCIO',
    "nivelRiesgo" INTEGER NOT NULL DEFAULT 1,
    "estado" "EstadoResultado" NOT NULL DEFAULT 'PROPUESTO',
    "version" INTEGER NOT NULL DEFAULT 1,
    "comprometidoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContratoResultado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidacionResultado" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contratoResultadoId" TEXT NOT NULL,
    "modo" "ModoValidacion" NOT NULL,
    "verificadorAgentId" TEXT,
    "validadorUserId" TEXT,
    "reglaAplicada" JSONB,
    "veredicto" "VeredictoValidacion" NOT NULL,
    "motivo" TEXT,
    "evidenciaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidacionResultado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidencia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contratoResultadoId" TEXT,
    "tareaId" TEXT,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "referencia" JSONB NOT NULL DEFAULT '{}',
    "hash" TEXT,
    "propietarioUserId" TEXT,
    "vigenteHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incumplimiento" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "causa" TEXT NOT NULL,
    "responsableUserId" TEXT,
    "escalaAgentId" TEXT,
    "planRecuperacion" TEXT,
    "plazo" TIMESTAMP(3),
    "maxReintentos" INTEGER NOT NULL DEFAULT 0,
    "maxCostoUsd" DECIMAL(18,8),
    "maxCiclos" INTEGER NOT NULL DEFAULT 0,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ciclos" INTEGER NOT NULL DEFAULT 0,
    "resuelto" BOOLEAN NOT NULL DEFAULT false,
    "resolucion" TEXT,
    "resueltoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incumplimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Objetivo_workspaceId_orgUnitId_idx" ON "Objetivo"("workspaceId", "orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "Objetivo_workspaceId_codigo_key" ON "Objetivo"("workspaceId", "codigo");

-- CreateIndex
CREATE INDEX "Tarea_workspaceId_estado_idx" ON "Tarea"("workspaceId", "estado");

-- CreateIndex
CREATE INDEX "Tarea_workspaceId_objetivoId_idx" ON "Tarea"("workspaceId", "objetivoId");

-- CreateIndex
CREATE INDEX "Tarea_workspaceId_fechaLimite_idx" ON "Tarea"("workspaceId", "fechaLimite");

-- CreateIndex
CREATE INDEX "Tarea_parentTareaId_idx" ON "Tarea"("parentTareaId");

-- CreateIndex
CREATE UNIQUE INDEX "ContratoResultado_tareaId_key" ON "ContratoResultado"("tareaId");

-- CreateIndex
CREATE INDEX "ContratoResultado_workspaceId_estado_idx" ON "ContratoResultado"("workspaceId", "estado");

-- CreateIndex
CREATE INDEX "ValidacionResultado_workspaceId_contratoResultadoId_idx" ON "ValidacionResultado"("workspaceId", "contratoResultadoId");

-- CreateIndex
CREATE INDEX "Evidencia_workspaceId_contratoResultadoId_idx" ON "Evidencia"("workspaceId", "contratoResultadoId");

-- CreateIndex
CREATE INDEX "Evidencia_workspaceId_tareaId_idx" ON "Evidencia"("workspaceId", "tareaId");

-- CreateIndex
CREATE INDEX "Incumplimiento_workspaceId_tareaId_idx" ON "Incumplimiento"("workspaceId", "tareaId");

-- CreateIndex
CREATE INDEX "Incumplimiento_workspaceId_resuelto_idx" ON "Incumplimiento"("workspaceId", "resuelto");

-- CreateIndex
CREATE INDEX "Execution_tareaId_idx" ON "Execution"("tareaId");

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objetivo" ADD CONSTRAINT "Objetivo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_objetivoId_fkey" FOREIGN KEY ("objetivoId") REFERENCES "Objetivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoResultado" ADD CONSTRAINT "ContratoResultado_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoResultado" ADD CONSTRAINT "ContratoResultado_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidacionResultado" ADD CONSTRAINT "ValidacionResultado_contratoResultadoId_fkey" FOREIGN KEY ("contratoResultadoId") REFERENCES "ContratoResultado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidencia" ADD CONSTRAINT "Evidencia_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidencia" ADD CONSTRAINT "Evidencia_contratoResultadoId_fkey" FOREIGN KEY ("contratoResultadoId") REFERENCES "ContratoResultado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidencia" ADD CONSTRAINT "Evidencia_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incumplimiento" ADD CONSTRAINT "Incumplimiento_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incumplimiento" ADD CONSTRAINT "Incumplimiento_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

