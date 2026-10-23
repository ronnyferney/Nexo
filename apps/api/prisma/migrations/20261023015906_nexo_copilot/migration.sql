-- CreateEnum
CREATE TYPE "LaunchStatus" AS ENUM ('DRAFT', 'LAUNCHED');

-- CreateEnum
CREATE TYPE "CopilotMode" AS ENUM ('CREATE', 'IMPROVE', 'DIAGNOSE');

-- CreateEnum
CREATE TYPE "CopilotProposalKind" AS ENUM ('CREATE_AGENT', 'UPDATE_AGENT');

-- AlterEnum
ALTER TYPE "UsageSource" ADD VALUE 'COPILOT';

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "launchOverrideReason" TEXT,
ADD COLUMN     "launchStatus" "LaunchStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "launchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CopilotSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "mode" "CopilotMode" NOT NULL,
    "context" TEXT,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotProposal" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT,
    "kind" "CopilotProposalKind" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "comment" TEXT,
    "sharedConversation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopilotSession_workspaceId_createdAt_idx" ON "CopilotSession"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotMessage_sessionId_createdAt_idx" ON "CopilotMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotProposal_workspaceId_createdAt_idx" ON "CopilotProposal"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotFeedback_messageId_key" ON "CopilotFeedback"("messageId");

-- CreateIndex
CREATE INDEX "CopilotFeedback_createdAt_idx" ON "CopilotFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "CopilotMessage" ADD CONSTRAINT "CopilotMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CopilotSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotProposal" ADD CONSTRAINT "CopilotProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CopilotSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotFeedback" ADD CONSTRAINT "CopilotFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CopilotMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Los agentes existentes ya operaban en producción: se marcan como lanzados para no detener sus rutinas ni su publicación MCP.
UPDATE "Agent" SET "launchStatus" = 'LAUNCHED', "launchedAt" = NOW();
