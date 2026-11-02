-- CreateTable
CREATE TABLE "CrewTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "sourceCuadrillaId" TEXT,
    "publicadoPorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewTemplateVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "notas" TEXT,
    "publicadoPorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrewTemplate_workspaceId_idx" ON "CrewTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "CrewTemplate_workspaceId_sourceCuadrillaId_idx" ON "CrewTemplate"("workspaceId", "sourceCuadrillaId");

-- CreateIndex
CREATE INDEX "CrewTemplateVersion_workspaceId_templateId_idx" ON "CrewTemplateVersion"("workspaceId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewTemplateVersion_templateId_version_key" ON "CrewTemplateVersion"("templateId", "version");

-- AddForeignKey
ALTER TABLE "CrewTemplateVersion" ADD CONSTRAINT "CrewTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CrewTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
