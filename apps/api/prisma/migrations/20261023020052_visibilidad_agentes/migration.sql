-- CreateEnum
CREATE TYPE "AgentVisibility" AS ENUM ('PRIVATE', 'TEAM', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "SharePrincipal" AS ENUM ('USER', 'UNIT');

-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('USE', 'EDIT');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "visibility" "AgentVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "AgentShare" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "principalType" "SharePrincipal" NOT NULL,
    "principalId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'USE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentShare_principalType_principalId_idx" ON "AgentShare"("principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentShare_agentId_principalType_principalId_key" ON "AgentShare"("agentId", "principalType", "principalId");

-- AddForeignKey
ALTER TABLE "AgentShare" ADD CONSTRAINT "AgentShare_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Agentes existentes: visibles para toda la empresa (sin cambio de comportamiento) y con dueño = primer OWNER del workspace.
UPDATE "Agent" a SET "visibility" = 'WORKSPACE',
  "ownerId" = (SELECT m."userId" FROM "Membership" m WHERE m."workspaceId" = a."workspaceId" AND m."role" = 'OWNER'
               ORDER BY m."createdAt" ASC LIMIT 1);
