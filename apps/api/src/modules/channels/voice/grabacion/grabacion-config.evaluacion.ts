/**
 * Lógica PURA de "qué se puede guardar y por cuánto" de la grabación de voz (ADR 0015 D3/D4 · decisión Jurídica D7).
 * Sin dependencias de Nest/Prisma: recibe las banderas de la configuración y devuelve una evaluación determinista.
 *
 * Principios (NO negociables):
 * - TODO OFF/null por defecto: sin configuración explícita, nada se graba ni se retiene.
 * - `retencionDias = null` significa "pendiente de política", NUNCA un plazo por defecto ni legal: no se inventan plazos.
 * - No se declara cumplimiento normativo ni valor probatorio automático: solo se expresan controles técnicos.
 * - Esta capa NO ejecuta borrados productivos; solo describe qué estaría permitido guardar y por cuánto.
 */

/** Tipos de dato de la grabación, con políticas independientes (ADR 0015 D3). */
export type TipoDatoGrabacion = 'AUDIO' | 'TRANSCRIPCION' | 'RESUMEN' | 'EVIDENCIA';

/** Banderas relevantes de `GrabacionConfig` para la evaluación. Subconjunto puro, sin ids ni tiempos. */
export interface GrabacionFlags {
  grabarAudio: boolean;
  guardarTranscripcion: boolean;
  guardarResumen: boolean;
  guardarEvidencia: boolean;
  retencionDias: number | null;
  eliminacionAutomatica: boolean;
}

/** Estado de la política de retención para un tipo de dato. */
export type EstadoRetencion =
  /** La captura de ese tipo de dato está desactivada (OFF por defecto): no se guarda nada. */
  | 'DESACTIVADO'
  /** La captura está activada pero sin plazo definido (`retencionDias = null`): pendiente de política, no productivo. */
  | 'PENDIENTE_POLITICA'
  /** La captura está activada y hay un plazo de conservación definido explícitamente. */
  | 'DEFINIDO';

/** Resultado de evaluar la retención de un tipo de dato. */
export interface EvaluacionRetencion {
  tipoDato: TipoDatoGrabacion;
  /** Si está permitido guardar ese tipo de dato según la configuración (bandera correspondiente en ON). */
  permitido: boolean;
  estado: EstadoRetencion;
  /** Plazo de conservación en días; null = pendiente de política (no es un plazo por defecto). */
  retencionDias: number | null;
  /** Si la eliminación automática al vencer el plazo está habilitada (solo relevante con plazo definido). */
  eliminacionAutomatica: boolean;
}

/** Configuración OFF total: lo que rige cuando una empresa no tiene `GrabacionConfig`. */
export const GRABACION_OFF: GrabacionFlags = {
  grabarAudio: false,
  guardarTranscripcion: false,
  guardarResumen: false,
  guardarEvidencia: false,
  retencionDias: null,
  eliminacionAutomatica: false,
};

/** Bandera de captura correspondiente a cada tipo de dato. */
export function banderaDe(config: GrabacionFlags, tipoDato: TipoDatoGrabacion): boolean {
  switch (tipoDato) {
    case 'AUDIO':
      return config.grabarAudio;
    case 'TRANSCRIPCION':
      return config.guardarTranscripcion;
    case 'RESUMEN':
      return config.guardarResumen;
    case 'EVIDENCIA':
      return config.guardarEvidencia;
  }
}

/**
 * Evalúa, para un tipo de dato, si se puede guardar y con qué plazo. PURA y determinista.
 * `config = null` (empresa sin configuración) equivale a OFF total.
 */
export function evaluarRetencion(
  config: GrabacionFlags | null | undefined,
  tipoDato: TipoDatoGrabacion,
): EvaluacionRetencion {
  const c = config ?? GRABACION_OFF;
  const permitido = banderaDe(c, tipoDato);
  if (!permitido) {
    return { tipoDato, permitido: false, estado: 'DESACTIVADO', retencionDias: null, eliminacionAutomatica: false };
  }
  // null = pendiente de política: NO se inventa un plazo. La eliminación automática solo aplica con plazo definido.
  if (c.retencionDias === null || c.retencionDias === undefined) {
    return {
      tipoDato,
      permitido: true,
      estado: 'PENDIENTE_POLITICA',
      retencionDias: null,
      eliminacionAutomatica: false,
    };
  }
  return {
    tipoDato,
    permitido: true,
    estado: 'DEFINIDO',
    retencionDias: c.retencionDias,
    eliminacionAutomatica: c.eliminacionAutomatica,
  };
}
