-- CreateTable
CREATE TABLE "AgentTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "area" TEXT,
    "nivel" "NivelJerarquico",
    "sourceAgentId" TEXT,
    "publicadoPorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTemplateVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "notas" TEXT,
    "publicadoPorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentTemplate_workspaceId_idx" ON "AgentTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "AgentTemplate_workspaceId_sourceAgentId_idx" ON "AgentTemplate"("workspaceId", "sourceAgentId");

-- CreateIndex
CREATE INDEX "AgentTemplateVersion_workspaceId_templateId_idx" ON "AgentTemplateVersion"("workspaceId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTemplateVersion_templateId_version_key" ON "AgentTemplateVersion"("templateId", "version");

-- AddForeignKey
ALTER TABLE "AgentTemplateVersion" ADD CONSTRAINT "AgentTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AgentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
