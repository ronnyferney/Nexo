import type { LaunchStatus } from '../../core/access.models';

/**
 * Ciclo de vida del empleado digital (E2/RF05/RF06). Lógica pura y testeable que la UI (encabezado del detalle y
 * filtros del tablero) consume: etiquetas, metadatos del badge y transiciones permitidas. Espeja el contrato del
 * backend (`LIFECYCLE_TRANSITIONS`/`LIFECYCLE_LABELS` de `agent-lifecycle.service.ts`); el gate real es del servidor.
 */

/** Tono del badge, alineado a las clases del design system (`.badge.success`, `.badge.warning`, …). */
export type LaunchTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface LaunchStatusMeta {
  label: string;
  tone: LaunchTone;
  icon: string;
  /** Descripción breve para títulos/ayudas. */
  description: string;
}

/** Metadatos por estado: etiqueta en español, tono del badge e ícono del design system. */
export const LAUNCH_STATUS_META: Record<LaunchStatus, LaunchStatusMeta> = {
  DRAFT: { label: 'Borrador', tone: 'warning', icon: 'pencil', description: 'En edición; aún no se publica.' },
  EN_VALIDACION: {
    label: 'En validación',
    tone: 'info',
    icon: 'clock',
    description: 'A la espera de revisión antes de publicar.',
  },
  LAUNCHED: { label: 'Publicado', tone: 'success', icon: 'rocket', description: 'En producción: disponible por MCP y rutinas.' },
  SUSPENDIDO: {
    label: 'Suspendido',
    tone: 'warning',
    icon: 'stop',
    description: 'Fuera de servicio temporalmente; conserva su expediente.',
  },
  RETIRADO: { label: 'Retirado', tone: 'danger', icon: 'xCircle', description: 'Retirado de servicio (estado final).' },
};

/** Etiqueta en español de un estado. `null`/`undefined` → «Borrador» (estado inicial por defecto). */
export function launchStatusLabel(status: LaunchStatus | null | undefined): string {
  return LAUNCH_STATUS_META[status ?? 'DRAFT'].label;
}

/**
 * Transiciones permitidas por estado (RF05/RF06). Debe coincidir con `LIFECYCLE_TRANSITIONS` del backend:
 * Borrador→En validación/Publicado/Retirado; En validación→Borrador/Publicado/Retirado; Publicado→Suspendido/
 * Borrador/Retirado; Suspendido→Publicado/Borrador/Retirado; Retirado es terminal.
 */
export const LIFECYCLE_TRANSITIONS: Record<LaunchStatus, LaunchStatus[]> = {
  DRAFT: ['EN_VALIDACION', 'LAUNCHED', 'RETIRADO'],
  EN_VALIDACION: ['DRAFT', 'LAUNCHED', 'RETIRADO'],
  LAUNCHED: ['SUSPENDIDO', 'DRAFT', 'RETIRADO'],
  SUSPENDIDO: ['LAUNCHED', 'DRAFT', 'RETIRADO'],
  RETIRADO: [],
};

/** ¿Es posible pasar de `from` a `to`? (misma fuente/destino se considera permitido/idempotente). */
export function canTransition(from: LaunchStatus, to: LaunchStatus): boolean {
  return from === to || LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Identificador de una acción de ciclo de vida que la UI ofrece según el estado actual. */
export type LifecycleActionId = 'submit-validation' | 'launch' | 'unlaunch' | 'suspend' | 'reactivate' | 'retire';

export interface LifecycleAction {
  id: LifecycleActionId;
  label: string;
  icon: string;
  /** Realza visualmente la acción principal del estado. */
  primary?: boolean;
  /** Acciones destructivas/irreversibles (botón con tono danger y confirmación). */
  danger?: boolean;
}

const SUBMIT: LifecycleAction = { id: 'submit-validation', label: 'Enviar a validación', icon: 'flag', primary: true };
const LAUNCH: LifecycleAction = { id: 'launch', label: 'Publicar', icon: 'rocket', primary: true };
const UNLAUNCH: LifecycleAction = { id: 'unlaunch', label: 'Volver a borrador', icon: 'x' };
const SUSPEND: LifecycleAction = { id: 'suspend', label: 'Suspender', icon: 'stop' };
const REACTIVATE: LifecycleAction = { id: 'reactivate', label: 'Reactivar', icon: 'play', primary: true };
const RETIRE: LifecycleAction = { id: 'retire', label: 'Retirar', icon: 'xCircle', danger: true };

/**
 * Acciones de ciclo de vida disponibles según el estado actual (RF05/RF06), en orden de presentación. `launch`
 * abre el diálogo de publicación con garantía de calidad; el resto llama su endpoint directo. Las no permitidas
 * se omiten (p. ej. RETIRADO, estado terminal, no ofrece ninguna).
 */
export function lifecycleActions(status: LaunchStatus | null | undefined): LifecycleAction[] {
  switch (status ?? 'DRAFT') {
    case 'DRAFT':
      return [SUBMIT, LAUNCH, RETIRE];
    case 'EN_VALIDACION':
      return [LAUNCH, UNLAUNCH, RETIRE];
    case 'LAUNCHED':
      return [SUSPEND, UNLAUNCH, RETIRE];
    case 'SUSPENDIDO':
      return [REACTIVATE, UNLAUNCH, RETIRE];
    case 'RETIRADO':
    default:
      return [];
  }
}

/** Opciones del filtro de estado del tablero (los 5 estados), con «todos» como valor vacío. */
export const LAUNCH_STATUS_FILTER_OPTIONS: readonly { value: LaunchStatus; label: string }[] = (
  ['DRAFT', 'EN_VALIDACION', 'LAUNCHED', 'SUSPENDIDO', 'RETIRADO'] as const
).map((value) => ({ value, label: LAUNCH_STATUS_META[value].label }));
