-- Ajustes de protección de datos por workspace (ADR 0008 D2 y D7), antes guardados en Redis
-- (hash `nexo:privacy:settings`; PrivacySettingsService los copia aquí una sola vez al arrancar).

-- CreateEnum
CREATE TYPE "DataGuardMode" AS ENUM ('OFF', 'MASK', 'BLOCK');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "conversationRetentionDays" INTEGER,
ADD COLUMN     "dataGuardMode" "DataGuardMode" NOT NULL DEFAULT 'MASK',
ADD COLUMN     "privacySettingsUpdatedAt" TIMESTAMP(3);

-- CreateIndex (purga diaria de conversaciones vencidas)
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

-- CreateIndex (purga diaria de sesiones del Copilot vencidas)
CREATE INDEX "CopilotSession_workspaceId_updatedAt_idx" ON "CopilotSession"("workspaceId", "updatedAt");
