import type { AuditActorType, AuditEntry, AuditVerification } from '../../core/audit.models';

/**
 * Lógica pura del visor de auditoría (E13), sin Angular: traducción de acciones a etiquetas en español, formato del
 * actor, y derivación del sello de integridad a partir del veredicto de `verificarCadena`. Se mantiene aquí, con
 * pruebas unitarias propias (`auditoria.util.spec.ts`), para que el componente sea solo presentación y estado reactivo.
 */

/**
 * Mapa amplio de acciones auditables -> etiqueta legible en español. Centraliza los códigos que emiten los puntos de
 * gobierno del backend (`modules/audit/audit.types`). Es deliberadamente extensible: las acciones desconocidas no
 * rompen la vista, se muestran con un fallback legible (`humanizeAction`).
 */
export const ACTION_LABELS: Record<string, string> = {
  APROBACION_CONCEDIDA: 'Aprobación concedida',
  APROBACION_RECHAZADA: 'Aprobación rechazada',
  POLITICA_CREADA: 'Política creada',
  POLITICA_MODIFICADA: 'Política modificada',
  POLITICA_ARCHIVADA: 'Política archivada',
  SUSPENSION_ACTIVADA: 'Suspensión activada',
  SUSPENSION_LEVANTADA: 'Suspensión levantada',
  AGENTE_PUBLICADO: 'Agente publicado',
  AGENTE_SUSPENDIDO: 'Agente suspendido',
  ACCESO_SENSIBLE: 'Acceso sensible',
  PASAPORTE_EMITIDO: 'Pasaporte emitido',
  CUADRILLA_CREADA: 'Cuadrilla creada',
  CUADRILLA_PUBLICADA: 'Cuadrilla publicada',
  CUADRILLA_RETIRADA: 'Cuadrilla retirada',
  CUADRILLA_INSTANCIADA: 'Cuadrilla instanciada',
  JERARQUIA_MODIFICADA: 'Jerarquía modificada',
  ESTACION_VIRTUAL_CREADA: 'Estación virtual creada',
  ESTACION_VIRTUAL_MODIFICADA: 'Estación virtual modificada',
  ESTACION_VIRTUAL_RETIRADA: 'Estación virtual retirada',
  PARAMETROS_EJECUCION_MODIFICADOS: 'Parámetros de ejecución modificados',
};

/**
 * Convierte un código de acción desconocido (`FOO_BAR_BAZ`) en una etiqueta legible («Foo bar baz»): reemplaza los
 * guiones bajos por espacios, pasa a minúsculas y capitaliza la primera letra. Nunca devuelve vacío.
 */
