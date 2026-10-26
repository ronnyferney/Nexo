-- E14 incremento 2 (WhatsApp): acuse de lectura del destinatario (Meta `read` / Twilio `read`).
-- Cambio ADITIVO: solo agrega un valor al enum; no altera datos ni índices existentes.
-- AlterEnum
ALTER TYPE "EstadoMensajeCanal" ADD VALUE 'LEIDO';
