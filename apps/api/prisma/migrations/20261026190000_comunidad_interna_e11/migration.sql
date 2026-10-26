-- CreateEnum
CREATE TYPE "PublicacionTipo" AS ENUM ('NOVEDAD', 'APOYO', 'APRENDIZAJE', 'COMPROMISO');

-- CreateEnum
CREATE TYPE "PublicacionEstado" AS ENUM ('ACTIVA', 'RESUELTA', 'ARCHIVADA');

-- CreateTable
CREATE TABLE "Publicacion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "autorUserId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "tipo" "PublicacionTipo" NOT NULL,
    "titulo" TEXT,
    "cuerpo" TEXT NOT NULL,
    "tareaId" TEXT,
    "estado" "PublicacionEstado" NOT NULL DEFAULT 'ACTIVA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publicacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comentario" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "publicacionId" TEXT NOT NULL,
    "autorUserId" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comentario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reaccion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "publicacionId" TEXT NOT NULL,
    "autorUserId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaccion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Publicacion_workspaceId_createdAt_idx" ON "Publicacion"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Publicacion_workspaceId_tipo_idx" ON "Publicacion"("workspaceId", "tipo");

-- CreateIndex
CREATE INDEX "Comentario_workspaceId_publicacionId_idx" ON "Comentario"("workspaceId", "publicacionId");

-- CreateIndex
CREATE INDEX "Reaccion_workspaceId_publicacionId_idx" ON "Reaccion"("workspaceId", "publicacionId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaccion_publicacionId_autorUserId_tipo_key" ON "Reaccion"("publicacionId", "autorUserId", "tipo");

-- AddForeignKey
ALTER TABLE "Publicacion" ADD CONSTRAINT "Publicacion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_publicacionId_fkey" FOREIGN KEY ("publicacionId") REFERENCES "Publicacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaccion" ADD CONSTRAINT "Reaccion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaccion" ADD CONSTRAINT "Reaccion_publicacionId_fkey" FOREIGN KEY ("publicacionId") REFERENCES "Publicacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
