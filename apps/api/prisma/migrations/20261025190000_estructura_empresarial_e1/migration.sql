-- Estructura empresarial (ADR 0011 · E1). Migración ADITIVA y retrocompatible:
--  - `OrgUnit` gana columnas nullable o con default neutro (las unidades previas quedan tipo=AREA_FUNCIONAL,
--    empresaId=null, estado=ACTIVA): ADR 0002 (presupuestos/reservas sobre OrgUnit) intacto.
--  - Tablas nuevas vacías: LineaNegocio, Sede, CentroCosto, AsignacionOrganizacional.
-- NOTA (regla de CLAUDE.md): se eliminaron del SQL generado por `prisma migrate diff` las sentencias espurias
--   `DROP INDEX "KnowledgeChunk_search_idx"` y `ALTER COLUMN "search" DROP DEFAULT` (columna/índice generados por SQL
--   manual que Prisma no modela). NO se deben reintroducir en futuras migraciones.

-- CreateEnum
CREATE TYPE "OrgUnitTipo" AS ENUM ('GRUPO', 'EMPRESA', 'UNIDAD_NEGOCIO', 'AREA_FUNCIONAL', 'DEPARTAMENTO', 'EQUIPO');

-- CreateEnum
CREATE TYPE "EstadoEstructura" AS ENUM ('ACTIVA', 'SUSPENDIDA', 'CERRADA');

-- CreateEnum
CREATE TYPE "TipoAsignacion" AS ENUM ('FUNCIONAL_PRINCIPAL', 'LINEA', 'SEDE', 'PROYECTO', 'SERVICIO');

-- AlterTable
ALTER TABLE "OrgUnit" ADD COLUMN     "empresaId" TEXT,
ADD COLUMN     "estado" "EstadoEstructura" NOT NULL DEFAULT 'ACTIVA',
ADD COLUMN     "responsableUserId" TEXT,
ADD COLUMN     "tipo" "OrgUnitTipo" NOT NULL DEFAULT 'AREA_FUNCIONAL',
ADD COLUMN     "vigenteDesde" TIMESTAMP(3),
ADD COLUMN     "vigenteHasta" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LineaNegocio" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "responsableUserId" TEXT,
    "metas" JSONB NOT NULL DEFAULT '{}',
    "estado" "EstadoEstructura" NOT NULL DEFAULT 'ACTIVA',
    "vigenteDesde" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineaNegocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sede" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "zonaHoraria" TEXT NOT NULL,
    "alcanceTerritorial" TEXT,
    "estado" "EstadoEstructura" NOT NULL DEFAULT 'ACTIVA',
    "vigenteDesde" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CentroCosto" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "lineaNegocioId" TEXT,
    "estado" "EstadoEstructura" NOT NULL DEFAULT 'ACTIVA',
    "vigenteDesde" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentroCosto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsignacionOrganizacional" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT,
    "userId" TEXT,
    "tipoAsignacion" "TipoAsignacion" NOT NULL,
    "orgUnitId" TEXT,
    "lineaNegocioId" TEXT,
    "sedeId" TEXT,
    "proyectoId" TEXT,
    "rol" TEXT,
    "alcance" JSONB NOT NULL DEFAULT '{}',
    "estado" "EstadoEstructura" NOT NULL DEFAULT 'ACTIVA',
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteHasta" TIMESTAMP(3),
    "creadaPorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AsignacionOrganizacional_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineaNegocio_workspaceId_empresaId_idx" ON "LineaNegocio"("workspaceId", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "LineaNegocio_workspaceId_empresaId_codigo_key" ON "LineaNegocio"("workspaceId", "empresaId", "codigo");

-- CreateIndex
CREATE INDEX "Sede_workspaceId_empresaId_idx" ON "Sede"("workspaceId", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Sede_workspaceId_empresaId_codigo_key" ON "Sede"("workspaceId", "empresaId", "codigo");

-- CreateIndex
CREATE INDEX "CentroCosto_workspaceId_empresaId_idx" ON "CentroCosto"("workspaceId", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "CentroCosto_workspaceId_empresaId_codigo_key" ON "CentroCosto"("workspaceId", "empresaId", "codigo");

-- CreateIndex
CREATE INDEX "AsignacionOrganizacional_workspaceId_agentId_idx" ON "AsignacionOrganizacional"("workspaceId", "agentId");

-- CreateIndex
CREATE INDEX "AsignacionOrganizacional_workspaceId_userId_idx" ON "AsignacionOrganizacional"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "AsignacionOrganizacional_workspaceId_lineaNegocioId_idx" ON "AsignacionOrganizacional"("workspaceId", "lineaNegocioId");

-- CreateIndex
CREATE INDEX "OrgUnit_workspaceId_tipo_idx" ON "OrgUnit"("workspaceId", "tipo");

-- CreateIndex
CREATE INDEX "OrgUnit_workspaceId_empresaId_idx" ON "OrgUnit"("workspaceId", "empresaId");

-- AddForeignKey
ALTER TABLE "LineaNegocio" ADD CONSTRAINT "LineaNegocio_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sede" ADD CONSTRAINT "Sede_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CentroCosto" ADD CONSTRAINT "CentroCosto_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsignacionOrganizacional" ADD CONSTRAINT "AsignacionOrganizacional_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índice parcial único (SQL manual; al estilo de OrgUnit_root_per_workspace): a lo sumo UNA asignación
-- FUNCIONAL_PRINCIPAL vigente (vigenteHasta IS NULL) por sujeto (RF42). Un sujeto es un agente o un miembro, por eso
-- hay un índice por cada tipo de sujeto. NO eliminar estos índices en futuras migraciones (regla de CLAUDE.md).
CREATE UNIQUE INDEX "AsignacionOrganizacional_funcional_principal_agent"
  ON "AsignacionOrganizacional"("workspaceId", "agentId")
  WHERE "tipoAsignacion" = 'FUNCIONAL_PRINCIPAL' AND "vigenteHasta" IS NULL AND "agentId" IS NOT NULL;

CREATE UNIQUE INDEX "AsignacionOrganizacional_funcional_principal_user"
  ON "AsignacionOrganizacional"("workspaceId", "userId")
  WHERE "tipoAsignacion" = 'FUNCIONAL_PRINCIPAL' AND "vigenteHasta" IS NULL AND "userId" IS NOT NULL;
