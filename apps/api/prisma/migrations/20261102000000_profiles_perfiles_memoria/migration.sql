-- Migración aditiva (ADR 0018 Inc.1): perfiles de contacto/organización y memoria operativa.
-- Nota: se removieron del SQL autogenerado las sentencias espurias sobre KnowledgeChunk
-- (`DROP INDEX "KnowledgeChunk_search_idx"` y `ALTER COLUMN "search" DROP DEFAULT`), ya que
-- la columna tsvector generada y su índice GIN se mantienen con SQL manual (ver CLAUDE.md).

-- CreateEnum
CREATE TYPE "EstadoMemoria" AS ENUM ('PROPUESTO', 'CONFIRMADO');

-- CreateTable
CREATE TABLE "OrganizacionPerfil" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "dominio" TEXT,
    "tipoSector" TEXT,
    "notas" TEXT,
    "fuente" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizacionPerfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactoPerfil" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correoPrincipal" TEXT,
    "correos" JSONB NOT NULL DEFAULT '[]',
    "telefonos" JSONB,
    "idioma" TEXT,
    "tono" TEXT,
    "organizacionId" TEXT,
    "senales" JSONB,
    "fuente" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactoPerfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoriaOperativa" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "procesoClave" TEXT NOT NULL,
    "hecho" TEXT NOT NULL,
    "fuente" TEXT,
    "estado" "EstadoMemoria" NOT NULL DEFAULT 'PROPUESTO',
    "caducaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoriaOperativa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizacionPerfil_workspaceId_idx" ON "OrganizacionPerfil"("workspaceId");

-- CreateIndex
CREATE INDEX "OrganizacionPerfil_workspaceId_dominio_idx" ON "OrganizacionPerfil"("workspaceId", "dominio");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizacionPerfil_workspaceId_dominio_key" ON "OrganizacionPerfil"("workspaceId", "dominio");

-- CreateIndex
CREATE INDEX "ContactoPerfil_workspaceId_idx" ON "ContactoPerfil"("workspaceId");

-- CreateIndex
CREATE INDEX "ContactoPerfil_workspaceId_correoPrincipal_idx" ON "ContactoPerfil"("workspaceId", "correoPrincipal");

-- CreateIndex
CREATE INDEX "ContactoPerfil_organizacionId_idx" ON "ContactoPerfil"("organizacionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactoPerfil_workspaceId_correoPrincipal_key" ON "ContactoPerfil"("workspaceId", "correoPrincipal");

-- CreateIndex
CREATE INDEX "MemoriaOperativa_workspaceId_idx" ON "MemoriaOperativa"("workspaceId");

-- CreateIndex
CREATE INDEX "MemoriaOperativa_workspaceId_procesoClave_idx" ON "MemoriaOperativa"("workspaceId", "procesoClave");

-- AddForeignKey
ALTER TABLE "OrganizacionPerfil" ADD CONSTRAINT "OrganizacionPerfil_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactoPerfil" ADD CONSTRAINT "ContactoPerfil_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactoPerfil" ADD CONSTRAINT "ContactoPerfil_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "OrganizacionPerfil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoriaOperativa" ADD CONSTRAINT "MemoriaOperativa_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
