import type { Role } from '../../core/models';
import type { EstacionVirtual, EstadoEstacion } from '../../core/execution-params.models';

/** Etiqueta legible de cada estado de una estación virtual. */
export const ESTADO_ESTACION_LABELS: Record<EstadoEstacion, string> = {
  ACTIVA: 'Activa',
  SUSPENDIDA: 'Suspendida',
  RETIRADA: 'Retirada',
};

export function estadoEstacionLabel(estado: string): string {
  return ESTADO_ESTACION_LABELS[estado as EstadoEstacion] ?? estado;
}

/** Clase del `.badge` del design system según el estado de la estación. */
export function estadoEstacionBadgeClass(estado: string): string {
  switch (estado) {
    case 'ACTIVA':
      return 'success';
    case 'SUSPENDIDA':
      return 'warning';
    default:
      return '';
  }
}

/** Etiqueta de una estación: nombre y, si lo tiene, proveedor (p. ej. «Robot ventas · azure»). */
export function estacionLabel(e: Pick<EstacionVirtual, 'nombre' | 'proveedor'>): string {
  return e.proveedor ? `${e.nombre} · ${e.proveedor}` : e.nombre;
}

/**
 * Estaciones ofrecidas en el selector del agente: las ACTIVA y, si la asignada actual está suspendida o retirada, la
 * incluye igual para no ocultar el vínculo vigente. Ordenadas por nombre (es).
 */
export function estacionesSeleccionables(list: EstacionVirtual[], asignadaId: string | null): EstacionVirtual[] {
  return list
    .filter((e) => e.estado === 'ACTIVA' || e.id === asignadaId)
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Resultado de validar/parsear el JSON de parámetros de ejecución. */
export interface ParseParametrosResult {
  value?: Record<string, unknown>;
  error?: string;
}

/**
 * Valida y parsea el JSON de parámetros de ejecución. Debe ser un objeto (no una lista ni un primitivo); el texto
 * vacío equivale a `{}`. Devuelve el objeto o un mensaje de error legible.
 */
export function parseParametrosJson(raw: string): ParseParametrosResult {
  const trimmed = raw.trim();
  if (!trimmed) return { value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { error: `JSON inválido: ${(e as Error).message}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Los parámetros deben ser un objeto JSON, por ejemplo { "horarioOperacion": "L-V 9-18" }.' };
  }
  return { value: parsed as Record<string, unknown> };
}

/** Texto JSON indentado de un objeto de parámetros, para mostrarlo en el editor. */
export function formatParametrosJson(value: Record<string, unknown> | null | undefined): string {
  return JSON.stringify(value ?? {}, null, 2);
}

/** Puede fijar los parámetros de ejecución de un agente (estación, salida, parámetros): EDITOR o superior. */
export function puedeEditarParametros(role: Role | undefined | null): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';
}

/** Puede administrar (crear/editar/retirar) estaciones virtuales: ADMIN o superior. */
export function puedeAdministrarEstaciones(role: Role | undefined | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** Validación del nombre de una estación (2–120 caracteres), espejo del DTO del backend. */
export function validarNombreEstacion(nombre: string): string | null {
  const n = nombre.trim();
  if (n.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
  if (n.length > 120) return 'El nombre no puede superar los 120 caracteres.';
  return null;
}

/** Explicación del significado de seguridad del toggle de salida a internet, según su estado. */
export function salidaInternetResumen(enabled: boolean): string {
  return enabled
    ? 'Habilitada: el agente puede hacer llamadas salientes, que SIEMPRE pasan por el control de seguridad (SSRF/allowlist, tiempo y tamaño). No es acceso irrestricto.'
    : 'Desactivada: el agente no puede salir a internet.';
}
