-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "EvalRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- AlterEnum
ALTER TYPE "UsageSource" ADD VALUE 'EVAL';

-- CreateTable
CREATE TABLE "MessageFeedback" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "userId" TEXT,
    "userMessage" TEXT NOT NULL,
    "agentResponse" TEXT NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "comment" TEXT,
    "correction" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalCase" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "expected" TEXT,
    "criteria" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "versionId" TEXT,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'QUEUED',
    "judgeProviderId" TEXT NOT NULL,
    "judgeModel" TEXT NOT NULL,
    "passThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "score" DOUBLE PRECISION,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT,
    "input" TEXT NOT NULL,
    "expected" TEXT,
    "output" TEXT,
    "score" DOUBLE PRECISION,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "reasoning" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "humanScore" DOUBLE PRECISION,
    "humanNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptSuggestion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "rationale" TEXT NOT NULL,
    "proposal" JSONB NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageFeedback_workspaceId_status_createdAt_idx" ON "MessageFeedback"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MessageFeedback_agentId_createdAt_idx" ON "MessageFeedback"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "EvalCase_agentId_idx" ON "EvalCase"("agentId");

-- CreateIndex
CREATE INDEX "EvalRun_agentId_createdAt_idx" ON "EvalRun"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "EvalResult_runId_idx" ON "EvalResult"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentVersion_agentId_version_key" ON "AgentVersion"("agentId", "version");

-- CreateIndex
CREATE INDEX "PromptSuggestion_agentId_createdAt_idx" ON "PromptSuggestion"("agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "MessageFeedback" ADD CONSTRAINT "MessageFeedback_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalCase" ADD CONSTRAINT "EvalCase_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AgentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "EvalCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptSuggestion" ADD CONSTRAINT "PromptSuggestion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptSuggestion" ADD CONSTRAINT "PromptSuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
