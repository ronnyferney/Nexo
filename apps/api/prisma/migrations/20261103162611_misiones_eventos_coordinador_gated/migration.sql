-- CreateEnum
CREATE TYPE "TipoMisionEvento" AS ENUM ('SEGUIMIENTO', 'BLOQUEO_DETECTADO', 'ESCALAMIENTO', 'SUPERVISION', 'DECISION_HUMANA_SOLICITADA', 'CONTINUIDAD', 'CONTRADICCION');

-- CreateEnum
CREATE TYPE "ActorMisionEvento" AS ENUM ('HUMANO', 'AGENTE', 'SISTEMA');

-- NOTA (CLAUDE.md): Prisma genera aquí un `DROP INDEX "KnowledgeChunk_search_idx"` y un
-- `ALTER TABLE "KnowledgeChunk" ALTER COLUMN "search" DROP DEFAULT` espurios (no modela la columna generada tsvector ni
-- su índice GIN). Se eliminan a propósito: esta migración es ADITIVA y no debe tocar el índice de búsqueda.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "coordinadorGobiernoActivo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MisionEvento" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "misionId" TEXT NOT NULL,
    "tipo" "TipoMisionEvento" NOT NULL,
    "actorTipo" "ActorMisionEvento" NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "requiereDecision" BOOLEAN NOT NULL DEFAULT false,
    "resueltoPor" TEXT,
    "resueltoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MisionEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MisionEvento_workspaceId_misionId_tipo_idx" ON "MisionEvento"("workspaceId", "misionId", "tipo");

-- CreateIndex
CREATE INDEX "MisionEvento_workspaceId_requiereDecision_idx" ON "MisionEvento"("workspaceId", "requiereDecision");

-- AddForeignKey
ALTER TABLE "MisionEvento" ADD CONSTRAINT "MisionEvento_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisionEvento" ADD CONSTRAINT "MisionEvento_misionId_fkey" FOREIGN KEY ("misionId") REFERENCES "MisionTransversal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
