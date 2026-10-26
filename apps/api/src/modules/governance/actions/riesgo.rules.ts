import type { NivelRiesgo } from '@prisma/client';

/**
 * Clasificación de riesgo PURA (punto 8 de las decisiones del patrocinador · E6+). Sin dependencias de Nest/Prisma
 * salvo el tipo `NivelRiesgo` (un enum, no una entidad): se prueba de forma aislada, igual que el motor de políticas.
 *
 * Reglas duras del punto 8:
 *  - BAJO    → automatizable si cumple las reglas (no exige revisión humana).
 *  - MEDIO   → revisión humana en piloto.
 *  - ALTO / CRITICO → revisión humana OBLIGATORIA.
 *  - DESCONOCIDO / contradictorio / sin evidencia suficiente → DETENER Y ESCALAR (no se automatiza).
 *
 * Dos decisiones de diseño explícitas:
 *  1. La **coincidencia entre modelos NO es autorización**. Que dos o más modelos "estén de acuerdo" NO sube ni baja el
 *     nivel ni se usa como prueba. Por eso esta función NO recibe ningún campo de "consenso de modelos": solo HECHOS
 *     estructurados (reversibilidad, impacto, evidencia, datos sensibles...). El consenso no tiene entrada aquí a
 *     propósito.
 *  2. NO se inventa un puntaje numérico arbitrario. El nivel se DERIVA de variables explícitas mediante reglas
 *     legibles; no hay un "% de riesgo" calibrado. Si en el futuro se expone un score, deberá derivarse de estas
 *     mismas variables y marcarse como NO calibrado (`scoreCalibrado = false`) hasta que exista calibración validada.
 */

/** Impacto potencial declarado de la acción (hecho estructurado, nunca inferido del texto del modelo). */
export type ImpactoPotencial = 'NINGUNO' | 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO';

/** Control que el gobierno debe aplicar según el nivel. */
export type ControlRiesgo = 'AUTOMATIZABLE' | 'REVISION_HUMANA' | 'REVISION_HUMANA_OBLIGATORIA' | 'DETENER_Y_ESCALAR';

/**
 * Entrada de clasificación: SOLO hechos estructurados. Todos los campos de evidencia son opcionales, pero su AUSENCIA
 * es conservadora: si no se afirma explícitamente que hay evidencia suficiente, se trata como insuficiente (DESCONOCIDO).
 */
export interface EntradaClasificacionRiesgo {
  /** Nivel de riesgo por defecto del catálogo para esta acción (si existe). Actúa como PISO del nivel resultante. */
  nivelPorDefecto?: NivelRiesgo | null;
  /** Hay evidencia suficiente para decidir. Debe afirmarse `true` explícitamente; si no, se asume insuficiente. */
  evidenciaSuficiente?: boolean;
  /** Las señales/fuentes se contradicen entre sí. Fuerza DESCONOCIDO → detener y escalar. */
  señalesContradictorias?: boolean;
  /** La acción es reversible (se puede deshacer sin daño material). */
  reversible?: boolean;
  /** Impacto potencial si la acción sale mal. */
  impactoPotencial?: ImpactoPotencial;
  /** La acción afecta a un entorno/dato de producción (no sandbox/sintético). */
  afectaProduccion?: boolean;
  /** La acción manipula datos sensibles/personales/financieros. */
  datosSensibles?: boolean;
  /** Reglas de negocio previas que habilitan la automatización se cumplen (relevante solo si el nivel es BAJO). */
  cumpleReglas?: boolean;
}

export interface ResultadoClasificacionRiesgo {
  nivel: NivelRiesgo;
  control: ControlRiesgo;
  /** Detener la ejecución (no continuar automáticamente). */
  detener: boolean;
  /** Escalar a un responsable humano. */
  escalar: boolean;
  /** Puede ejecutarse sin intervención humana (solo cierto para BAJO que cumple reglas). */
  automatizable: boolean;
  /** Exige revisión humana antes del efecto. */
  requiereRevisionHumana: boolean;
  /** Código auditable del motivo ganador (nunca texto libre del modelo). */
  motivo: string;
  /** Señales estructuradas que explican la decisión (para auditoría/trazabilidad). */
  señales: string[];
  /**
   * Nunca se expone un puntaje numérico: no existe un score calibrado. Se mantiene el flag explícito para dejar claro
   * que cualquier consumidor que espere un "% de riesgo" debe tratarlo como NO disponible / NO calibrado.
   */
  scoreCalibrado: false;
}

const ORDEN_CONOCIDOS: Record<Exclude<NivelRiesgo, 'DESCONOCIDO'>, number> = {
  BAJO: 1,
  MEDIO: 2,
  ALTO: 3,
  CRITICO: 4,
};

