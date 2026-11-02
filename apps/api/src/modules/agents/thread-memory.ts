/**
 * Memoria de corto plazo compacta del hilo (ADR 0017 Inc.2). Funciones puras y deterministas que deciden cuándo y
 * dónde partir un historial nativo para enviar `[resumen del tramo antiguo] + cola de los últimos K turnos` en lugar
 * de recargar todo el historial cada turno.
 *
 * PRINCIPIOS DE SEGURIDAD que estas funciones garantizan:
 * - El corte se hace siempre en un **límite de turno seguro**: justo antes de un mensaje de usuario genuino (inicio de
 *   un intercambio). Nunca parte un par `tool_use`/`tool_result` ni corta dentro de un ciclo de herramienta abierto:
 *   esos pares viven completos dentro de un turno, y el turno nunca cruza el límite.
 * - La **cola** (`queue`) es una porción del arreglo nativo original **sin modificar**: conserva intactos los bloques
 *   de razonamiento (razonamiento preservado) y el emparejamiento de herramientas tal y como se guardaron.
 * - El **tramo antiguo** (`oldSegment`) no se reescribe: se usa solo para generar un resumen (contexto adicional) y,
 *   fuera de aquí, para reconstruir el historial append-only completo que se persiste. El resumen NO reemplaza nada.
 */

/** Configuración del gate de memoria compacta. Default conservador: deshabilitado (comportamiento idéntico al actual). */
export interface ThreadMemoryConfig {
  /** Si está deshabilitado, no se compacta nunca: el hilo viaja completo como hoy. */
  enabled: boolean;
  /** Nº de turnos completos (intercambios) del hilo a partir del cual se empieza a compactar. */
  thresholdTurns: number;
  /** Nº de turnos completos recientes (K) que viajan en formato nativo, intactos, en la cola. */
  recentTurns: number;
}

/** Un mensaje del historial nativo: forma mínima común a los proveedores actuales (`{ role, content }`). */
interface NativeMessage {
  role?: unknown;
  content?: unknown;
}

interface NativeBlock {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  is_error?: unknown;
}

