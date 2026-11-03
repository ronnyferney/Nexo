/**
 * Núcleo PURO de la matriz de cumplimiento configurable y MULTISECTORIAL (P1.3 · ADR 0020). Sin dependencias de
 * Nest/Prisma: recibe las reglas ya leídas (planas) y un contexto, y resuelve de forma determinista el conjunto de
 * campos/reglas aplicables y la evaluación ASESORA de un conjunto de valores.
 *
 * Reglas de resolución (NO hay lógica de ningún sector en el código):
 *  - Una regla APLICA a un contexto si cada una de sus dimensiones (jurisdiccion/sector/proceso/nivelRiesgo) es null
 *    (comodín, aplica a todas) o coincide con la del contexto. Una dimensión no provista en el contexto solo admite
 *    reglas con comodín (null) en esa dimensión.
 *  - VIGENCIA (aditiva, opcional): una regla solo aplica si la fecha de evaluación cae DENTRO de su ventana de
 *    vigencia [vigenciaDesde, vigenciaHasta], ambos inclusive. Un extremo null = sin límite por ese lado; ambos null =
 *    siempre vigente. Por defecto la fecha de evaluación es «ahora». Las reglas ya sembradas (sin vigencia) no cambian.
 *  - «La más específica SUMA»: el conjunto resuelto es la UNIÓN de las reglas aplicables por `campoClave`. Si varias
 *    reglas aplican al MISMO `campoClave`, gana la MÁS ESPECÍFICA (más dimensiones concretas); el empate se rompe de
 *    forma determinista por antigüedad (`createdAt`/orden de entrada).
 *
 * Evaluación ASESORA (advisory, NO bloqueante): dado el conjunto resuelto y un objeto de valores, devuelve
 * cumple/faltantes/invalidos SIN lanzar por motivos de negocio. Con el conjunto VACÍO (p. ej. todas las reglas
 * inactivas) el resultado es `cumple = true` y no exige nada. Nunca afirma conformidad normativa.
 */

/** Nivel de riesgo del alcance (coincide con el enum `NivelRiesgo` de Prisma). */
export type NivelRiesgo = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO' | 'DESCONOCIDO';

/** Tipo de dato de un campo obligatorio (coincide con el enum `TipoDatoCumplimiento` de Prisma). */
export type TipoDatoCumplimiento = 'TEXTO' | 'NUMERO' | 'BOOLEANO' | 'FECHA' | 'LISTA' | 'OBJETO';

/** Regla de validación declarativa opcional (sin código ejecutable). Todas las claves son opcionales. */
export interface ReglaValidacionDeclarativa {
  /** Si `false`, el campo es opcional (no cuenta como faltante al estar ausente). Por defecto es obligatorio. */
  requerido?: boolean;
  /** Expresión regular que debe cumplir el valor de texto. */
  patron?: string;
  /** Mínimo numérico (inclusive) para `NUMERO`. */
  min?: number;
  /** Máximo numérico (inclusive) para `NUMERO`. */
  max?: number;
  /** Conjunto cerrado de valores permitidos. */
  enum?: Array<string | number | boolean>;
  /** Longitud mínima de un texto o lista. */
  longitudMin?: number;
  /** Longitud máxima de un texto o lista. */
  longitudMax?: number;
}

/** Regla de cumplimiento plana (subconjunto relevante de la fila `ReglaCumplimiento`). */
export interface ReglaCumplimientoPlana {
  /** Id de origen (opcional; útil para trazar la regla que ganó en la resolución). */
  id?: string;
  jurisdiccion: string | null;
  sector: string | null;
  proceso: string | null;
  nivelRiesgo: NivelRiesgo | null;
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  reglaValidacion: ReglaValidacionDeclarativa | null;
  controlProteccion: string | null;
  descripcion: string | null;
  activa: boolean;
  /** Inicio de vigencia (inclusive); null = sin límite inferior. Fecha ISO o `Date`. */
  vigenciaDesde?: Date | string | null;
  /** Fin de vigencia (inclusive); null = sin límite superior. Fecha ISO o `Date`. */
  vigenciaHasta?: Date | string | null;
}

/** Contexto de resolución. Una dimensión `undefined` no se filtra: solo aplican reglas con comodín (null) en ella. */
export interface ContextoCumplimiento {
  jurisdiccion?: string;
  sector?: string;
  proceso?: string;
  nivelRiesgo?: NivelRiesgo;
  /** Fecha en la que se evalúa la vigencia de las reglas (ISO o `Date`); por defecto «ahora». */
  fechaEvaluacion?: Date | string;
}

/** Regla ya resuelta para un `campoClave` (la más específica que ganó), con su puntuación de especificidad. */
export interface ReglaResuelta extends ReglaCumplimientoPlana {
  /** Puntuación de especificidad del alcance (mayor = más específico). */
  especificidad: number;
}

