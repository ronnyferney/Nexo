-- Migración aditiva: presupuestos — umbrales 80/90/100, bloqueo con override, nivel agente, preset piloto US$0 y
-- degradación por criticidad (P0.1/P1.1c). Las sentencias espurias de drift sobre la columna generada
-- `KnowledgeChunk.search` y su índice GIN `KnowledgeChunk_search_idx` (creados con SQL manual que Prisma no modela,
-- ver CLAUDE.md) se ELIMINARON de este script para no romperlos.

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "critico" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "impactoNota" TEXT,
ADD COLUMN     "impactoValidadoAt" TIMESTAMP(3),
ADD COLUMN     "impactoValidadoPor" TEXT,
ALTER COLUMN "alertThresholds" SET DEFAULT ARRAY[80, 90, 100]::INTEGER[];

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "modoPiloto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "modoPilotoDesde" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AgentBudget" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "period" "BudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "limitUsd" DECIMAL(18,8) NOT NULL,
    "policy" "BudgetPolicy" NOT NULL DEFAULT 'BLOCK',
    "alertThresholds" INTEGER[] DEFAULT ARRAY[80, 90, 100]::INTEGER[],
    "downgradeProviderId" TEXT,
    "downgradeModel" TEXT,
    "critico" BOOLEAN NOT NULL DEFAULT true,
    "impactoValidadoAt" TIMESTAMP(3),
    "impactoValidadoPor" TEXT,
    "impactoNota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentBudgetLedger" (
    "agentId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "spentUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentBudgetLedger_pkey" PRIMARY KEY ("agentId","periodKey")
);

-- CreateTable
CREATE TABLE "AgentBudgetAlert" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "spentUsd" DECIMAL(18,8) NOT NULL,
    "limitUsd" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentBudgetAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetOverride" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "agentId" TEXT,
    "periodKey" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "limitExtraUsd" DECIMAL(18,8),
    "grantedByUserId" TEXT,
    "grantedByRole" "Role" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentBudget_agentId_key" ON "AgentBudget"("agentId");

-- CreateIndex
CREATE INDEX "AgentBudget_workspaceId_idx" ON "AgentBudget"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentBudgetAlert_agentId_periodKey_threshold_key" ON "AgentBudgetAlert"("agentId", "periodKey", "threshold");

-- CreateIndex
CREATE INDEX "BudgetOverride_workspaceId_orgUnitId_periodKey_idx" ON "BudgetOverride"("workspaceId", "orgUnitId", "periodKey");

-- CreateIndex
CREATE INDEX "BudgetOverride_workspaceId_agentId_periodKey_idx" ON "BudgetOverride"("workspaceId", "agentId", "periodKey");

-- AddForeignKey
ALTER TABLE "AgentBudget" ADD CONSTRAINT "AgentBudget_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBudget" ADD CONSTRAINT "AgentBudget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBudgetLedger" ADD CONSTRAINT "AgentBudgetLedger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBudgetAlert" ADD CONSTRAINT "AgentBudgetAlert_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

