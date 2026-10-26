/**
 * Validador declarativo de Cuadrillas (ADR 0014 · D1 · seguridad central). Función PURA, sin dependencias de Nest/Prisma:
 * recibe un valor JSON (la definición de una versión o la configuración de un miembro) y RECHAZA cualquier clave o
 * contenido ejecutable. Es el opuesto exacto de una plantilla con hooks de terceros: una `CuadrillaVersion` es un
 * documento de configuración (referencias a `Cargo`/`Skill`/conectores/`Politica` + criterios + plantillas de texto que
 * SOLO se expanden con `template.engine.ts`); nunca código, hooks, comandos, ni URLs de arranque que se ejecuten al
 * instanciar. No ejecuta ni expande nada: solo inspecciona la forma de los datos.
 *
 * Se mantiene como función pura y determinista para poder probarla a fondo (acepta config declarativa; rechaza cada
 * forma de código/hook/URL de arranque). El servicio la envuelve y traduce un rechazo a `400` con motivo auditable.
 */

/** Claves prohibidas (comparación insensible a mayúsculas/acentos de camelCase): denotan código, hooks o arranque. */
const CLAVES_PROHIBIDAS = new Set<string>([
  'hook',
  'hooks',
  'eval',
  'exec',
  'execute',
  'command',
  'cmd',
  'shell',
  'script',
  'scripts',
  'code',
  'sourcecode',
  'run',
  'runcommand',
  'function',
  'fn',
  'lambda',
  'handler',
  'require',
  'import',
  'process',
  'childprocess',
  'child_process',
  'startupurl',
  'starturl',
  'bootstrap',
  'bootstrapurl',
  'entrypoint',
  'preinstall',
  'postinstall',
  'install',
  'oninstall',
  'onstart',
  'onload',
  'onboot',
  'oninit',
  'onrun',
  'oninstantiate',
]);

/**
 * Marcadores de contenido ejecutable en VALORES de texto. Conservadores a propósito: patrones que no aparecen en
 * configuración declarativa legítima (una URL de conector o una plantilla `{{ var }}` no los contiene). Evita rechazar
 * URLs legítimas por su mera presencia: solo esquemas/llamadas de ejecución.
 */
const MARCADORES_CONTENIDO: { re: RegExp; motivo: string }[] = [
  { re: /javascript:/i, motivo: 'esquema javascript:' },
  { re: /data:text\/(javascript|html)/i, motivo: 'URI de datos ejecutable' },
  { re: /<script\b/i, motivo: 'etiqueta <script>' },
  { re: /\beval\s*\(/i, motivo: 'llamada eval(' },
  { re: /new\s+Function\s*\(/i, motivo: 'new Function(' },
  { re: /\brequire\s*\(/i, motivo: 'require(' },
  { re: /child_process/i, motivo: 'child_process' },
  { re: /process\.(exit|env|binding)/i, motivo: 'acceso a process' },
];

/** Normaliza una clave para comparar: minúsculas y sin separadores (`on-install`, `on_install`, `onInstall` -> `oninstall`). */
function normalizarClave(clave: string): string {
  return clave.toLowerCase().replace(/[-_\s]/g, '');
}

/** Un patrón de hook por evento: `on` + mayúscula (onInstall, onStart, onAnything). */
function esHookDeEvento(clave: string): boolean {
  return /^on[A-Z]/.test(clave);
}

export interface ResultadoDeclarativo {
  ok: boolean;
  /** Ruta JSON del nodo que provocó el rechazo (p. ej. `miembros[0].conectoresSugeridos.hooks`). */
  ruta?: string;
  /** Motivo auditable, en español, de por qué se rechazó. */
  motivo?: string;
}

/** Profundidad máxima para cortar estructuras anidadas patológicas (defensa, no límite funcional). */
const PROFUNDIDAD_MAX = 20;

/**
 * Inspecciona recursivamente un valor y determina si es 100 % declarativo. Devuelve `{ ok: true }` o un rechazo con la
 * ruta y el motivo. No lanza: el llamador decide cómo traducir el rechazo (el servicio lo convierte en `400`).
 */
export function inspeccionarDeclarativo(valor: unknown, ruta = '$', profundidad = 0): ResultadoDeclarativo {
  if (profundidad > PROFUNDIDAD_MAX) {
    return { ok: false, ruta, motivo: 'La definición anida demasiados niveles (posible estructura maliciosa)' };
  }

  // Una función nunca puede viajar en JSON, pero se comprueba defensivamente por si llega un objeto no serializado.
  if (typeof valor === 'function') {
    return {
      ok: false,
      ruta,
      motivo: 'Una definición de Cuadrilla no puede contener funciones (debe ser declarativa)',
    };
  }

  if (typeof valor === 'string') {
    for (const { re, motivo } of MARCADORES_CONTENIDO) {
      if (re.test(valor)) {
        return { ok: false, ruta, motivo: `Contenido ejecutable prohibido en un valor de texto (${motivo})` };
      }
    }
    return { ok: true };
  }

  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) {
      const r = inspeccionarDeclarativo(valor[i], `${ruta}[${i}]`, profundidad + 1);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  if (valor !== null && typeof valor === 'object') {
    for (const [clave, hijo] of Object.entries(valor as Record<string, unknown>)) {
      const norm = normalizarClave(clave);
      if (CLAVES_PROHIBIDAS.has(norm) || esHookDeEvento(clave)) {
        return {
          ok: false,
          ruta: `${ruta}.${clave}`,
          motivo: `Clave ejecutable prohibida "${clave}": una Cuadrilla es declarativa (sin código, hooks ni URLs de arranque)`,
        };
      }
      const r = inspeccionarDeclarativo(hijo, `${ruta}.${clave}`, profundidad + 1);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  // number | boolean | null: valores declarativos válidos.
  return { ok: true };
}