/** Un campo obligatorio ausente en los valores evaluados. */
export interface CampoFaltante {
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  controlProteccion: string | null;
  descripcion: string | null;
}

/** Un campo presente pero que no supera su regla de validación (tipo o regla declarativa). */
export interface CampoInvalido {
  campoClave: string;
  motivo: string;
}

/** Resultado de la evaluación ASESORA de un conjunto de valores contra el conjunto de reglas resuelto. */
export interface EvaluacionCumplimiento {
  /** Siempre `ASESOR`: la evaluación informa, NO bloquea (P1.3). */
  modo: 'ASESOR';
  /** Informativo: ¿todos los campos obligatorios aplicables están presentes y son válidos? */
  cumple: boolean;
  /** Nº de reglas (campos) aplicables evaluadas. 0 = no se exige nada (reglas inactivas o sin alcance). */
  totalReglas: number;
  /** Campos obligatorios ausentes. */
  faltantes: CampoFaltante[];
  /** Campos presentes que no superan su regla de validación. */
  invalidos: CampoInvalido[];
  /** Nota explícita de que la matriz es asesora y no afirma conformidad normativa. */
  nota: string;
}

const NOTA_ASESORA =
  'Evaluación ASESORA (no bloqueante). No afirma conformidad con ninguna norma; las reglas solo rigen una vez ' +
  'activadas por un ADMIN y aprobado el conjunto por el patrocinador.';

/** ¿La regla aplica al contexto? Un valor null en la regla es comodín; undefined en el contexto solo admite comodín. */
function aplica(regla: ReglaCumplimientoPlana, ctx: ContextoCumplimiento): boolean {
  if (regla.jurisdiccion !== null && regla.jurisdiccion !== ctx.jurisdiccion) return false;
  if (regla.sector !== null && regla.sector !== ctx.sector) return false;
  if (regla.proceso !== null && regla.proceso !== ctx.proceso) return false;
  if (regla.nivelRiesgo !== null && regla.nivelRiesgo !== ctx.nivelRiesgo) return false;
  return true;
}

/** Convierte una fecha ISO/`Date` a epoch (ms). Devuelve null si es ausente o no parseable. */
function aMilis(fecha: Date | string | null | undefined): number | null {
  if (fecha === null || fecha === undefined) return null;
  const ms = fecha instanceof Date ? fecha.getTime() : Date.parse(fecha);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * ¿La regla está VIGENTE en la fecha de evaluación? Ventana [vigenciaDesde, vigenciaHasta] inclusive; cada extremo null
 * (o ausente/ no parseable) = sin límite por ese lado. Sin vigencia definida = siempre vigente (reglas ya sembradas).
 */
function vigente(regla: ReglaCumplimientoPlana, ahora: number): boolean {
  const desde = aMilis(regla.vigenciaDesde);
  const hasta = aMilis(regla.vigenciaHasta);
  if (desde !== null && ahora < desde) return false;
  if (hasta !== null && ahora > hasta) return false;
  return true;
}

/** Puntuación de especificidad: jurisdicción > sector > proceso > nivel de riesgo (pesos disjuntos, desempate determinista). */
function especificidad(regla: ReglaCumplimientoPlana): number {
  return (
    (regla.jurisdiccion !== null ? 8 : 0) +
    (regla.sector !== null ? 4 : 0) +
    (regla.proceso !== null ? 2 : 0) +
    (regla.nivelRiesgo !== null ? 1 : 0)
  );
}

/**
 * Resuelve el conjunto de campos/reglas aplicables a un contexto. «La más específica suma»: unión por `campoClave`,
 * quedándose con la regla más específica de cada campo. El orden de entrada de `reglas` se respeta como desempate
 * (antigüedad), por lo que el resultado es determinista. Devuelve las reglas ordenadas por especificidad y campo.
 * Solo entran las VIGENTES en `ctx.fechaEvaluacion` (por defecto «ahora»); las reglas sin vigencia son siempre vigentes.
 */
export function resolverReglas(reglas: ReglaCumplimientoPlana[], ctx: ContextoCumplimiento): ReglaResuelta[] {
  const ahora = aMilis(ctx.fechaEvaluacion) ?? Date.now();
  const ganadoraPorCampo = new Map<string, ReglaResuelta>();
  for (const regla of reglas) {
    if (!aplica(regla, ctx)) continue;
    if (!vigente(regla, ahora)) continue;
    const candidata: ReglaResuelta = { ...regla, especificidad: especificidad(regla) };
    const actual = ganadoraPorCampo.get(regla.campoClave);
    // Más específica gana; a igual especificidad se conserva la primera vista (antigüedad = desempate determinista).
    if (!actual || candidata.especificidad > actual.especificidad) {
      ganadoraPorCampo.set(regla.campoClave, candidata);
    }
  }
  return [...ganadoraPorCampo.values()].sort(
    (a, b) => b.especificidad - a.especificidad || a.campoClave.localeCompare(b.campoClave),
  );
}

/** ¿El valor está ausente? (undefined, null o cadena vacía/espacios). */
function ausente(valor: unknown): boolean {
  return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '');
}