export function humanizeAction(action: string): string {
  const clean = action.trim();
  if (!clean) return '—';
  const words = clean.replace(/_/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Etiqueta en español de una acción; usa el mapa y, si es desconocida, el fallback legible. */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanizeAction(action);
}

/** Etiqueta del tipo de actor. */
export const ACTOR_TYPE_LABELS: Record<AuditActorType, string> = {
  USER: 'Persona',
  AGENT: 'Agente',
  SYSTEM: 'Sistema',
};

/** Ícono del tipo de actor (mapa de `nx-icon`). */
export const ACTOR_TYPE_ICONS: Record<AuditActorType, string> = {
  USER: 'user',
  AGENT: 'bot',
  SYSTEM: 'cpu',
};

export function actorTypeLabel(actorType: AuditActorType): string {
  return ACTOR_TYPE_LABELS[actorType] ?? actorType;
}

export function actorTypeIcon(actorType: AuditActorType): string {
  return ACTOR_TYPE_ICONS[actorType] ?? 'user';
}

/**
 * Texto completo del actor: tipo + id. SYSTEM no lleva id (lo pone el servidor en null), así que se muestra solo como
 * «Sistema». Para USER/AGENT sin id (no debería ocurrir) cae con elegancia al tipo.
 */
export function formatActor(actorType: AuditActorType, actorId: string | null | undefined): string {
  const label = actorTypeLabel(actorType);
  if (actorType === 'SYSTEM' || !actorId) return label;
  return `${label} · ${actorId}`;
}

/** Objetivo del hecho: tipo + id. Devuelve `—` cuando no hay objetivo (acciones sin entidad afectada). */
export function formatTarget(targetType: string | null | undefined, targetId: string | null | undefined): string {
  if (!targetType && !targetId) return '—';
  if (targetType && targetId) return `${targetType} · ${targetId}`;
  return targetType ?? targetId ?? '—';
}

/** Códigos de motivo de rotura -> explicación legible para el administrador. */
export const BREAK_REASON_LABELS: Record<string, string> = {
  CONTENIDO_ALTERADO: 'El contenido de una entrada fue alterado',
  ENLACE_ROTO: 'El enlace de hash entre entradas no cuadra',
  SECUENCIA_ROTA: 'Falta una entrada en la secuencia (posible borrado)',
  FALTANTE: 'Falta una entrada esperada en la cadena',
};

export function breakReasonLabel(motivo: string | undefined): string {
  if (!motivo) return 'La cadena no superó la verificación';
  return BREAK_REASON_LABELS[motivo] ?? motivo;
}

/** Estado derivado del sello de integridad, listo para pintar. */
export interface IntegritySeal {
  ok: boolean;
  /** Titular prominente del sello. */
  titulo: string;
  /** Explicación bajo el titular. */
  detalle: string;
  /** Ícono (mapa de `nx-icon`). */
  icon: string;
  /** Total de hechos verificados. */
  total: number;
  /** `seq` de la primera rotura (solo cuando `ok` es falso). */
  rotaEnSeq?: number;
}

/**
 * Deriva el sello de integridad a partir del veredicto del backend. Es el corazón de la confianza: demuestra que el
 * registro no fue alterado («Cadena íntegra») o, si lo fue, en qué `seq` y por qué se rompió («Cadena comprometida»).
 */
export function toSeal(v: AuditVerification): IntegritySeal {
  if (v.ok) {
    return {
      ok: true,
      titulo: 'Cadena íntegra',
      detalle:
        v.total === 0
          ? 'Todavía no hay hechos registrados; la cadena está lista.'
          : `Se verificaron ${v.total} ${v.total === 1 ? 'hecho' : 'hechos'} y el encadenamiento de hash es correcto.`,
      icon: 'check',
      total: v.total,
    };
  }
  const motivo = breakReasonLabel(v.motivo);
  const donde = v.rotaEnSeq !== undefined ? ` en la entrada #${v.rotaEnSeq}` : '';
  return {
    ok: false,
    titulo: 'Cadena comprometida',
    detalle: `${motivo}${donde}. El registro no es confiable a partir de ese punto.`,
    icon: 'alert',
    total: v.total,
    rotaEnSeq: v.rotaEnSeq,
  };
}

/** Fecha absoluta corta con hora, para la columna de la tabla. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}

/** Fecha absoluta completa, para el `title` de la celda. */
export function formatDateTimeFull(iso: string): string {
  return new Date(iso).toLocaleString('es', { dateStyle: 'full', timeStyle: 'medium' });
}

/** ¿Hay algún filtro activo? Distingue «sin hechos aún» de «sin resultados para el filtro». */
export function hasActiveFilters(f: {
  action: string;
  targetType: string;
  targetId: string;
  desde: string;
  hasta: string;
}): boolean {
  return !!(f.action || f.targetType || f.targetId || f.desde || f.hasta);
}

/** ¿La entrada tiene metadatos que valga la pena mostrar al expandir? */
export function hasMetadata(entry: AuditEntry): boolean {
  const m = entry.metadata;
  return !!m && typeof m === 'object' && Object.keys(m).length > 0;
}

/** Serializa el valor de metadatos para mostrarlo con honestidad (sin inventar nada). */
export function prettyMetadata(value: unknown): string {
  if (value === null || value === undefined) return '{}';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
