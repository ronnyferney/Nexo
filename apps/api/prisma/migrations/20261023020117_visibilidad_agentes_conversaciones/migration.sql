-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "allowPersonalAgents" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Conversation_agentId_userId_idx" ON "Conversation"("agentId", "userId");
