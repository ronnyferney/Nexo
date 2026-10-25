/** Utilidades puras del panel de prueba del agente (clasificación de eventos y nombres legibles). */

/**
 * Estado de interfaz del turno en curso, ligado a eventos reales del backend (no a animaciones que simulen progreso):
 * idle (sin actividad), thinking (preparando), tool (consultando una herramienta), awaiting_approval (requiere
 * autorización), streaming (generando texto), y los terminales completed / partial / failed / cancelled.
 */
export type ChatTurnState =
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'awaiting_approval'
  | 'streaming'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

/** Estados en los que el agente está trabajando activamente (se muestra el indicador de progreso). */
export const isActiveTurnState = (s: ChatTurnState): boolean =>
  s === 'thinking' || s === 'tool' || s === 'awaiting_approval' || s === 'streaming';

/** Texto del indicador discreto según el estado del turno; `null` cuando no hay nada activo que mostrar. */
export function turnStateLabel(state: ChatTurnState, toolName?: string): string | null {
  switch (state) {
    case 'thinking':
      return 'Preparando respuesta…';
    case 'tool':
      return toolName ? `Consultando: ${toolName}…` : 'Consultando una herramienta…';
    case 'awaiting_approval':
      return 'Esperando su autorización';
    case 'streaming':
      return 'Generando respuesta…';
    default:
      return null;
  }
}

/**
 * Proporción del estudio del agente: fracción (0–1) del ancho que ocupa la columna de configuración frente al panel
 * de prueba. Se acota para respetar los anchos mínimos de ambas columnas (RX-6, chat redimensionable).
 */
export const MIN_STUDIO_RATIO = 0.3;
export const MAX_STUDIO_RATIO = 0.72;
export const DEFAULT_STUDIO_RATIO = 0.55;
/** Paso de teclado del divisor (flechas izquierda/derecha). */
export const STUDIO_RATIO_STEP = 0.03;

/** Acota la proporción al rango permitido; cae al valor por defecto si no es un número finito. */
export function clampStudioRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_STUDIO_RATIO;
  return Math.min(MAX_STUDIO_RATIO, Math.max(MIN_STUDIO_RATIO, ratio));
}

/** Proporción resultante de arrastrar el divisor a `clientX`, dado el rectángulo del contenedor del layout. */
export function studioRatioAt(clientX: number, rect: { left: number; width: number }): number {
  if (!rect.width) return DEFAULT_STUDIO_RATIO;
  return clampStudioRatio((clientX - rect.left) / rect.width);
}

/** Lee la proporción guardada (texto de localStorage) y la acota; valor por defecto si falta o es inválida. */
export function parseStudioRatio(raw: string | null | undefined): number {
  return clampStudioRatio(raw == null ? NaN : Number(raw));
}

/** Un aviso del backend es de seguridad (DataGuard) si empieza con este prefijo; el resto son informativos. */
export const SECURITY_NOTICE_PREFIX = 'Protección de datos';

/** Forma mínima de un elemento del chat para clasificarlo (compatible con ChatItem). */
export interface ClassifiableItem {
  kind: string;
  text?: string;
}

/** ¿El aviso corresponde a una política de protección de datos (para agruparlo fuera de la conversación)? */
export const isSecurityNotice = (i: ClassifiableItem): boolean =>
  i.kind === 'notice' && !!i.text?.startsWith(SECURITY_NOTICE_PREFIX);

/**
 * Traduce el mensaje técnico de un error del proveedor o de la ejecución a una causa comprensible para el usuario.
 * El texto crudo se conserva aparte (vista Diagnóstico); aquí solo se decide qué explicar en la conversación.
 */
export function friendlyError(raw: string): string {
  const t = (raw || '').toLowerCase();
  if (/throttl|rate.?limit|l[íi]mite de solicitudes|\b429\b|overloaded|sobrecarg/.test(t))
    return 'El servicio externo alcanzó temporalmente su límite de solicitudes. Puede reintentar en unos momentos.';
  if (/\b401\b|\b403\b|unauthorized|forbidden|api key|autenticac|sesi[óo]n|token|revocad|expir/.test(t))
    return 'La conexión del modelo o de la herramienta necesita reautorizarse. Revísela e inténtelo de nuevo.';
  if (/timeout|timed out|tard[óo] demasiado|\b504\b|tiempo de espera/.test(t))
    return 'La operación tardó más de lo esperado y se interrumpió. Puede reintentar.';
  if (/presupuesto|budget|cuota|quota|saldo/.test(t))
    return 'Se alcanzó el límite de presupuesto configurado. Revise los presupuestos del workspace.';
  return 'No fue posible completar la solicitud.';
}

/**
 * Replica el identificador de herramienta del backend (`toolName` en agent-runtime): `<conector>__<operación>`,
 * ambos en minúsculas y saneados, el conector acotado a 24 caracteres y el total a 64. Sirve para mapear el nombre
 * técnico que llega por el stream al nombre legible del conector y la operación.
 */
export function toolSlug(connectorName: string, opKey: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  return `${slug(connectorName).slice(0, 24)}__${slug(opKey)}`.slice(0, 64);
}