/** Verifica la FORMA del valor según su tipo de dato. Devuelve null si es válido o el motivo del rechazo. */
function motivoTipoInvalido(valor: unknown, tipo: TipoDatoCumplimiento): string | null {
  switch (tipo) {
    case 'TEXTO':
      return typeof valor === 'string' ? null : 'se esperaba TEXTO';
    case 'NUMERO':
      return typeof valor === 'number' && Number.isFinite(valor) ? null : 'se esperaba NUMERO';
    case 'BOOLEANO':
      return typeof valor === 'boolean' ? null : 'se esperaba BOOLEANO';
    case 'FECHA':
      return typeof valor === 'string' && !Number.isNaN(Date.parse(valor)) ? null : 'se esperaba FECHA (ISO)';
    case 'LISTA':
      return Array.isArray(valor) ? null : 'se esperaba LISTA';
    case 'OBJETO':
      return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? null : 'se esperaba OBJETO';
    default:
      return 'tipo de dato no soportado';
  }
}

/** Aplica la regla declarativa opcional de forma acotada (sin código ejecutable). Devuelve null o el motivo del rechazo. */
function motivoReglaInvalida(valor: unknown, regla: ReglaValidacionDeclarativa | null): string | null {
  if (!regla) return null;
  if (regla.enum && !regla.enum.includes(valor as string | number | boolean)) {
    return `valor fuera del conjunto permitido (${regla.enum.join(', ')})`;
  }
  if (typeof valor === 'number') {
    if (regla.min !== undefined && valor < regla.min) return `menor que el mínimo (${regla.min})`;
    if (regla.max !== undefined && valor > regla.max) return `mayor que el máximo (${regla.max})`;
  }
  if (typeof valor === 'string') {
    if (regla.longitudMin !== undefined && valor.length < regla.longitudMin) {
      return `longitud menor que ${regla.longitudMin}`;
    }
    if (regla.longitudMax !== undefined && valor.length > regla.longitudMax) {
      return `longitud mayor que ${regla.longitudMax}`;
    }
    if (regla.patron !== undefined) {
      let re: RegExp;
      try {
        re = new RegExp(regla.patron);
      } catch {
        return `patrón de validación inválido`;
      }
      if (!re.test(valor)) return 'no coincide con el patrón requerido';
    }
  }
  if (Array.isArray(valor)) {
    if (regla.longitudMin !== undefined && valor.length < regla.longitudMin) {
      return `la lista tiene menos de ${regla.longitudMin} elementos`;
    }
    if (regla.longitudMax !== undefined && valor.length > regla.longitudMax) {
      return `la lista tiene más de ${regla.longitudMax} elementos`;
    }
  }
  return null;
}

/**
 * Evalúa de forma ASESORA (no bloqueante) un objeto de valores contra las reglas ya resueltas. Un campo es obligatorio
 * salvo que su regla declarativa indique `requerido: false`. Nunca lanza por motivos de negocio; con el conjunto vacío
 * devuelve `cumple = true`.
 */
export function evaluarCumplimiento(reglas: ReglaResuelta[], valores: Record<string, unknown>): EvaluacionCumplimiento {
  const faltantes: CampoFaltante[] = [];
  const invalidos: CampoInvalido[] = [];

  for (const regla of reglas) {
    const valor = valores[regla.campoClave];
    const obligatorio = regla.reglaValidacion?.requerido !== false;
    if (ausente(valor)) {
      if (obligatorio) {
        faltantes.push({
          campoClave: regla.campoClave,
          tipoDato: regla.tipoDato,
          controlProteccion: regla.controlProteccion,
          descripcion: regla.descripcion,
        });
      }
      continue; // un campo opcional ausente no se valida
    }
    const motivoTipo = motivoTipoInvalido(valor, regla.tipoDato);
    if (motivoTipo) {
      invalidos.push({ campoClave: regla.campoClave, motivo: motivoTipo });
      continue;
    }
    const motivoRegla = motivoReglaInvalida(valor, regla.reglaValidacion);
    if (motivoRegla) invalidos.push({ campoClave: regla.campoClave, motivo: motivoRegla });
  }

  return {
    modo: 'ASESOR',
    cumple: faltantes.length === 0 && invalidos.length === 0,
    totalReglas: reglas.length,
    faltantes,
    invalidos,
    nota: NOTA_ASESORA,
  };
}
