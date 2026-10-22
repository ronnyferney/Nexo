-- CreateEnum
CREATE TYPE "LlmKind" AS ENUM ('ANTHROPIC', 'OPENAI_COMPATIBLE', 'MOCK');

-- CreateEnum
CREATE TYPE "ModelTier" AS ENUM ('PREMIUM', 'STANDARD', 'ECONOMY');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "BudgetPolicy" AS ENUM ('BLOCK', 'DOWNGRADE', 'ALERT_ONLY');

-- CreateEnum
CREATE TYPE "UsageSource" AS ENUM ('CHAT', 'WORKFLOW', 'MCP');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "orgUnitId" TEXT;

-- CreateTable
CREATE TABLE "LlmConnection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LlmKind" NOT NULL,
    "baseUrl" TEXT,
    "apiKeyCipher" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmModel" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tier" "ModelTier" NOT NULL DEFAULT 'STANDARD',
    "inputUsdPerMTok" DECIMAL(12,6) NOT NULL,
    "outputUsdPerMTok" DECIMAL(12,6) NOT NULL,
    "cacheReadUsdPerMTok" DECIMAL(12,6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "connectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "parentId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "period" "BudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "limitUsd" DECIMAL(14,4) NOT NULL,
    "policy" "BudgetPolicy" NOT NULL DEFAULT 'BLOCK',
    "alertThresholds" INTEGER[] DEFAULT ARRAY[50, 80, 100]::INTEGER[],
    "downgradeProviderId" TEXT,
    "downgradeModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLedger" (
    "orgUnitId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "spentUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLedger_pkey" PRIMARY KEY ("orgUnitId","periodKey")
);

-- CreateTable
CREATE TABLE "BudgetAlert" (
    "id" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "spentUsd" DECIMAL(18,8) NOT NULL,
    "limitUsd" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "userId" TEXT,
    "agentId" TEXT,
    "workflowId" TEXT,
    "executionId" TEXT,
    "conversationId" TEXT,
    "source" "UsageSource" NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmConnection_workspaceId_idx" ON "LlmConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LlmModel_connectionId_modelId_key" ON "LlmModel"("connectionId", "modelId");

-- CreateIndex
CREATE INDEX "OrgUnit_workspaceId_idx" ON "OrgUnit"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_orgUnitId_key" ON "Budget"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetAlert_orgUnitId_periodKey_threshold_key" ON "BudgetAlert"("orgUnitId", "periodKey", "threshold");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_createdAt_idx" ON "UsageRecord"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_orgUnitId_createdAt_idx" ON "UsageRecord"("orgUnitId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmConnection" ADD CONSTRAINT "LlmConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmModel" ADD CONSTRAINT "LlmModel_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "LlmConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLedger" ADD CONSTRAINT "BudgetLedger_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetAlert" ADD CONSTRAINT "BudgetAlert_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Una sola unidad raíz por workspace (índice parcial; Prisma no lo expresa en el esquema).
CREATE UNIQUE INDEX "OrgUnit_root_per_workspace" ON "OrgUnit"("workspaceId") WHERE "parentId" IS NULL;
