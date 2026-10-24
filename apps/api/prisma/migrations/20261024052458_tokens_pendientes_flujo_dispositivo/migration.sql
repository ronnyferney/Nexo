-- Columna propia para los tokens del código de dispositivo pendientes de confirmar (M1b), que antes reutilizaban
-- `deviceCodeCipher`. Los flujos en curso (vida ≤ 10 min) se siguen leyendo desde `deviceCodeCipher`.

-- AlterTable
ALTER TABLE "LlmAuthFlow" ADD COLUMN     "pendingCipher" TEXT;