/** Toma el nivel MÁS severo entre dos niveles conocidos (DESCONOCIDO se gestiona antes, nunca llega aquí). */
function masSevero(
  a: Exclude<NivelRiesgo, 'DESCONOCIDO'>,
  b: Exclude<NivelRiesgo, 'DESCONOCIDO'>,
): Exclude<NivelRiesgo, 'DESCONOCIDO'> {
  return ORDEN_CONOCIDOS[a] >= ORDEN_CONOCIDOS[b] ? a : b;
}

/** Deriva el nivel a partir de los hechos de impacto/reversibilidad/sensibilidad. Reglas legibles, sin puntajes. */
function nivelDerivado(e: EntradaClasificacionRiesgo, señales: string[]): Exclude<NivelRiesgo, 'DESCONOCIDO'> {
  const impacto = e.impactoPotencial ?? 'BAJO';
  let nivel: Exclude<NivelRiesgo, 'DESCONOCIDO'> = 'BAJO';

  if (impacto === 'CRITICO') {
    nivel = 'CRITICO';
    señales.push('IMPACTO_CRITICO');
  } else if (impacto === 'ALTO') {
    // Un impacto alto irreversible escala a crítico: no hay vuelta atrás.
    if (e.reversible === false) {
      nivel = 'CRITICO';
      señales.push('IMPACTO_ALTO_IRREVERSIBLE');
    } else {
      nivel = 'ALTO';
      señales.push('IMPACTO_ALTO');
    }
  } else if (impacto === 'MEDIO') {
    nivel = 'MEDIO';
    señales.push('IMPACTO_MEDIO');
  } else {
    señales.push('IMPACTO_BAJO');
  }

  // Afectar producción con datos sensibles nunca es "bajo": sube al menos a MEDIO.
  if (e.afectaProduccion && e.datosSensibles && ORDEN_CONOCIDOS[nivel] < ORDEN_CONOCIDOS.MEDIO) {
    nivel = 'MEDIO';
    señales.push('PRODUCCION_CON_DATOS_SENSIBLES');
  }
  return nivel;
}

function controlDeNivel(nivel: NivelRiesgo, cumpleReglas: boolean): ControlRiesgo {
  switch (nivel) {
    case 'DESCONOCIDO':
      return 'DETENER_Y_ESCALAR';
    case 'CRITICO':
    case 'ALTO':
      return 'REVISION_HUMANA_OBLIGATORIA';
    case 'MEDIO':
      return 'REVISION_HUMANA';
    case 'BAJO':
    default:
      return cumpleReglas ? 'AUTOMATIZABLE' : 'REVISION_HUMANA';
  }
}

/**
 * Clasifica el riesgo de una acción/misión a partir de hechos estructurados. Determinista y sin efectos secundarios.
 */
export function clasificarRiesgo(entrada: EntradaClasificacionRiesgo): ResultadoClasificacionRiesgo {
  const señales: string[] = [];

  // Regla dura del punto 8: contradicción o evidencia insuficiente → DESCONOCIDO → detener y escalar. La ausencia de
  // una afirmación explícita de evidencia suficiente se trata como insuficiente (conservador). También cuando el
  // propio catálogo marca el nivel por defecto como DESCONOCIDO.
  const contradictorio = entrada.señalesContradictorias === true;
  const sinEvidencia = entrada.evidenciaSuficiente !== true;
  const defectoDesconocido = entrada.nivelPorDefecto === 'DESCONOCIDO';

  if (contradictorio || sinEvidencia || defectoDesconocido) {
    if (contradictorio) señales.push('SEÑALES_CONTRADICTORIAS');
    if (sinEvidencia) señales.push('EVIDENCIA_INSUFICIENTE');
    if (defectoDesconocido) señales.push('NIVEL_POR_DEFECTO_DESCONOCIDO');
    return {
      nivel: 'DESCONOCIDO',
      control: 'DETENER_Y_ESCALAR',
      detener: true,
      escalar: true,
      automatizable: false,
      requiereRevisionHumana: true,
      motivo: 'DESCONOCIDO_DETENER_Y_ESCALAR',
      señales,
      scoreCalibrado: false,
    };
  }

  // Nivel = el más severo entre el derivado de los hechos y el piso del catálogo (si es un nivel conocido).
  let nivel = nivelDerivado(entrada, señales);
  const piso = entrada.nivelPorDefecto;
  if (piso && piso !== 'DESCONOCIDO') {
    const anterior = nivel;
    nivel = masSevero(nivel, piso);
    if (nivel !== anterior) señales.push(`PISO_CATALOGO_${piso}`);
  }

  const cumpleReglas = entrada.cumpleReglas === true;
  const control = controlDeNivel(nivel, cumpleReglas);
  const automatizable = control === 'AUTOMATIZABLE';

  if (nivel === 'BAJO' && !cumpleReglas) señales.push('BAJO_SIN_CUMPLIR_REGLAS');

  return {
    nivel,
    control,
    detener: false,
    escalar: false,
    automatizable,
    requiereRevisionHumana: !automatizable,
    motivo: `NIVEL_${nivel}`,
    señales,
    scoreCalibrado: false,
  };
}
