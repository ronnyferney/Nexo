-- AlterEnum
ALTER TYPE "ConnectorType" ADD VALUE 'DATABASE';

-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "catalogId" TEXT;

-- CreateTable
CREATE TABLE "OAuthCredential" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "accessTokenCipher" TEXT NOT NULL,
    "refreshTokenCipher" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "accountLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdgeAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "version" TEXT,
    "hostname" TEXT,
    "connections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdgeAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthCredential_connectorId_key" ON "OAuthCredential"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeAgent_tokenHash_key" ON "EdgeAgent"("tokenHash");

-- CreateIndex
CREATE INDEX "EdgeAgent_workspaceId_idx" ON "EdgeAgent"("workspaceId");

-- AddForeignKey
ALTER TABLE "OAuthCredential" ADD CONSTRAINT "OAuthCredential_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeAgent" ADD CONSTRAINT "EdgeAgent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
