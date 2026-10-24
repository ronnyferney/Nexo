-- CreateEnum
CREATE TYPE "LlmCredentialType" AS ENUM ('API_KEY', 'OAUTH');

-- CreateEnum
CREATE TYPE "LlmAuthFlowType" AS ENUM ('OAUTH', 'DEVICE_CODE');

-- AlterTable
ALTER TABLE "LlmConnection" ADD COLUMN     "credentialType" "LlmCredentialType" NOT NULL DEFAULT 'API_KEY',
ADD COLUMN     "oauthExpiresAt" TIMESTAMP(3),
ADD COLUMN     "oauthRefreshCipher" TEXT,
ADD COLUMN     "oauthScope" TEXT;

-- AlterTable
ALTER TABLE "LlmModel" ADD COLUMN     "contextTokens" INTEGER,
ADD COLUMN     "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "LlmAuthFlow" (
    "id" TEXT NOT NULL,
    "type" "LlmAuthFlowType" NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "fields" JSONB,
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceCodeCipher" TEXT,
    "intervalSec" INTEGER,
    "nextPollAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "connectionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmAuthFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmAuthFlow_workspaceId_idx" ON "LlmAuthFlow"("workspaceId");

-- CreateIndex
CREATE INDEX "LlmAuthFlow_expiresAt_idx" ON "LlmAuthFlow"("expiresAt");

-- AddForeignKey
ALTER TABLE "LlmAuthFlow" ADD CONSTRAINT "LlmAuthFlow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
