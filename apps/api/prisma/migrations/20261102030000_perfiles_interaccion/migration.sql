-- AlterTable: campos aditivos de interacción en ContactoPerfil (ADR 0018 Inc.2).
-- El enriquecimiento idempotente desde el correo fija `ultimaInteraccionEn` e incrementa `interaccionesCount`.
ALTER TABLE "ContactoPerfil" ADD COLUMN     "interaccionesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimaInteraccionEn" TIMESTAMP(3);
