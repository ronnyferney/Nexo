-- Trazabilidad de rol/razón de enrutamiento en el consumo (ADR 0010 D5, decisión 2: registro obligatorio).
-- Aditiva y retrocompatible: los registros existentes quedan en NULL (sin política de enrutamiento).
-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "role" TEXT,
ADD COLUMN     "routingReason" TEXT;
