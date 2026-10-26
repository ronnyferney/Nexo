-- Cuadrillas (ADR 0014 · D1 · E11). Migración ADITIVA: solo crea el enum `CuadrillaEstado` y las tablas
-- `CuadrillaPlantilla`/`CuadrillaVersion`/`CuadrillaMiembro`/`CuadrillaInstancia` con sus índices y FKs internas. No
-- altera ninguna columna existente ni la vuelve obligatoria. Se omiten a propósito los `DROP INDEX
-- "KnowledgeChunk_search_idx"` / `ALTER COLUMN "search" DROP DEFAULT` que Prisma añade de forma espuria (índice GIN y
-- columna generada creados con SQL manual; ver CLAUDE.md): esta migración no los debe tocar.

-- CreateEnum
CREATE TYPE "CuadrillaEstado" AS ENUM ('BORRADOR', 'PUBLICADA', 'RETIRADA');

-- CreateTable
CREATE TABLE "CuadrillaPlantilla" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "nombre" TEXT NOT NULL,
    "proposito" TEXT,
    "procesoObjetivo" TEXT,
    "estado" "CuadrillaEstado" NOT NULL DEFAULT 'BORRADOR',
    "creadaPorUserId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuadrillaPlantilla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuadrillaVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plantillaId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definicion" JSONB NOT NULL DEFAULT '{}',
    "publicadaPorUserId" TEXT,
    "publicadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuadrillaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuadrillaMiembro" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "cargoId" TEXT,
    "nivelEsperado" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conectoresSugeridos" JSONB NOT NULL DEFAULT '[]',
    "politicaSugerida" JSONB NOT NULL DEFAULT '{}',
    "criteriosResultado" JSONB NOT NULL DEFAULT '{}',
    "delegaA" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuadrillaMiembro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuadrillaInstancia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plantillaId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "instanciadaPorUserId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "agentesCreados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objetivosCreados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuadrillaInstancia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CuadrillaPlantilla_workspaceId_estado_idx" ON "CuadrillaPlantilla"("workspaceId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "CuadrillaVersion_workspaceId_plantillaId_version_key" ON "CuadrillaVersion"("workspaceId", "plantillaId", "version");

-- CreateIndex
CREATE INDEX "CuadrillaMiembro_workspaceId_versionId_idx" ON "CuadrillaMiembro"("workspaceId", "versionId");

-- CreateIndex
CREATE INDEX "CuadrillaInstancia_workspaceId_plantillaId_idx" ON "CuadrillaInstancia"("workspaceId", "plantillaId");

-- AddForeignKey
ALTER TABLE "CuadrillaVersion" ADD CONSTRAINT "CuadrillaVersion_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "CuadrillaPlantilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuadrillaMiembro" ADD CONSTRAINT "CuadrillaMiembro_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CuadrillaVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuadrillaInstancia" ADD CONSTRAINT "CuadrillaInstancia_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "CuadrillaPlantilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