/** Entero dentro de `[min, max]`, o `fallback` si la variable no está definida o no es válida. */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt((raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Lee el gate de memoria compacta del entorno. Default conservador (ADR 0017: «degrada con gracia; gate configurable
 * con default conservador»): `AGENT_THREAD_SUMMARY` deshabilitado salvo activación explícita del negocio. Con el gate
 * apagado el comportamiento es idéntico al actual y no hay gasto extra de resumen.
 */
export function threadMemoryConfigFrom(env: NodeJS.ProcessEnv): ThreadMemoryConfig {
  const enabled = /^(1|true|yes|on|si|sí)$/i.test((env.AGENT_THREAD_SUMMARY ?? '').trim());
  const recentTurns = clampInt(env.AGENT_THREAD_SUMMARY_RECENT_TURNS, 6, 1, 100);
  const defaultThreshold = Math.max(12, recentTurns * 2);
  const thresholdTurns = clampInt(env.AGENT_THREAD_SUMMARY_THRESHOLD_TURNS, defaultThreshold, recentTurns + 1, 10_000);
  return { enabled, thresholdTurns, recentTurns };
}

function asMessage(value: unknown): NativeMessage | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * ¿`value` es un mensaje de **usuario genuino** (inicio de un intercambio), y no un mensaje de usuario que solo
 * transporta `tool_result`? Un mensaje con bloques `tool_result` es la continuación del ciclo de herramientas del
 * turno en curso, nunca el comienzo de uno nuevo; cortar ahí partiría un par `tool_use`/`tool_result`.
 */
export function isGenuineUserMessage(value: unknown): boolean {
  const msg = asMessage(value);
  if (!msg || msg.role !== 'user') return false;
  const content = msg.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) {
    return !content.some((b) => asBlock(b)?.type === 'tool_result');
  }
  // Contenido con otra forma (objeto suelto): se trata como usuario genuino (no transporta resultados de herramienta).
  return true;
}

function asBlock(value: unknown): NativeBlock | null {
  return value && typeof value === 'object' ? value : null;
}

/** Índices de los mensajes de usuario genuinos: cada uno es el inicio de un turno y un límite de corte seguro. */
export function turnStartIndices(history: readonly unknown[]): number[] {
  const starts: number[] = [];
  history.forEach((m, i) => {
    if (isGenuineUserMessage(m)) starts.push(i);
  });
  return starts;
}

/**
 * Decide el punto de corte seguro que deja los últimos `recentTurns` turnos completos en la cola. Devuelve `null`
 * (no compactar) cuando el gate está apagado, cuando el hilo no supera el umbral de turnos, o cuando no quedaría
 * ningún turno antiguo que resumir. El corte es el índice del mensaje de usuario genuino que abre el primero de los
 * `recentTurns` turnos recientes; todo lo anterior es el tramo antiguo.
 */
export function planThreadSplit(history: readonly unknown[], cfg: ThreadMemoryConfig): { cut: number } | null {
  if (!cfg.enabled || !history.length) return null;
  const starts = turnStartIndices(history);
  if (starts.length < cfg.thresholdTurns) return null;
  if (starts.length <= cfg.recentTurns) return null;
  const cut = starts[starts.length - cfg.recentTurns];
  if (cut <= 0) return null;
  return { cut };
}

const SUMMARY_MESSAGE_MAX = 4_000;
const SUMMARY_TOTAL_MAX = 24_000;

/** Texto plano de un bloque de contenido nativo para el prompt de resumen (nunca expone razonamiento ni secretos). */
function renderBlock(block: unknown): string | null {
  const b = asBlock(block);
  if (!b) return null;
  switch (b.type) {
    case 'text':
      return typeof b.text === 'string' ? b.text : null;
    case 'tool_use':
      return `[usa la herramienta ${typeof b.name === 'string' ? b.name : 'desconocida'}]`;
    case 'tool_result': {
      const inner = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
      const flag = b.is_error ? 'error de herramienta' : 'resultado de herramienta';
      return `[${flag}: ${inner.slice(0, 500)}]`;
    }
    case 'image':
      return '[imagen adjunta]';
    case 'document':
      return '[documento adjunto]';
    // Los bloques de razonamiento preservado no se resumen ni se exponen.
    case 'thinking':
    case 'redacted_thinking':
      return null;
    default:
      return null;
  }
}

/** Transcripción legible y acotada de un tramo de mensajes nativos, para pedir su resumen al proveedor. */
export function renderForSummary(messages: readonly unknown[]): string {
  const lines: string[] = [];
  for (const raw of messages) {
    const msg = asMessage(raw);
    if (!msg) continue;
    const who = msg.role === 'assistant' ? 'Asistente' : 'Usuario';
    let body: string;
    if (typeof msg.content === 'string') {
      body = msg.content;
    } else if (Array.isArray(msg.content)) {
      body = msg.content
        .map(renderBlock)
        .filter((s): s is string => !!s && s.length > 0)
        .join('\n');
    } else {
      body = '';
    }
    body = body.trim();
    if (!body) continue;
    lines.push(`${who}: ${body.slice(0, SUMMARY_MESSAGE_MAX)}`);
  }
  return lines.join('\n').slice(0, SUMMARY_TOTAL_MAX);
}

/** System prompt del turno de resumen (barato, sin herramientas). En español, fiel y sin inventar. */
export const SUMMARY_SYSTEM =
  'Eres el componente de memoria de Nexo. Resume de forma fiel, concisa y en español el tramo antiguo de una ' +
  'conversación entre un usuario y un agente de IA, para conservarlo como contexto. Mantén hechos, decisiones, datos ' +
  'concretos (nombres, identificadores, cantidades), tareas pendientes y acuerdos. No inventes nada que no aparezca. ' +
  'No incluyas secretos ni credenciales. Responde únicamente con el resumen, sin preámbulos ni comentarios.';

/** Mensaje de usuario del turno de resumen: integra el resumen previo con los mensajes nuevos del tramo antiguo. */
export function buildSummaryPrompt(priorSummary: string | undefined, renderedNew: string): string {
  return [
    '[RESUMEN PREVIO]',
    priorSummary?.trim() || '(ninguno)',
    '',
    '[NUEVOS MENSAJES A INCORPORAR]',
    renderedNew || '(sin contenido)',
    '',
    'Devuelve un único resumen actualizado que integre el resumen previo con los nuevos mensajes, conservando lo ' +
      'relevante de ambos.',
  ].join('\n');
}
