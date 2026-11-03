-- Extensión ADITIVA de la matriz de cumplimiento (P1.3 · ADR 0020): vigencia opcional de cada regla.
-- Ambas columnas son nullable (null = sin límite): no rompe reglas existentes ni cambia su comportamiento.
-- AlterTable
ALTER TABLE "ReglaCumplimiento" ADD COLUMN     "vigenciaDesde" TIMESTAMP(3),
ADD COLUMN     "vigenciaHasta" TIMESTAMP(3);
