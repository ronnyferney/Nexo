-- Se eliminaron del SQL generado el DROP INDEX "KnowledgeChunk_search_idx" y el ALTER COLUMN "search": la columna
-- generada y su índice GIN se crean con SQL manual que Prisma no modela (ver CLAUDE.md).

-- CreateTable
CREATE TABLE "PlatformOAuthApp" (
    "provider" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretCipher" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformOAuthApp_pkey" PRIMARY KEY ("provider")
);
