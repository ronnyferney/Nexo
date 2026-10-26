import type { EstadoResultado } from '../../core/results.models';
import type { DocumentoRef, PasaporteResultado } from '../../core/pasaporte.models';
import { formatUsd } from '../../shared/usd.pipe';

/**
 * Lógica PURA del panel de Pasaporte de Resultado (ADR 0014 · E14): traducción de motivos de verificación a texto
 * legible, formateo de costo/conteos, decisión de qué acción ofrecer (emitir vs. ver) y distinción autor humano vs.
 * digital. Sin Angular ni HTTP: fácilmente verificable y reutilizable por la plantilla.
 */

/** Acción que ofrece el panel según el estado del resultado y si ya se conoce un pasaporte. */
export type AccionPasaporte = 'no-aplica' | 'emitir' | 'ver';

/**
 * Decide la acción del panel:
 * - `no-aplica`: el resultado no está ACEPTADO (solo se emite pasaporte de un resultado verificado y aceptado).
 * - `ver`: ya se conoce un pasaporte emitido → mostrar la hoja de vida.
 * - `emitir`: resultado ACEPTADO sin pasaporte conocido → ofrecer la emisión (solo a quien puede editar).
 */
export function accionPasaporte(
  estado: EstadoResultado | null | undefined,
  pasaporte: PasaporteResultado | null | undefined,
): AccionPasaporte {
  if (estado !== 'ACEPTADO') return 'no-aplica';
  return pasaporte ? 'ver' : 'emitir';
}

/** Veredicto de la verificación en forma de etiqueta + tono para la UI. */
export interface VeredictoVista {
  ok: boolean;
  titulo: string;
  detalle: string;
}

const MOTIVO_TEXTO: Record<string, string> = {
  CONTRATO_FALTANTE: 'El contrato de resultado referenciado ya no existe en el workspace.',
  REFERENCIA_ALTERADA:
    'Alguna de las referencias (agentes, ejecuciones, aprobaciones, validaciones…) cambió desde que se emitió: el documento ya no cuadra con su huella original.',
  ANCLA_FALTANTE: 'La entrada de auditoría que ancla el pasaporte no se encuentra.',
  ANCLA_NO_CUADRA: 'El ancla de auditoría no coincide con el pasaporte (secuencia, acción o huella alteradas).',
  CADENA_SECUENCIA_ROTA: 'La cadena de auditoría del workspace tiene un salto de secuencia.',
  CADENA_CONTENIDO_ALTERADO: 'El contenido de una entrada de la cadena de auditoría fue alterado.',
  CADENA_ENLACE_ROTO: 'El encadenamiento de huellas de la auditoría está roto.',
  CADENA_ROTA: 'La cadena de auditoría del workspace no verifica.',
};

/**
 * Traduce un veredicto de verificación a texto legible en español. Un motivo desconocido se muestra tal cual (sin
 * inventar una causa): se prefiere ser honesto a adornar.
 */
export function veredictoVista(ok: boolean, motivo?: string | null): VeredictoVista {
  if (ok) {
    return {
      ok: true,
      titulo: 'Íntegro y verificado',
      detalle: 'La cadena de custodia cuadra: referencias, ancla y auditoría inmutable coinciden. A prueba de manipulación.',
    };
  }
  const detalle = (motivo && MOTIVO_TEXTO[motivo]) || `No verifica${motivo ? ` (${motivo})` : ''}.`;
  return { ok: false, titulo: 'No verifica', detalle };
}

/** Formatea el costo total imputado (string Decimal del backend) como USD en español. `—` si no es un número. */
export function formatCostoTotal(costoUsd: string | null | undefined): string {
  if (costoUsd === null || costoUsd === undefined || costoUsd === '') return '—';
  const n = Number(costoUsd);
  return Number.isNaN(n) ? '—' : formatUsd(n, 'auto');
}

/** Autor de la emisión: humano (hay `emitidoPorUserId`) o digital/sistema (no lo hay). */
export interface AutorVista {
  tipo: 'humano' | 'digital';
  etiqueta: string;
  icon: string;
}

export function autorPasaporte(emitidoPorUserId: string | null | undefined): AutorVista {
  return emitidoPorUserId
    ? { tipo: 'humano', etiqueta: 'Persona', icon: 'user' }
    : { tipo: 'digital', etiqueta: 'Sistema / agente', icon: 'cpu' };
}

/** Línea resumen de totales para la hoja de vida, legible y sin inventar datos. */
export interface ConteoVista {
  label: string;
  valor: number;
  icon: string;
}

export function conteosVista(doc: DocumentoRef): ConteoVista[] {
  const t = doc.totales;
  return [
    { label: 'Agentes', valor: doc.agentes.length, icon: 'bot' },
    { label: 'Ejecuciones', valor: t.numEjecuciones, icon: 'play' },
    { label: 'Transferencias', valor: t.numTransferencias, icon: 'shuffle' },
    { label: 'Mensajes', valor: t.numMensajes, icon: 'send' },
    { label: 'Aprobaciones', valor: t.numAprobaciones, icon: 'shield' },
    { label: 'Validaciones', valor: t.numValidaciones, icon: 'checkCircle' },
    { label: 'Conectores', valor: doc.conectores.length, icon: 'plug' },
    { label: 'Consumos', valor: t.numUsageRecords, icon: 'wallet' },
  ];
}

/** Clave de almacenamiento local del último pasaporte conocido por contrato (puntero de conveniencia, no fuente de verdad). */
export function claveAlmacen(contratoId: string): string {
  return `nexo.pasaporte.${contratoId}`;
}
